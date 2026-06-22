import { generateSecretHash, digestSecretHash, verifySecretHash } from '../security';

describe('generateSecretHash', () => {
  it('returns a non-empty string', () => {
    const hash = generateSecretHash();
    expect(typeof hash).toBe('string');
    expect(hash.length).toBeGreaterThan(0);
  });

  it('uses base64url characters only', () => {
    const hash = generateSecretHash();
    expect(hash).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('generates distinct values', () => {
    const hashes = new Set(Array.from({ length: 50 }, generateSecretHash));
    expect(hashes.size).toBeGreaterThan(45);
  });

  it('does not use Math.random', () => {
    const spy = jest.spyOn(Math, 'random');
    generateSecretHash();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('digestSecretHash', () => {
  it('returns a 64-character hex string (SHA-256)', () => {
    const digest = digestSecretHash('test-secret');
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic', () => {
    expect(digestSecretHash('abc')).toBe(digestSecretHash('abc'));
  });

  it('produces different digests for different inputs', () => {
    expect(digestSecretHash('secret1')).not.toBe(digestSecretHash('secret2'));
  });
});

describe('verifySecretHash', () => {
  it('returns true for a matching secret', () => {
    const secret = generateSecretHash();
    const digest = digestSecretHash(secret);
    expect(verifySecretHash(secret, digest)).toBe(true);
  });

  it('returns false for a non-matching secret', () => {
    const secret = generateSecretHash();
    const digest = digestSecretHash(secret);
    expect(verifySecretHash('wrong-secret', digest)).toBe(false);
  });

  it('returns false for an empty secret', () => {
    const digest = digestSecretHash('real-secret');
    expect(verifySecretHash('', digest)).toBe(false);
  });

  it('returns false for a tampered digest', () => {
    const secret = generateSecretHash();
    const digest = digestSecretHash(secret);
    const tampered = digest.slice(0, -2) + '00';
    expect(verifySecretHash(secret, tampered)).toBe(false);
  });

  it('does not throw for invalid hex digest', () => {
    expect(() => verifySecretHash('some-secret', 'not-hex!')).not.toThrow();
    expect(verifySecretHash('some-secret', 'not-hex!')).toBe(false);
  });
});
