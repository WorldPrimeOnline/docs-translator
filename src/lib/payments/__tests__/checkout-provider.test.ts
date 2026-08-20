import { getCheckoutPaymentProvider } from '../checkout-provider';

describe('getCheckoutPaymentProvider', () => {
  const original = process.env.NEXT_PUBLIC_APP_ENV;

  afterEach(() => {
    if (original === undefined) delete process.env.NEXT_PUBLIC_APP_ENV;
    else process.env.NEXT_PUBLIC_APP_ENV = original;
  });

  it('returns freedompay when NEXT_PUBLIC_APP_ENV=staging', () => {
    process.env.NEXT_PUBLIC_APP_ENV = 'staging';
    expect(getCheckoutPaymentProvider()).toBe('freedompay');
  });

  it('returns halyk when NEXT_PUBLIC_APP_ENV=production', () => {
    process.env.NEXT_PUBLIC_APP_ENV = 'production';
    expect(getCheckoutPaymentProvider()).toBe('halyk');
  });

  it('returns halyk when NEXT_PUBLIC_APP_ENV is unset (safe default)', () => {
    delete process.env.NEXT_PUBLIC_APP_ENV;
    expect(getCheckoutPaymentProvider()).toBe('halyk');
  });

  it('returns halyk for any other value (development, typo, etc.)', () => {
    process.env.NEXT_PUBLIC_APP_ENV = 'development';
    expect(getCheckoutPaymentProvider()).toBe('halyk');
  });
});
