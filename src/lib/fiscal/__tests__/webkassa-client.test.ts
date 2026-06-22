import {
  authenticate,
  createCheck,
  sanitizeForStorage,
  WebkassaApiError,
  WebkassaNetworkError,
  _resetTokenCacheForTests,
  type WebkassaClientConfig,
} from '../webkassa-client';

// ─── Mock fetch ───────────────────────────────────────────────────────────────

const mockFetch = jest.fn();
global.fetch = mockFetch;

const TEST_CONFIG: WebkassaClientConfig = {
  apiBaseUrl: 'https://devkkm.webkassa.kz',
  apiKey: 'test-api-key',
  login: 'test@example.com',
  password: 'test-password',
  cashboxUniqueNumber: 'SWK00529346',
  timeoutMs: 5000,
};

const SALE_REQUEST_BASE = {
  OperationType: 2 as const,
  Positions: [
    {
      Count: 1,
      Price: 1999,
      TaxType: 0 as const,
      TaxPercent: 0,
      Tax: 0,
      PositionName: 'Услуга перевода документа',
      UnitCode: 796,
      Discount: 0,
      Markup: 0,
    },
  ],
  Payments: [{ Sum: 1999, PaymentType: 1 as const }],
  Change: 0,
  RoundType: 2,
  ExternalCheckNumber: '550e8400-e29b-41d4-a716-446655440000',
};

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'application/json' },
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

beforeEach(() => {
  mockFetch.mockReset();
  _resetTokenCacheForTests();
});

// ─── authenticate() ───────────────────────────────────────────────────────────

describe('authenticate()', () => {
  it('returns token on success', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ Data: { Token: 'test-token-abc' } }),
    );

    const token = await authenticate(TEST_CONFIG);
    expect(token).toBe('test-token-abc');

    // Should have called /api/v4/Authorize
    expect(mockFetch).toHaveBeenCalledWith(
      'https://devkkm.webkassa.kz/api/v4/Authorize',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'x-api-key': 'test-api-key' }),
      }),
    );

    // Should NOT log password — verify it's in body but we can't easily check from outside
    // The test serves as documentation of the API contract.
  });

  it('throws WebkassaApiError on credentials error (Code 1)', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ Errors: [{ Code: 1, Text: 'Неверный логин и/или пароль' }] }),
    );

    let caught: unknown;
    try { await authenticate(TEST_CONFIG); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(WebkassaApiError);
    expect(caught).toMatchObject({ code: 1, isRetryable: false });
  });

  it('throws WebkassaNetworkError when Token is missing from response', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ Data: {} }));
    await expect(authenticate(TEST_CONFIG)).rejects.toThrow(WebkassaNetworkError);
  });

  it('throws WebkassaNetworkError on non-JSON response', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'text/html' },
      text: async () => '<html>Gateway timeout</html>',
    } as unknown as Response);

    await expect(authenticate(TEST_CONFIG)).rejects.toThrow(WebkassaNetworkError);
  });

  it('throws WebkassaNetworkError on HTTP 500', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ error: 'Internal Server Error' }, 500));
    await expect(authenticate(TEST_CONFIG)).rejects.toThrow(WebkassaNetworkError);
  });
});

// ─── createCheck() ────────────────────────────────────────────────────────────

describe('createCheck()', () => {
  function mockAuth() {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ Data: { Token: 'test-token-xyz' } }),
    );
  }

  const SUCCESSFUL_RECEIPT = {
    CheckNumber: '1675760809473',
    DateTime: '28.01.2026 08:49:41',
    DateTimeUTC: '28.01.2026 08:49:41 +05:00',
    ShiftNumber: 16,
    Total: 1999,
    TicketUrl: 'https://ctest3.wofd.kz/consumer?i=1675760809473',
    TicketPrintUrl: 'https://devkkm.webkassa.kz/spa-ui/ticket?id=123',
  };

  it('creates a sale receipt and returns parsed fields', async () => {
    mockAuth();
    mockFetch.mockResolvedValueOnce(jsonResponse({ Data: SUCCESSFUL_RECEIPT }));

    const result = await createCheck(TEST_CONFIG, SALE_REQUEST_BASE);

    expect(result.checkNumber).toBe('1675760809473');
    expect(result.ticketUrl).toBe('https://ctest3.wofd.kz/consumer?i=1675760809473');
    expect(result.total).toBe(1999);
    expect(result.isDuplicate).toBe(false);
    expect(result.rawData).toMatchObject({ CheckNumber: '1675760809473' });
  });

  it('treats Error 14 (duplicate ExternalCheckNumber) as success', async () => {
    mockAuth();
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        Data: SUCCESSFUL_RECEIPT,
        Errors: [{ Code: 14, Text: 'Чек с данным внешним номером уже существует' }],
      }),
    );

    const result = await createCheck(TEST_CONFIG, SALE_REQUEST_BASE);

    expect(result.isDuplicate).toBe(true);
    expect(result.checkNumber).toBe('1675760809473');
  });

  it('throws WebkassaApiError on non-retryable error (Code 6 cashbox not found)', async () => {
    mockAuth();
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ Errors: [{ Code: 6, Text: 'Касса не найдена' }] }),
    );

    let caught: unknown;
    try { await createCheck(TEST_CONFIG, SALE_REQUEST_BASE); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(WebkassaApiError);
    expect(caught).toMatchObject({ code: 6, isRetryable: false });
  });

  it('re-authenticates on session expired (Error Code 2) and retries', async () => {
    // First auth
    mockFetch.mockResolvedValueOnce(jsonResponse({ Data: { Token: 'old-token' } }));
    // First check → session expired
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        Errors: [{ Code: 2, Text: 'Сессия устарела' }],
      }),
    );
    // Re-auth
    mockFetch.mockResolvedValueOnce(jsonResponse({ Data: { Token: 'new-token' } }));
    // Retry check → success
    mockFetch.mockResolvedValueOnce(jsonResponse({ Data: SUCCESSFUL_RECEIPT }));

    const result = await createCheck(TEST_CONFIG, SALE_REQUEST_BASE);

    expect(result.checkNumber).toBe('1675760809473');
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });

  it('throws WebkassaNetworkError on timeout (AbortError)', async () => {
    mockAuth();
    mockFetch.mockImplementation(() => {
      const err = new Error('The operation was aborted.');
      (err as NodeJS.ErrnoException).name = 'AbortError';
      return Promise.reject(err);
    });

    await expect(
      createCheck({ ...TEST_CONFIG, timeoutMs: 100 }, SALE_REQUEST_BASE),
    ).rejects.toThrow(WebkassaNetworkError);
  });

  it('throws WebkassaNetworkError when response has no Data and no Errors', async () => {
    mockAuth();
    mockFetch.mockResolvedValueOnce(jsonResponse({}));

    await expect(createCheck(TEST_CONFIG, SALE_REQUEST_BASE)).rejects.toThrow(WebkassaNetworkError);
  });

  it('includes CashboxUniqueNumber from config in the request', async () => {
    mockAuth();
    mockFetch.mockResolvedValueOnce(jsonResponse({ Data: SUCCESSFUL_RECEIPT }));

    await createCheck(TEST_CONFIG, SALE_REQUEST_BASE);

    const checkCall = mockFetch.mock.calls[1];
    const body = JSON.parse(checkCall[1].body as string) as Record<string, unknown>;
    expect(body.CashboxUniqueNumber).toBe('SWK00529346');
  });
});

// ─── sanitizeForStorage() ─────────────────────────────────────────────────────

describe('sanitizeForStorage()', () => {
  it('returns null for null input', () => {
    expect(sanitizeForStorage(null)).toBeNull();
  });

  it('strips Token field if present', () => {
    const data = {
      CheckNumber: '123',
      Token: 'secret-token',
      Total: 999,
    };
    const result = sanitizeForStorage(data as never);
    expect(result).not.toBeNull();
    expect(result!['Token']).toBeUndefined();
    expect(result!['CheckNumber']).toBe('123');
  });

  it('strips Password field if present', () => {
    const data = { CheckNumber: '123', Password: 'secret' };
    const result = sanitizeForStorage(data as never);
    expect(result!['Password']).toBeUndefined();
  });

  it('returns plain serializable object', () => {
    const data = { CheckNumber: '123', Total: 999 };
    const result = sanitizeForStorage(data);
    expect(JSON.stringify(result)).toBe(JSON.stringify({ CheckNumber: '123', Total: 999 }));
  });
});
