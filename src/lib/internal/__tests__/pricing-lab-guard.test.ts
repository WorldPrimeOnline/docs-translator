describe('pricing-lab-guard', () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    jest.resetModules();
  });

  it('is never allowed when NEXT_PUBLIC_APP_ENV is production, regardless of other flags (test #14)', async () => {
    process.env.NEXT_PUBLIC_APP_ENV = 'production';
    process.env.ENABLE_PRICING_LAB = 'true';
    process.env.PRICING_LAB_ALLOWED_EMAILS = 'ops@wpo.test';
    const { checkPricingLabEnvironment, checkPricingLabAccess } = await import('../pricing-lab-guard');
    expect(checkPricingLabEnvironment().allowed).toBe(false);
    expect(checkPricingLabAccess('ops@wpo.test').allowed).toBe(false);
  });

  it('is not allowed on staging when ENABLE_PRICING_LAB is not "true"', async () => {
    process.env.NEXT_PUBLIC_APP_ENV = 'staging';
    delete process.env.ENABLE_PRICING_LAB;
    const { checkPricingLabEnvironment } = await import('../pricing-lab-guard');
    expect(checkPricingLabEnvironment().allowed).toBe(false);
  });

  it('is not allowed when no allowlist is configured, even for a real user', async () => {
    process.env.NEXT_PUBLIC_APP_ENV = 'staging';
    process.env.ENABLE_PRICING_LAB = 'true';
    delete process.env.PRICING_LAB_ALLOWED_EMAILS;
    const { checkPricingLabAccess } = await import('../pricing-lab-guard');
    expect(checkPricingLabAccess('anyone@wpo.test').allowed).toBe(false);
  });

  it('rejects a user not on the allowlist', async () => {
    process.env.NEXT_PUBLIC_APP_ENV = 'staging';
    process.env.ENABLE_PRICING_LAB = 'true';
    process.env.PRICING_LAB_ALLOWED_EMAILS = 'ops@wpo.test,finance@wpo.test';
    const { checkPricingLabAccess } = await import('../pricing-lab-guard');
    expect(checkPricingLabAccess('stranger@wpo.test').allowed).toBe(false);
  });

  it('allows an allowlisted user on staging with the flag enabled', async () => {
    process.env.NEXT_PUBLIC_APP_ENV = 'staging';
    process.env.ENABLE_PRICING_LAB = 'true';
    process.env.PRICING_LAB_ALLOWED_EMAILS = 'ops@wpo.test, Finance@WPO.test';
    const { checkPricingLabAccess } = await import('../pricing-lab-guard');
    expect(checkPricingLabAccess('ops@wpo.test').allowed).toBe(true);
    expect(checkPricingLabAccess('finance@wpo.test').allowed).toBe(true); // case-insensitive
  });

  it('rejects a null/missing email', async () => {
    process.env.NEXT_PUBLIC_APP_ENV = 'staging';
    process.env.ENABLE_PRICING_LAB = 'true';
    process.env.PRICING_LAB_ALLOWED_EMAILS = 'ops@wpo.test';
    const { checkPricingLabAccess } = await import('../pricing-lab-guard');
    expect(checkPricingLabAccess(null).allowed).toBe(false);
    expect(checkPricingLabAccess(undefined).allowed).toBe(false);
  });
});
