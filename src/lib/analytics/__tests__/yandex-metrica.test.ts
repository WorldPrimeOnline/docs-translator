/**
 * @jest-environment jsdom
 * @jest-environment-options {"url": "https://www.wpotranslations.org/"}
 *
 * Minimal test coverage for the Yandex Metrica integration (2026-08-19) — only what's
 * explicitly load-bearing for safety: production/staging gating (must never fire on
 * staging/local), purchase deduplication (must never double-count a paid order), and
 * the pageview URL sanitizer (must never leak tokens/ids into a tracked URL). Not a
 * general-purpose analytics test framework.
 *
 * jsdom 26 makes window.location non-reconfigurable, so the "wrong hostname" gating
 * case (the one dimension that needs a DIFFERENT hostname than this file's) lives in
 * the sibling file yandex-metrica.non-production-host.test.ts instead, whose jsdom
 * environment is pointed at a non-production URL via the same docblock mechanism.
 * This file's URL above is the real production hostname throughout.
 */
import {
  trackUploadCompleted,
  trackQuoteGenerated,
  trackBeginCheckout,
  trackPurchaseOnce,
  trackPageview,
  sanitizePageviewUrl,
  storeCheckoutServiceLevel,
  readCheckoutServiceLevel,
} from '../yandex-metrica';

const ORIGINAL_ENV = process.env;

function setYm(): jest.Mock {
  const ym = jest.fn();
  (window as unknown as { ym?: unknown }).ym = ym;
  return ym;
}

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  delete (window as unknown as { ym?: unknown }).ym;
  localStorage.clear();
  sessionStorage.clear();
});

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

describe('production/staging gating', () => {
  it('does nothing when NEXT_PUBLIC_YANDEX_METRICA_ID is unset (staging/local default)', () => {
    delete process.env.NEXT_PUBLIC_YANDEX_METRICA_ID;
    const ym = setYm();
    trackUploadCompleted();
    expect(ym).not.toHaveBeenCalled();
  });

  it('does nothing when window.ym has not loaded yet, even with a matching counter id + hostname', () => {
    process.env.NEXT_PUBLIC_YANDEX_METRICA_ID = '111762122';
    trackUploadCompleted();
    // no assertion needed beyond "does not throw" — there is no ym to call
  });

  it('fires reachGoal only when counter id is set AND hostname is production AND ym is loaded', () => {
    process.env.NEXT_PUBLIC_YANDEX_METRICA_ID = '111762122';
    const ym = setYm();
    trackUploadCompleted();
    expect(ym).toHaveBeenCalledTimes(1);
    expect(ym).toHaveBeenCalledWith(111762122, 'reachGoal', 'upload_completed', undefined);
  });

  it('an invalid (non-numeric) counter id is treated as unset', () => {
    process.env.NEXT_PUBLIC_YANDEX_METRICA_ID = 'not-a-number';
    const ym = setYm();
    trackUploadCompleted();
    expect(ym).not.toHaveBeenCalled();
  });
});

describe('event params — exact shape, no PII', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_YANDEX_METRICA_ID = '111762122';
  });

  it('upload_completed sends no params', () => {
    const ym = setYm();
    trackUploadCompleted();
    expect(ym).toHaveBeenCalledWith(111762122, 'reachGoal', 'upload_completed', undefined);
  });

  it('quote_generated sends value/currency/service_level only', () => {
    const ym = setYm();
    trackQuoteGenerated({ value: 12000, currency: 'KZT', service_level: 'official' });
    expect(ym).toHaveBeenCalledWith(111762122, 'reachGoal', 'quote_generated', {
      value: 12000,
      currency: 'KZT',
      service_level: 'official',
    });
  });

  it('begin_checkout sends service_level only', () => {
    const ym = setYm();
    trackBeginCheckout({ service_level: 'electronic' });
    expect(ym).toHaveBeenCalledWith(111762122, 'reachGoal', 'begin_checkout', { service_level: 'electronic' });
  });
});

describe('purchase — max once per paymentId', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_YANDEX_METRICA_ID = '111762122';
  });

  it('fires on the first call for a given paymentId', () => {
    const ym = setYm();
    trackPurchaseOnce('pay_1', { value: 5000, currency: 'KZT', service_level: 'electronic' });
    expect(ym).toHaveBeenCalledTimes(1);
    expect(ym).toHaveBeenCalledWith(111762122, 'reachGoal', 'purchase', {
      value: 5000,
      currency: 'KZT',
      service_level: 'electronic',
    });
  });

  it('never fires again for the same paymentId, even across separate calls/reloads', () => {
    const ym = setYm();
    trackPurchaseOnce('pay_1', { value: 5000, currency: 'KZT' });
    trackPurchaseOnce('pay_1', { value: 5000, currency: 'KZT' });
    trackPurchaseOnce('pay_1', { value: 5000, currency: 'KZT' });
    expect(ym).toHaveBeenCalledTimes(1);
  });

  it('fires independently for a different paymentId', () => {
    const ym = setYm();
    trackPurchaseOnce('pay_1', { value: 5000, currency: 'KZT' });
    trackPurchaseOnce('pay_2', { value: 8000, currency: 'KZT' });
    expect(ym).toHaveBeenCalledTimes(2);
  });

  it('dedup persists across a fresh page load (simulated by re-importing with the same localStorage)', () => {
    const ym1 = setYm();
    trackPurchaseOnce('pay_1', { value: 5000, currency: 'KZT' });
    expect(ym1).toHaveBeenCalledTimes(1);

    // Simulate a reload: window.ym is gone until the script re-initializes, then comes back.
    delete (window as unknown as { ym?: unknown }).ym;
    const ym2 = setYm();
    trackPurchaseOnce('pay_1', { value: 5000, currency: 'KZT' });
    expect(ym2).not.toHaveBeenCalled();
  });
});

describe('sanitizePageviewUrl — never leaks tokens/ids', () => {
  it('keeps only the acquisition allowlist (ref, utm_*)', () => {
    const url = sanitizePageviewUrl('/ru/checkout', 'utm_source=google&utm_medium=cpc&ref=partner123');
    expect(url).toBe('/ru/checkout?ref=partner123&utm_source=google&utm_medium=cpc');
  });

  it('strips auth tokens (code, token_hash)', () => {
    const url = sanitizePageviewUrl('/ru/auth/callback', 'code=abc123&token_hash=xyz789');
    expect(url).toBe('/ru/auth/callback');
  });

  it('strips payment/draft identifiers', () => {
    const url = sanitizePageviewUrl('/ru/payment/result', 'payment=11111111-1111-1111-1111-111111111111');
    expect(url).toBe('/ru/payment/result');
  });

  it('strips draftId and next (checkout bridge params)', () => {
    const url = sanitizePageviewUrl('/ru/checkout', 'draftId=abc&next=%2Fru%2Fdashboard');
    expect(url).toBe('/ru/checkout');
  });

  it('returns bare pathname when there are no query params', () => {
    expect(sanitizePageviewUrl('/ru', '')).toBe('/ru');
  });

  it('mixed safe + unsafe params: keeps only the safe ones', () => {
    const url = sanitizePageviewUrl('/ru/start', 'utm_campaign=summer&payment=secret-id&code=token');
    expect(url).toBe('/ru/start?utm_campaign=summer');
  });
});

describe('trackPageview — same gating as reachGoal, uses the hit command', () => {
  it('does nothing outside production', () => {
    delete process.env.NEXT_PUBLIC_YANDEX_METRICA_ID;
    const ym = setYm();
    trackPageview('/ru/dashboard');
    expect(ym).not.toHaveBeenCalled();
  });

  it('calls ym with the hit command and counter id in production', () => {
    process.env.NEXT_PUBLIC_YANDEX_METRICA_ID = '111762122';
    const ym = setYm();
    trackPageview('/ru/dashboard');
    expect(ym).toHaveBeenCalledWith(111762122, 'hit', '/ru/dashboard');
  });
});

describe('service_level propagation (begin_checkout -> purchase)', () => {
  it('round-trips through sessionStorage', () => {
    storeCheckoutServiceLevel('pay_1', 'notarization_through_partners');
    expect(readCheckoutServiceLevel('pay_1')).toBe('notarization_through_partners');
  });

  it('returns null for a paymentId that was never stored', () => {
    expect(readCheckoutServiceLevel('never-seen')).toBeNull();
  });

  it('different paymentIds do not collide', () => {
    storeCheckoutServiceLevel('pay_1', 'electronic');
    storeCheckoutServiceLevel('pay_2', 'official_with_translator_signature_and_provider_stamp');
    expect(readCheckoutServiceLevel('pay_1')).toBe('electronic');
    expect(readCheckoutServiceLevel('pay_2')).toBe('official_with_translator_signature_and_provider_stamp');
  });
});
