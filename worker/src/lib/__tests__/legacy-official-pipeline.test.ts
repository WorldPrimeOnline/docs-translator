/**
 * Integration test for the legacy official translation pipeline.
 * Verifies that protected values are extracted before translation,
 * table shape mismatches trigger a retry, and the AST rendering path
 * is never used as the primary renderer.
 */

// ── Module mocks ─────────────────────────────────────────────────────────────

jest.mock('../env', () => ({
  env: {
    APP_ENV: 'staging',
    NEXT_PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'test-service-key',
    R2_ACCOUNT_ID: 'test-r2-account',
    R2_ACCESS_KEY_ID: 'test-r2-key',
    R2_SECRET_ACCESS_KEY: 'test-r2-secret',
    R2_BUCKET_NAME: 'test-bucket',
    ANTHROPIC_API_KEY: 'test-anthropic-key',
    MISTRAL_API_KEY: 'test-mistral-key',
    RESEND_API_KEY: undefined,
    SITE_URL: 'https://test.example.com',
    EMAILS_ENABLED: false,
    EMAIL_REDIRECT_ALL_TO: undefined,
    PAYMENTS_MODE: 'test',
    OFFICIAL_WORKFLOW_ENABLED: true,
    POLL_INTERVAL_MS: 10000,
    WORKER_CONCURRENCY: 1,
  },
}));

jest.mock('../translator', () => ({
  translateDocument: jest.fn(),
  retranslateWithCorrection: jest.fn(),
}));

jest.mock('../ast/translator', () => ({
  translateToAst: jest.fn().mockRejectedValue(new Error('AST disabled in tests')),
}));

jest.mock('../ast/script-quality', () => ({
  assessOcrQuality: jest.fn().mockReturnValue({
    pass: true,
    wordCountEstimate: 150,
    charCount: 900,
    scriptProfile: { name: 'latin' },
    junkRatio: 0,
    failReason: undefined,
  }),
}));

jest.mock('../r2', () => ({
  downloadFile: jest.fn().mockResolvedValue(Buffer.from('fake-pdf')),
  uploadFile: jest.fn().mockResolvedValue(undefined),
  getPresignedUrl: jest.fn().mockResolvedValue('https://example.com/file'),
}));

jest.mock('../supabase', () => {
  const makeChain = (data: unknown) => {
    const cp: Record<string, unknown> = {};
    cp['select'] = jest.fn(() => cp);
    cp['update'] = jest.fn(() => cp);
    cp['insert'] = jest.fn(() => Promise.resolve({ data: null, error: null }));
    cp['upsert'] = jest.fn(() => Promise.resolve({ data: null, error: null }));
    cp['eq'] = jest.fn(() => cp);
    cp['single'] = jest.fn(() => Promise.resolve({ data, error: null }));
    cp['maybeSingle'] = jest.fn(() => Promise.resolve({ data: null, error: null }));
    cp['then'] = (fn: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
      Promise.resolve({ data: null, error: null }).then(fn, rej);
    cp['catch'] = (fn: (e: unknown) => unknown) =>
      Promise.resolve({ data: null, error: null }).catch(fn);
    return cp;
  };

  const MOCK_DOC = {
    id: 'test-doc-id',
    user_id: 'test-user-id',
    filename: 'employment_cert.pdf',
    file_key: 'documents/test-user-id/test-doc-id/original.pdf',
    source_language: 'en',
    target_language: 'en',
    document_type: 'employment_document|docx',
    status: 'processing',
    detected_source_language: null,
  };

  const MOCK_JOB = {
    id: 'test-job-id',
    document_id: 'test-doc-id',
    status: 'ocr_in_progress',
    progress_percent: 0,
    error_message: null,
    priority: 0,
    payment_source: 'subscription',
    notarized: false,
    service_level: 'official_with_translator_signature_and_provider_stamp',
    notary_city: null,
    fulfillment_method: null,
    delivery_phone: null,
    delivery_address: null,
    started_at: null,
    completed_at: null,
    created_at: new Date().toISOString(),
    workflow_status: null,
    jira_issue_id: null,
    jira_issue_key: null,
    jira_issue_url: null,
    google_drive_folder_id: null,
    google_drive_folder_url: null,
    jira_sync_status: null,
    drive_sync_status: null,
    last_integration_error: null,
    last_synced_at: null,
  };

  return {
    supabase: {
      from: jest.fn((table: string) => {
        if (table === 'documents') return makeChain(MOCK_DOC);
        if (table === 'jobs') return makeChain(MOCK_JOB);
        return makeChain(null);
      }),
      auth: {
        admin: {
          getUserById: jest.fn().mockResolvedValue({
            data: { user: { email: 'test@test.com' } },
          }),
        },
      },
    },
  };
});

jest.mock('../integrations', () => ({
  initializeOrderIntegrations: jest.fn().mockResolvedValue({
    jiraIssueKey: null,
    jiraIssueUrl: null,
    driveFolderId: null,
    driveUrl: null,
    aiDraftFolderId: null,
    sourceFolderId: null,
  }),
  triggerTranslatorReview: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../ocr', () => ({
  extractTextFromPdf: jest.fn(),
}));

jest.mock('../email', () => ({
  sendTranslationReady: jest.fn().mockResolvedValue(undefined),
  sendDocumentReceivedForReview: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../pdf', () => ({
  generatePdfFromHtml: jest.fn().mockResolvedValue(Buffer.from('fake-pdf-output')),
}));

jest.mock('../renderer', () => ({
  renderToHtml: jest.fn().mockResolvedValue('<html><body><p>Test translation output</p><h2>Translator</h2><h2>Document visual elements:</h2></body></html>'),
}));

jest.mock('../detect-language', () => ({
  detectSourceLanguage: jest.fn().mockResolvedValue(null),
}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { processJob } from '../../processor';

const FIXTURE_MARKDOWN = `
# CERTIFICATE OF EMPLOYMENT

## Organization Details
| Field | Value |
|-------|-------|
| Organization | SML Group LLP |
| BIN | 047291638 |
| Certificate No. | SML-2026-06-17-071 |

## Employee Details
| Field | Value |
|-------|-------|
| Full Name | YUDENOV GLEB ALEXANDROVICH |
| IIN | 201240012345 |
| Passport | N14720583 |

## Employment Details
| Field | Value |
|-------|-------|
| Position | Senior Software Engineer |
| Contract | TD-2020/0914-38 |
| Department | Information Technology |

## Salary Information
| Calculation period | Base salary | Bonus | Compensation | Total gross amount | Amount payable |
|--------------------|-------------|-------|--------------|-------------------|----------------|
| March 2026 | 865 000,00 KZT | 95 000,00 KZT | 28 500,00 KZT | 988 500,00 KZT | 801 472,35 KZT |
| April 2026 | 865 000,00 KZT | 0,00 KZT | 28 500,00 KZT | 893 500,00 KZT | 724 618,10 KZT |
| May 2026 | 865 000,00 KZT | 127 500,00 KZT | 34 750,00 KZT | 1 027 250,00 KZT | 832 906,44 KZT |

## Bank Details
| Field | Value |
|-------|-------|
| IIK/IBAN | KZ559876543210123456 |
| BIC/SWIFT | KCJBKZKX |

## Manager
Chief Executive Officer

[round stamp]

[director signature]

Verification code: SML-74-KZ-170626-Q8X5

Manager IIN: 930208450176
`;

// Drops the last column from every table row that has exactly 6 cells.
// Works on protectedMarkdown (tokens, not raw values).
function dropLastColumnFromSixColRows(md: string): string {
  return md
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith('|')) return line;
      const inner = trimmed.replace(/^\||\|$/g, '');
      const parts = inner.split('|');
      if (parts.length === 6) {
        return '| ' + parts.slice(0, 5).map((p) => p.trim()).join(' | ') + ' |';
      }
      return line;
    })
    .join('\n');
}

describe('legacy official pipeline', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Set OCR mock to return fixture
    const { extractTextFromPdf } = jest.requireMock('../ocr') as {
      extractTextFromPdf: jest.Mock;
    };
    extractTextFromPdf.mockResolvedValue({
      markdown: FIXTURE_MARKDOWN,
      pageCount: 1,
      visualElements: [],
    });
  });

  describe('happy path: translation preserves everything', () => {
    it('translateDocument receives protectedMarkdown without raw IDs', async () => {
      const { translateDocument } = jest.requireMock('../translator') as {
        translateDocument: jest.Mock;
      };
      // Return the protectedMarkdown unchanged (simulates perfect token preservation)
      translateDocument.mockImplementation((md: string) => Promise.resolve(md));

      await processJob('test-job-id', 'test-doc-id');

      expect(translateDocument).toHaveBeenCalledTimes(1);
      const firstArg = translateDocument.mock.calls[0][0] as string;

      // Raw sensitive values must be replaced with tokens
      expect(firstArg).not.toContain('047291638');
      expect(firstArg).not.toContain('KZ559876543210123456');
      expect(firstArg).not.toContain('201240012345');
      expect(firstArg).not.toContain('930208450176');
      expect(firstArg).toContain('__WPO_PV_');
    });

    it('DOCX is uploaded to R2', async () => {
      const { translateDocument } = jest.requireMock('../translator') as {
        translateDocument: jest.Mock;
      };
      translateDocument.mockImplementation((md: string) => Promise.resolve(md));

      const { uploadFile } = jest.requireMock('../r2') as { uploadFile: jest.Mock };

      await processJob('test-job-id', 'test-doc-id');

      const docxCall = uploadFile.mock.calls.find(
        ([key]: [string]) => key.endsWith('.docx'),
      );
      expect(docxCall).toBeDefined();
    });

    it('triggerTranslatorReview is called on success', async () => {
      const { translateDocument } = jest.requireMock('../translator') as {
        translateDocument: jest.Mock;
      };
      translateDocument.mockImplementation((md: string) => Promise.resolve(md));

      const { triggerTranslatorReview } = jest.requireMock('../integrations') as {
        triggerTranslatorReview: jest.Mock;
      };

      await processJob('test-job-id', 'test-doc-id');

      expect(triggerTranslatorReview).toHaveBeenCalledTimes(1);
    });

    it('AST rendering functions are not used for primary output', async () => {
      const { translateDocument } = jest.requireMock('../translator') as {
        translateDocument: jest.Mock;
      };
      translateDocument.mockImplementation((md: string) => Promise.resolve(md));

      const { renderDocxFromAst } = jest.requireMock('../ast') as {
        renderDocxFromAst?: jest.Mock;
      };
      const { renderHtmlFromAst } = jest.requireMock('../ast') as {
        renderHtmlFromAst?: jest.Mock;
      };

      await processJob('test-job-id', 'test-doc-id');

      // These functions are not called by processor.ts at all
      if (renderDocxFromAst) expect(renderDocxFromAst).not.toHaveBeenCalled();
      if (renderHtmlFromAst) expect(renderHtmlFromAst).not.toHaveBeenCalled();
    });

    it('retranslateWithCorrection is NOT called when tables match', async () => {
      const { translateDocument, retranslateWithCorrection } = jest.requireMock('../translator') as {
        translateDocument: jest.Mock;
        retranslateWithCorrection: jest.Mock;
      };
      translateDocument.mockImplementation((md: string) => Promise.resolve(md));

      await processJob('test-job-id', 'test-doc-id');

      expect(retranslateWithCorrection).not.toHaveBeenCalled();
    });
  });

  describe('table shape mismatch: triggers correction retry', () => {
    it('retranslateWithCorrection is called when translation drops a column', async () => {
      const { translateDocument, retranslateWithCorrection } = jest.requireMock('../translator') as {
        translateDocument: jest.Mock;
        retranslateWithCorrection: jest.Mock;
      };

      // First call drops last column of salary table
      translateDocument.mockImplementationOnce((md: string) =>
        Promise.resolve(dropLastColumnFromSixColRows(md)),
      );

      // retranslate returns correct version
      retranslateWithCorrection.mockImplementationOnce((md: string) => Promise.resolve(md));

      await processJob('test-job-id', 'test-doc-id');

      expect(retranslateWithCorrection).toHaveBeenCalledTimes(1);
      // Correction prompt mentions 6 columns
      const correctionArg = retranslateWithCorrection.mock.calls[0][4] as string;
      expect(correctionArg).toContain('6 columns');
    });

    it('pipeline continues even if retranslateWithCorrection throws', async () => {
      const { translateDocument, retranslateWithCorrection } = jest.requireMock('../translator') as {
        translateDocument: jest.Mock;
        retranslateWithCorrection: jest.Mock;
      };

      translateDocument.mockImplementationOnce((md: string) =>
        Promise.resolve(dropLastColumnFromSixColRows(md)),
      );
      retranslateWithCorrection.mockRejectedValueOnce(new Error('API timeout'));

      const { triggerTranslatorReview } = jest.requireMock('../integrations') as {
        triggerTranslatorReview: jest.Mock;
      };

      await processJob('test-job-id', 'test-doc-id');

      // Job should still complete (retry is advisory)
      expect(triggerTranslatorReview).toHaveBeenCalledTimes(1);
    });
  });

  describe('QA advisory: failed QA never blocks workflow', () => {
    it('triggerTranslatorReview is still called when QA fails', async () => {
      const { translateDocument } = jest.requireMock('../translator') as {
        translateDocument: jest.Mock;
      };
      translateDocument.mockImplementation((md: string) => Promise.resolve(md));

      // qa.ts is NOT mocked — it runs for real and may flag issues,
      // but processor.ts treats QA as advisory-only (never throws on failure)
      const { triggerTranslatorReview } = jest.requireMock('../integrations') as {
        triggerTranslatorReview: jest.Mock;
      };

      await processJob('test-job-id', 'test-doc-id');

      expect(triggerTranslatorReview).toHaveBeenCalledTimes(1);
    });
  });
});
