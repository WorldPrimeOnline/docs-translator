/**
 * @jest-environment node
 *
 * Regression tests for web processor service-level guard.
 * Certified/notarized jobs must NOT be processed by the web processor —
 * they must stay queued for the Railway worker.
 */

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockOcr = jest.fn();
const mockTranslate = jest.fn();
const mockJobSingle = jest.fn();
const mockDocSingle = jest.fn();
const mockJobUpdate = jest.fn();
const mockDocUpdate = jest.fn();
const mockInsert = jest.fn();

jest.mock('@/lib/ocr/mistral', () => ({ extractTextFromPdf: mockOcr }));
jest.mock('@/lib/translation/translator', () => ({ translateDocument: mockTranslate }));
jest.mock('@/lib/translation/detect-language', () => ({ detectSourceLanguage: jest.fn().mockResolvedValue('kk') }));
jest.mock('@/lib/pdf/renderer', () => ({
  renderToPdf: jest.fn().mockResolvedValue(Buffer.from('html')),
  renderToPdfBuffer: jest.fn().mockResolvedValue(Buffer.from('pdf')),
}));
jest.mock('@/lib/pdf/docx-renderer', () => ({ renderToDocx: jest.fn().mockResolvedValue(Buffer.from('docx')) }));
jest.mock('@/lib/r2/client', () => ({
  downloadFile: jest.fn().mockResolvedValue(Buffer.from('pdf')),
  uploadFile: jest.fn().mockResolvedValue(undefined),
}));

// Chainable supabase mock — job queries use mockJobSingle, doc queries use mockDocSingle
jest.mock('@/lib/supabase/server', () => {
  const jobChain = { select: jest.fn(), eq: jest.fn(), update: jest.fn(), single: mockJobSingle };
  jobChain.select.mockReturnValue(jobChain);
  jobChain.eq.mockReturnValue(jobChain);
  jobChain.update.mockReturnValue({ eq: mockJobUpdate });

  const docChain = { select: jest.fn(), eq: jest.fn(), update: jest.fn(), single: mockDocSingle, insert: mockInsert };
  docChain.select.mockReturnValue(docChain);
  docChain.eq.mockReturnValue(docChain);
  docChain.update.mockReturnValue({ eq: mockDocUpdate });
  docChain.insert.mockReturnValue({ select: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: null, error: null }) }) });

  const ocrChain = { insert: mockInsert };

  return {
    supabaseServer: {
      from: jest.fn((table: string) => {
        if (table === 'jobs') return jobChain;
        if (table === 'documents') return docChain;
        return ocrChain;
      }),
    },
  };
});

import { processJob } from '../processor';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const JOB_ID = '00000000-0000-4000-8000-000000000001';
const DOC_ID = '00000000-0000-4000-8000-000000000002';

function makeJobRow(serviceLevel: string) {
  return { id: JOB_ID, service_level: serviceLevel, notarized: false, document_id: DOC_ID };
}

function makeDocRow() {
  return {
    id: DOC_ID, user_id: 'user-1',
    file_key: 'documents/user-1/doc/original.pdf',
    source_language: 'kk', target_language: 'ru',
    document_type: 'passport_id|html', filename: 'test.pdf', status: 'processing',
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('processJob — service-level guard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockJobUpdate.mockResolvedValue({ error: null });
    mockDocUpdate.mockResolvedValue({ error: null });
    mockInsert.mockResolvedValue({ error: null });
    // Must be >10 words AND >50 chars to pass OCR quality gate
    mockOcr.mockResolvedValue({ markdown: 'This is a sample document with enough words and characters to pass the OCR quality gate check.', pageCount: 1 });
    mockTranslate.mockResolvedValue('translated text content');
  });

  it('does NOT run OCR for certified (official_with_translator_signature) job', async () => {
    mockJobSingle.mockResolvedValueOnce({ data: makeJobRow('official_with_translator_signature_and_provider_stamp'), error: null });

    await processJob(JOB_ID, DOC_ID);

    expect(mockOcr).not.toHaveBeenCalled();
    expect(mockTranslate).not.toHaveBeenCalled();
  });

  it('does NOT run OCR for notarized (notarization_through_partners) job', async () => {
    mockJobSingle.mockResolvedValueOnce({ data: makeJobRow('notarization_through_partners'), error: null });

    await processJob(JOB_ID, DOC_ID);

    expect(mockOcr).not.toHaveBeenCalled();
    expect(mockTranslate).not.toHaveBeenCalled();
  });

  it('does NOT change job status for non-electronic job (stays queued)', async () => {
    mockJobSingle.mockResolvedValueOnce({ data: makeJobRow('notarization_through_partners'), error: null });

    await processJob(JOB_ID, DOC_ID);

    // updateJob('ocr_in_progress') would call supabaseServer.from('jobs').update(...)
    // which would trigger mockJobUpdate. Verify it was NOT called.
    expect(mockJobUpdate).not.toHaveBeenCalled();
  });

  it('runs full pipeline for electronic job', async () => {
    mockJobSingle.mockResolvedValueOnce({ data: makeJobRow('electronic'), error: null });
    mockDocSingle.mockResolvedValueOnce({ data: makeDocRow(), error: null });
    mockInsert.mockResolvedValue({ error: null });

    await processJob(JOB_ID, DOC_ID);

    expect(mockOcr).toHaveBeenCalledTimes(1);
    expect(mockTranslate).toHaveBeenCalledTimes(1);
  });

  it('falls back to non-electronic for notarized=true legacy job (no service_level)', async () => {
    // Old rows without service_level column — notarized=true should NOT go through web processor
    mockJobSingle.mockResolvedValueOnce({
      data: { id: JOB_ID, service_level: null, notarized: true, document_id: DOC_ID },
      error: null,
    });

    await processJob(JOB_ID, DOC_ID);

    // notarized=true → falls back to 'official_with_...' → web processor refuses
    expect(mockOcr).not.toHaveBeenCalled();
  });
});
