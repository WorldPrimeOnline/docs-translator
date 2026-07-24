/**
 * 2026-07-25 staging regression: "after uploading a document, the price is
 * calculated and shown, but after closing the popup the order disappears — Active
 * shows none, History is empty."
 *
 * Root cause (confirmed via a read-only staging DB audit): commit 18cc8020 added
 * `documents.files_purged_at` to this route's SELECT, but migration 0066 (which adds
 * that column) was never applied to the staging database. The query failed outright
 * with a real Postgres "column does not exist" error — and this route destructured
 * `{ data: docs }` WITHOUT checking `error`, so `docs` was `null`, and the very next
 * line (`if (!docs || docs.length === 0) return { jobs: [] }`) silently treated a
 * broken query exactly the same as "this user has zero orders" — for EVERY user,
 * every request. This is NOT a bucketOrders/needsLivePolling/loadOrders regression —
 * those were all individually verified correct (see
 * src/lib/translation-workflow/__tests__/order-buckets.test.ts and
 * customer-order-state.test.ts) — the order never even reached client-side
 * classification because the API response was already an empty array.
 *
 * These tests lock in two things: (1) a documents/jobs query error must return a
 * real 500, never a silent empty list, and (2) the exact scenario flagged as a risk
 * in the incident report — payment_pending with a legacy/default
 * workflow_status='completed' — is correctly classified as active, using the REAL
 * getCustomerOrderState (not mocked, unlike order-sort.test.ts's simplified mock),
 * so this proves the actual production classification logic, not a stand-in.
 */
import { GET } from '../route';

jest.mock('next/headers', () => ({
  cookies: jest.fn().mockResolvedValue({ getAll: () => [], set: jest.fn() }),
}));
jest.mock('@supabase/ssr', () => ({ createServerClient: jest.fn() }));
jest.mock('@/lib/supabase/server', () => ({ supabaseServer: { from: jest.fn() } }));
jest.mock('@/lib/jobs/result-files-status', () => ({
  getResultFilesStatus: jest.fn(() => Promise.resolve({ isMultiSource: false, hasReadyResultFiles: false, readyFiles: [] })),
}));

import { createServerClient } from '@supabase/ssr';
import { supabaseServer } from '@/lib/supabase/server';

const mockCreateServerClient = createServerClient as jest.MockedFunction<typeof createServerClient>;
const mockFrom = supabaseServer.from as jest.Mock;

function chain(returnVal: { data?: unknown; error?: unknown }) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    order: jest.fn().mockResolvedValue(returnVal),
  };
}

function makeDoc(id: string, userId = 'user-1') {
  return {
    id, filename: `${id}.pdf`, source_language: 'ru', target_language: 'en',
    document_type: 'passport_id', status: 'processing',
    created_at: '2026-07-25T10:00:00.000Z', updated_at: '2026-07-25T10:00:00.000Z',
    files_purged_at: null,
    user_id: userId,
  };
}

function makeJob(overrides: Partial<{ id: string; document_id: string; status: string; workflow_status: string | null; service_level: string }> = {}) {
  return {
    id: overrides.id ?? 'job-1',
    document_id: overrides.document_id ?? 'doc-1',
    status: overrides.status ?? 'payment_pending',
    progress_percent: 0,
    error_message: null,
    workflow_status: overrides.workflow_status ?? null,
    service_level: overrides.service_level ?? 'official_with_translator_signature_and_provider_stamp',
    fulfillment_method: null,
    price_kzt: 7400,
    price_before_discount_kzt: null,
    discount_applied_kzt: null,
    discount_code: null,
    created_at: '2026-07-25T10:00:05.000Z',
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
  const body = await res.json();
  return { status: res.status, body };
}

describe('GET /api/jobs — query error must never present as an empty account (2026-07-25 regression)', () => {
  it('a documents query error (e.g. a column referenced before its migration is applied) returns 500, never {jobs:[]}', async () => {
    mockFrom.mockReturnValueOnce(chain({ data: null, error: { code: '42703', message: 'column documents.files_purged_at does not exist' } }));

    const { status, body } = await callGET();

    expect(status).toBe(500);
    expect(body).toEqual({ error: 'Failed to load orders' });
  });

  it('a jobs query error also returns 500, never a silent partial/empty list', async () => {
    mockFrom
      .mockReturnValueOnce(chain({ data: [makeDoc('doc-1')], error: null }))
      .mockReturnValueOnce(chain({ data: null, error: { code: '42P01', message: 'relation "jobs" does not exist' } }));

    const { status, body } = await callGET();

    expect(status).toBe(500);
    expect(body).toEqual({ error: 'Failed to load orders' });
  });

  it('a genuinely empty account (real empty result, no error) still returns 200 with jobs:[] — the fix distinguishes error from empty, it does not turn empty accounts into errors', async () => {
    mockFrom.mockReturnValueOnce(chain({ data: [], error: null }));

    const { status, body } = await callGET();

    expect(status).toBe(200);
    expect(body).toEqual({ jobs: [] });
  });
});

describe('GET /api/jobs — payment_pending classification (2026-07-25 incident risk, real getCustomerOrderState)', () => {
  it('a brand-new job (payment_pending, workflow_status=null, quote just computed) is active with the quote amount present', async () => {
    mockFrom
      .mockReturnValueOnce(chain({ data: [makeDoc('doc-1')], error: null }))
      .mockReturnValueOnce(chain({ data: [makeJob({ workflow_status: null })], error: null }))
      .mockReturnValueOnce(chain({ data: [], error: null })) // fiscal_receipts
      .mockReturnValueOnce(chain({
        data: [{ id: 'quote-1', job_id: 'job-1', status: 'payment_pending', amount_kzt: '7400.00', currency: 'KZT', expires_at: '2026-07-25T11:00:00.000Z', pricing_context_json: {} }],
        error: null,
      }));

    const { status, body } = await callGET();
    const order = body.jobs[0];

    expect(status).toBe(200);
    expect(order.customerStatus).toBe('payment_pending');
    expect(order.isActive).toBe(true);
    expect(order.isTerminal).toBe(false);
    expect(order.quoteStatus).toBe('payment_pending');
    expect(order.quoteAmountKzt).toBe(7400);
    expect(order.quoteExpiresAt).toBe('2026-07-25T11:00:00.000Z');
  });

  it('payment_pending with a legacy/default workflow_status="completed" is STILL active, not misclassified as a finished order — jobStatus always wins over workflow_status', async () => {
    mockFrom
      .mockReturnValueOnce(chain({ data: [makeDoc('doc-1')], error: null }))
      .mockReturnValueOnce(chain({ data: [makeJob({ status: 'payment_pending', workflow_status: 'completed' })], error: null }))
      .mockReturnValueOnce(chain({ data: [], error: null }))
      .mockReturnValueOnce(chain({ data: [], error: null }));

    const { body } = await callGET();
    const order = body.jobs[0];

    expect(order.customerStatus).toBe('payment_pending');
    expect(order.isActive).toBe(true);
    expect(order.isTerminal).toBe(false);
  });

  it("User B's request never includes User A's orders — scoped by .eq('user_id', ...) at the query level", async () => {
    mockCreateServerClient.mockReturnValue({
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'user-B' } } }) },
    } as unknown as ReturnType<typeof createServerClient>);

    const documentsChain = chain({ data: [], error: null });
    mockFrom.mockReturnValueOnce(documentsChain);

    await callGET();

    expect(documentsChain.eq).toHaveBeenCalledWith('user_id', 'user-B');
  });
});
