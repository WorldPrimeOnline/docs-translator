import { initPayment, checkStatus, refund, FreedomPayApiError } from '../client';
import { _resetFreedomPayConfigCache } from '../config';
import { buildFreedomPayResponseXml } from '../xml';

function mockFetchOnce(status: number, body: string): jest.Mock {
  const fn = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
  });
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

beforeEach(() => {
  process.env.FREEDOMPAY_ENABLED = 'true';
  process.env.FREEDOMPAY_MERCHANT_ID = '588913';
  process.env.FREEDOMPAY_SECRET_KEY = 'test-secret';
  process.env.APP_BASE_URL = 'https://staging.example.com';
  _resetFreedomPayConfigCache();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('initPayment', () => {
  it('calls POST https://api.freedompay.kz/init_payment with JSON content-type', async () => {
    const xml = buildFreedomPayResponseXml({ pg_status: 'ok', pg_redirect_url: 'https://pay.freedompay.kz/x' });
    const fetchMock = mockFetchOnce(200, xml);

    const result = await initPayment({
      orderId: 'order-1',
      amountKzt: 1500,
      description: 'WPO order test',
      resultUrl: 'https://staging.example.com/api/payments/freedompay/result',
      successUrl: 'https://staging.example.com/payment/result?payment=order-1',
      failureUrl: 'https://staging.example.com/payment/result?payment=order-1',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.freedompay.kz/init_payment');
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json');

    const sentBody = JSON.parse(init.body);
    expect(sentBody.pg_order_id).toBe('order-1');
    expect(sentBody.pg_merchant_id).toBe('588913');
    expect(sentBody.pg_amount).toBe('1500');
    expect(sentBody.pg_auto_clearing).toBe('1');
    expect(sentBody.pg_sig).toMatch(/^[0-9a-f]{32}$/);

    expect(result.redirectUrl).toBe('https://pay.freedompay.kz/x');
  });

  it('always sets pg_auto_clearing=1 (explicit one-step behavior)', async () => {
    const xml = buildFreedomPayResponseXml({ pg_status: 'ok', pg_redirect_url: 'https://pay.freedompay.kz/x' });
    const fetchMock = mockFetchOnce(200, xml);
    await initPayment({
      orderId: 'order-1', amountKzt: 1000, description: 'd',
      resultUrl: 'r', successUrl: 's', failureUrl: 'f',
    });
    const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sentBody.pg_auto_clearing).toBe('1');
  });

  it('throws FreedomPayApiError on non-2xx HTTP response', async () => {
    mockFetchOnce(500, 'Internal Server Error');
    await expect(initPayment({
      orderId: 'order-1', amountKzt: 1000, description: 'd',
      resultUrl: 'r', successUrl: 's', failureUrl: 'f',
    })).rejects.toThrow(FreedomPayApiError);
  });

  it('throws FreedomPayApiError when pg_status is not ok', async () => {
    const xml = buildFreedomPayResponseXml({ pg_status: 'error', pg_error_description: 'Bad signature' });
    mockFetchOnce(200, xml);
    await expect(initPayment({
      orderId: 'order-1', amountKzt: 1000, description: 'd',
      resultUrl: 'r', successUrl: 's', failureUrl: 'f',
    })).rejects.toThrow(FreedomPayApiError);
  });

  it('throws FreedomPayApiError on unparseable XML', async () => {
    mockFetchOnce(200, 'not xml at all {}');
    await expect(initPayment({
      orderId: 'order-1', amountKzt: 1000, description: 'd',
      resultUrl: 'r', successUrl: 's', failureUrl: 'f',
    })).rejects.toThrow(FreedomPayApiError);
  });

  it('throws FREEDOMPAY_DISABLED when not configured', async () => {
    process.env.FREEDOMPAY_ENABLED = 'false';
    _resetFreedomPayConfigCache();
    await expect(initPayment({
      orderId: 'order-1', amountKzt: 1000, description: 'd',
      resultUrl: 'r', successUrl: 's', failureUrl: 'f',
    })).rejects.toMatchObject({ code: 'FREEDOMPAY_DISABLED' });
  });
});

describe('checkStatus', () => {
  it('calls POST https://api.freedompay.kz/get_status3.php with form encoding', async () => {
    const xml = buildFreedomPayResponseXml({ pg_result: '1', pg_payment_id: 'fp-123', pg_amount: '1500', pg_currency: 'KZT' });
    const fetchMock = mockFetchOnce(200, xml);

    const result = await checkStatus('order-1');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.freedompay.kz/get_status3.php');
    expect(init.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(String(init.body)).toContain('pg_order_id=order-1');

    expect(result.pgResult).toBe('1');
    expect(result.pgPaymentId).toBe('fp-123');
  });

  it('throws FreedomPayApiError on HTTP error', async () => {
    mockFetchOnce(500, 'error');
    await expect(checkStatus('order-1')).rejects.toThrow(FreedomPayApiError);
  });
});

describe('refund', () => {
  it('calls POST https://api.freedompay.kz/revoke with multipart/form-data', async () => {
    const xml = buildFreedomPayResponseXml({ pg_status: 'ok', pg_refund_id: 'ref-1' });
    const fetchMock = mockFetchOnce(200, xml);

    const result = await refund({ pgPaymentId: 'fp-123', amountKzt: 500 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.freedompay.kz/revoke');

    // multipart/form-data — fetch/undici sets the Content-Type (with boundary)
    // automatically from a FormData body; the client must NOT set it manually.
    expect(init.headers).toBeUndefined();
    expect(init.body).toBeInstanceOf(FormData);

    const body = init.body as FormData;
    expect(body.get('pg_payment_id')).toBe('fp-123');
    expect(body.get('pg_refund_amount')).toBe('500');
    expect(body.get('pg_merchant_id')).toBe('588913');
    expect(typeof body.get('pg_sig')).toBe('string');

    expect(result.ok).toBe(true);
    expect(result.raw.pg_refund_id).toBe('ref-1');
  });

  it('omits pg_refund_amount for a full refund', async () => {
    const xml = buildFreedomPayResponseXml({ pg_status: 'ok' });
    const fetchMock = mockFetchOnce(200, xml);
    await refund({ pgPaymentId: 'fp-123' });
    const body = fetchMock.mock.calls[0][1].body as FormData;
    expect(body.has('pg_refund_amount')).toBe(false);
  });

  it('includes pg_idempotency_key when provided, and it participates in the signature', async () => {
    const xml1 = buildFreedomPayResponseXml({ pg_status: 'ok' });
    const fetchMock1 = mockFetchOnce(200, xml1);
    await refund({ pgPaymentId: 'fp-123', idempotencyKey: 'idem-abc' });
    const body1 = fetchMock1.mock.calls[0][1].body as FormData;
    expect(body1.get('pg_idempotency_key')).toBe('idem-abc');
    const sig1 = body1.get('pg_sig');

    // Same call without an idempotency key must produce a different signature —
    // proves pg_idempotency_key is included in the signed field set, not just attached.
    const xml2 = buildFreedomPayResponseXml({ pg_status: 'ok' });
    const fetchMock2 = mockFetchOnce(200, xml2);
    await refund({ pgPaymentId: 'fp-123' });
    const body2 = fetchMock2.mock.calls[0][1].body as FormData;
    expect(body2.has('pg_idempotency_key')).toBe(false);
    expect(body2.get('pg_sig')).not.toBe(sig1);
  });

  it('omits pg_idempotency_key when not provided', async () => {
    const xml = buildFreedomPayResponseXml({ pg_status: 'ok' });
    const fetchMock = mockFetchOnce(200, xml);
    await refund({ pgPaymentId: 'fp-123' });
    const body = fetchMock.mock.calls[0][1].body as FormData;
    expect(body.has('pg_idempotency_key')).toBe(false);
  });

  it('returns ok:false when pg_status is not ok', async () => {
    const xml = buildFreedomPayResponseXml({ pg_status: 'error' });
    mockFetchOnce(200, xml);
    const result = await refund({ pgPaymentId: 'fp-123' });
    expect(result.ok).toBe(false);
  });
});
