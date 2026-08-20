import { buildSignature, verifySignature, deriveScriptNameFromUrl, FREEDOMPAY_SCRIPT_NAMES } from '../signature';
import { createHash } from 'crypto';

describe('buildSignature', () => {
  it('is deterministic for the same inputs', () => {
    const fields = { pg_order_id: 'abc', pg_amount: '1000', pg_salt: 'saltvalue' };
    const sig1 = buildSignature('init_payment', fields, 'secret');
    const sig2 = buildSignature('init_payment', fields, 'secret');
    expect(sig1).toBe(sig2);
  });

  it('produces a lowercase 32-character hex string (MD5)', () => {
    const sig = buildSignature('init_payment', { a: '1' }, 'secret');
    expect(sig).toMatch(/^[0-9a-f]{32}$/);
  });

  it('sorts fields alphabetically by key before joining values', () => {
    const fieldsA = { pg_order_id: 'abc', pg_amount: '1000', pg_salt: 'x' };
    const fieldsB = { pg_salt: 'x', pg_amount: '1000', pg_order_id: 'abc' }; // same data, different insertion order
    expect(buildSignature('init_payment', fieldsA, 'secret')).toBe(buildSignature('init_payment', fieldsB, 'secret'));
  });

  it('matches a manually computed signature string', () => {
    // signature_string = script_name + ";" + <sorted values> + ";" + secret_key
    const fields = { pg_b: '2', pg_a: '1' }; // sorted keys: pg_a, pg_b -> values "1","2"
    const expected = createHash('md5').update('script;1;2;mysecret', 'utf8').digest('hex');
    expect(buildSignature('script', fields, 'mysecret')).toBe(expected);
  });

  it('changes when the script_name changes', () => {
    const fields = { a: '1' };
    expect(buildSignature('init_payment', fields, 'secret')).not.toBe(buildSignature('get_status3.php', fields, 'secret'));
  });

  it('changes when the secret key changes', () => {
    const fields = { a: '1' };
    expect(buildSignature('init_payment', fields, 'secret1')).not.toBe(buildSignature('init_payment', fields, 'secret2'));
  });

  it('changes when a field value changes', () => {
    expect(buildSignature('init_payment', { a: '1' }, 'secret')).not.toBe(buildSignature('init_payment', { a: '2' }, 'secret'));
  });
});

describe('verifySignature', () => {
  it('returns true for a correctly signed payload', () => {
    const fields = { pg_order_id: 'abc', pg_salt: 'saltvalue' };
    const sig = buildSignature(FREEDOMPAY_SCRIPT_NAMES.status, fields, 'secret');
    expect(verifySignature(FREEDOMPAY_SCRIPT_NAMES.status, fields, 'secret', sig)).toBe(true);
  });

  it('returns false for an invalid signature', () => {
    const fields = { pg_order_id: 'abc', pg_salt: 'saltvalue' };
    expect(verifySignature(FREEDOMPAY_SCRIPT_NAMES.status, fields, 'secret', 'deadbeef00000000000000000000000')).toBe(false);
  });

  it('returns false when the wrong script_name is used to verify', () => {
    const fields = { pg_order_id: 'abc', pg_salt: 'saltvalue' };
    const sig = buildSignature('result', fields, 'secret');
    expect(verifySignature('init_payment', fields, 'secret', sig)).toBe(false);
  });

  it('returns false when a field is tampered after signing', () => {
    const fields = { pg_order_id: 'abc', pg_amount: '1000' };
    const sig = buildSignature('init_payment', fields, 'secret');
    const tampered = { ...fields, pg_amount: '9999' };
    expect(verifySignature('init_payment', tampered, 'secret', sig)).toBe(false);
  });

  it('does not throw and returns false for a malformed (non-hex) signature', () => {
    const fields = { a: '1' };
    expect(() => verifySignature('init_payment', fields, 'secret', 'not-hex!!')).not.toThrow();
    expect(verifySignature('init_payment', fields, 'secret', 'not-hex!!')).toBe(false);
  });

  it('is case-insensitive on the provided signature', () => {
    const fields = { a: '1' };
    const sig = buildSignature('init_payment', fields, 'secret');
    expect(verifySignature('init_payment', fields, 'secret', sig.toUpperCase())).toBe(true);
  });
});

describe('deriveScriptNameFromUrl', () => {
  it('derives the basename from a full URL', () => {
    expect(deriveScriptNameFromUrl('https://staging.example.com/api/payments/freedompay/result')).toBe('result');
  });

  it('derives the basename from a bare path', () => {
    expect(deriveScriptNameFromUrl('/api/payments/freedompay/result')).toBe('result');
  });

  it('ignores query strings on a full URL', () => {
    expect(deriveScriptNameFromUrl('https://staging.example.com/api/payments/freedompay/result?foo=bar')).toBe('result');
  });

  it('handles a trailing slash by returning the last non-empty segment', () => {
    expect(deriveScriptNameFromUrl('/api/payments/freedompay/result/')).toBe('result');
  });
});
