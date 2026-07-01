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
  sanitizeForStorage: jest.fn(() => ({})),
  WebkassaApiError: MockWebkassaApiError,
  WebkassaNetworkError: MockWebkassaNetworkError,
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
});
