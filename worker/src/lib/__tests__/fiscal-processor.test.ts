/**
 * Tests: fiscal-processor.ts
 *
 * Covers:
 * - Two receipts for the same cashbox processed sequentially (not in parallel)
 * - Webkassa error 14 (duplicate) is idempotent success
 * - Non-retryable error → status=failed
 * - Retryable error → status=retry_required
 * - No receipts → no Webkassa calls
 * - Missing config → no Webkassa calls
 * - Error 11 (shift >24h) → Z-report → retry
 * - Error 11 retry: same ExternalCheckNumber reused (idempotency prevents duplicates)
 * - Error 11 not retried a second time (capped at 1 shift retry)
 * - Error 10 (cashbox not activated) → permanent failure, no retry
 * - Error 2 (session expired) → re-auth handled by webkassa-client, no duplicate
 * - Error 18 (offline duration exceeded) → permanent failure, no retry
 * - Generic non-retryable error → status=failed
 * - Generic retryable error → status=retry_required
 * - Sale return (operation_type=refund) uses refundTransactionId as ExternalCheckNumber
 * - Sale return includes returnBasisDetails built from original sale provider_response_sanitized
 * - Sale return warns and proceeds when no original sale found in DB
 */

// ─── Module mocks (must be before any imports) ────────────────────────────────

const mockEnv = {
  WEBKASSA_ENABLED: 'true',
  WEBKASSA_API_KEY: 'test-key',
  WEBKASSA_LOGIN: 'test@test.com',
  WEBKASSA_PASSWORD: 'test-pass',
  WEBKASSA_CASHBOX_SERIAL_NUMBER: 'SWK00035686',
  WEBKASSA_API_BASE_URL: 'https://devkkm.webkassa.kz',
  WEBKASSA_ALLOW_REAL_RECEIPTS: undefined as string | undefined,
  FISCAL_PROVIDER_ENV: 'test' as 'test' | 'production',
  WORKER_INSTANCE_ID: 'test-worker-001',
};

jest.mock('../env', () => ({ env: mockEnv }));

const mockSupabaseFrom = jest.fn();
jest.mock('../supabase', () => ({ supabase: { from: mockSupabaseFrom } }));

const mockCreateCheck = jest.fn();
const mockCreateZReport = jest.fn();
const MockWebkassaApiError = class WebkassaApiError extends Error {
  code: number; isRetryable: boolean; isDuplicate: boolean;
  constructor(msg: string, code: number, isRetryable: boolean, isDuplicate = false) {
    super(msg); this.name = 'WebkassaApiError'; this.code = code; this.isRetryable = isRetryable; this.isDuplicate = isDuplicate;
  }
};
const MockWebkassaNetworkError = class WebkassaNetworkError extends Error {
  isRetryable: boolean;
  constructor(msg: string, isRetryable: boolean) { super(msg); this.name = 'WebkassaNetworkError'; this.isRetryable = isRetryable; }
};

jest.mock('../webkassa-client', () => ({
  createCheck: mockCreateCheck,
  createZReport: mockCreateZReport,
  sanitizeForStorage: jest.fn(() => ({})),
  WebkassaApiError: MockWebkassaApiError,
  WebkassaNetworkError: MockWebkassaNetworkError,
  WEBKASSA_ERROR_SHIFT_OVER_24H: 11,
}));

// ─── Import after mocks ───────────────────────────────────────────────────────

import { processPendingFiscalReceipts } from '../fiscal-processor';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeChain(rows: unknown[] | null) {
  const updateMock = jest.fn().mockReturnThis();
  const chain = {
    select: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    upsert: jest.fn().mockReturnThis(),
    delete: jest.fn().mockReturnThis(),
    update: updateMock,
    returns: jest.fn().mockResolvedValue({ data: rows, error: null }),
    maybeSingle: jest.fn().mockResolvedValue({ data: null }),
    single: jest.fn().mockResolvedValue({ data: null }),
  };
  return chain;
}

/** Chain for looking up original sale's provider_response_sanitized (single row lookup) */
function makeOriginalSaleChain(saleData: Record<string, unknown> | null) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue({
      data: saleData ? { provider_response_sanitized: saleData } : null,
    }),
  };
}

function makeReceipt(overrides: Record<string, unknown> = {}) {
  return {
    id: 'receipt-1',
    payment_transaction_id: 'txn-uuid-1',
    operation_type: 'sale',
    amount_kzt: 1000,
    currency: 'KZT',
    customer_email: 'test@example.com',
    receipt_payload_sanitized: { orderNumber: 'TXN001', description: 'Test service' },
    retry_count: 0,
    ...overrides,
  };
}

function makeSuccessResult() {
  return { checkNumber: 'CHK-001', ticketUrl: 'https://ofd.kz/test', isDuplicate: false, rawData: null };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('processPendingFiscalReceipts', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockEnv.WEBKASSA_ENABLED = 'true';
    mockEnv.WEBKASSA_API_KEY = 'test-key';
    mockEnv.WEBKASSA_LOGIN = 'test@test.com';
    mockEnv.WEBKASSA_PASSWORD = 'test-pass';
    mockEnv.WEBKASSA_CASHBOX_SERIAL_NUMBER = 'SWK00035686';
    mockEnv.FISCAL_PROVIDER_ENV = 'test';
    mockEnv.WEBKASSA_ALLOW_REAL_RECEIPTS = undefined;
  });

  it('skips when WEBKASSA_ENABLED is not set', async () => {
    mockEnv.WEBKASSA_ENABLED = undefined as unknown as string;
    await processPendingFiscalReceipts();
    expect(mockSupabaseFrom).not.toHaveBeenCalled();
  });

  it('skips when credentials are missing', async () => {
    mockEnv.WEBKASSA_API_KEY = undefined as unknown as string;
    await processPendingFiscalReceipts();
    expect(mockSupabaseFrom).not.toHaveBeenCalled();
  });

  it('skips when production + WEBKASSA_ALLOW_REAL_RECEIPTS not set', async () => {
    mockEnv.FISCAL_PROVIDER_ENV = 'production';
    mockEnv.WEBKASSA_ALLOW_REAL_RECEIPTS = undefined;
    await processPendingFiscalReceipts();
    expect(mockSupabaseFrom).not.toHaveBeenCalled();
  });

  it('does not call Webkassa when no pending receipts', async () => {
    const chain = makeChain([]);
    mockSupabaseFrom.mockReturnValue(chain);
    await processPendingFiscalReceipts();
    expect(mockCreateCheck).not.toHaveBeenCalled();
  });

  it('issues receipt and calls updateMock with status=issued on success', async () => {
    const receipt = makeReceipt();
    const fetchChain = makeChain([receipt]);
    const lockChain = makeChain([{ cashbox_id: 'SWK00035686' }]);
    const updateChain = makeChain(null);

    mockSupabaseFrom
      .mockReturnValueOnce(fetchChain)   // fiscal_receipts select
      .mockReturnValueOnce(lockChain)    // fiscal_cashbox_locks upsert
      .mockReturnValueOnce(updateChain); // fiscal_receipts update (issued)

    mockCreateCheck.mockResolvedValue(makeSuccessResult());

    await processPendingFiscalReceipts();
    expect(mockCreateCheck).toHaveBeenCalledTimes(1);
    expect(updateChain.update).toHaveBeenCalled();
  });

  it('handles Error 14 (duplicate) as idempotent success — no throw', async () => {
    const fetchChain = makeChain([makeReceipt()]);
    const lockChain = makeChain([{ cashbox_id: 'SWK00035686' }]);
    const updateChain = makeChain(null);

    mockSupabaseFrom
      .mockReturnValueOnce(fetchChain)
      .mockReturnValueOnce(lockChain)
      .mockReturnValueOnce(updateChain);

    mockCreateCheck.mockResolvedValue({ checkNumber: 'EXISTING', isDuplicate: true, rawData: null });
    await expect(processPendingFiscalReceipts()).resolves.not.toThrow();
    expect(mockCreateCheck).toHaveBeenCalledTimes(1);
  });

  it('sets status=retry_required on retryable network error', async () => {
    const receipt = makeReceipt({ retry_count: 0 });
    const fetchChain = makeChain([receipt]);
    const lockChain = makeChain([{ cashbox_id: 'SWK00035686' }]);
    const updateChain = makeChain(null);

    mockSupabaseFrom
      .mockReturnValueOnce(fetchChain)
      .mockReturnValueOnce(lockChain)
      .mockReturnValueOnce(updateChain);

    mockCreateCheck.mockRejectedValue(new MockWebkassaNetworkError('Timeout', true));

    await processPendingFiscalReceipts();
    expect(updateChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'retry_required' }),
    );
  });

  it('sets status=failed on non-retryable API error (e.g. cashbox not activated)', async () => {
    const receipt = makeReceipt({ retry_count: 0 });
    const fetchChain = makeChain([receipt]);
    const lockChain = makeChain([{ cashbox_id: 'SWK00035686' }]);
    const updateChain = makeChain(null);

    mockSupabaseFrom
      .mockReturnValueOnce(fetchChain)
      .mockReturnValueOnce(lockChain)
      .mockReturnValueOnce(updateChain);

    mockCreateCheck.mockRejectedValue(new MockWebkassaApiError('Cashbox not activated', 10, false));

    await processPendingFiscalReceipts();
    expect(updateChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed' }),
    );
  });

  it('processes two receipts sequentially for the same cashbox', async () => {
    const order: string[] = [];
    let idx = 0;

    mockCreateCheck.mockImplementation(async () => {
      const i = ++idx;
      order.push(`start-${i}`);
      await new Promise((r) => setTimeout(r, 10));
      order.push(`end-${i}`);
      return { checkNumber: `CHK-${i}`, isDuplicate: false, rawData: null };
    });

    const receipts = [
      makeReceipt({ id: 'r1', payment_transaction_id: 'txn-1' }),
      makeReceipt({ id: 'r2', payment_transaction_id: 'txn-2' }),
    ];

    const fetchChain = makeChain(receipts);
    const lockChain = makeChain([{ cashbox_id: 'SWK00035686' }]);
    const update1Chain = makeChain(null);
    const update2Chain = makeChain(null);

    mockSupabaseFrom
      .mockReturnValueOnce(fetchChain)   // fetch pending receipts
      .mockReturnValueOnce(lockChain)    // acquire lock
      .mockReturnValueOnce(update1Chain) // update receipt 1 (issued)
      .mockReturnValueOnce(update2Chain) // update receipt 2 (issued)
    ; // 5th call (release lock delete) returns undefined → caught in try-catch

    await processPendingFiscalReceipts();

    // Sequential: start-1 must complete before start-2
    expect(order).toEqual(['start-1', 'end-1', 'start-2', 'end-2']);
  });

  it('Error 11 (shift >24h) triggers Z-report then retries the fiscal receipt', async () => {
    const receipt = makeReceipt();
    const fetchChain = makeChain([receipt]);
    const lockChain = makeChain([{ cashbox_id: 'SWK00035686' }]);
    const updateChain = makeChain(null);

    mockSupabaseFrom
      .mockReturnValueOnce(fetchChain)
      .mockReturnValueOnce(lockChain)
      .mockReturnValueOnce(updateChain);

    mockCreateZReport.mockResolvedValue({ alreadyClosed: false, shiftNumber: 5, rawData: null });

    // First call: Error 11 (shift >24h). Second call: success.
    mockCreateCheck
      .mockRejectedValueOnce(new MockWebkassaApiError('Shift over 24h', 11, false))
      .mockResolvedValueOnce(makeSuccessResult());

    await processPendingFiscalReceipts();

    expect(mockCreateZReport).toHaveBeenCalledTimes(1);
    expect(mockCreateCheck).toHaveBeenCalledTimes(2);
    expect(updateChain.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'issued' }));
  });

  it('Error 11 retry uses same ExternalCheckNumber — idempotency prevents duplicate receipts', async () => {
    const receipt = makeReceipt({ payment_transaction_id: 'orig-txn-id' });
    const fetchChain = makeChain([receipt]);
    const lockChain = makeChain([{ cashbox_id: 'SWK00035686' }]);
    const updateChain = makeChain(null);

    mockSupabaseFrom
      .mockReturnValueOnce(fetchChain)
      .mockReturnValueOnce(lockChain)
      .mockReturnValueOnce(updateChain);

    mockCreateZReport.mockResolvedValue({ alreadyClosed: false, rawData: null });
    mockCreateCheck
      .mockRejectedValueOnce(new MockWebkassaApiError('Shift over 24h', 11, false))
      .mockResolvedValueOnce(makeSuccessResult());

    await processPendingFiscalReceipts();

    // Both calls must use the same ExternalCheckNumber to ensure idempotency
    const calls = mockCreateCheck.mock.calls;
    expect(calls).toHaveLength(2);
    const extNum1 = (calls[0]![1] as { ExternalCheckNumber: string }).ExternalCheckNumber;
    const extNum2 = (calls[1]![1] as { ExternalCheckNumber: string }).ExternalCheckNumber;
    expect(extNum1).toBe(extNum2);
    expect(extNum1).toBe('orig-txn-id');
  });

  it('Error 11 is NOT retried a second time — capped at 1 shift retry', async () => {
    const receipt = makeReceipt({ retry_count: 0 });
    const fetchChain = makeChain([receipt]);
    const lockChain = makeChain([{ cashbox_id: 'SWK00035686' }]);
    const updateChain = makeChain(null);

    mockSupabaseFrom
      .mockReturnValueOnce(fetchChain)
      .mockReturnValueOnce(lockChain)
      .mockReturnValueOnce(updateChain);

    mockCreateZReport.mockResolvedValue({ alreadyClosed: false, rawData: null });
    // Both attempts fail with Error 11 — second attempt must NOT trigger another Z-report
    mockCreateCheck.mockRejectedValue(new MockWebkassaApiError('Shift over 24h', 11, false));

    await processPendingFiscalReceipts();

    // Z-report only once, check only twice (original + 1 retry), then marked failed
    expect(mockCreateZReport).toHaveBeenCalledTimes(1);
    expect(mockCreateCheck).toHaveBeenCalledTimes(2);
    expect(updateChain.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }));
  });

  it('sale return (operation_type=refund) uses refundTransactionId as ExternalCheckNumber and passes OriginalExternalCheckNumber', async () => {
    const refundTxnId = 'refund-txn-uuid';
    const originalPaymentTxnId = 'orig-payment-txn-uuid';
    const receipt = makeReceipt({
      operation_type: 'refund',
      payment_transaction_id: originalPaymentTxnId,
      receipt_payload_sanitized: {
        refundTransactionId: refundTxnId,
        amountKzt: 1000,
        reason: 'customer_request',
      },
    });

    const fetchChain = makeChain([receipt]);
    const lockChain = makeChain([{ cashbox_id: 'SWK00035686' }]);
    const originalSaleChain = makeOriginalSaleChain(null); // no original sale data
    const updateChain = makeChain(null);

    mockSupabaseFrom
      .mockReturnValueOnce(fetchChain)
      .mockReturnValueOnce(lockChain)
      .mockReturnValueOnce(originalSaleChain)
      .mockReturnValueOnce(updateChain);

    mockCreateCheck.mockResolvedValue(makeSuccessResult());

    await processPendingFiscalReceipts();

    expect(mockCreateCheck).toHaveBeenCalledTimes(1);
    const [, request] = mockCreateCheck.mock.calls[0] as [unknown, { OperationType: number; ExternalCheckNumber: string; OriginalExternalCheckNumber?: string }];
    // Return uses refundTransactionId as its own ExternalCheckNumber (not originalPaymentTxnId)
    expect(request.ExternalCheckNumber).toBe(refundTxnId);
    // Original sale's ExternalCheckNumber is passed as base check reference
    expect(request.OriginalExternalCheckNumber).toBe(originalPaymentTxnId);
    // OperationType=3 (SALE_RETURN)
    expect(request.OperationType).toBe(3);
  });

  it('sale return (operation_type=refund) falls back to payment_transaction_id when no refundTransactionId in payload', async () => {
    const originalPaymentTxnId = 'orig-payment-no-refund-id';
    const receipt = makeReceipt({
      operation_type: 'refund',
      payment_transaction_id: originalPaymentTxnId,
      receipt_payload_sanitized: {}, // no refundTransactionId
    });

    const fetchChain = makeChain([receipt]);
    const lockChain = makeChain([{ cashbox_id: 'SWK00035686' }]);
    const originalSaleChain = makeOriginalSaleChain(null);
    const updateChain = makeChain(null);

    mockSupabaseFrom
      .mockReturnValueOnce(fetchChain)
      .mockReturnValueOnce(lockChain)
      .mockReturnValueOnce(originalSaleChain)
      .mockReturnValueOnce(updateChain);

    mockCreateCheck.mockResolvedValue(makeSuccessResult());

    await processPendingFiscalReceipts();

    const [, request] = mockCreateCheck.mock.calls[0] as [unknown, { ExternalCheckNumber: string; OriginalExternalCheckNumber?: string }];
    // Falls back to payment_transaction_id when refundTransactionId is absent
    expect(request.ExternalCheckNumber).toBe(originalPaymentTxnId);
    // OriginalExternalCheckNumber still set (same value as fallback ExternalCheckNumber)
    expect(request.OriginalExternalCheckNumber).toBe(originalPaymentTxnId);
  });

  it('sale return includes returnBasisDetails built from original sale provider_response_sanitized', async () => {
    const refundTxnId = 'refund-uuid-basis';
    const originalPaymentTxnId = 'orig-payment-basis';
    const receipt = makeReceipt({
      operation_type: 'refund',
      payment_transaction_id: originalPaymentTxnId,
      receipt_payload_sanitized: { refundTransactionId: refundTxnId },
    });

    const originalSaleProviderData = {
      CheckNumber: '1610859834212',
      DateTime: '01.07.2026 15:52:41',
      OfflineMode: false,
      Total: 1000,
      Cashbox: { RegistrationNumber: '774641472171' },
    };

    const fetchChain = makeChain([receipt]);
    const lockChain = makeChain([{ cashbox_id: 'SWK00035686' }]);
    const originalSaleChain = makeOriginalSaleChain(originalSaleProviderData);
    const updateChain = makeChain(null);

    mockSupabaseFrom
      .mockReturnValueOnce(fetchChain)
      .mockReturnValueOnce(lockChain)
      .mockReturnValueOnce(originalSaleChain)
      .mockReturnValueOnce(updateChain);

    mockCreateCheck.mockResolvedValue(makeSuccessResult());

    await processPendingFiscalReceipts();

    expect(mockCreateCheck).toHaveBeenCalledTimes(1);
    const [, request] = mockCreateCheck.mock.calls[0] as [
      unknown,
      {
        returnBasisDetails?: {
          dateTime: string;
          total: number;
          checkNumber: string;
          registrationNumber: string;
          isOffline: boolean;
        };
      },
    ];
    expect(request.returnBasisDetails).toBeDefined();
    expect(request.returnBasisDetails?.checkNumber).toBe('1610859834212');
    expect(request.returnBasisDetails?.total).toBe(1000);
    expect(request.returnBasisDetails?.registrationNumber).toBe('774641472171');
    expect(request.returnBasisDetails?.isOffline).toBe(false);
    // DateTime converted from "DD.MM.YYYY HH:mm:ss" → "YYYY-MM-DD HH:mm:ss"
    expect(request.returnBasisDetails?.dateTime).toBe('2026-07-01 15:52:41');
  });

  it('sale return proceeds without returnBasisDetails when original sale not in DB (warns, lets Webkassa fail)', async () => {
    const originalPaymentTxnId = 'orig-payment-no-sale-in-db';
    const receipt = makeReceipt({
      operation_type: 'refund',
      payment_transaction_id: originalPaymentTxnId,
      receipt_payload_sanitized: { refundTransactionId: 'refund-uuid-no-basis' },
    });

    const fetchChain = makeChain([receipt]);
    const lockChain = makeChain([{ cashbox_id: 'SWK00035686' }]);
    const originalSaleChain = makeOriginalSaleChain(null); // no original sale row
    const updateChain = makeChain(null);

    mockSupabaseFrom
      .mockReturnValueOnce(fetchChain)
      .mockReturnValueOnce(lockChain)
      .mockReturnValueOnce(originalSaleChain)
      .mockReturnValueOnce(updateChain);

    mockCreateCheck.mockResolvedValue(makeSuccessResult());

    await processPendingFiscalReceipts();

    // Proceeds without returnBasisDetails — createCheck is still called
    expect(mockCreateCheck).toHaveBeenCalledTimes(1);
    const [, request] = mockCreateCheck.mock.calls[0] as [unknown, { returnBasisDetails?: unknown }];
    expect(request.returnBasisDetails).toBeUndefined();
  });

  it('Error 10 (cashbox not activated) → permanent failure, not retried', async () => {
    const receipt = makeReceipt({ retry_count: 0 });
    const fetchChain = makeChain([receipt]);
    const lockChain = makeChain([{ cashbox_id: 'SWK00035686' }]);
    const updateChain = makeChain(null);

    mockSupabaseFrom
      .mockReturnValueOnce(fetchChain)
      .mockReturnValueOnce(lockChain)
      .mockReturnValueOnce(updateChain);

    mockCreateCheck.mockRejectedValue(new MockWebkassaApiError('Cashbox not activated', 10, false));

    await processPendingFiscalReceipts();

    expect(updateChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed', error_code: '10' }),
    );
    expect(mockCreateCheck).toHaveBeenCalledTimes(1);
  });

  it('Error 18 (offline duration exceeded) → permanent failure, not retried', async () => {
    const receipt = makeReceipt({ retry_count: 0 });
    const fetchChain = makeChain([receipt]);
    const lockChain = makeChain([{ cashbox_id: 'SWK00035686' }]);
    const updateChain = makeChain(null);

    mockSupabaseFrom
      .mockReturnValueOnce(fetchChain)
      .mockReturnValueOnce(lockChain)
      .mockReturnValueOnce(updateChain);

    mockCreateCheck.mockRejectedValue(new MockWebkassaApiError('Offline duration exceeded', 18, false));

    await processPendingFiscalReceipts();

    expect(updateChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed', error_code: '18' }),
    );
    expect(mockCreateCheck).toHaveBeenCalledTimes(1);
  });

  it('generic retryable error (code 505) → status=retry_required, error_code saved', async () => {
    const receipt = makeReceipt({ retry_count: 0 });
    const fetchChain = makeChain([receipt]);
    const lockChain = makeChain([{ cashbox_id: 'SWK00035686' }]);
    const updateChain = makeChain(null);

    mockSupabaseFrom
      .mockReturnValueOnce(fetchChain)
      .mockReturnValueOnce(lockChain)
      .mockReturnValueOnce(updateChain);

    mockCreateCheck.mockRejectedValue(new MockWebkassaApiError('Service unavailable', 505, true));

    await processPendingFiscalReceipts();

    expect(updateChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'retry_required', error_code: '505' }),
    );
  });

  it('generic non-retryable API error → status=failed, error_code and message saved', async () => {
    const receipt = makeReceipt({ retry_count: 0 });
    const fetchChain = makeChain([receipt]);
    const lockChain = makeChain([{ cashbox_id: 'SWK00035686' }]);
    const updateChain = makeChain(null);

    mockSupabaseFrom
      .mockReturnValueOnce(fetchChain)
      .mockReturnValueOnce(lockChain)
      .mockReturnValueOnce(updateChain);

    mockCreateCheck.mockRejectedValue(new MockWebkassaApiError('Validation error', 9, false));

    await processPendingFiscalReceipts();

    expect(updateChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed', error_code: '9' }),
    );
  });

  it('Error 2 (session expired) is handled by webkassa-client re-auth — receipt succeeds, no duplicate', async () => {
    // Error 2 is re-authed inside callAuthenticated() in webkassa-client (not in fiscal-processor).
    // fiscal-processor only sees the final success or failure after webkassa-client retries.
    const receipt = makeReceipt();
    const fetchChain = makeChain([receipt]);
    const lockChain = makeChain([{ cashbox_id: 'SWK00035686' }]);
    const updateChain = makeChain(null);

    mockSupabaseFrom
      .mockReturnValueOnce(fetchChain)
      .mockReturnValueOnce(lockChain)
      .mockReturnValueOnce(updateChain);

    // webkassa-client handles Error 2 internally; fiscal-processor receives success
    mockCreateCheck.mockResolvedValue(makeSuccessResult());

    await processPendingFiscalReceipts();

    expect(mockCreateCheck).toHaveBeenCalledTimes(1);
    expect(updateChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'issued' }),
    );
  });

  // ─── New tests: config logging, production gate, provider filter ──────────────

  it('logs skip reason when WEBKASSA_ENABLED is not set', async () => {
    const consoleSpy = jest.spyOn(console, 'info').mockImplementation(() => undefined);
    mockEnv.WEBKASSA_ENABLED = undefined as unknown as string;

    await processPendingFiscalReceipts();

    expect(mockSupabaseFrom).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith(
      '[fiscal-processor] skipping — Webkassa not configured',
      expect.objectContaining({ reason: expect.stringContaining('WEBKASSA_ENABLED') }),
    );
    consoleSpy.mockRestore();
  });

  it('logs skip reason when FISCAL_PROVIDER_ENV=production and WEBKASSA_ALLOW_REAL_RECEIPTS not set', async () => {
    const consoleSpy = jest.spyOn(console, 'info').mockImplementation(() => undefined);
    mockEnv.FISCAL_PROVIDER_ENV = 'production';
    mockEnv.WEBKASSA_ALLOW_REAL_RECEIPTS = undefined;

    await processPendingFiscalReceipts();

    expect(mockSupabaseFrom).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith(
      '[fiscal-processor] skipping — Webkassa not configured',
      expect.objectContaining({ reason: expect.stringContaining('WEBKASSA_ALLOW_REAL_RECEIPTS') }),
    );
    consoleSpy.mockRestore();
  });

  it('processes pending production sale receipt when WEBKASSA_ALLOW_REAL_RECEIPTS=true and FISCAL_PROVIDER_ENV=production', async () => {
    mockEnv.FISCAL_PROVIDER_ENV = 'production';
    mockEnv.WEBKASSA_ALLOW_REAL_RECEIPTS = 'true';

    const receipt = makeReceipt({ id: 'prod-receipt-1' });
    const fetchChain = makeChain([receipt]);
    const lockChain = makeChain([{ cashbox_id: 'SWK00035686' }]);
    const updateChain = makeChain(null);

    mockSupabaseFrom
      .mockReturnValueOnce(fetchChain)
      .mockReturnValueOnce(lockChain)
      .mockReturnValueOnce(updateChain);

    mockCreateCheck.mockResolvedValue(makeSuccessResult());

    await processPendingFiscalReceipts();

    // Must process — not skip
    expect(mockCreateCheck).toHaveBeenCalledTimes(1);
    expect(updateChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'issued' }),
    );
  });

  it('DB query includes provider=webkassa filter (only webkassa receipts are processed)', async () => {
    const fetchChain = makeChain([]);
    mockSupabaseFrom.mockReturnValue(fetchChain);

    await processPendingFiscalReceipts();

    // eq('provider', 'webkassa') must be called in the chain
    expect(fetchChain.eq).toHaveBeenCalledWith('provider', 'webkassa');
  });
});

// ─── processReceiptById ────────────────────────────────────────────────────────

import { processReceiptById } from '../fiscal-processor';

describe('processReceiptById', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockEnv.WEBKASSA_ENABLED = 'true';
    mockEnv.WEBKASSA_API_KEY = 'test-key';
    mockEnv.WEBKASSA_LOGIN = 'test@test.com';
    mockEnv.WEBKASSA_PASSWORD = 'test-pass';
    mockEnv.WEBKASSA_CASHBOX_SERIAL_NUMBER = 'SWK00035686';
    mockEnv.FISCAL_PROVIDER_ENV = 'test';
    mockEnv.WEBKASSA_ALLOW_REAL_RECEIPTS = undefined;
  });

  function makeSingleReceiptChain(row: Record<string, unknown> | null) {
    return {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: row }),
    };
  }

  it('throws when Webkassa not configured', async () => {
    mockEnv.WEBKASSA_ENABLED = undefined as unknown as string;
    await expect(processReceiptById('any-id')).rejects.toThrow('Webkassa not configured');
  });

  it('returns not_found when receipt does not exist', async () => {
    const chain = makeSingleReceiptChain(null);
    mockSupabaseFrom.mockReturnValueOnce(chain);

    const result = await processReceiptById('unknown-id');
    expect(result).toBe('not_found');
  });

  it('returns already_issued when provider_receipt_id is set — prevents duplicate', async () => {
    const chain = makeSingleReceiptChain({
      id: 'r1', status: 'issued', provider_receipt_id: 'CHK-EXISTING',
      fiscal_url: 'https://ofd.kz/existing', retry_count: 0,
    });
    mockSupabaseFrom.mockReturnValueOnce(chain);

    const result = await processReceiptById('r1');
    expect(result).toBe('already_issued');
    expect(mockCreateCheck).not.toHaveBeenCalled();
  });

  it('returns not_processable when status is issued', async () => {
    const chain = makeSingleReceiptChain({
      id: 'r1', status: 'issued', provider_receipt_id: null, fiscal_url: null, retry_count: 0,
    });
    mockSupabaseFrom.mockReturnValueOnce(chain);

    const result = await processReceiptById('r1');
    expect(result).toBe('not_processable');
  });

  it('processes a pending receipt and returns processed', async () => {
    const row = {
      ...makeReceipt({ id: 'retry-r1' }),
      status: 'pending',
      provider_receipt_id: null,
      fiscal_url: null,
    };
    const receiptChain = makeSingleReceiptChain(row);
    const lockChain = makeChain([{ cashbox_id: 'SWK00035686' }]);
    const updateChain = makeChain(null);

    mockSupabaseFrom
      .mockReturnValueOnce(receiptChain)  // fetch receipt by id
      .mockReturnValueOnce(lockChain)      // acquire db lock
      .mockReturnValueOnce(updateChain);   // update to issued

    mockCreateCheck.mockResolvedValue(makeSuccessResult());

    const result = await processReceiptById('retry-r1');
    expect(result).toBe('processed');
    expect(mockCreateCheck).toHaveBeenCalledTimes(1);
    expect(updateChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'issued' }),
    );
  });

  it('processes a failed receipt (retry_count=0, no provider_receipt_id)', async () => {
    const row = {
      ...makeReceipt({ id: 'failed-r1', retry_count: 0 }),
      status: 'failed',
      provider_receipt_id: null,
      fiscal_url: null,
    };
    const receiptChain = makeSingleReceiptChain(row);
    const lockChain = makeChain([{ cashbox_id: 'SWK00035686' }]);
    const updateChain = makeChain(null);

    mockSupabaseFrom
      .mockReturnValueOnce(receiptChain)
      .mockReturnValueOnce(lockChain)
      .mockReturnValueOnce(updateChain);

    mockCreateCheck.mockResolvedValue(makeSuccessResult());

    const result = await processReceiptById('failed-r1');
    expect(result).toBe('processed');
    expect(updateChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'issued' }),
    );
  });
});
