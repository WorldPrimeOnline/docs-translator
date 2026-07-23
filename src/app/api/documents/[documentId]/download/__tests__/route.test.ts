/**
 * Tests: GET /api/documents/[documentId]/download
 *
 * Covers:
 * - Legacy single-file jobs (no job_source_files): exact pre-2026-08-01 behavior
 *   preserved for all three service levels.
 * - 2026-08-01 multi-file fulfillment decision: Electronic serves
 *   electronic_final_*, Official serves signature_stamp, Notary serves notary —
 *   single ready file downloads directly, multiple are zipped, and an incomplete
 *   result set is refused outright (never a partial/inconsistent download).
 * - The key behavior CHANGE: multi-source Notary becomes downloadable once
 *   job_result_files(stage='notary') is fully synced — legacy notary stays blocked.
 */
jest.mock('next/headers', () => ({
  cookies: jest.fn().mockResolvedValue({ getAll: () => [], set: jest.fn() }),
}));
jest.mock('@supabase/ssr', () => ({ createServerClient: jest.fn() }));
jest.mock('@/lib/supabase/server', () => ({ supabaseServer: { from: jest.fn() } }));
jest.mock('@/lib/r2/client', () => ({ downloadFile: jest.fn() }));

const mockGetResultFilesStatus = jest.fn();
jest.mock('@/lib/jobs/result-files-status', () => ({
  getResultFilesStatus: (...args: unknown[]) => mockGetResultFilesStatus(...args),
}));

import { GET } from '../route';
import { createServerClient } from '@supabase/ssr';
import { supabaseServer } from '@/lib/supabase/server';
import { downloadFile } from '@/lib/r2/client';

const mockCreateServerClient = createServerClient as jest.MockedFunction<typeof createServerClient>;
const mockFrom = supabaseServer.from as jest.Mock;
const mockDownloadFile = downloadFile as jest.Mock;

const USER = { id: 'user-1' };
const DOC_ID = 'doc-1';

function chain(result: { data?: unknown; error?: unknown; count?: number }) {
  const c: Record<string, unknown> = {};
  const methods = ['select', 'eq', 'order', 'limit'];
  for (const m of methods) c[m] = jest.fn(() => c);
  c.single = jest.fn(() => Promise.resolve(result));
  c.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return c;
}

function setAuth(user: { id: string } | null) {
  mockCreateServerClient.mockReturnValue({
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user } }) },
  } as unknown as ReturnType<typeof createServerClient>);
}

async function callGET(documentId = DOC_ID) {
  const req = {} as Parameters<typeof GET>[0];
  const res = await GET(req, { params: Promise.resolve({ documentId }) });
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
  setAuth(USER);
});

describe('legacy jobs (no job_source_files) — exact pre-existing behavior', () => {
  it('electronic: serves translations.translated_pdf_key', async () => {
    mockFrom
      .mockReturnValueOnce(chain({ data: { user_id: USER.id, filename: 'passport.pdf', document_type: 'passport_id' }, error: null })) // documents
      .mockReturnValueOnce(chain({ data: { id: 'job-1', workflow_status: null, service_level: 'electronic', fulfillment_method: null }, error: null })) // jobs
      .mockReturnValueOnce(chain({ count: 0 })) // job_source_files count = 0
      .mockReturnValueOnce(chain({ data: { translated_pdf_key: 'documents/user-1/doc-1/translated.docx' }, error: null })); // translations
    mockDownloadFile.mockResolvedValueOnce(Buffer.from('docx-bytes'));

    const res = await callGET();
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Disposition')).toContain('.docx');
    expect(mockGetResultFilesStatus).not.toHaveBeenCalled();
  });

  it('notarized: always 403, regardless of workflow_status', async () => {
    mockFrom
      .mockReturnValueOnce(chain({ data: { user_id: USER.id, filename: 'x.pdf', document_type: 'x' }, error: null }))
      .mockReturnValueOnce(chain({ data: { id: 'job-1', workflow_status: 'notarized', service_level: 'notarization_through_partners', fulfillment_method: 'delivery' }, error: null }))
      .mockReturnValueOnce(chain({ count: 0 }));

    const res = await callGET();
    expect(res.status).toBe(403);
  });

  it('official: 403 while awaiting_translator_review, 200 at ready_for_delivery', async () => {
    mockFrom
      .mockReturnValueOnce(chain({ data: { user_id: USER.id, filename: 'x.pdf', document_type: 'x' }, error: null }))
      .mockReturnValueOnce(chain({ data: { id: 'job-1', workflow_status: 'awaiting_translator_review', service_level: 'official_with_translator_signature_and_provider_stamp', fulfillment_method: null }, error: null }))
      .mockReturnValueOnce(chain({ count: 0 }));
    const res1 = await callGET();
    expect(res1.status).toBe(403);

    jest.clearAllMocks();
    setAuth(USER);
    mockFrom
      .mockReturnValueOnce(chain({ data: { user_id: USER.id, filename: 'x.pdf', document_type: 'x' }, error: null }))
      .mockReturnValueOnce(chain({ data: { id: 'job-1', workflow_status: 'ready_for_delivery', service_level: 'official_with_translator_signature_and_provider_stamp', fulfillment_method: null }, error: null }))
      .mockReturnValueOnce(chain({ count: 0 }))
      .mockReturnValueOnce(chain({ data: { translated_pdf_key: 'documents/user-1/doc-1/translator_draft.docx' }, error: null }));
    mockDownloadFile.mockResolvedValueOnce(Buffer.from('docx-bytes'));
    const res2 = await callGET();
    expect(res2.status).toBe(200);
  });
});

describe('multi-source jobs (job_source_files rows exist)', () => {
  it('electronic: single ready result file downloads directly as "Output.docx" — never the original filename or the internal translated.docx name', async () => {
    mockFrom
      .mockReturnValueOnce(chain({ data: { user_id: USER.id, filename: 'passport.pdf', document_type: 'passport_id' }, error: null }))
      .mockReturnValueOnce(chain({ data: { id: 'job-1', workflow_status: null, service_level: 'electronic', fulfillment_method: null }, error: null }))
      .mockReturnValueOnce(chain({ count: 1 }));
    mockGetResultFilesStatus.mockResolvedValueOnce({
      isMultiSource: true, hasReadyResultFiles: true,
      readyFiles: [{ sequenceMin: 1, sourceSequences: [1], filename: 'passport_translated.docx', r2Key: 'documents/user-1/doc-1/sources/001/translated.docx' }],
    });
    mockDownloadFile.mockResolvedValueOnce(Buffer.from('docx-bytes'));

    const res = await callGET();
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Disposition')).toBe('attachment; filename="Output.docx"');
    expect(res.headers.get('Content-Type')).toContain('wordprocessingml');
  });

  it('electronic: single ready result file, html output — "Output.html"', async () => {
    mockFrom
      .mockReturnValueOnce(chain({ data: { user_id: USER.id, filename: 'passport.pdf', document_type: 'passport_id' }, error: null }))
      .mockReturnValueOnce(chain({ data: { id: 'job-1', workflow_status: null, service_level: 'electronic', fulfillment_method: null }, error: null }))
      .mockReturnValueOnce(chain({ count: 1 }));
    mockGetResultFilesStatus.mockResolvedValueOnce({
      isMultiSource: true, hasReadyResultFiles: true,
      readyFiles: [{ sequenceMin: 1, sourceSequences: [1], filename: 'passport_translated.html', r2Key: 'k1' }],
    });
    mockDownloadFile.mockResolvedValueOnce(Buffer.from('html-bytes'));

    const res = await callGET();
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Disposition')).toBe('attachment; filename="Output.html"');
  });

  it('electronic: multiple ready result files are zipped as WPO_<short-job-id>_Output.zip, entries named 001_Output.docx/002_Output.docx, sorted by minimum sequence', async () => {
    mockFrom
      .mockReturnValueOnce(chain({ data: { user_id: USER.id, filename: 'docs.pdf', document_type: 'passport_id' }, error: null }))
      .mockReturnValueOnce(chain({ data: { id: 'job-12345678-abcd', workflow_status: null, service_level: 'electronic', fulfillment_method: null }, error: null }))
      .mockReturnValueOnce(chain({ count: 2 }));
    mockGetResultFilesStatus.mockResolvedValueOnce({
      isMultiSource: true, hasReadyResultFiles: true,
      readyFiles: [
        { sequenceMin: 1, sourceSequences: [1], filename: 'a_translated.docx', r2Key: 'k1' },
        { sequenceMin: 2, sourceSequences: [2], filename: 'b_translated.docx', r2Key: 'k2' },
      ],
    });
    mockDownloadFile.mockResolvedValue(Buffer.from('bytes'));

    const res = await callGET();
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/zip');
    expect(res.headers.get('Content-Disposition')).toBe('attachment; filename="WPO_job-1234_Output.zip"');
    expect(mockDownloadFile).toHaveBeenCalledWith('k1');
    expect(mockDownloadFile).toHaveBeenCalledWith('k2');

    const zipBuffer = Buffer.from(await res.arrayBuffer());
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(zipBuffer);
    expect(Object.keys(zip.files).sort()).toEqual(['001_Output.docx', '002_Output.docx']);
  });

  it('official: not fully synced (hasReadyResultFiles=false) → 403 even at ready_for_delivery', async () => {
    mockFrom
      .mockReturnValueOnce(chain({ data: { user_id: USER.id, filename: 'x.pdf', document_type: 'x' }, error: null }))
      .mockReturnValueOnce(chain({ data: { id: 'job-1', workflow_status: 'ready_for_delivery', service_level: 'official_with_translator_signature_and_provider_stamp', fulfillment_method: null }, error: null }))
      .mockReturnValueOnce(chain({ count: 2 }));
    mockGetResultFilesStatus.mockResolvedValueOnce({ isMultiSource: true, hasReadyResultFiles: false, readyFiles: [] });

    const res = await callGET();
    expect(res.status).toBe(403);
    expect(mockDownloadFile).not.toHaveBeenCalled();
  });

  it('official: fully synced AND operator-confirmed → serves signature_stamp file', async () => {
    mockFrom
      .mockReturnValueOnce(chain({ data: { user_id: USER.id, filename: 'contract.pdf', document_type: 'contract' }, error: null }))
      .mockReturnValueOnce(chain({ data: { id: 'job-1', workflow_status: 'ready_for_delivery', service_level: 'official_with_translator_signature_and_provider_stamp', fulfillment_method: null }, error: null }))
      .mockReturnValueOnce(chain({ count: 1 }));
    mockGetResultFilesStatus.mockResolvedValueOnce({
      isMultiSource: true, hasReadyResultFiles: true,
      readyFiles: [{ sequenceMin: 1, sourceSequences: [1], filename: '001_SIGNED.pdf', r2Key: 'results/signature_stamp/001.pdf' }],
    });
    mockDownloadFile.mockResolvedValueOnce(Buffer.from('pdf-bytes'));

    const res = await callGET();
    expect(res.status).toBe(200);
    expect(mockDownloadFile).toHaveBeenCalledWith('results/signature_stamp/001.pdf');
    expect(res.headers.get('Content-Disposition')).toBe('attachment; filename="Output.pdf"');
  });

  it('notary — THE key behavior change: fully synced → downloadable (legacy notary was always blocked)', async () => {
    mockFrom
      .mockReturnValueOnce(chain({ data: { user_id: USER.id, filename: 'x.pdf', document_type: 'x' }, error: null }))
      .mockReturnValueOnce(chain({ data: { id: 'job-1', workflow_status: 'notarized', service_level: 'notarization_through_partners', fulfillment_method: 'delivery' }, error: null }))
      .mockReturnValueOnce(chain({ count: 1 }));
    mockGetResultFilesStatus.mockResolvedValueOnce({
      isMultiSource: true, hasReadyResultFiles: true,
      readyFiles: [{ sequenceMin: 1, sourceSequences: [1], filename: '001_NOTARY.pdf', r2Key: 'results/notary/001.pdf' }],
    });
    mockDownloadFile.mockResolvedValueOnce(Buffer.from('pdf-bytes'));

    const res = await callGET();
    expect(res.status).toBe(200);
    expect(mockDownloadFile).toHaveBeenCalledWith('results/notary/001.pdf');
    expect(res.headers.get('Content-Disposition')).toBe('attachment; filename="Output.pdf"');
  });

  it('notary — pickup fulfillment, fully synced → downloadable, identical to the delivery case above (fulfillment method never affects digital availability)', async () => {
    mockFrom
      .mockReturnValueOnce(chain({ data: { user_id: USER.id, filename: 'x.pdf', document_type: 'x' }, error: null }))
      .mockReturnValueOnce(chain({ data: { id: 'job-1', workflow_status: 'notarized', service_level: 'notarization_through_partners', fulfillment_method: 'pickup' }, error: null }))
      .mockReturnValueOnce(chain({ count: 1 }));
    mockGetResultFilesStatus.mockResolvedValueOnce({
      isMultiSource: true, hasReadyResultFiles: true,
      readyFiles: [{ sequenceMin: 1, sourceSequences: [1], filename: '001_NOTARY.pdf', r2Key: 'results/notary/001.pdf' }],
    });
    mockDownloadFile.mockResolvedValueOnce(Buffer.from('pdf-bytes'));

    const res = await callGET();
    expect(res.status).toBe(200);
    expect(mockDownloadFile).toHaveBeenCalledWith('results/notary/001.pdf');
  });

  it('notary — no fulfillment_method set (null), fully synced → still downloadable (digital access never depends on fulfillment method)', async () => {
    mockFrom
      .mockReturnValueOnce(chain({ data: { user_id: USER.id, filename: 'x.pdf', document_type: 'x' }, error: null }))
      .mockReturnValueOnce(chain({ data: { id: 'job-1', workflow_status: 'notarized', service_level: 'notarization_through_partners', fulfillment_method: null }, error: null }))
      .mockReturnValueOnce(chain({ count: 1 }));
    mockGetResultFilesStatus.mockResolvedValueOnce({
      isMultiSource: true, hasReadyResultFiles: true,
      readyFiles: [{ sequenceMin: 1, sourceSequences: [1], filename: '001_NOTARY.pdf', r2Key: 'results/notary/001.pdf' }],
    });
    mockDownloadFile.mockResolvedValueOnce(Buffer.from('pdf-bytes'));

    const res = await callGET();
    expect(res.status).toBe(200);
  });

  it('notary — download stays available past notarized, through ready_for_delivery/out_for_delivery/delivered, once synced (never regresses)', async () => {
    for (const ws of ['ready_for_delivery', 'out_for_delivery', 'delivered']) {
      jest.clearAllMocks();
      setAuth(USER);
      mockFrom
        .mockReturnValueOnce(chain({ data: { user_id: USER.id, filename: 'x.pdf', document_type: 'x' }, error: null }))
        .mockReturnValueOnce(chain({ data: { id: 'job-1', workflow_status: ws, service_level: 'notarization_through_partners', fulfillment_method: 'delivery' }, error: null }))
        .mockReturnValueOnce(chain({ count: 1 }));
      mockGetResultFilesStatus.mockResolvedValueOnce({
        isMultiSource: true, hasReadyResultFiles: true,
        readyFiles: [{ sequenceMin: 1, sourceSequences: [1], filename: '001_NOTARY.pdf', r2Key: 'results/notary/001.pdf' }],
      });
      mockDownloadFile.mockResolvedValueOnce(Buffer.from('pdf-bytes'));

      const res = await callGET();
      expect(res.status).toBe(200);
    }
  });

  it('notary: not yet synced → 403, never falls back to serving anything', async () => {
    mockFrom
      .mockReturnValueOnce(chain({ data: { user_id: USER.id, filename: 'x.pdf', document_type: 'x' }, error: null }))
      .mockReturnValueOnce(chain({ data: { id: 'job-1', workflow_status: 'notarized', service_level: 'notarization_through_partners', fulfillment_method: 'pickup' }, error: null }))
      .mockReturnValueOnce(chain({ count: 1 }));
    mockGetResultFilesStatus.mockResolvedValueOnce({ isMultiSource: true, hasReadyResultFiles: false, readyFiles: [] });

    const res = await callGET();
    expect(res.status).toBe(403);
    expect(mockDownloadFile).not.toHaveBeenCalled();
  });

  it('an inconsistent state (canDownload somehow true but readyFiles empty) still refuses to serve — defense in depth', async () => {
    mockFrom
      .mockReturnValueOnce(chain({ data: { user_id: USER.id, filename: 'x.pdf', document_type: 'x' }, error: null }))
      .mockReturnValueOnce(chain({ data: { id: 'job-1', workflow_status: 'notarized', service_level: 'notarization_through_partners', fulfillment_method: 'pickup' }, error: null }))
      .mockReturnValueOnce(chain({ count: 1 }));
    // hasReadyResultFiles true (so canDownload would be true) but readyFiles is empty —
    // must never happen in practice, but the route must not trust hasReadyResultFiles alone.
    mockGetResultFilesStatus.mockResolvedValueOnce({ isMultiSource: true, hasReadyResultFiles: true, readyFiles: [] });

    const res = await callGET();
    expect(res.status).toBe(404);
    expect(mockDownloadFile).not.toHaveBeenCalled();
  });
});

describe('auth/ownership (unchanged)', () => {
  it('401 when unauthenticated', async () => {
    setAuth(null);
    const res = await callGET();
    expect(res.status).toBe(401);
  });

  it('403 when the document belongs to another user', async () => {
    mockFrom.mockReturnValueOnce(chain({ data: { user_id: 'someone-else', filename: 'x.pdf', document_type: 'x' }, error: null }));
    const res = await callGET();
    expect(res.status).toBe(403);
  });

  it('403 for another user\'s fully-synced, ready-to-download multi-source notary result — ownership is checked before the job/service-level/stage branch is ever reached, so a ready notary result never leaks across users', async () => {
    mockFrom.mockReturnValueOnce(chain({ data: { user_id: 'someone-else', filename: 'x.pdf', document_type: 'x' }, error: null }));
    // Deliberately do NOT queue a jobs/job_source_files/getResultFilesStatus mock —
    // if ownership weren't checked first, the route would throw or 404 instead of a
    // clean 403, so this also proves the multi-source branch is never reached.
    const res = await callGET();
    expect(res.status).toBe(403);
    expect(mockGetResultFilesStatus).not.toHaveBeenCalled();
    expect(mockDownloadFile).not.toHaveBeenCalled();
  });
});

describe('retention expiry (2026-07-24) — documents.files_purged_at', () => {
  it('a purged document returns 410 RETENTION_EXPIRED immediately after ownership, before the job/service-level/multi-source branch', async () => {
    mockFrom.mockReturnValueOnce(chain({
      data: { user_id: USER.id, filename: 'x.pdf', document_type: 'x', files_purged_at: '2026-06-01T00:00:00.000Z' },
      error: null,
    }));

    const res = await callGET();
    const body = await res.json();

    expect(res.status).toBe(410);
    expect(body).toEqual({ error: 'RETENTION_EXPIRED', filesPurgedAt: '2026-06-01T00:00:00.000Z' });
    expect(mockGetResultFilesStatus).not.toHaveBeenCalled();
    expect(mockDownloadFile).not.toHaveBeenCalled();
  });

  it('a non-purged document (files_purged_at null) is unaffected — falls through to the normal path', async () => {
    mockFrom
      .mockReturnValueOnce(chain({ data: { user_id: USER.id, filename: 'passport.pdf', document_type: 'passport_id', files_purged_at: null }, error: null }))
      .mockReturnValueOnce(chain({ data: { id: 'job-1', workflow_status: null, service_level: 'electronic', fulfillment_method: null }, error: null }))
      .mockReturnValueOnce(chain({ count: 0 }))
      .mockReturnValueOnce(chain({ data: { translated_pdf_key: 'k' }, error: null }));
    mockDownloadFile.mockResolvedValueOnce(Buffer.from('bytes'));

    const res = await callGET();
    expect(res.status).toBe(200);
  });

  it('a purged notary result — even if job_result_files rows were somehow left behind — never leaks a download: retention check runs before the multi-source branch', async () => {
    mockFrom.mockReturnValueOnce(chain({
      data: { user_id: USER.id, filename: 'x.pdf', document_type: 'x', files_purged_at: '2026-06-01T00:00:00.000Z' },
      error: null,
    }));

    const res = await callGET();
    expect(res.status).toBe(410);
    // job_source_files count / getResultFilesStatus never reached.
    expect(mockGetResultFilesStatus).not.toHaveBeenCalled();
  });
});
