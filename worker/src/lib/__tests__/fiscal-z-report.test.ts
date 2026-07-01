/**
 * Tests: fiscal-z-report.ts
 *
 * Covers:
 * - Skips when WEBKASSA_Z_REPORT_ENABLED / WEBKASSA_ENABLED not set
 * - Skips when credentials are missing
 * - Skips when Z-report already issued for today
 * - Skips when pending fiscal receipts exist
 * - Calls createZReport and marks issued on success
 * - Marks already_closed when Webkassa returns alreadyClosed=true
 * - Idempotent: second call for same date skips
 * - Sets status=failed when createZReport throws
 */

// ─── Module mocks (must be before any imports) ────────────────────────────────

const mockEnv = {
  WEBKASSA_ENABLED: 'true',
  WEBKASSA_Z_REPORT_ENABLED: 'true',
  WEBKASSA_API_KEY: 'test-key',
  WEBKASSA_LOGIN: 'test@test.com',
  WEBKASSA_PASSWORD: 'test-pass',
  WEBKASSA_CASHBOX_SERIAL_NUMBER: 'SWK00035686',
  WEBKASSA_API_BASE_URL: 'https://devkkm.webkassa.kz',
  WEBKASSA_ALLOW_REAL_RECEIPTS: undefined as string | undefined,
  FISCAL_PROVIDER_ENV: 'test' as 'test' | 'production',
  WEBKASSA_Z_REPORT_TIMEZONE: 'Asia/Almaty',
  WEBKASSA_Z_REPORT_HOUR: 0, // always pass the hour check in tests
};

jest.mock('../env', () => ({ env: mockEnv }));

const mockSupabaseFrom = jest.fn();
jest.mock('../supabase', () => ({ supabase: { from: mockSupabaseFrom } }));

const mockCreateZReport = jest.fn();
jest.mock('../webkassa-client', () => ({
  createZReport: mockCreateZReport,
  sanitizeForStorage: jest.fn(() => null),
  WebkassaApiError: class WebkassaApiError extends Error {
    code: number; isRetryable: boolean;
    constructor(msg: string, code: number, isRetryable: boolean) {
      super(msg); this.name = 'WebkassaApiError'; this.code = code; this.isRetryable = isRetryable;
    }
  },
  WebkassaNetworkError: class WebkassaNetworkError extends Error {
    isRetryable: boolean;
    constructor(msg: string, isRetryable: boolean) { super(msg); this.name = 'WebkassaNetworkError'; this.isRetryable = isRetryable; }
  },
}));

// ─── Import after mocks ───────────────────────────────────────────────────────

import { maybeRunScheduledZReport } from '../fiscal-z-report';

// ─── Chain builders by query pattern ─────────────────────────────────────────

/**
 * Z-report check chain: .select().eq().eq().maybeSingle()
 * Z-report insert chain: .insert().select().single()
 * Z-report update chain: .update().eq()
 */
function makeZReportTableChain(opts: {
  maybeSingleData?: unknown;
  singleData?: unknown;
  singleError?: unknown;
} = {}) {
  // update().eq() — eq is the terminal that resolves the promise
  const eqAfterUpdate = jest.fn().mockResolvedValue({ error: null });
  const updateFn = jest.fn().mockReturnValue({ eq: eqAfterUpdate });

  const chain = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(), // non-terminal eq (for select/check chains)
    insert: jest.fn().mockReturnThis(),
    update: updateFn,
    maybeSingle: jest.fn().mockResolvedValue({ data: opts.maybeSingleData ?? null }),
    single: jest.fn().mockResolvedValue({
      data: opts.singleData ?? { id: 'z-row-id' },
      error: opts.singleError ?? null,
    }),
    _updateFn: updateFn,
    _eqAfterUpdate: eqAfterUpdate,
  };
  return chain;
}

/**
 * fiscal_receipts count chain: .select().in().limit() — limit() resolves directly.
 */
function makeFiscalReceiptsCountChain(count: number) {
  return {
    select: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    limit: jest.fn().mockResolvedValue({ count, error: null }),
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('maybeRunScheduledZReport', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockEnv.WEBKASSA_ENABLED = 'true';
    mockEnv.WEBKASSA_Z_REPORT_ENABLED = 'true';
    mockEnv.WEBKASSA_API_KEY = 'test-key';
    mockEnv.WEBKASSA_LOGIN = 'test@test.com';
    mockEnv.WEBKASSA_PASSWORD = 'test-pass';
    mockEnv.WEBKASSA_CASHBOX_SERIAL_NUMBER = 'SWK00035686';
    mockEnv.WEBKASSA_API_BASE_URL = 'https://devkkm.webkassa.kz';
    mockEnv.FISCAL_PROVIDER_ENV = 'test';
    mockEnv.WEBKASSA_ALLOW_REAL_RECEIPTS = undefined;
    mockEnv.WEBKASSA_Z_REPORT_TIMEZONE = 'Asia/Almaty';
    mockEnv.WEBKASSA_Z_REPORT_HOUR = 0;
  });

  it('skips when WEBKASSA_Z_REPORT_ENABLED is not set', async () => {
    mockEnv.WEBKASSA_Z_REPORT_ENABLED = undefined as unknown as string;
    await maybeRunScheduledZReport();
    expect(mockSupabaseFrom).not.toHaveBeenCalled();
    expect(mockCreateZReport).not.toHaveBeenCalled();
  });

  it('skips when WEBKASSA_ENABLED is not set', async () => {
    mockEnv.WEBKASSA_ENABLED = undefined as unknown as string;
    await maybeRunScheduledZReport();
    expect(mockSupabaseFrom).not.toHaveBeenCalled();
    expect(mockCreateZReport).not.toHaveBeenCalled();
  });

  it('skips when credentials are missing', async () => {
    mockEnv.WEBKASSA_API_KEY = undefined as unknown as string;
    await maybeRunScheduledZReport();
    expect(mockSupabaseFrom).not.toHaveBeenCalled();
    expect(mockCreateZReport).not.toHaveBeenCalled();
  });

  it('skips when production env and WEBKASSA_ALLOW_REAL_RECEIPTS not set', async () => {
    mockEnv.FISCAL_PROVIDER_ENV = 'production';
    mockEnv.WEBKASSA_ALLOW_REAL_RECEIPTS = undefined;
    await maybeRunScheduledZReport();
    expect(mockSupabaseFrom).not.toHaveBeenCalled();
    expect(mockCreateZReport).not.toHaveBeenCalled();
  });

  it('skips when Z-report already issued for today', async () => {
    // maybeSingle returns an existing issued row → ensureZReportRow returns null → skip
    const chain = makeZReportTableChain({ maybeSingleData: { id: 'z1', status: 'issued' } });
    mockSupabaseFrom.mockReturnValue(chain);

    await maybeRunScheduledZReport();
    expect(mockCreateZReport).not.toHaveBeenCalled();
  });

  it('skips when Z-report already_closed for today', async () => {
    const chain = makeZReportTableChain({ maybeSingleData: { id: 'z2', status: 'already_closed' } });
    mockSupabaseFrom.mockReturnValue(chain);

    await maybeRunScheduledZReport();
    expect(mockCreateZReport).not.toHaveBeenCalled();
  });

  it('skips when pending fiscal receipts exist for cashbox', async () => {
    // Sequence of from() calls:
    // 1. fiscal_z_reports check (maybySingle → null = no existing row)
    // 2. fiscal_z_reports insert (single → new row id)
    // 3. fiscal_receipts count check (limit → count=1, has pending)
    const zCheckChain = makeZReportTableChain({ maybeSingleData: null });
    const zInsertChain = makeZReportTableChain({ maybeSingleData: null, singleData: { id: 'new-z-id' } });
    const fiscalCountChain = makeFiscalReceiptsCountChain(1); // pending receipts exist

    mockSupabaseFrom
      .mockReturnValueOnce(zCheckChain)      // fiscal_z_reports select/eq/maybySingle
      .mockReturnValueOnce(zInsertChain)     // fiscal_z_reports insert/select/single
      .mockReturnValueOnce(fiscalCountChain); // fiscal_receipts count

    await maybeRunScheduledZReport();
    expect(mockCreateZReport).not.toHaveBeenCalled();
  });

  it('calls createZReport and marks issued on success', async () => {
    const zCheckChain = makeZReportTableChain({ maybeSingleData: null });
    const zInsertChain = makeZReportTableChain({ singleData: { id: 'new-z-id' } });
    const fiscalCountChain = makeFiscalReceiptsCountChain(0); // no pending receipts
    const zUpdateChain = makeZReportTableChain({});

    mockSupabaseFrom
      .mockReturnValueOnce(zCheckChain)
      .mockReturnValueOnce(zInsertChain)
      .mockReturnValueOnce(fiscalCountChain)
      .mockReturnValueOnce(zUpdateChain);

    mockCreateZReport.mockResolvedValue({
      shiftNumber: 5,
      documentCount: 10,
      alreadyClosed: false,
      rawData: null,
    });

    await maybeRunScheduledZReport();

    expect(mockCreateZReport).toHaveBeenCalledTimes(1);
    expect(zUpdateChain._updateFn).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'issued', shift_number: 5, document_count: 10 }),
    );
  });

  it('marks already_closed when Webkassa returns alreadyClosed=true (Error 12/13)', async () => {
    const zCheckChain = makeZReportTableChain({ maybeSingleData: null });
    const zInsertChain = makeZReportTableChain({ singleData: { id: 'new-z-id' } });
    const fiscalCountChain = makeFiscalReceiptsCountChain(0);
    const zUpdateChain = makeZReportTableChain({});

    mockSupabaseFrom
      .mockReturnValueOnce(zCheckChain)
      .mockReturnValueOnce(zInsertChain)
      .mockReturnValueOnce(fiscalCountChain)
      .mockReturnValueOnce(zUpdateChain);

    mockCreateZReport.mockResolvedValue({ alreadyClosed: true, rawData: null });

    await expect(maybeRunScheduledZReport()).resolves.not.toThrow();
    expect(mockCreateZReport).toHaveBeenCalledTimes(1);
    expect(zUpdateChain._updateFn).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'already_closed' }),
    );
  });

  it('is idempotent — second call finds existing issued row and skips', async () => {
    const chain = makeZReportTableChain({ maybeSingleData: { id: 'z-id', status: 'issued' } });
    mockSupabaseFrom.mockReturnValue(chain); // both calls find the same issued row

    await maybeRunScheduledZReport();
    await maybeRunScheduledZReport();

    expect(mockCreateZReport).not.toHaveBeenCalled();
  });

  it('sets status=failed and updates row when createZReport throws', async () => {
    const zCheckChain = makeZReportTableChain({ maybeSingleData: null });
    const zInsertChain = makeZReportTableChain({ singleData: { id: 'fail-z-id' } });
    const fiscalCountChain = makeFiscalReceiptsCountChain(0);
    const zUpdateChain = makeZReportTableChain({});

    mockSupabaseFrom
      .mockReturnValueOnce(zCheckChain)
      .mockReturnValueOnce(zInsertChain)
      .mockReturnValueOnce(fiscalCountChain)
      .mockReturnValueOnce(zUpdateChain);

    mockCreateZReport.mockRejectedValue(new Error('Network timeout'));

    await expect(maybeRunScheduledZReport()).resolves.not.toThrow();
    expect(zUpdateChain._updateFn).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed', error_message: 'Network timeout' }),
    );
  });
});
