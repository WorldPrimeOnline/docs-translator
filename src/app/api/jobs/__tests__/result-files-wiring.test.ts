/**
 * Tests: GET /api/jobs — job_result_files readiness wiring (2026-08-01 multi-file
 * fulfillment decision). Verifies getResultFilesStatus()'s result is correctly
 * threaded into getCustomerOrderState()'s hasReadyResultFiles input: omitted
 * (undefined) for legacy single-file jobs, the real computed boolean for
 * multi-source jobs — never silently dropped or inverted.
 */
import { GET } from '../route';

jest.mock('next/headers', () => ({
  cookies: jest.fn().mockResolvedValue({ getAll: () => [], set: jest.fn() }),
}));
jest.mock('@supabase/ssr', () => ({ createServerClient: jest.fn() }));
jest.mock('@/lib/supabase/server', () => ({ supabaseServer: { from: jest.fn() } }));

const mockGetCustomerOrderState = jest.fn((..._args: unknown[]) => ({
  customerStatus: 'notarized',
  canDownload: false,
  isActive: true,
  isTerminal: false,
  progressPercent: 80,
  stages: [],
}));
jest.mock('@/lib/translation-workflow/customer-order-state', () => ({
  getCustomerOrderState: (...args: unknown[]) => mockGetCustomerOrderState(...args),
}));

const mockGetResultFilesStatus = jest.fn();
jest.mock('@/lib/jobs/result-files-status', () => ({
  getResultFilesStatus: (...args: unknown[]) => mockGetResultFilesStatus(...args),
}));

import { createServerClient } from '@supabase/ssr';
import { supabaseServer } from '@/lib/supabase/server';

const mockCreateServerClient = createServerClient as jest.MockedFunction<typeof createServerClient>;
const mockSupabaseServer = supabaseServer as jest.Mocked<typeof supabaseServer>;

function makeChain(returnVal: unknown) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    order: jest.fn().mockResolvedValue(returnVal),
  };
}

const USER_A = { id: 'user-a' };
const DOC_A = {
  id: 'doc-a', filename: 'passport.pdf', source_language: 'ru', target_language: 'en',
  document_type: 'passport_id', status: 'completed', created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:01:00Z', user_id: USER_A.id,
};
const JOB_NOTARY = {
  id: 'job-a', document_id: DOC_A.id, status: 'completed', progress_percent: 100,
  error_message: null, workflow_status: 'notarized', service_level: 'notarization_through_partners',
  fulfillment_method: 'delivery', price_kzt: 1000, price_before_discount_kzt: null,
  discount_applied_kzt: null, discount_code: null, created_at: '2026-01-01T00:00:00Z',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockCreateServerClient.mockReturnValue({
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user: USER_A } }) },
  } as unknown as ReturnType<typeof createServerClient>);
});

async function callGET() {
  const res = await GET();
  return res.json() as Promise<{ jobs: Record<string, unknown>[] }>;
}

describe('GET /api/jobs — hasReadyResultFiles wiring', () => {
  it('multi-source notary job, fully synced: hasReadyResultFiles=true is passed through to getCustomerOrderState', async () => {
    mockGetResultFilesStatus.mockResolvedValueOnce({ isMultiSource: true, hasReadyResultFiles: true, readyFiles: [] });
    (mockSupabaseServer.from as jest.Mock)
      .mockReturnValueOnce(makeChain({ data: [DOC_A] }))
      .mockReturnValueOnce(makeChain({ data: [JOB_NOTARY] }))
      .mockReturnValueOnce(makeChain({ data: [] })) // fiscal_receipts
      .mockReturnValueOnce(makeChain({ data: [] })); // price_quotes

    await callGET();

    expect(mockGetResultFilesStatus).toHaveBeenCalledWith('job-a', 'notarization_through_partners');
    expect(mockGetCustomerOrderState).toHaveBeenCalledWith(
      expect.objectContaining({ hasReadyResultFiles: true }),
    );
  });

  it('multi-source notary job, not yet synced: hasReadyResultFiles=false is passed through (never silently true)', async () => {
    mockGetResultFilesStatus.mockResolvedValueOnce({ isMultiSource: true, hasReadyResultFiles: false, readyFiles: [] });
    (mockSupabaseServer.from as jest.Mock)
      .mockReturnValueOnce(makeChain({ data: [DOC_A] }))
      .mockReturnValueOnce(makeChain({ data: [JOB_NOTARY] }))
      .mockReturnValueOnce(makeChain({ data: [] }))
      .mockReturnValueOnce(makeChain({ data: [] }));

    await callGET();

    expect(mockGetCustomerOrderState).toHaveBeenCalledWith(
      expect.objectContaining({ hasReadyResultFiles: false }),
    );
  });

  it('legacy job (isMultiSource=false): hasReadyResultFiles is omitted (undefined), not coerced to false', async () => {
    mockGetResultFilesStatus.mockResolvedValueOnce({ isMultiSource: false, hasReadyResultFiles: false, readyFiles: [] });
    (mockSupabaseServer.from as jest.Mock)
      .mockReturnValueOnce(makeChain({ data: [DOC_A] }))
      .mockReturnValueOnce(makeChain({ data: [JOB_NOTARY] }))
      .mockReturnValueOnce(makeChain({ data: [] }))
      .mockReturnValueOnce(makeChain({ data: [] }));

    await callGET();

    expect(mockGetCustomerOrderState).toHaveBeenCalledWith(
      expect.objectContaining({ hasReadyResultFiles: undefined }),
    );
  });
});
