/**
 * GET /api/jobs — ordering regression (2026-08-03 dashboard-ordering incident):
 * "если есть старые payment_pending / processing заказы, новый заказ после
 * завершения оказывается ниже них." The route used to map over `docs` (sorted by
 * documents.created_at DESC) unchanged, which is NOT the same guarantee as
 * jobs.created_at DESC — a document created early whose job is created/re-created
 * much later (or vice versa) would sort wrong. This locks in: response order is
 * strictly jobs.created_at DESC (documents.created_at fallback only when a
 * document has no job), with a stable id DESC tie-breaker, never grouped by status.
 */
import { GET } from '../route';

jest.mock('next/headers', () => ({
  cookies: jest.fn().mockResolvedValue({ getAll: () => [], set: jest.fn() }),
}));
jest.mock('@supabase/ssr', () => ({ createServerClient: jest.fn() }));
jest.mock('@/lib/supabase/server', () => ({ supabaseServer: { from: jest.fn() } }));

// customerStatus/isActive/isTerminal depend on jobStatus only, so ordering tests
// don't need real getCustomerOrderState — mirrors the fiscal-url.test.ts pattern.
jest.mock('@/lib/translation-workflow/customer-order-state', () => ({
  getCustomerOrderState: jest.fn(({ jobStatus }: { jobStatus: string }) =>
    jobStatus === 'completed'
      ? { customerStatus: 'completed', canDownload: true, isActive: true, isTerminal: true, progressPercent: 100, stages: [] }
      : { customerStatus: 'payment_pending', canDownload: false, isActive: true, isTerminal: false, progressPercent: 0, stages: [] },
  ),
}));

// Legacy single-file jobs only — the multi-source job_source_files/job_result_files
// path is covered separately by multi-source-electronic-incident.test.ts.
jest.mock('@/lib/jobs/result-files-status', () => ({
  getResultFilesStatus: jest.fn(() => Promise.resolve({ isMultiSource: false, hasReadyResultFiles: false, readyFiles: [] })),
}));

import { createServerClient } from '@supabase/ssr';
import { supabaseServer } from '@/lib/supabase/server';

const mockCreateServerClient = createServerClient as jest.MockedFunction<typeof createServerClient>;
const mockFrom = supabaseServer.from as jest.Mock;

function chain(returnVal: { data?: unknown; error?: unknown }) {
  const c = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    order: jest.fn().mockResolvedValue(returnVal),
  };
  return c;
}

function makeDoc(id: string, createdAt: string) {
  return {
    id, filename: `${id}.pdf`, source_language: 'ru', target_language: 'en',
    document_type: 'other', status: 'completed', created_at: createdAt, updated_at: createdAt,
  };
}

function makeJob(id: string, documentId: string, status: string, createdAt: string) {
  return {
    id, document_id: documentId, status, progress_percent: status === 'completed' ? 100 : 0,
    error_message: null, workflow_status: status === 'completed' ? 'completed' : null,
    service_level: 'electronic', fulfillment_method: null, price_kzt: 1500,
    price_before_discount_kzt: null, discount_applied_kzt: null, discount_code: null,
    created_at: createdAt,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCreateServerClient.mockReturnValue({
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }) },
  } as unknown as ReturnType<typeof createServerClient>);
});

async function callGET() {
  const res = await GET();
  return res.json() as Promise<{ jobs: { documentId: string }[] }>;
}

describe('GET /api/jobs — ordering (2026-08-03 incident)', () => {
  it('an old payment_pending order never outranks a newer completed order', async () => {
    const docOld = makeDoc('doc-old', '2026-07-01T00:00:00.000Z');
    const docNew = makeDoc('doc-new', '2026-08-03T00:00:00.000Z');
    const jobOld = makeJob('job-old', 'doc-old', 'payment_pending', '2026-07-01T00:00:00.000Z');
    const jobNew = makeJob('job-new', 'doc-new', 'completed', '2026-08-03T00:00:00.000Z');

    mockFrom
      .mockReturnValueOnce(chain({ data: [docNew, docOld] })) // documents (already DESC by doc created_at)
      .mockReturnValueOnce(chain({ data: [jobNew, jobOld] })) // jobs
      .mockReturnValueOnce(chain({ data: [] })) // fiscal_receipts
      .mockReturnValueOnce(chain({ data: [] })); // price_quotes

    const { jobs } = await callGET();
    expect(jobs.map((j) => j.documentId)).toEqual(['doc-new', 'doc-old']);
  });

  it('sorts by jobs.created_at, not documents.created_at, when the two disagree (e.g. a job created long after its document)', async () => {
    // doc-x's document is OLD, but its job was created much later than doc-y's job —
    // pure documents.created_at ordering would rank doc-y first; the fix must not.
    const docX = makeDoc('doc-x', '2026-01-01T00:00:00.000Z');
    const docY = makeDoc('doc-y', '2026-06-01T00:00:00.000Z');
    const jobX = makeJob('job-x', 'doc-x', 'payment_pending', '2026-08-05T00:00:00.000Z');
    const jobY = makeJob('job-y', 'doc-y', 'payment_pending', '2026-01-02T00:00:00.000Z');

    mockFrom
      .mockReturnValueOnce(chain({ data: [docY, docX] })) // documents, DESC by doc created_at (Y before X)
      .mockReturnValueOnce(chain({ data: [jobX, jobY] })) // jobs, DESC by job created_at (X before Y)
      .mockReturnValueOnce(chain({ data: [] }))
      .mockReturnValueOnce(chain({ data: [] }));

    const { jobs } = await callGET();
    // job-x's created_at (Aug) is newer than job-y's (Jan) -> doc-x must come first,
    // even though doc-x's OWN document.created_at is the older of the two.
    expect(jobs.map((j) => j.documentId)).toEqual(['doc-x', 'doc-y']);
  });

  it('a document with no job at all falls back to documents.created_at for its position', async () => {
    const docNoJob = makeDoc('doc-no-job', '2026-08-02T00:00:00.000Z');
    const docWithJob = makeDoc('doc-with-job', '2026-01-01T00:00:00.000Z');
    const job = makeJob('job-1', 'doc-with-job', 'completed', '2026-01-01T00:00:00.000Z');

    mockFrom
      .mockReturnValueOnce(chain({ data: [docNoJob, docWithJob] }))
      .mockReturnValueOnce(chain({ data: [job] }))
      .mockReturnValueOnce(chain({ data: [] }))
      .mockReturnValueOnce(chain({ data: [] }));

    const { jobs } = await callGET();
    expect(jobs.map((j) => j.documentId)).toEqual(['doc-no-job', 'doc-with-job']);
  });

  it('equal created_at falls back to a deterministic id DESC tie-break', async () => {
    const sameTime = '2026-08-03T00:00:00.000Z';
    const docA = makeDoc('doc-a', sameTime);
    const docB = makeDoc('doc-b', sameTime);
    const jobZ = makeJob('job-zzz', 'doc-a', 'payment_pending', sameTime);
    const jobA = makeJob('job-aaa', 'doc-b', 'payment_pending', sameTime);

    mockFrom
      .mockReturnValueOnce(chain({ data: [docA, docB] }))
      .mockReturnValueOnce(chain({ data: [jobZ, jobA] }))
      .mockReturnValueOnce(chain({ data: [] }))
      .mockReturnValueOnce(chain({ data: [] }));

    const { jobs } = await callGET();
    // job-zzz > job-aaa lexicographically -> doc-a (owning job-zzz) sorts first.
    expect(jobs.map((j) => j.documentId)).toEqual(['doc-a', 'doc-b']);
  });

  it('does not group active before ready — response is a single created_at-ordered list', async () => {
    // 3 orders: newest completed, middle payment_pending, oldest completed.
    // Bucket-concatenation would never produce this exact interleaving.
    const docNewest = makeDoc('doc-newest-completed', '2026-08-03T00:00:00.000Z');
    const docMiddle = makeDoc('doc-middle-pending', '2026-08-02T00:00:00.000Z');
    const docOldest = makeDoc('doc-oldest-completed', '2026-08-01T00:00:00.000Z');
    const jobNewest = makeJob('job-newest', 'doc-newest-completed', 'completed', '2026-08-03T00:00:00.000Z');
    const jobMiddle = makeJob('job-middle', 'doc-middle-pending', 'payment_pending', '2026-08-02T00:00:00.000Z');
    const jobOldest = makeJob('job-oldest', 'doc-oldest-completed', 'completed', '2026-08-01T00:00:00.000Z');

    mockFrom
      .mockReturnValueOnce(chain({ data: [docNewest, docMiddle, docOldest] }))
      .mockReturnValueOnce(chain({ data: [jobNewest, jobMiddle, jobOldest] }))
      .mockReturnValueOnce(chain({ data: [] }))
      .mockReturnValueOnce(chain({ data: [] }));

    const { jobs } = await callGET();
    expect(jobs.map((j) => j.documentId)).toEqual([
      'doc-newest-completed', 'doc-middle-pending', 'doc-oldest-completed',
    ]);
  });
});
