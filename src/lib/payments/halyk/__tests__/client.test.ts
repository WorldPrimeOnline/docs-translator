import { createPaymentToken, checkPaymentStatus, HalykApiError } from '../client';
import { _resetConfigCache } from '../config';

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

function mockTokenSuccess(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    text: async () => JSON.stringify({
      access_token: 'test-access-token',
      token_type: 'Bearer',
      expires_in: 3600,
      ...overrides,
    }),
  };
}

function mockStatusSuccess(statusName = 'CHARGE', resultCode = 100) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    text: async () => JSON.stringify({
      resultCode,
      transaction: {
        invoiceID: '123456789012345',
        terminalID: 'test-terminal',
        statusName,
        amount: 1999,
        currency: 'KZT',
      },
    }),
  };
}

const baseParams = {
  invoiceId: '123456789012345',
  secretHash: 'test-secret',
  amount: 1999,
  postLink: 'https://example.com/callback',
  failurePostLink: 'https://example.com/callback',
};

beforeEach(() => {
  _resetConfigCache();
  process.env.HALYK_EPAY_ENABLED = 'true';
  process.env.HALYK_EPAY_MODE = 'test';
  process.env.HALYK_EPAY_CLIENT_ID = 'test-client-id';
  process.env.HALYK_EPAY_CLIENT_SECRET = 'test-client-secret';
  process.env.HALYK_EPAY_TERMINAL_ID = 'test-terminal';
  process.env.APP_BASE_URL = 'https://staging.wpotranslations.org';
  mockFetch.mockReset();
});

afterEach(() => {
  _resetConfigCache();
  delete process.env.HALYK_EPAY_ENABLED;
  delete process.env.HALYK_EPAY_MODE;
  delete process.env.HALYK_EPAY_CLIENT_ID;
  delete process.env.HALYK_EPAY_CLIENT_SECRET;
  delete process.env.HALYK_EPAY_TERMINAL_ID;
  delete process.env.APP_BASE_URL;
});

// ─── HalykApiError class ──────────────────────────────────────────────────────

describe('HalykApiError', () => {
  it('carries all diagnostic fields', () => {
    const err = new HalykApiError({
      message: 'test',
      code: 'TEST_CODE',
      httpStatus: 400,
      responseBodySnippet: 'body',
      responseContentType: 'application/json',
      halykErrorCode: 'invalid_client',
      halykErrorDescription: 'Bad credentials',
      validationIssues: [{ path: ['access_token'], message: 'Required' }],
    });
    expect(err.code).toBe('TEST_CODE');
    expect(err.httpStatus).toBe(400);
    expect(err.responseBodySnippet).toBe('body');
    expect(err.responseContentType).toBe('application/json');
    expect(err.halykErrorCode).toBe('invalid_client');
    expect(err.halykErrorDescription).toBe('Bad credentials');
    expect(err.validationIssues).toHaveLength(1);
    expect(err instanceof Error).toBe(true);
    expect(err instanceof HalykApiError).toBe(true);
  });
});

// ─── createPaymentToken ────────────────────────────────────────────────────────

describe('createPaymentToken', () => {
  it('throws HalykApiError when disabled', async () => {
    _resetConfigCache();
    process.env.HALYK_EPAY_ENABLED = 'false';
    await expect(createPaymentToken(baseParams)).rejects.toThrow(HalykApiError);
  });

  it('returns token on success — standard response', async () => {
    mockFetch.mockResolvedValueOnce(mockTokenSuccess());
    const result = await createPaymentToken(baseParams);
    expect(result.access_token).toBe('test-access-token');
    expect(result.token_type).toBe('Bearer');
    expect(result.expires_in).toBe(3600);
  });

  it('accepts expires_in as numeric string (Halyk test env quirk)', async () => {
    mockFetch.mockResolvedValueOnce(mockTokenSuccess({ expires_in: '7200' }));
    const result = await createPaymentToken(baseParams);
    // z.union([z.number(), z.string()]).transform(Number) coerces to number
    expect(typeof result.expires_in).toBe('number');
    expect(result.expires_in).toBe(7200);
  });

  it('succeeds when token_type is absent (optional field)', async () => {
    const { token_type: _, ...withoutType } = { access_token: 'tok', token_type: 'Bearer', expires_in: 3600 };
    void _;
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      text: async () => JSON.stringify(withoutType),
    });
    const result = await createPaymentToken(baseParams);
    expect(result.access_token).toBe('tok');
    expect(result.token_type).toBeUndefined();
  });

  it('passes through extra unknown fields without throwing', async () => {
    mockFetch.mockResolvedValueOnce(mockTokenSuccess({ extra_field: 'ignored', jti: 'abc' }));
    const result = await createPaymentToken(baseParams);
    expect(result.access_token).toBe('test-access-token');
  });

  it('normalizes token → access_token if Halyk returns wrong key', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      text: async () => JSON.stringify({ token: 'normalized-token', expires_in: 3600 }),
    });
    const result = await createPaymentToken(baseParams);
    expect(result.access_token).toBe('normalized-token');
  });

  it('throws HALYK_OAUTH_SCHEMA_ERROR with httpStatus and snippet when access_token is missing', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      text: async () => JSON.stringify({ token_type: 'bearer', expires_in: 3600 }),
    });
    let caught: HalykApiError | null = null;
    try { await createPaymentToken(baseParams); } catch (e) { if (e instanceof HalykApiError) caught = e; }
    expect(caught).not.toBeNull();
    expect(caught?.code).toBe('HALYK_OAUTH_SCHEMA_ERROR');
    expect(caught?.httpStatus).toBe(200);
    expect(caught?.responseBodySnippet).toBeDefined();
    expect(caught?.validationIssues).toBeDefined();
    expect(caught?.validationIssues?.length).toBeGreaterThan(0);
  });

  it('throws HALYK_OAUTH_EMPTY_TOKEN when access_token is empty string', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      text: async () => JSON.stringify({ access_token: '', expires_in: 3600 }),
    });
    let caught: HalykApiError | null = null;
    try { await createPaymentToken(baseParams); } catch (e) { if (e instanceof HalykApiError) caught = e; }
    // Empty string fails z.string().min(1) — captured as HALYK_OAUTH_SCHEMA_ERROR
    expect(caught?.code).toMatch(/HALYK_OAUTH_SCHEMA_ERROR|HALYK_OAUTH_EMPTY_TOKEN/);
  });

  it('throws HALYK_OAUTH_NON_JSON_RESPONSE on non-JSON body', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: () => 'text/html' },
      text: async () => '<html>Error</html>',
    });
    let caught: HalykApiError | null = null;
    try { await createPaymentToken(baseParams); } catch (e) { if (e instanceof HalykApiError) caught = e; }
    expect(caught).not.toBeNull();
    expect(caught?.code).toBe('HALYK_OAUTH_NON_JSON_RESPONSE');
    expect(caught?.httpStatus).toBe(200);
    expect(caught?.responseBodySnippet).toContain('<html>');
  });

  it('throws HALYK_OAUTH_HTTP_ERROR on HTTP 400 with error body', async () => {
    const halykErrorBody = '{"error":"invalid_client","error_description":"Bad credentials"}';
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      headers: { get: () => 'application/json' },
      text: async () => halykErrorBody,
    });
    let caught: HalykApiError | null = null;
    try { await createPaymentToken(baseParams); } catch (e) { if (e instanceof HalykApiError) caught = e; }
    expect(caught).not.toBeNull();
    expect(caught?.code).toBe('HALYK_OAUTH_HTTP_ERROR');
    expect(caught?.httpStatus).toBe(400);
    expect(caught?.halykErrorCode).toBe('invalid_client');
    expect(caught?.halykErrorDescription).toBe('Bad credentials');
    expect(caught?.responseBodySnippet).toContain('invalid_client');
  });

  it('throws HALYK_OAUTH_HTTP_ERROR on HTTP 401', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      headers: { get: () => 'text/plain' },
      text: async () => 'Unauthorized',
    });
    await expect(createPaymentToken(baseParams)).rejects.toMatchObject({ code: 'HALYK_OAUTH_HTTP_ERROR', httpStatus: 401 });
  });

  it('responseBodySnippet does NOT contain access_token value', async () => {
    const halykErrorBody = '{"error":"invalid_client","error_description":"Bad credentials"}';
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      headers: { get: () => 'application/json' },
      text: async () => halykErrorBody,
    });
    let caught: HalykApiError | null = null;
    try { await createPaymentToken(baseParams); } catch (e) { if (e instanceof HalykApiError) caught = e; }
    // No access_token in error body or snippet
    expect(caught?.responseBodySnippet).not.toContain('test-client-secret');
    expect(caught?.responseBodySnippet).not.toContain('access_token":"t');
  });

  it('does not include client_secret in returned token object', async () => {
    mockFetch.mockResolvedValueOnce(mockTokenSuccess());
    const result = await createPaymentToken(baseParams);
    const resultStr = JSON.stringify(result);
    expect(resultStr).not.toContain('test-client-secret');
    expect(resultStr).not.toContain('client_secret');
  });

  it('request body uses invoiceID (not invoiceId) and terminal (not terminalId)', async () => {
    mockFetch.mockResolvedValueOnce(mockTokenSuccess());
    await createPaymentToken(baseParams);
    const sentBody = mockFetch.mock.calls[0][1].body as string;
    const params = new URLSearchParams(sentBody);
    // invoiceID is the Halyk-required field name
    expect(params.has('invoiceID')).toBe(true);
    expect(params.has('invoiceId')).toBe(false);
    // terminal is the Halyk-required field name
    expect(params.has('terminal')).toBe(true);
    expect(params.has('terminalId')).toBe(false);
    // amount must be integer string
    expect(params.get('amount')).toMatch(/^\d+$/);
    expect(params.get('currency')).toBe('KZT');
    expect(params.get('grant_type')).toBe('client_credentials');
    expect(params.has('postLink')).toBe(true);
    expect(params.has('failurePostLink')).toBe(true);
  });

  it('amount is rounded to integer (no decimal point)', async () => {
    mockFetch.mockResolvedValueOnce(mockTokenSuccess());
    await createPaymentToken({ ...baseParams, amount: 3999.99 });
    const sentBody = mockFetch.mock.calls[0][1].body as string;
    const params = new URLSearchParams(sentBody);
    expect(params.get('amount')).toBe('4000');
    expect(params.get('amount')).not.toContain('.');
  });
});

// ─── checkPaymentStatus ───────────────────────────────────────────────────────

describe('checkPaymentStatus', () => {
  it('throws when disabled', async () => {
    _resetConfigCache();
    process.env.HALYK_EPAY_ENABLED = 'false';
    await expect(checkPaymentStatus('123456')).rejects.toThrow(HalykApiError);
  });

  it('returns status response with CHARGE (numeric resultCode)', async () => {
    mockFetch
      .mockResolvedValueOnce(mockTokenSuccess())
      .mockResolvedValueOnce(mockStatusSuccess());

    const result = await checkPaymentStatus('123456789012345');
    expect(result.resultCode).toBe(100);
    expect(result.transaction?.statusName).toBe('CHARGE');
  });

  it('accepts resultCode as string "100" (official Halyk format)', async () => {
    mockFetch
      .mockResolvedValueOnce(mockTokenSuccess())
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        text: async () => JSON.stringify({
          resultCode: '100',  // STRING — official Halyk format
          resultMessage: 'SUCCESS',
          transaction: {
            invoiceID: '123456789012345',
            terminalID: 'test-terminal-uuid',
            terminal: 'test-terminal',
            statusName: 'CHARGE',
            amount: 3999,
            currency: 'KZT',
            cardMask: '400303...9821',
            cardType: 'VISA',
            issuer: 'Test Bank',
          },
        }),
      });

    const result = await checkPaymentStatus('123456789012345');
    // Schema transforms string "100" → number 100
    expect(result.resultCode).toBe(100);
    expect(result.transaction?.statusName).toBe('CHARGE');
  });

  it('normalizes statusName with whitespace: " charge " → "CHARGE"', async () => {
    mockFetch
      .mockResolvedValueOnce(mockTokenSuccess())
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        text: async () => JSON.stringify({
          resultCode: '100',
          transaction: {
            invoiceID: '123456789012345',
            statusName: ' charge ',  // with whitespace and lowercase
            amount: 3999,
            currency: 'KZT',
          },
        }),
      });

    const result = await checkPaymentStatus('123456789012345');
    expect(result.transaction?.statusName).toBe('CHARGE');
  });

  it('accepts transaction with all optional fields missing (minimal response)', async () => {
    // Halyk may return minimal transaction objects in some environments
    mockFetch
      .mockResolvedValueOnce(mockTokenSuccess())
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        text: async () => JSON.stringify({
          resultCode: '100',
          transaction: {
            // invoiceID, amount, currency all absent — now all optional
            statusName: 'NEW',
          },
        }),
      });

    const result = await checkPaymentStatus('123456789012345');
    expect(result.resultCode).toBe(100);
    expect(result.transaction?.statusName).toBe('NEW');
  });

  it('accepts extra unknown fields in transaction without throwing', async () => {
    mockFetch
      .mockResolvedValueOnce(mockTokenSuccess())
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        text: async () => JSON.stringify({
          resultCode: 100,
          transaction: {
            invoiceID: '123',
            statusName: 'CHARGE',
            amount: 3999,
            currency: 'KZT',
            id: 'uuid-here',          // 'id' field from actual Halyk response
            terminal: '98120001',     // short terminal id
            reason: 'Successfully',
            reasonCode: '00',
            reference: 'ref123',
            cardMask: '400303...9821',
            cardType: 'VISA',
            issuer: 'Test Bank',
            extraField: 'ignored',
          },
        }),
      });

    const result = await checkPaymentStatus('123456789012345');
    expect(result.resultCode).toBe(100);
    expect(result.transaction?.statusName).toBe('CHARGE');
  });

  it('accepts transaction: null for non-100 resultCode', async () => {
    mockFetch
      .mockResolvedValueOnce(mockTokenSuccess())
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        text: async () => JSON.stringify({
          resultCode: '107',
          resultMessage: 'Transaction not found',
          transaction: null,
        }),
      });

    const result = await checkPaymentStatus('123456789012345');
    expect(result.resultCode).toBe(107);
    expect(result.transaction).toBeNull();
  });

  it('throws HALYK_STATUS_PARSE_ERROR with validationIssues when schema fails', async () => {
    // Simulate a truly invalid response that fails schema validation
    mockFetch
      .mockResolvedValueOnce(mockTokenSuccess())
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        text: async () => JSON.stringify({
          // missing resultCode entirely
          wrongField: 'value',
        }),
      });

    let caught: HalykApiError | null = null;
    try { await checkPaymentStatus('123456'); } catch (e) { if (e instanceof HalykApiError) caught = e; }
    expect(caught).not.toBeNull();
    expect(caught?.code).toBe('HALYK_STATUS_PARSE_ERROR');
    expect(caught?.httpStatus).toBe(200);
    expect(caught?.responseBodySnippet).toBeDefined();
    expect(caught?.validationIssues).toBeDefined();
    expect(caught?.validationIssues?.length).toBeGreaterThan(0);
  });

  it('throws on invalid status response JSON', async () => {
    mockFetch
      .mockResolvedValueOnce(mockTokenSuccess())
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: () => 'text/html' },
        text: async () => 'bad-json',
      });

    await expect(checkPaymentStatus('123456')).rejects.toThrow(HalykApiError);
  });

  it('accepts expires_in as string in status token flow', async () => {
    mockFetch
      .mockResolvedValueOnce(mockTokenSuccess({ expires_in: '3600' }))
      .mockResolvedValueOnce(mockStatusSuccess());
    const result = await checkPaymentStatus('123456789012345');
    expect(result.resultCode).toBe(100);
  });
});

// ─── Status mapping with string resultCode ────────────────────────────────────

describe('mapHalykStatus (via status-map)', () => {
  // These tests import directly from status-map.ts — verifying the string resultCode path
  // which the actual Halyk API sends (e.g. "100", not 100)
  it('mapHalykStatus accepts string "100" + CHARGE → paid', async () => {
    const { mapHalykStatus } = await import('../status-map');
    expect(mapHalykStatus('100', 'CHARGE')).toBe('paid');
  });

  it('mapHalykStatus accepts string "107" → payment_pending', async () => {
    const { mapHalykStatus } = await import('../status-map');
    expect(mapHalykStatus('107', undefined)).toBe('payment_pending');
  });

  it('mapHalykStatus normalizes lowercase statusName', async () => {
    const { mapHalykStatus } = await import('../status-map');
    // The schema already normalizes via transform, but the map function also normalizes
    // as a safety net in case it's called directly with raw strings
    expect(mapHalykStatus(100, 'charge')).toBe('paid');
    expect(mapHalykStatus(100, ' CHARGE ')).toBe('paid');
  });
});
