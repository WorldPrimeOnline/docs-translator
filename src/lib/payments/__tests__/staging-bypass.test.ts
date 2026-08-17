/**
 * @jest-environment node
 *
 * Tests for the staging-only payment bypass guard/password check.
 * Follows the same env-var-matrix convention as finalize-payment.test.ts.
 */

import { isStagingBypassEnabled, verifyStagingBypassPassword } from '../staging-bypass';

describe('isStagingBypassEnabled', () => {
  const originalAppEnv = process.env.NEXT_PUBLIC_APP_ENV;
  const originalApiAppEnv = process.env.APP_ENV;
  const originalFlag = process.env.STAGING_PAYMENT_BYPASS_ENABLED;

  afterEach(() => {
    if (originalAppEnv === undefined) delete process.env.NEXT_PUBLIC_APP_ENV;
    else process.env.NEXT_PUBLIC_APP_ENV = originalAppEnv;

    if (originalApiAppEnv === undefined) delete process.env.APP_ENV;
    else process.env.APP_ENV = originalApiAppEnv;

    if (originalFlag === undefined) delete process.env.STAGING_PAYMENT_BYPASS_ENABLED;
    else process.env.STAGING_PAYMENT_BYPASS_ENABLED = originalFlag;
  });

  it('refuses on production regardless of STAGING_PAYMENT_BYPASS_ENABLED', () => {
    process.env.NEXT_PUBLIC_APP_ENV = 'production';
    process.env.STAGING_PAYMENT_BYPASS_ENABLED = 'true';
    expect(isStagingBypassEnabled()).toBe(false);
  });

  it('refuses when neither APP_ENV nor NEXT_PUBLIC_APP_ENV is set (fails closed to "production")', () => {
    delete process.env.NEXT_PUBLIC_APP_ENV;
    delete process.env.APP_ENV;
    process.env.STAGING_PAYMENT_BYPASS_ENABLED = 'true';
    expect(isStagingBypassEnabled()).toBe(false);
  });

  it('refuses on staging when STAGING_PAYMENT_BYPASS_ENABLED is unset', () => {
    process.env.NEXT_PUBLIC_APP_ENV = 'staging';
    delete process.env.STAGING_PAYMENT_BYPASS_ENABLED;
    expect(isStagingBypassEnabled()).toBe(false);
  });

  it('refuses on staging when STAGING_PAYMENT_BYPASS_ENABLED is not exactly "true"', () => {
    process.env.NEXT_PUBLIC_APP_ENV = 'staging';
    process.env.STAGING_PAYMENT_BYPASS_ENABLED = '1';
    expect(isStagingBypassEnabled()).toBe(false);
  });

  it('allows on staging when STAGING_PAYMENT_BYPASS_ENABLED=true', () => {
    process.env.NEXT_PUBLIC_APP_ENV = 'staging';
    process.env.STAGING_PAYMENT_BYPASS_ENABLED = 'true';
    expect(isStagingBypassEnabled()).toBe(true);
  });

  it('allows on development when STAGING_PAYMENT_BYPASS_ENABLED=true', () => {
    delete process.env.NEXT_PUBLIC_APP_ENV;
    process.env.APP_ENV = 'development';
    process.env.STAGING_PAYMENT_BYPASS_ENABLED = 'true';
    expect(isStagingBypassEnabled()).toBe(true);
  });
});

describe('verifyStagingBypassPassword', () => {
  const originalPassword = process.env.STAGING_PAYMENT_BYPASS_PASSWORD;

  afterEach(() => {
    if (originalPassword === undefined) delete process.env.STAGING_PAYMENT_BYPASS_PASSWORD;
    else process.env.STAGING_PAYMENT_BYPASS_PASSWORD = originalPassword;
  });

  it('returns false when STAGING_PAYMENT_BYPASS_PASSWORD is not configured', () => {
    delete process.env.STAGING_PAYMENT_BYPASS_PASSWORD;
    expect(verifyStagingBypassPassword('anything')).toBe(false);
  });

  it('returns false for an empty candidate', () => {
    process.env.STAGING_PAYMENT_BYPASS_PASSWORD = 'correct-horse-battery-staple';
    expect(verifyStagingBypassPassword('')).toBe(false);
  });

  it('returns false for a wrong password of the same length', () => {
    process.env.STAGING_PAYMENT_BYPASS_PASSWORD = 'correct-horse-battery-staple';
    expect(verifyStagingBypassPassword('wrong-horse-battery-staplf')).toBe(false);
  });

  it('returns false for a wrong password of a different length', () => {
    process.env.STAGING_PAYMENT_BYPASS_PASSWORD = 'correct-horse-battery-staple';
    expect(verifyStagingBypassPassword('short')).toBe(false);
  });

  it('returns true for the exact configured password', () => {
    process.env.STAGING_PAYMENT_BYPASS_PASSWORD = 'correct-horse-battery-staple';
    expect(verifyStagingBypassPassword('correct-horse-battery-staple')).toBe(true);
  });

  it('is case-sensitive', () => {
    process.env.STAGING_PAYMENT_BYPASS_PASSWORD = 'Correct-Horse';
    expect(verifyStagingBypassPassword('correct-horse')).toBe(false);
  });
});
