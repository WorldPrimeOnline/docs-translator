/**
 * 2026-07-23 staging incident follow-up: reported Chrome Network activity showed
 * quoteAmountKzt values (1500, 14900, 163000, ...) across several job UUIDs that looked
 * like they could belong to different users. Read-only DB verification traced every one
 * of those amounts to a single staging user (see incident report) — no cross-user leak
 * occurred. This test locks in the ownership check GET /api/jobs/[jobId] already had
 * (doc.user_id !== user.id -> 403) as a permanent regression: User A's job must never be
 * readable by User B, and the 403 response must carry no job/quote data at all.
 */
import { GET } from '../route';

jest.mock('next/headers', () => ({
  cookies: jest.fn().mockResolvedValue({ getAll: () => [], set: jest.fn() }),
}));
jest.mock('@supabase/ssr', () => ({ createServerClient: jest.fn() }));
jest.mock('@/lib/supabase/server', () => ({ supabaseServer: { from: jest.fn() } }));

import { createServerClient } from '@supabase/ssr';
import { supabaseServer } from '@/lib/supabase/server';

const mockCreateServerClient = createServerClient as jest.MockedFunction<typeof createServerClient>;
const mockFrom = supabaseServer.from as jest.Mock;

function chain(result: { data?: unknown; error?: unknown; count?: number }) {
  const c: Record<string, unknown> = {};
  const methods = ['select', 'eq', 'in', 'order', 'single', 'limit'];
  for (const m of methods) c[m] = jest.fn(() => c);
  c.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return c;
}

const USER_A = '11111111-1111-1111-1111-111111111111';
const USER_B = '22222222-2222-2222-2222-222222222222';
const JOB_ID = '33333333-3333-3333-3333-333333333333';
const DOC_ID = '44444444-4444-4444-4444-444444444444';

function mockAuthedAs(userId: string) {
  mockCreateServerClient.mockReturnValue({
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: userId } } }) },
  } as unknown as ReturnType<typeof createServerClient>);
}

function callGET(jobId: string) {
  return GET({} as never, { params: Promise.resolve({ jobId }) });
}

const JOB_ROW = {
  status: 'completed',
  progress_percent: 100,
  error_message: null,
  document_id: DOC_ID,
  workflow_status: 'completed',
  service_level: 'official',
  fulfillment_method: null,
  price_before_discount_kzt: 163000,
  discount_applied_kzt: null,
  discount_code: null,
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('GET /api/jobs/[jobId] — cross-user ownership', () => {
  it("User B requesting User A's job gets 403 with no job/quote data in the body", async () => {
    mockAuthedAs(USER_B);
    mockFrom
      .mockReturnValueOnce(chain({ data: JOB_ROW, error: null })) // jobs
      .mockReturnValueOnce(chain({ data: { user_id: USER_A }, error: null })); // documents

    const res = await callGET(JOB_ID);
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body).toEqual({ error: 'Forbidden' });
    expect(JSON.stringify(body)).not.toMatch(/163000|completed|official/);
  });

  it('the owning user (User A) can still read their own job', async () => {
    mockAuthedAs(USER_A);
    mockFrom
      .mockReturnValueOnce(chain({ data: JOB_ROW, error: null })) // jobs
      .mockReturnValueOnce(chain({ data: { user_id: USER_A }, error: null })) // documents
      .mockReturnValueOnce(chain({ data: [], error: null })) // price_quotes
      .mockReturnValueOnce(chain({ count: 0 })); // job_source_files (getResultFilesStatus)

    const res = await callGET(JOB_ID);
    expect(res.status).toBe(200);
  });

  it('an unauthenticated request gets 401, never reaching the ownership check', async () => {
    mockCreateServerClient.mockReturnValue({
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: null } }) },
    } as unknown as ReturnType<typeof createServerClient>);

    const res = await callGET(JOB_ID);
    expect(res.status).toBe(401);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('a random/nonexistent job UUID gets 404, not a DB error leak', async () => {
    mockAuthedAs(USER_B);
    mockFrom.mockReturnValueOnce(chain({ data: null, error: { code: 'PGRST116', message: 'no rows' } }));

    const res = await callGET('99999999-9999-9999-9999-999999999999');
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body).toEqual({ error: 'Job not found' });
  });
});
