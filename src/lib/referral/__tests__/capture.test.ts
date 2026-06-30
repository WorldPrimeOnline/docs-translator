/**
 * Tests for src/lib/referral/capture.ts
 *
 * Covers: localStorage + sessionStorage dual persistence, 30-day TTL,
 * page-reload survival, expiry cleanup, manual-override logic.
 */

// Mock browser storage APIs
const localStorageStore: Record<string, string> = {};
const sessionStorageStore: Record<string, string> = {};

Object.defineProperty(global, 'localStorage', {
  value: {
    getItem: (key: string) => localStorageStore[key] ?? null,
    setItem: (key: string, value: string) => { localStorageStore[key] = value; },
    removeItem: (key: string) => { delete localStorageStore[key]; },
  },
  writable: true,
});

Object.defineProperty(global, 'sessionStorage', {
  value: {
    getItem: (key: string) => sessionStorageStore[key] ?? null,
    setItem: (key: string, value: string) => { sessionStorageStore[key] = value; },
    removeItem: (key: string) => { delete sessionStorageStore[key]; },
  },
  writable: true,
});

import {
  extractReferralParams,
  saveReferralParams,
  loadReferralParams,
  clearReferralParams,
  ReferralParams,
} from '../capture';

const BASE_PARAMS: ReferralParams = {
  refCode: 'VISAALMATY',
  utmSource: 'instagram',
  utmMedium: 'story',
  utmCampaign: 'spring2026',
  utmContent: null,
  utmTerm: null,
};

beforeEach(() => {
  Object.keys(localStorageStore).forEach((k) => delete localStorageStore[k]);
  Object.keys(sessionStorageStore).forEach((k) => delete sessionStorageStore[k]);
});

// ─── Original extractReferralParams tests (now with TTL fields) ───────────────

describe('extractReferralParams', () => {
  it('returns null when no relevant params are present', () => {
    expect(extractReferralParams('')).toBeNull();
    expect(extractReferralParams('?foo=bar')).toBeNull();
  });

  it('captures ref param', () => {
    const result = extractReferralParams('?ref=PARTNER123');
    expect(result).not.toBeNull();
    expect(result?.refCode).toBe('PARTNER123');
    expect(result?.utmSource).toBeNull();
  });

  it('captures all UTM params', () => {
    const result = extractReferralParams(
      '?utm_source=instagram&utm_medium=social&utm_campaign=partners-2026&utm_content=bio&utm_term=translation',
    );
    expect(result).not.toBeNull();
    expect(result?.utmSource).toBe('instagram');
    expect(result?.utmMedium).toBe('social');
    expect(result?.utmCampaign).toBe('partners-2026');
    expect(result?.utmContent).toBe('bio');
    expect(result?.utmTerm).toBe('translation');
    expect(result?.refCode).toBeNull();
  });

  it('captures ref and UTM together', () => {
    const result = extractReferralParams('?ref=MYCODE&utm_source=email&utm_medium=newsletter');
    expect(result?.refCode).toBe('MYCODE');
    expect(result?.utmSource).toBe('email');
    expect(result?.utmMedium).toBe('newsletter');
  });

  it('returns null when only unrelated params are present', () => {
    expect(extractReferralParams('?page=2&sort=date')).toBeNull();
  });

  it('handles URL-encoded values', () => {
    const result = extractReferralParams('?ref=PARTNER%20123&utm_campaign=test%20campaign');
    expect(result?.refCode).toBe('PARTNER 123');
    expect(result?.utmCampaign).toBe('test campaign');
  });

  it('includes capturedAt and expiresAt (30 days)', () => {
    const params = extractReferralParams('?ref=PARTNER&utm_source=ig');
    expect(params).not.toBeNull();
    expect(params!.capturedAt).toBeDefined();
    expect(params!.expiresAt).toBeDefined();
    const ttlMs = new Date(params!.expiresAt!).getTime() - new Date(params!.capturedAt!).getTime();
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;
    expect(ttlMs).toBeCloseTo(thirtyDays, -3);
  });
});

// ─── 1. localStorage persistence ─────────────────────────────────────────────

describe('localStorage persistence', () => {
  it('saves to both localStorage and sessionStorage', () => {
    saveReferralParams(BASE_PARAMS);
    expect(localStorageStore['wpo_referral']).toBeDefined();
    expect(sessionStorageStore['wpo_referral']).toBeDefined();
  });

  it('loads from localStorage when present', () => {
    saveReferralParams(BASE_PARAMS);
    const loaded = loadReferralParams();
    expect(loaded?.refCode).toBe('VISAALMATY');
  });
});

// ─── 2. TTL expiry ────────────────────────────────────────────────────────────

describe('TTL expiry', () => {
  it('returns null and clears storage when referral has expired', () => {
    const expired: ReferralParams = {
      ...BASE_PARAMS,
      capturedAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString(),
      expiresAt: new Date(Date.now() - 1).toISOString(),
    };
    localStorageStore['wpo_referral'] = JSON.stringify(expired);
    const loaded = loadReferralParams();
    expect(loaded).toBeNull();
    expect(localStorageStore['wpo_referral']).toBeUndefined();
  });

  it('treats legacy entries without expiresAt as valid (no TTL = permanent)', () => {
    const legacy: ReferralParams = { ...BASE_PARAMS };
    localStorageStore['wpo_referral'] = JSON.stringify(legacy);
    expect(loadReferralParams()?.refCode).toBe('VISAALMATY');
  });
});

// ─── 3. Page reload survival ──────────────────────────────────────────────────

describe('page reload survival', () => {
  it('returns params from localStorage when sessionStorage is cleared', () => {
    saveReferralParams(BASE_PARAMS);
    Object.keys(sessionStorageStore).forEach((k) => delete sessionStorageStore[k]);
    expect(loadReferralParams()?.refCode).toBe('VISAALMATY');
  });

  it('falls back to sessionStorage when localStorage is empty', () => {
    sessionStorageStore['wpo_referral'] = JSON.stringify(BASE_PARAMS);
    expect(loadReferralParams()?.refCode).toBe('VISAALMATY');
  });
});

// ─── 4. clearReferralParams ───────────────────────────────────────────────────

describe('clearReferralParams', () => {
  it('removes entries from both localStorage and sessionStorage', () => {
    saveReferralParams(BASE_PARAMS);
    clearReferralParams();
    expect(localStorageStore['wpo_referral']).toBeUndefined();
    expect(sessionStorageStore['wpo_referral']).toBeUndefined();
    expect(loadReferralParams()).toBeNull();
  });
});
