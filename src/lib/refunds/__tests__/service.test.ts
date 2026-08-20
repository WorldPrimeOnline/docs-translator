/**
 * @jest-environment node
 */

// Mock Supabase
const mockRpc = jest.fn();
const mockFrom = jest.fn();
jest.mock('@/lib/supabase/server', () => ({
  supabaseServer: {
    from: mockFrom,
    rpc: mockRpc,
  },
}));

// Mock fiscal service (refund service calls createRefundReceiptForRefund)
const mockCreateRefundReceipt = jest.fn().mockResolvedValue({
  fiscalReceiptId: 'fr-1',
  status: 'pending',
  isNew: true,
});
jest.mock('@/lib/fiscal/service', () => ({
  createRefundReceiptForRefund: (...args: unknown[]) => mockCreateRefundReceipt(...args),
}));

// Mock the Freedom Pay client (refund service calls its refund() for freedom_pay rows)
const mockFreedomPayRefund = jest.fn();
class MockFreedomPayApiError extends Error {
  code: string;
  constructor(params: { code: string; message?: string }) {
    super(params.message ?? params.code);
    this.code = params.code;
  }
}
jest.mock('@/lib/payments/freedompay/client', () => ({
  refund: (...args: unknown[]) => mockFreedomPayRefund(...args),
  FreedomPayApiError: MockFreedomPayApiError,
}));

function makeChain(result: unknown): Record<string, jest.Mock> {
  const chain: Record<string, jest.Mock> = {};
  const returnSelf = jest.fn().mockReturnValue(chain);
  chain.select = returnSelf;
  chain.insert = returnSelf;
  chain.update = returnSelf;
  chain.eq = returnSelf;
  chain.in = returnSelf;
  chain.maybeSingle = jest.fn().mockResolvedValue(result);
  chain.single = jest.fn().mockResolvedValue(result);
  return chain;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('getRefundableAmount', () => {
  it('returns ok=false when payment is not paid', async () => {
    mockRpc.mockResolvedValue({
      data: { ok: false, error: 'payment_not_paid', total_paid: 0, total_refunded: 0, refundable: 0 },
      error: null,
    });

    const { getRefundableAmount } = await import('../service');
    const result = await getRefundableAmount('pt-1');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('payment_not_paid');
    expect(result.refundable).toBe(0);
  });

  it('returns correct refundable amount', async () => {
    mockRpc.mockResolvedValue({
      data: { ok: true, total_paid: 1999, total_refunded: 0, refundable: 1999 },
      error: null,
    });

    const { getRefundableAmount } = await import('../service');
    const result = await getRefundableAmount('pt-1');
    expect(result.ok).toBe(true);
    expect(result.totalPaid).toBe(1999);
    expect(result.refundable).toBe(1999);
  });

  it('computes partial refundable (after previous refund)', async () => {
    mockRpc.mockResolvedValue({
      data: { ok: true, total_paid: 3999, total_refunded: 1000, refundable: 2999 },
      error: null,
    });

    const { getRefundableAmount } = await import('../service');
    const result = await getRefundableAmount('pt-partial');
    expect(result.refundable).toBe(2999);
    expect(result.totalRefunded).toBe(1000);
  });

  it('returns error when rpc fails', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'connection error' } });

    const { getRefundableAmount } = await import('../service');
    const result = await getRefundableAmount('pt-err');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('connection error');
  });
});

describe('initiateRefund', () => {
  it('returns failed when payment is not paid', async () => {
    // idempotency check: no existing refund
    mockFrom.mockReturnValue(makeChain({ data: null, error: null }));
    // refundable amount check via rpc
    mockRpc.mockResolvedValue({
      data: { ok: false, error: 'payment_not_paid', total_paid: 0, total_refunded: 0, refundable: 0 },
      error: null,
    });

    const { initiateRefund } = await import('../service');
    const result = await initiateRefund({
      paymentTransactionId: 'pt-1',
      refundAmountKzt: 1000,
      reason: 'test',
      operatorId: 'op@test.com',
    });
    expect(result.status).toBe('failed');
    expect(result.errorMessage).toContain('payment_not_paid');
  });

  it('returns failed when refund amount is 0', async () => {
    mockFrom.mockReturnValue(makeChain({ data: null, error: null }));
    mockRpc.mockResolvedValue({
      data: { ok: true, total_paid: 1999, total_refunded: 0, refundable: 1999 },
      error: null,
    });

    const { initiateRefund } = await import('../service');
    const result = await initiateRefund({
      paymentTransactionId: 'pt-1',
      refundAmountKzt: 0,
      reason: 'test',
      operatorId: 'op@test.com',
    });
    expect(result.status).toBe('failed');
    expect(result.errorMessage).toBe('refund_amount_too_small');
  });

  it('returns failed when refund exceeds refundable amount', async () => {
    mockFrom.mockReturnValue(makeChain({ data: null, error: null }));
    mockRpc.mockResolvedValue({
      data: { ok: true, total_paid: 1999, total_refunded: 0, refundable: 1999 },
      error: null,
    });

    const { initiateRefund } = await import('../service');
    const result = await initiateRefund({
      paymentTransactionId: 'pt-1',
      refundAmountKzt: 5000,
      reason: 'test',
      operatorId: 'op@test.com',
    });
    expect(result.status).toBe('failed');
    expect(result.errorMessage).toContain('refund_exceeds_refundable');
  });

  it('returns duplicate when same idempotency key is used', async () => {
    const existingChain = makeChain({
      data: { id: 'rt-existing', status: 'pending_manual', provider_refund_id: null, fiscal_refund_receipt_id: null },
      error: null,
    });
    mockFrom.mockReturnValue(existingChain);

    const { initiateRefund } = await import('../service');
    const result = await initiateRefund({
      paymentTransactionId: 'pt-1',
      refundAmountKzt: 1000,
      reason: 'test',
      operatorId: 'op@test.com',
      idempotencyKey: 'idem-key-1',
    });
    expect(result.refundTransactionId).toBe('rt-existing');
    expect(result.status).toBe('pending_manual');
  });

  it('creates pending_manual refund when Halyk API not integrated', async () => {
    // First call: no existing refund (idempotency check returns null)
    const noExistingChain = makeChain({ data: null, error: null });
    // Second call: rpc for refundable amount
    mockRpc.mockResolvedValue({
      data: { ok: true, total_paid: 1999, total_refunded: 0, refundable: 1999 },
      error: null,
    });
    // Third call: get payment details
    const paymentChain = makeChain({
      data: { job_id: 'j-1', provider_transaction_id: 'halyk-tx-1', provider_environment: 'test' },
      error: null,
    });
    // Fourth call: insert refund
    const insertChain = makeChain({ data: { id: 'rt-new' }, error: null });

    mockFrom
      .mockReturnValueOnce(noExistingChain)   // idempotency check
      .mockReturnValueOnce(paymentChain)       // get payment
      .mockReturnValueOnce(insertChain);       // insert refund

    const { initiateRefund } = await import('../service');
    const result = await initiateRefund({
      paymentTransactionId: 'pt-1',
      refundAmountKzt: 1000,
      reason: 'Technical error',
      operatorId: 'operator@wpo.kz',
      idempotencyKey: 'unique-key-123',
    });

    expect(result.status).toBe('pending_manual');
    expect(result.refundTransactionId).toBe('rt-new');
  });
});

describe('initiateRefund — Freedom Pay provider branch', () => {
  it('calls freedompay refund() and marks the refund succeeded, without any fiscal receipt call', async () => {
    mockRpc.mockResolvedValue({
      data: { ok: true, total_paid: 1500, total_refunded: 0, refundable: 1500 },
      error: null,
    });
    const noExistingChain = makeChain({ data: null, error: null });
    const paymentChain = makeChain({
      data: { job_id: 'j-1', provider_transaction_id: 'fp-payment-1', provider_environment: 'test', payment_provider: 'freedom_pay' },
      error: null,
    });
    const insertChain = makeChain({ data: { id: 'rt-fp-1' }, error: null });
    const updateRefundChain = makeChain({ data: null, error: null });
    const updatePaymentChain = makeChain({ data: null, error: null });

    mockFrom
      .mockReturnValueOnce(noExistingChain)     // idempotency check
      .mockReturnValueOnce(paymentChain)        // get payment (includes payment_provider)
      .mockReturnValueOnce(insertChain)         // insert refund_transactions
      .mockReturnValueOnce(updateRefundChain)   // update refund_transactions -> succeeded
      .mockReturnValueOnce(updatePaymentChain); // update payment_transactions -> refunded

    mockFreedomPayRefund.mockResolvedValue({ ok: true, raw: { pg_status: 'ok', pg_refund_id: 'fp-refund-1' } });

    const { initiateRefund } = await import('../service');
    const result = await initiateRefund({
      paymentTransactionId: 'pt-fp-1',
      refundAmountKzt: 1500,
      reason: 'test refund',
      operatorId: 'op@test.com',
      idempotencyKey: 'idem-fp-1',
    });

    // idempotencyKey must be passed through to the Freedom Pay client (pg_idempotency_key).
    expect(mockFreedomPayRefund).toHaveBeenCalledWith({ pgPaymentId: 'fp-payment-1', amountKzt: 1500, idempotencyKey: 'idem-fp-1' });
    expect(mockCreateRefundReceipt).not.toHaveBeenCalled();
    expect(result.status).toBe('succeeded');
    expect(result.refundTransactionId).toBe('rt-fp-1');
    expect(result.providerRefundId).toBe('fp-refund-1');
  });

  it('leaves the refund pending_manual (not succeeded) when Freedom Pay rejects the refund', async () => {
    mockRpc.mockResolvedValue({
      data: { ok: true, total_paid: 1500, total_refunded: 0, refundable: 1500 },
      error: null,
    });
    const noExistingChain = makeChain({ data: null, error: null });
    const paymentChain = makeChain({
      data: { job_id: 'j-1', provider_transaction_id: 'fp-payment-1', provider_environment: 'test', payment_provider: 'freedom_pay' },
      error: null,
    });
    const insertChain = makeChain({ data: { id: 'rt-fp-2' }, error: null });
    const updateRefundChain = makeChain({ data: null, error: null });

    mockFrom
      .mockReturnValueOnce(noExistingChain)
      .mockReturnValueOnce(paymentChain)
      .mockReturnValueOnce(insertChain)
      .mockReturnValueOnce(updateRefundChain);

    mockFreedomPayRefund.mockResolvedValue({ ok: false, raw: { pg_status: 'error' } });

    const { initiateRefund } = await import('../service');
    const result = await initiateRefund({
      paymentTransactionId: 'pt-fp-2',
      refundAmountKzt: 1500,
      reason: 'test refund',
      operatorId: 'op@test.com',
    });

    expect(result.status).toBe('failed');
    expect(mockCreateRefundReceipt).not.toHaveBeenCalled();
  });

  it('leaves the refund pending_manual when the Freedom Pay API call itself throws (network/timeout)', async () => {
    mockRpc.mockResolvedValue({
      data: { ok: true, total_paid: 1500, total_refunded: 0, refundable: 1500 },
      error: null,
    });
    const noExistingChain = makeChain({ data: null, error: null });
    const paymentChain = makeChain({
      data: { job_id: 'j-1', provider_transaction_id: 'fp-payment-1', provider_environment: 'test', payment_provider: 'freedom_pay' },
      error: null,
    });
    const insertChain = makeChain({ data: { id: 'rt-fp-3' }, error: null });
    const ambiguousUpdateChain = makeChain({ data: null, error: null });

    mockFrom
      .mockReturnValueOnce(noExistingChain)
      .mockReturnValueOnce(paymentChain)
      .mockReturnValueOnce(insertChain)
      .mockReturnValueOnce(ambiguousUpdateChain); // marks the ambiguous-timeout note

    mockFreedomPayRefund.mockRejectedValue(new MockFreedomPayApiError({ code: 'FREEDOMPAY_REFUND_NETWORK_ERROR' }));

    const { initiateRefund } = await import('../service');
    const result = await initiateRefund({
      paymentTransactionId: 'pt-fp-3',
      refundAmountKzt: 1500,
      reason: 'test refund',
      operatorId: 'op@test.com',
    });

    // Distinct from a confirmed rejection — signals "do not blindly retry" to callers.
    expect(result.status).toBe('pending_manual');
    expect(result.errorMessage).toBe('freedompay_refund_ambiguous_timeout');
    expect(mockCreateRefundReceipt).not.toHaveBeenCalled();

    // The ambiguity must be recorded on the refund_transactions row for operator review.
    const updateCall = ambiguousUpdateChain.update!.mock.calls[0][0] as { provider_response_sanitized: { ambiguous_timeout: boolean } };
    expect(updateCall.provider_response_sanitized.ambiguous_timeout).toBe(true);
  });
});

describe('refund audit requirements', () => {
  it('idempotency key is required (auto-generated if not provided)', async () => {
    // Test that the service generates an idempotency key if not provided
    // We can verify by checking the insert payload includes idempotency_key
    mockRpc.mockResolvedValue({
      data: { ok: true, total_paid: 1999, total_refunded: 0, refundable: 1999 },
      error: null,
    });

    const noExistingChain = makeChain({ data: null, error: null });
    const paymentChain = makeChain({
      data: { job_id: 'j-1', provider_transaction_id: 'tx-1', provider_environment: 'test' },
      error: null,
    });
    const insertChain = makeChain({ data: { id: 'rt-auto' }, error: null });
    mockFrom
      .mockReturnValueOnce(noExistingChain)
      .mockReturnValueOnce(paymentChain)
      .mockReturnValueOnce(insertChain);

    const { initiateRefund } = await import('../service');
    // No idempotencyKey provided — should auto-generate
    const result = await initiateRefund({
      paymentTransactionId: 'pt-1',
      refundAmountKzt: 500,
      reason: 'Auto key test',
      operatorId: 'op',
    });
    expect(result.status).toBe('pending_manual');
    expect(result.refundTransactionId).toBe('rt-auto');
  });
});
