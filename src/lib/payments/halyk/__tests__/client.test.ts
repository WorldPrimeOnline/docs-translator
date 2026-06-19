import { createPaymentToken, checkPaymentStatus, HalykApiError } from '../client';
import { _resetConfigCache } from '../config';

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

function mockTokenSuccess() {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({
      access_token: 'test-access-token',
      token_type: 'Bearer',
      expires_in: 3600,
    }),
  };
}

function mockStatusSuccess(statusName = 'CHARGE', resultCode = 100) {
  return {
    ok: true,
    status: 200,
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

describe('createPaymentToken', () => {
  it('throws HalykApiError when disabled', async () => {
    _resetConfigCache();
    process.env.HALYK_EPAY_ENABLED = 'false';
    await expect(
      createPaymentToken({ invoiceId: '123456', secretHash: 'h', amount: 1999, postLink: 'x', failurePostLink: 'y' }),
    ).rejects.toThrow(HalykApiError);
  });

  it('returns token on success', async () => {
    mockFetch.mockResolvedValueOnce(mockTokenSuccess());
    const result = await createPaymentToken({
      invoiceId: '123456789012345',
      secretHash: 'test-secret',
      amount: 1999,
      postLink: 'https://example.com/callback',
      failurePostLink: 'https://example.com/callback',
    });
    expect(result.access_token).toBe('test-access-token');
    expect(result.token_type).toBe('Bearer');
  });

  it('throws on HTTP error status', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 401, text: async () => 'Unauthorized' });
    await expect(
      createPaymentToken({ invoiceId: '123456', secretHash: 'h', amount: 1999, postLink: 'x', failurePostLink: 'y' }),
    ).rejects.toThrow(HalykApiError);
  });

  it('throws on invalid JSON response', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, text: async () => 'not-json' });
    await expect(
      createPaymentToken({ invoiceId: '123456', secretHash: 'h', amount: 1999, postLink: 'x', failurePostLink: 'y' }),
    ).rejects.toThrow(HalykApiError);
  });

  it('does not include client_secret in any observable output', async () => {
    mockFetch.mockResolvedValueOnce(mockTokenSuccess());
    const result = await createPaymentToken({
      invoiceId: '123456789012345',
      secretHash: 'test-secret',
      amount: 1999,
      postLink: 'x',
      failurePostLink: 'y',
    });
    const resultStr = JSON.stringify(result);
    expect(resultStr).not.toContain('test-client-secret');
    expect(resultStr).not.toContain('client_secret');
  });
});

describe('checkPaymentStatus', () => {
  it('throws when disabled', async () => {
    _resetConfigCache();
    process.env.HALYK_EPAY_ENABLED = 'false';
    await expect(checkPaymentStatus('123456')).rejects.toThrow(HalykApiError);
  });

  it('returns status response with CHARGE', async () => {
    mockFetch
      .mockResolvedValueOnce(mockTokenSuccess())    // token request
      .mockResolvedValueOnce(mockStatusSuccess());   // status request

    const result = await checkPaymentStatus('123456789012345');
    expect(result.resultCode).toBe(100);
    expect(result.transaction?.statusName).toBe('CHARGE');
  });

  it('throws on invalid status response', async () => {
    mockFetch
      .mockResolvedValueOnce(mockTokenSuccess())
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => 'bad-json' });

    await expect(checkPaymentStatus('123456')).rejects.toThrow(HalykApiError);
  });
});
