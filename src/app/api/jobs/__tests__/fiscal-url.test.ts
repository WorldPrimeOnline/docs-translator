/**
 * Tests: GET /api/jobs — fiscal receipt fields
 *
 * Verifies:
 * - fiscalUrl returned for job owner when fiscal_receipts row exists (issued status)
 * - fiscalUrl is null when no fiscal_receipts row exists (does not break)
 * - fiscalReceiptStatus returned for pending receipt
 * - Fiscal data scoped to user's own jobs only (no cross-user leakage)
 */

import { GET } from '../route';

// ─── Mocks ───────────────────────────────────────────────────────────────────

jest.mock('next/headers', () => ({
  cookies: jest.fn().mockResolvedValue({
    getAll: () => [],
    set: jest.fn(),
  }),
}));

jest.mock('@supabase/ssr', () => ({
  createServerClient: jest.fn(),
}));

jest.mock('@/lib/supabase/server', () => ({
  supabaseServer: { from: jest.fn() },
}));

jest.mock('@/lib/translation-workflow/customer-order-state', () => ({
  getCustomerOrderState: jest.fn(() => ({
    customerStatus: 'completed',
    canDownload: true,
    isActive: false,
    isTerminal: true,
    progressPercent: 100,
    stages: [],
  })),
}));

// This test file doesn't exercise the 2026-08-01 multi-file fulfillment decision —
// every job here is a legacy single-file job, so isMultiSource=false is the correct
// (and only relevant) mock here.
jest.mock('@/lib/jobs/result-files-status', () => ({
  getResultFilesStatus: jest.fn(() => Promise.resolve({ isMultiSource: false, hasReadyResultFiles: false, readyFiles: [] })),
}));

import { createServerClient } from '@supabase/ssr';
import { supabaseServer } from '@/lib/supabase/server';

const mockCreateServerClient = createServerClient as jest.MockedFunction<typeof createServerClient>;
const mockSupabaseServer = supabaseServer as jest.Mocked<typeof supabaseServer>;

// ─── Fixtures ────────────────────────────────────────────────────────────────

const USER_A = { id: 'user-a' };

const DOC_A = {
  id: 'doc-a',
  filename: 'passport.pdf',
  source_language: 'ru',
  target_language: 'en',
  document_type: 'passport_id',
  status: 'completed',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:01:00Z',
  user_id: USER_A.id,
};

const JOB_A = {
  id: 'job-a',
  document_id: DOC_A.id,
  status: 'completed',
  progress_percent: 100,
  error_message: null,
  workflow_status: null,
  service_level: 'electronic',
  fulfillment_method: null,
  price_kzt: 1000,
  price_before_discount_kzt: null,
  discount_applied_kzt: null,
  discount_code: null,
  created_at: '2026-01-01T00:00:00Z',
};

const FISCAL_ISSUED = {
  job_id: JOB_A.id,
  status: 'issued',
  fiscal_url: 'https://ofd.kz/receipt/abc123',
};

const FISCAL_PENDING = {
  job_id: JOB_A.id,
  status: 'pending',
  fiscal_url: null,
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeChain(returnVal: unknown) {
  const chain = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    order: jest.fn().mockResolvedValue(returnVal),
  };
  return chain;
}

function setupAuthUser(user: { id: string } | null) {
  mockCreateServerClient.mockReturnValue({
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user } }) },
  } as unknown as ReturnType<typeof createServerClient>);
}

async function callGET(): Promise<{ jobs: Record<string, unknown>[] }> {
  const res = await GET();
  return res.json() as Promise<{ jobs: Record<string, unknown>[] }>;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('GET /api/jobs — fiscal receipt fields', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupAuthUser(USER_A);
  });

  it('returns fiscalUrl and issued status for job owner', async () => {
    (mockSupabaseServer.from as jest.Mock)
      .mockReturnValueOnce(makeChain({ data: [DOC_A] }))   // documents
      .mockReturnValueOnce(makeChain({ data: [JOB_A] }))   // jobs
      .mockReturnValueOnce(makeChain({ data: [FISCAL_ISSUED] })) // fiscal_receipts
      .mockReturnValueOnce(makeChain({ data: [] }));        // price_quotes

    const { jobs } = await callGET();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.fiscalUrl).toBe('https://ofd.kz/receipt/abc123');
    expect(jobs[0]!.fiscalReceiptStatus).toBe('issued');
  });

  it('returns null fiscalUrl when no fiscal_receipts row exists (does not break)', async () => {
    (mockSupabaseServer.from as jest.Mock)
      .mockReturnValueOnce(makeChain({ data: [DOC_A] }))
      .mockReturnValueOnce(makeChain({ data: [JOB_A] }))
      .mockReturnValueOnce(makeChain({ data: [] }))         // no fiscal row
      .mockReturnValueOnce(makeChain({ data: [] }));

    const { jobs } = await callGET();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.fiscalUrl).toBeNull();
    expect(jobs[0]!.fiscalReceiptStatus).toBeNull();
  });

  it('returns pending status with null fiscalUrl for pending receipt', async () => {
    (mockSupabaseServer.from as jest.Mock)
      .mockReturnValueOnce(makeChain({ data: [DOC_A] }))
      .mockReturnValueOnce(makeChain({ data: [JOB_A] }))
      .mockReturnValueOnce(makeChain({ data: [FISCAL_PENDING] }))
      .mockReturnValueOnce(makeChain({ data: [] }));

    const { jobs } = await callGET();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.fiscalUrl).toBeNull();
    expect(jobs[0]!.fiscalReceiptStatus).toBe('pending');
  });

  it('fiscal_receipts query uses jobIds scoped to authenticated user documents', async () => {
    (mockSupabaseServer.from as jest.Mock)
      .mockReturnValueOnce(makeChain({ data: [DOC_A] }))
      .mockReturnValueOnce(makeChain({ data: [JOB_A] }))
      .mockReturnValueOnce(makeChain({ data: [FISCAL_ISSUED] }))
      .mockReturnValueOnce(makeChain({ data: [] }));

    await callGET();

    // The fiscal_receipts .in() call must only use job IDs from this user's documents
    const fromCalls = (mockSupabaseServer.from as jest.Mock).mock.calls;
    const fiscalFromCall = fromCalls.find(([table]: [string]) => table === 'fiscal_receipts');
    expect(fiscalFromCall).toBeDefined();

    // Verify the chain's .in() was called with only user A's job IDs
    const fiscalChain = (mockSupabaseServer.from as jest.Mock).mock.results[
      fromCalls.indexOf(fiscalFromCall!)
    ]!.value;
    expect(fiscalChain.in).toHaveBeenCalledWith('job_id', [JOB_A.id]);
  });

  it('returns 401 for unauthenticated request', async () => {
    setupAuthUser(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it('returns empty jobs array when user has no documents', async () => {
    (mockSupabaseServer.from as jest.Mock)
      .mockReturnValueOnce(makeChain({ data: [] }));

    const { jobs } = await callGET();
    expect(jobs).toEqual([]);
  });
});
