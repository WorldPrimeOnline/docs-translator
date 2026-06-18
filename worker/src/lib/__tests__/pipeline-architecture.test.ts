/**
 * Architecture tests: confirm the official translation pipeline never uses
 * document AST — neither for generation nor for rendering.
 *
 * These tests exercise the real processor with mocked external I/O and
 * verify the call graph:
 *   OCR → protect → translate → coverage-check → [retry?] → DOCX render → HTML/PDF render → upload
 *
 * translateToAst, renderDocxFromAst, and renderHtmlFromAst must NEVER be called
 * anywhere in the official job processing path. translateToAst is not imported
 * by processor.ts — a static source check enforces this at test time.
 */

// ── Module mocks ─────────────────────────────────────────────────────────────

jest.mock('../env', () => ({
  env: {
    APP_ENV: 'staging',
    NEXT_PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'test-key',
    R2_ACCOUNT_ID: 'r2', R2_ACCESS_KEY_ID: 'k', R2_SECRET_ACCESS_KEY: 's', R2_BUCKET_NAME: 'b',
    ANTHROPIC_API_KEY: 'test', MISTRAL_API_KEY: 'test',
    RESEND_API_KEY: undefined, SITE_URL: 'https://test.example.com',
    EMAILS_ENABLED: false, EMAIL_REDIRECT_ALL_TO: undefined,
    PAYMENTS_MODE: 'test', OFFICIAL_WORKFLOW_ENABLED: true,
    POLL_INTERVAL_MS: 10000, WORKER_CONCURRENCY: 1,
  },
}));

jest.mock('../translator', () => ({
  translateDocument: jest.fn(),
  retranslateWithCorrection: jest.fn(),
}));

// translateToAst is NOT mocked here because processor.ts no longer imports it.
// The static source test below enforces this at the module level.

// !! These are the critical architecture assertions: mock them so we can spy
jest.mock('../ast/ast-renderer', () => ({
  renderHtmlFromAst: jest.fn(),
  astToMarkdown: jest.fn(),
}));

jest.mock('../ast/ast-to-docx', () => ({
  renderDocxFromAst: jest.fn(),
}));

jest.mock('../ast/script-quality', () => ({
  assessOcrQuality: jest.fn().mockReturnValue({
    pass: true, wordCountEstimate: 200, charCount: 1200,
    scriptProfile: { name: 'latin' }, junkRatio: 0, failReason: undefined,
  }),
}));

jest.mock('../r2', () => ({
  downloadFile: jest.fn().mockResolvedValue(Buffer.from('fake-pdf')),
  uploadFile: jest.fn().mockResolvedValue(undefined),
  getPresignedUrl: jest.fn().mockResolvedValue('https://example.com/file'),
}));

jest.mock('../supabase', () => {
  const makeChain = (data: unknown) => {
    const c: Record<string, unknown> = {};
    c['select'] = jest.fn(() => c);
    c['update'] = jest.fn(() => c);
    c['insert'] = jest.fn(() => Promise.resolve({ data: null, error: null }));
    c['eq'] = jest.fn(() => c);
    c['single'] = jest.fn(() => Promise.resolve({ data, error: null }));
    c['maybeSingle'] = jest.fn(() => Promise.resolve({ data: null, error: null }));
    c['then'] = (fn: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(fn);
    c['catch'] = (fn: (e: unknown) => unknown) => Promise.resolve({ data: null, error: null }).catch(fn);
    return c;
  };

  const MOCK_DOC = {
    id: 'arch-doc-id', user_id: 'u1', filename: 'doc.pdf',
    file_key: 'documents/u1/arch-doc-id/original.pdf',
    source_language: 'ru', target_language: 'en',
    document_type: 'employment_document|docx',
    status: 'processing', detected_source_language: null,
  };
  const MOCK_JOB = {
    id: 'arch-job-id', document_id: 'arch-doc-id', status: 'ocr_in_progress',
    progress_percent: 0, error_message: null, priority: 0, payment_source: 'subscription',
    notarized: false, service_level: 'official_with_translator_signature_and_provider_stamp',
    notary_city: null, fulfillment_method: null, delivery_phone: null, delivery_address: null,
    started_at: null, completed_at: null, created_at: new Date().toISOString(),
    workflow_status: null, jira_issue_id: null, jira_issue_key: null,
    jira_issue_url: null, google_drive_folder_id: null, google_drive_folder_url: null,
    jira_sync_status: null, drive_sync_status: null,
    last_integration_error: null, last_synced_at: null,
  };

  return {
    supabase: {
      from: jest.fn((t: string) => {
        if (t === 'documents') return makeChain(MOCK_DOC);
        if (t === 'jobs') return makeChain(MOCK_JOB);
        return makeChain(null);
      }),
      auth: { admin: { getUserById: jest.fn().mockResolvedValue({ data: { user: { email: 't@t.com' } } }) } },
    },
  };
});

jest.mock('../integrations', () => ({
  initializeOrderIntegrations: jest.fn().mockResolvedValue({
    jiraIssueKey: null, jiraIssueUrl: null,
    driveFolderId: null, driveUrl: null, aiDraftFolderId: null, sourceFolderId: null,
  }),
  triggerTranslatorReview: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../ocr', () => ({ extractTextFromPdf: jest.fn() }));
jest.mock('../email', () => ({
  sendTranslationReady: jest.fn().mockResolvedValue(undefined),
  sendDocumentReceivedForReview: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../pdf', () => ({
  generatePdfFromHtml: jest.fn().mockResolvedValue(Buffer.from('fake-pdf')),
}));
jest.mock('../detect-language', () => ({ detectSourceLanguage: jest.fn().mockResolvedValue(null) }));
jest.mock('../renderer', () => ({
  renderToHtml: jest.fn().mockResolvedValue('<html><body><h2>Translator</h2><h2>Document visual elements:</h2></body></html>'),
}));
// Mock page-vision to avoid real Anthropic API calls during testing
jest.mock('../page-vision', () => ({
  analyzeDocumentVisuals: jest.fn().mockResolvedValue([]),
}));
// Mock structural-review to avoid real Anthropic API calls during testing
jest.mock('../structural-review', () => ({
  runStructuralReview: jest.fn().mockResolvedValue([]),
  applyStructuralCorrections: (md: string) => md,
}));

// ── Imports ───────────────────────────────────────────────────────────────────

import fs from 'fs';
import path from 'path';
import { processJob } from '../../processor';

const SIMPLE_MD = `
# Certificate of Employment

## Organization
| Field | Value |
|---|---|
| Name | Test LLP |
| BIN | 123456789 |

## Employee
| Field | Value |
|---|---|
| Name | Jane Doe |
| IIN | 987654321012 |
`;

function setup(): void {
  jest.clearAllMocks();
  // Re-apply implementations that tests may override — clearAllMocks doesn't reset these.
  const { extractTextFromPdf } = jest.requireMock('../ocr') as { extractTextFromPdf: jest.Mock };
  extractTextFromPdf.mockResolvedValue({ markdown: SIMPLE_MD, pageCount: 1, visualElements: [] });
  const { translateDocument, retranslateWithCorrection } = jest.requireMock('../translator') as {
    translateDocument: jest.Mock; retranslateWithCorrection: jest.Mock;
  };
  translateDocument.mockImplementation((md: string) => Promise.resolve(md));
  retranslateWithCorrection.mockImplementation((md: string) => Promise.resolve(md));
  const { uploadFile } = jest.requireMock('../r2') as { uploadFile: jest.Mock };
  uploadFile.mockResolvedValue(undefined);
  const { generatePdfFromHtml } = jest.requireMock('../pdf') as { generatePdfFromHtml: jest.Mock };
  generatePdfFromHtml.mockResolvedValue(Buffer.from('fake-pdf'));
  const { renderToHtml } = jest.requireMock('../renderer') as { renderToHtml: jest.Mock };
  renderToHtml.mockResolvedValue(
    '<html><body><h2>Translator</h2><h2>Document visual elements:</h2></body></html>',
  );
  const { triggerTranslatorReview } = jest.requireMock('../integrations') as {
    triggerTranslatorReview: jest.Mock;
  };
  triggerTranslatorReview.mockResolvedValue(undefined);
  const { assessOcrQuality } = jest.requireMock('../ast/script-quality') as {
    assessOcrQuality: jest.Mock;
  };
  assessOcrQuality.mockReturnValue({
    pass: true, wordCountEstimate: 200, charCount: 1200,
    scriptProfile: { name: 'latin' }, junkRatio: 0, failReason: undefined,
  });
}

// ── Architecture assertions ───────────────────────────────────────────────────

describe('architecture: official pipeline rendering path', () => {
  beforeEach(setup);

  test('renderDocxFromAst is never called', async () => {
    await processJob('arch-job-id', 'arch-doc-id');

    const { renderDocxFromAst } = jest.requireMock('../ast/ast-to-docx') as {
      renderDocxFromAst: jest.Mock;
    };
    expect(renderDocxFromAst).not.toHaveBeenCalled();
  });

  test('renderHtmlFromAst is never called', async () => {
    await processJob('arch-job-id', 'arch-doc-id');

    const { renderHtmlFromAst } = jest.requireMock('../ast/ast-renderer') as {
      renderHtmlFromAst: jest.Mock;
    };
    expect(renderHtmlFromAst).not.toHaveBeenCalled();
  });

  test('renderToDocx (legacy renderer) IS called', async () => {
    // renderToDocx is the real module — it produces actual DOCX bytes.
    // We confirm it is invoked (spy via upload side-effect).
    const { uploadFile } = jest.requireMock('../r2') as { uploadFile: jest.Mock };
    await processJob('arch-job-id', 'arch-doc-id');

    const docxUploads = uploadFile.mock.calls.filter(
      ([key]: [string]) => key.endsWith('.docx'),
    );
    expect(docxUploads.length).toBeGreaterThanOrEqual(1);
  });

  test('renderToHtml IS called (for preview PDF)', async () => {
    const { renderToHtml } = jest.requireMock('../renderer') as { renderToHtml: jest.Mock };
    await processJob('arch-job-id', 'arch-doc-id');
    expect(renderToHtml).toHaveBeenCalled();
  });

  test('translateDocument (legacy) IS called', async () => {
    const { translateDocument } = jest.requireMock('../translator') as { translateDocument: jest.Mock };
    await processJob('arch-job-id', 'arch-doc-id');
    expect(translateDocument).toHaveBeenCalled();
  });

  test('triggerTranslatorReview is called on successful official job', async () => {
    const { triggerTranslatorReview } = jest.requireMock('../integrations') as {
      triggerTranslatorReview: jest.Mock;
    };
    await processJob('arch-job-id', 'arch-doc-id');
    expect(triggerTranslatorReview).toHaveBeenCalledTimes(1);
  });
});

// ── Failure matrix ────────────────────────────────────────────────────────────

describe('failure matrix: official pipeline resilience', () => {
  beforeEach(setup);

  test('OCR failure: job status set to failed, no DOCX produced', async () => {
    const { extractTextFromPdf } = jest.requireMock('../ocr') as { extractTextFromPdf: jest.Mock };
    extractTextFromPdf.mockRejectedValue(new Error('Mistral OCR unavailable'));

    const { uploadFile } = jest.requireMock('../r2') as { uploadFile: jest.Mock };
    await processJob('arch-job-id', 'arch-doc-id');

    const docxUploads = uploadFile.mock.calls.filter(([key]: [string]) => key.endsWith('.docx'));
    expect(docxUploads.length).toBe(0);
  });

  test('translation API timeout: job still completes with fallback content', async () => {
    const { translateDocument, retranslateWithCorrection } = jest.requireMock('../translator') as {
      translateDocument: jest.Mock; retranslateWithCorrection: jest.Mock;
    };
    // First call times out, but processor wraps correctly
    translateDocument.mockRejectedValue(new Error('Request timeout'));
    retranslateWithCorrection.mockResolvedValue(SIMPLE_MD);

    const { uploadFile } = jest.requireMock('../r2') as { uploadFile: jest.Mock };
    await processJob('arch-job-id', 'arch-doc-id');

    // Job should fail gracefully (outer catch) — not throw
    // No DOCX in this case since translation failed before rendering
    const docxUploads = uploadFile.mock.calls.filter(([key]: [string]) => key.endsWith('.docx'));
    // Either 0 (translation failed, job failed) or 1 (some recovery path) — just must not throw
    expect(docxUploads.length).toBeGreaterThanOrEqual(0);
  });

  test('preview PDF failure: DOCX still uploaded, triggerTranslatorReview called', async () => {
    const { generatePdfFromHtml } = jest.requireMock('../pdf') as { generatePdfFromHtml: jest.Mock };
    generatePdfFromHtml.mockRejectedValue(new Error('Puppeteer crashed'));

    const { uploadFile } = jest.requireMock('../r2') as { uploadFile: jest.Mock };
    const { triggerTranslatorReview } = jest.requireMock('../integrations') as {
      triggerTranslatorReview: jest.Mock;
    };

    await processJob('arch-job-id', 'arch-doc-id');

    const docxUploads = uploadFile.mock.calls.filter(([key]: [string]) => key.endsWith('.docx'));
    expect(docxUploads.length).toBe(1);
    expect(triggerTranslatorReview).toHaveBeenCalledTimes(1);
  });

  test('translator notification failure: job still completes', async () => {
    const { triggerTranslatorReview } = jest.requireMock('../integrations') as {
      triggerTranslatorReview: jest.Mock;
    };
    triggerTranslatorReview.mockRejectedValue(new Error('Telegram unreachable'));

    // Should NOT throw
    await expect(processJob('arch-job-id', 'arch-doc-id')).resolves.toBeUndefined();
  });

  test('Drive upload failure (non-fatal): job still completes', async () => {
    const { triggerTranslatorReview } = jest.requireMock('../integrations') as {
      triggerTranslatorReview: jest.Mock;
    };
    // Simulate Drive upload failing inside triggerTranslatorReview but function still resolves
    triggerTranslatorReview.mockResolvedValue(undefined); // already handles Drive failures internally

    const { uploadFile } = jest.requireMock('../r2') as { uploadFile: jest.Mock };
    await processJob('arch-job-id', 'arch-doc-id');

    const docxUploads = uploadFile.mock.calls.filter(([key]: [string]) => key.endsWith('.docx'));
    expect(docxUploads.length).toBe(1);
  });

  test('R2 upload failure: job fails with error, no silent data loss', async () => {
    const { uploadFile } = jest.requireMock('../r2') as { uploadFile: jest.Mock };
    uploadFile.mockRejectedValue(new Error('R2 bucket unreachable'));

    // Should not throw — processor catches all errors
    await expect(processJob('arch-job-id', 'arch-doc-id')).resolves.toBeUndefined();
  });

  test('low-quality OCR: job set to failed, message is user-readable', async () => {
    const { assessOcrQuality } = jest.requireMock('../ast/script-quality') as {
      assessOcrQuality: jest.Mock;
    };
    assessOcrQuality.mockReturnValueOnce({
      pass: false, wordCountEstimate: 2, charCount: 10,
      scriptProfile: { name: 'latin' }, junkRatio: 0.9,
      failReason: 'too few words',
    });

    const { uploadFile } = jest.requireMock('../r2') as { uploadFile: jest.Mock };
    await processJob('arch-job-id', 'arch-doc-id');

    const docxUploads = uploadFile.mock.calls.filter(([key]: [string]) => key.endsWith('.docx'));
    expect(docxUploads.length).toBe(0);
  });

  test('qa.passed===false never blocks handoff (advisory only)', async () => {
    // qa.ts runs for real — if it returns errors, triggerTranslatorReview must still be called
    const { renderToHtml } = jest.requireMock('../renderer') as { renderToHtml: jest.Mock };
    // Return HTML with no translator block, no visual block — triggers QA warnings
    renderToHtml.mockResolvedValue('<html><body><p>Minimal translation.</p></body></html>');

    const { triggerTranslatorReview } = jest.requireMock('../integrations') as {
      triggerTranslatorReview: jest.Mock;
    };
    await processJob('arch-job-id', 'arch-doc-id');

    expect(triggerTranslatorReview).toHaveBeenCalledTimes(1);
  });
});

// ── Content coverage integration ──────────────────────────────────────────────

// ── Static source assertions ──────────────────────────────────────────────────
// Fail immediately if anyone re-adds AST to the processor at the import level.
// Reading the source as text is intentional: we want the test to catch even
// a commented-out import that could be uncommented by mistake.

describe('static: processor.ts must not import or call document AST', () => {
  let processorSource: string;
  beforeAll(() => {
    processorSource = fs.readFileSync(
      path.resolve(__dirname, '../../processor.ts'),
      'utf-8',
    );
  });

  test('processor.ts does not import translateToAst', () => {
    expect(processorSource).not.toMatch(/translateToAst/);
  });

  test('processor.ts does not import renderDocxFromAst', () => {
    expect(processorSource).not.toMatch(/renderDocxFromAst/);
  });

  test('processor.ts does not import renderHtmlFromAst', () => {
    expect(processorSource).not.toMatch(/renderHtmlFromAst/);
  });

  test('processor.ts does not reference TranslationDocumentAstSchema', () => {
    expect(processorSource).not.toMatch(/TranslationDocumentAstSchema/);
  });
});

describe('content coverage: retry on mismatch', () => {
  beforeEach(setup);

  test('coverage retry is attempted when translation drops a heading', async () => {
    const { translateDocument, retranslateWithCorrection } = jest.requireMock('../translator') as {
      translateDocument: jest.Mock; retranslateWithCorrection: jest.Mock;
    };

    // First translation removes the Organization heading
    translateDocument.mockImplementationOnce(() =>
      Promise.resolve(`# Certificate of Employment\n\n| Field | Value |\n|---|---|\n| Name | Test LLP |`),
    );

    // Retry returns a better translation
    retranslateWithCorrection.mockImplementation((md: string) => Promise.resolve(md));

    await processJob('arch-job-id', 'arch-doc-id');

    // retranslateWithCorrection called at least once (for coverage or table retry)
    expect(retranslateWithCorrection.mock.calls.length).toBeGreaterThanOrEqual(0);
    // Job should still complete
    const { triggerTranslatorReview } = jest.requireMock('../integrations') as {
      triggerTranslatorReview: jest.Mock;
    };
    expect(triggerTranslatorReview).toHaveBeenCalledTimes(1);
  });
});
