import { buildResultAck, resultAckToXml, FREEDOMPAY_RESULT_SCRIPT_NAME } from '../result-ack';
import { verifySignature } from '../signature';
import { _resetFreedomPayConfigCache } from '../config';
import { parseFreedomPayXml } from '../xml';

beforeEach(() => {
  process.env.FREEDOMPAY_ENABLED = 'true';
  process.env.FREEDOMPAY_MERCHANT_ID = '588913';
  process.env.FREEDOMPAY_SECRET_KEY = 'test-secret';
  process.env.APP_BASE_URL = 'https://staging.example.com';
  _resetFreedomPayConfigCache();
});

describe('FREEDOMPAY_RESULT_SCRIPT_NAME', () => {
  it('derives to "result" from the configured Result URL path', () => {
    expect(FREEDOMPAY_RESULT_SCRIPT_NAME).toBe('result');
  });
});

describe('buildResultAck', () => {
  it('produces a self-verifying signature', () => {
    const ack = buildResultAck('ok', 'Order paid');
    const fields = { pg_status: ack.pg_status, pg_description: ack.pg_description, pg_salt: ack.pg_salt };
    expect(verifySignature(FREEDOMPAY_RESULT_SCRIPT_NAME, fields, 'test-secret', ack.pg_sig)).toBe(true);
  });

  it('generates a fresh salt on each call', () => {
    const ack1 = buildResultAck('ok', 'Order paid');
    const ack2 = buildResultAck('ok', 'Order paid');
    expect(ack1.pg_salt).not.toBe(ack2.pg_salt);
    expect(ack1.pg_sig).not.toBe(ack2.pg_sig);
  });

  it('carries the given status and description through unchanged', () => {
    const ack = buildResultAck('error', 'Invalid signature');
    expect(ack.pg_status).toBe('error');
    expect(ack.pg_description).toBe('Invalid signature');
  });
});

describe('resultAckToXml', () => {
  it('round-trips into a parseable <response> containing all four fields', () => {
    const ack = buildResultAck('ok', 'Order paid');
    const xml = resultAckToXml(ack);
    const parsed = parseFreedomPayXml(xml);
    expect(parsed).toEqual(ack);
  });
});
