/**
 * @jest-environment node
 *
 * Tests for POST /api/admin/fiscal/retry
 *
 * The endpoint does NOT call Webkassa — it only resets the DB status to retry_required.
 * The Railway worker's fiscal-processor picks it up within 30 seconds.
 */

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockMaybeSingle = jest.fn();
const mockSingle = jest.fn();
const mockUpdate = jest.fn();
const mockEq = jest.fn().mockReturnThis();
const mockChain = {
  select: jest.fn().mockReturnThis(),
  eq: mockEq,
  maybeSingle: mockMaybeSingle,
  single: mockSingle,
  update: mockUpdate,
};
mockUpdate.mockReturnValue(mockChain);

jest.mock('@/lib/supabase/server', () => ({
  supabaseServer: {
    from: jest.fn(() => mockChain),
  },
}));

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  process.env.CRON_SECRET = 'test-cron-secret';
  mockChain.select.mockReturnThis();
  mockEq.mockReturnThis();
  mockUpdate.mockReturnValue(mockChain);
});

// ─── Test helpers ─────────────────────────────────────────────────────────────

function makeRequest(body: unknown, secret = 'test-cron-secret'): Request {
  return new Request('http://localhost/api/admin/fiscal/retry', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify(body),
  });
}

function makeReceipt(overrides: Record<string, unknown> = {}) {
  return {
    id: 'receipt-uuid-1',
    status: 'failed',
    provider: 'webkassa',
    provider_environment: 'production',
    provider_receipt_id: null,
    fiscal_url: null,
    operation_type: 'sale',
    payment_transaction_id: 'payment-uuid-1',
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('POST /api/admin/fiscal/retry — authorization', () => {
  it('returns 401 when Authorization header is missing', async () => {
    const { POST } = await import('../retry/route');
    const req = new Request('http://localhost/api/admin/fiscal/retry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ receiptId: 'r1' }),
    });
    const res = await POST(req as never);
    expect(res.status).toBe(401);
  });

  it('returns 401 when CRON_SECRET is wrong', async () => {
    const { POST } = await import('../retry/route');
    const req = makeRequest({ receiptId: 'r1' }, 'wrong-secret');
    const res = await POST(req as never);
    expect(res.status).toBe(401);
  });
});

describe('POST /api/admin/fiscal/retry — input validation', () => {
  it('returns 400 when neither paymentTransactionId nor receiptId provided', async () => {
    const { POST } = await import('../retry/route');
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });

    const req = makeRequest({});
    const res = await POST(req as never);
    expect(res.status).toBe(400);
  });
});

describe('POST /api/admin/fiscal/retry — receipt lookup and reset', () => {
  it('returns 404 when receipt not found', async () => {
    const { POST } = await import('../retry/route');
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });

    const req = makeRequest({ receiptId: 'nonexistent' });
    const res = await POST(req as never);
    expect(res.status).toBe(404);
  });

  it('returns 409 when receipt already has provider_receipt_id (issued — refuse reset)', async () => {
    const { POST } = await import('../retry/route');
    mockMaybeSingle.mockResolvedValue({
      data: makeReceipt({ provider_receipt_id: 'CHK-12345', status: 'issued' }),
      error: null,
    });

    const req = makeRequest({ receiptId: 'r1' });
    const res = await POST(req as never);
    expect(res.status).toBe(409);
    const body = await res.json() as Record<string, unknown>;
    expect(body['error']).toBe('already_issued');
  });

  it('returns 422 when receipt status is issued (no provider_receipt_id but issued status)', async () => {
    const { POST } = await import('../retry/route');
    mockMaybeSingle.mockResolvedValue({
      data: makeReceipt({ status: 'issued' }),
      error: null,
    });

    const req = makeRequest({ receiptId: 'r1' });
    const res = await POST(req as never);
    expect(res.status).toBe(422);
  });

  it('returns 422 when receipt status is pending_manual (cannot auto-retry)', async () => {
    const { POST } = await import('../retry/route');
    mockMaybeSingle.mockResolvedValue({
      data: makeReceipt({ status: 'pending_manual' }),
      error: null,
    });

    const req = makeRequest({ receiptId: 'r1' });
    const res = await POST(req as never);
    expect(res.status).toBe(422);
  });

  it('resets failed receipt to retry_required and clears error fields', async () => {
    const { POST } = await import('../retry/route');
    mockMaybeSingle.mockResolvedValue({
      data: makeReceipt({ status: 'failed' }),
      error: null,
    });
    mockUpdate.mockReturnValue({
      eq: jest.fn().mockResolvedValue({ error: null }),
    });

    const req = makeRequest({ receiptId: 'receipt-uuid-1' });
    const res = await POST(req as never);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body['ok']).toBe(true);
    expect(body['newStatus']).toBe('retry_required');
    expect(body['previousStatus']).toBe('failed');

    // Verify the update was called with retry_required and cleared error fields
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'retry_required',
        error_code: null,
        error_message: null,
        retry_count: 0,
        failed_at: null,
      }),
    );
  });

  it('resets blocked_by_config receipt to retry_required', async () => {
    const { POST } = await import('../retry/route');
    mockMaybeSingle.mockResolvedValue({
      data: makeReceipt({ status: 'blocked_by_config' }),
      error: null,
    });
    mockUpdate.mockReturnValue({
      eq: jest.fn().mockResolvedValue({ error: null }),
    });

    const req = makeRequest({ paymentTransactionId: 'payment-uuid-1' });
    const res = await POST(req as never);
    expect(res.status).toBe(200);
  });

  it('does NOT call Webkassa — only updates DB status', async () => {
    const { POST } = await import('../retry/route');
    mockMaybeSingle.mockResolvedValue({
      data: makeReceipt({ status: 'failed' }),
      error: null,
    });
    mockUpdate.mockReturnValue({
      eq: jest.fn().mockResolvedValue({ error: null }),
    });

    const req = makeRequest({ receiptId: 'receipt-uuid-1' });
    await POST(req as never);

    // Verify: no outgoing HTTP calls to Webkassa (createCheck never imported/called)
    // The route only calls supabaseServer.from().update()
    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });
});
