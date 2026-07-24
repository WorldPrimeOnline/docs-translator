/**
 * Tests for src/lib/pricing/service.ts — focused on the 2026-07-22 additions:
 *   - computeQuoteForJob()'s Official/Notary feature-flag gate + active-version-must-match check
 *     (there is no legacy Official/Notary formula left in this codebase to fall back to, so a
 *     disabled flag must refuse to quote rather than silently price against the wrong version)
 *   - markQuotePaid()'s status guard (mirrors markQuotePaymentPending()'s existing guard)
 * calculatePrice() itself is exercised in calculator.test.ts — mocked here so this file only
 * tests service.ts's own orchestration logic.
 */
jest.mock('@/lib/supabase/server', () => ({
  supabaseServer: { from: jest.fn() },
}));
const mockCalculatePrice = jest.fn();
jest.mock('../calculator', () => ({
  calculatePrice: (...args: unknown[]) => mockCalculatePrice(...args),
}));

import { supabaseServer } from '@/lib/supabase/server';
import { computeQuoteForJob, getLanguageRate, markQuotePaid } from '../service';
import { _resetPricingFeatureFlagsCache } from '../feature-flags';
import type { PricingInput } from '../types';

const mockFrom = supabaseServer.from as jest.Mock;

function chain(result: { data?: unknown; error?: unknown }) {
  const c: Record<string, unknown> = {};
  const methods = ['select', 'eq', 'or', 'order', 'limit', 'update', 'in'];
  for (const m of methods) c[m] = jest.fn(() => c);
  c.maybeSingle = jest.fn(() => Promise.resolve(result));
  c.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return c;
}

const NEW_MODEL_VERSION_ROW = {
  id: 'v-newmodel', code: '2026-Q3-KZ-NEWMODEL', status: 'active', currency: 'KZT',
  internal_fx_rate: null, mrp_value: 4.325,
  tax_rate: 0.03, acquiring_rate: 0.025, risk_reserve_rate: 0.05, owner_reserve_rate: 0,
  marketing_rate_direct: 0.05, partner_commission_rate: 0.1, target_profit_rate: 0.25,
  ai_it_reserve_per_page_kzt: 100, valid_from: '2026-07-17', valid_to: null,
  metadata: { formula_version: 'new_2026_07_21' },
  ai_it_rate: 0.1, channel_reserve_rate: 0.2, client_discount_rate: 0.1, wpo_coordination_rate: 0.3,
  translator_payout_rate: 0.3, ocr_rate_per_physical_page_kzt: 100, courier_fee_kzt: 5000,
  printing_fee_kzt: 0, extra_paper_copy_fee_kzt: 0, rounding_step_official_kzt: 100, rounding_step_notary_kzt: 500,
  public_electronic_price_kzt: null, public_official_min_price_kzt: null, public_notary_min_price_kzt: null,
};

const MVP_VERSION_ROW = { ...NEW_MODEL_VERSION_ROW, id: 'v-mvp', code: '2026-Q3-KZ-MVP', metadata: { note: 'old' } };

// 2026-07-25 incident: the WO-98 progressive-coordination version — same approved formula
// (formula_version: new_2026_07_21), different `code`, different coordination metadata layered
// on top. Activating this as the new active version must NOT break quoting.
const COORD_TIERS_VERSION_ROW = {
  ...NEW_MODEL_VERSION_ROW, id: 'v-coord-tiers', code: '2026-Q3-KZ-NEWMODEL-COORD-TIERS',
  valid_from: '2026-07-25T09:00:00.000Z',
  metadata: {
    formula_version: 'new_2026_07_21',
    coordinationVolumeTiers: [{ rate: 0.3, fromPage: 0, upToPage: 5 }, { rate: 0.25, fromPage: 5, upToPage: 10 }, { rate: 0.2, fromPage: 10, upToPage: null }],
    notaryCoordinationRate: 0.3,
    courierCoordinationRate: 0.3,
  },
};

function baseInput(overrides: Partial<PricingInput> = {}): PricingInput {
  return { sourceLanguage: 'ru', targetLanguage: 'en', serviceLevel: 'official_with_translator_signature_and_provider_stamp', ...overrides };
}

describe('computeQuoteForJob', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    _resetPricingFeatureFlagsCache();
    delete process.env.ENABLE_NEW_OFFICIAL_PRICING;
    delete process.env.ENABLE_NEW_NOTARY_PRICING;
    mockCalculatePrice.mockReturnValue({ amountKzt: 1000, newModel: undefined });
  });

  it('electronic is never gated by the Official/Notary flags — no version-code check either', async () => {
    mockFrom.mockReturnValueOnce(chain({ data: MVP_VERSION_ROW, error: null })); // getActivePricingVersion only
    const result = await computeQuoteForJob(baseInput({ serviceLevel: 'electronic' }));
    expect('error' in result).toBe(false);
    expect(mockCalculatePrice).toHaveBeenCalledTimes(1);
  });

  it('official + ENABLE_NEW_OFFICIAL_PRICING unset (default false) -> SERVICE_LEVEL_PRICING_DISABLED, never calls calculatePrice', async () => {
    mockFrom.mockReturnValueOnce(chain({ data: NEW_MODEL_VERSION_ROW, error: null }));
    const result = await computeQuoteForJob(baseInput());
    expect(result).toEqual({ error: 'SERVICE_LEVEL_PRICING_DISABLED' });
    expect(mockCalculatePrice).not.toHaveBeenCalled();
  });

  it('notarization + ENABLE_NEW_NOTARY_PRICING unset (default false) -> SERVICE_LEVEL_PRICING_DISABLED', async () => {
    mockFrom.mockReturnValueOnce(chain({ data: NEW_MODEL_VERSION_ROW, error: null }));
    const result = await computeQuoteForJob(baseInput({ serviceLevel: 'notarization_through_partners' }));
    expect(result).toEqual({ error: 'SERVICE_LEVEL_PRICING_DISABLED' });
    expect(mockCalculatePrice).not.toHaveBeenCalled();
  });

  it('official + flag ON but active version is NOT the corrected new-model row -> PRICING_VERSION_MISMATCH (with detail, never silently prices against the wrong version)', async () => {
    process.env.ENABLE_NEW_OFFICIAL_PRICING = 'true';
    mockFrom.mockReturnValueOnce(chain({ data: MVP_VERSION_ROW, error: null }));
    const result = await computeQuoteForJob(baseInput());
    expect(result).toEqual({
      error: 'PRICING_VERSION_MISMATCH',
      activeVersionId: 'v-mvp',
      activeVersionCode: '2026-Q3-KZ-MVP',
      activeVersionValidFrom: '2026-07-17',
    });
    expect(mockCalculatePrice).not.toHaveBeenCalled();
  });

  it('2026-07-25 incident regression: the gate checks formula_version only, NOT a hardcoded exact code — activating 2026-Q3-KZ-NEWMODEL-COORD-TIERS (same approved formula, different code) must NOT return PRICING_VERSION_MISMATCH', async () => {
    process.env.ENABLE_NEW_OFFICIAL_PRICING = 'true';
    mockFrom
      .mockReturnValueOnce(chain({ data: COORD_TIERS_VERSION_ROW, error: null }))
      .mockReturnValueOnce(chain({ data: null, error: null }))
      .mockReturnValueOnce(chain({ data: null, error: null }));

    const result = await computeQuoteForJob(baseInput());

    expect('error' in result).toBe(false);
    expect(mockCalculatePrice).toHaveBeenCalledTimes(1);
  });

  it('notarization also succeeds against the coord-tiers version', async () => {
    process.env.ENABLE_NEW_NOTARY_PRICING = 'true';
    mockFrom
      .mockReturnValueOnce(chain({ data: COORD_TIERS_VERSION_ROW, error: null }))
      .mockReturnValueOnce(chain({ data: null, error: null }))
      .mockReturnValueOnce(chain({ data: null, error: null }));

    const result = await computeQuoteForJob(baseInput({ serviceLevel: 'notarization_through_partners' }));

    expect('error' in result).toBe(false);
    expect(mockCalculatePrice).toHaveBeenCalledTimes(1);
  });

  it('a genuinely wrong formula_version still returns PRICING_VERSION_MISMATCH — the gate is not simply disabled', async () => {
    process.env.ENABLE_NEW_OFFICIAL_PRICING = 'true';
    const wrongFormula = { ...NEW_MODEL_VERSION_ROW, id: 'v-wrong', code: 'SOME-OTHER-CODE', metadata: { formula_version: 'old_formula' } };
    mockFrom.mockReturnValueOnce(chain({ data: wrongFormula, error: null }));

    const result = await computeQuoteForJob(baseInput());

    expect(result).toEqual({
      error: 'PRICING_VERSION_MISMATCH',
      activeVersionId: 'v-wrong',
      activeVersionCode: 'SOME-OTHER-CODE',
      activeVersionValidFrom: '2026-07-17',
    });
    expect(mockCalculatePrice).not.toHaveBeenCalled();
  });

  it('logs a structured, safe diagnostic on mismatch — expected/actual version identifiers and documentId, never the full config payload', async () => {
    process.env.ENABLE_NEW_OFFICIAL_PRICING = 'true';
    mockFrom.mockReturnValueOnce(chain({ data: MVP_VERSION_ROW, error: null }));
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    await computeQuoteForJob(baseInput({ documentId: 'doc-123', analysisId: 'analysis-456' }));

    const logged = consoleSpy.mock.calls.map((c) => String(c[0])).find((s) => s.includes('pricing_version_mismatch'));
    expect(logged).toBeDefined();
    const parsed = JSON.parse(logged!);
    expect(parsed).toEqual({
      scope: 'pricing_version_mismatch',
      expectedFormulaVersion: 'new_2026_07_21',
      actualVersionId: 'v-mvp',
      actualVersionCode: '2026-Q3-KZ-MVP',
      actualFormulaVersion: null,
      documentId: 'doc-123',
      analysisId: 'analysis-456',
    });
    // Never the full metadata/config payload — only identifiers.
    expect(logged).not.toContain('coordinationVolumeTiers');
    expect(logged).not.toContain('rate_kzt_per_translation_page');
    consoleSpy.mockRestore();
  });

  it('official + flag ON + active version IS the corrected new-model row -> proceeds to calculatePrice as normal', async () => {
    process.env.ENABLE_NEW_OFFICIAL_PRICING = 'true';
    mockFrom
      .mockReturnValueOnce(chain({ data: NEW_MODEL_VERSION_ROW, error: null })) // getActivePricingVersion
      .mockReturnValueOnce(chain({ data: null, error: null }))                  // validateChannelReserveInvariant's partners query
      .mockReturnValueOnce(chain({ data: null, error: null }));                 // getLanguageRate

    const result = await computeQuoteForJob(baseInput());
    expect('error' in result).toBe(false);
    expect(mockCalculatePrice).toHaveBeenCalledTimes(1);
  });

  it('notarization + flag ON + correct version -> proceeds to calculatePrice as normal', async () => {
    process.env.ENABLE_NEW_NOTARY_PRICING = 'true';
    mockFrom
      .mockReturnValueOnce(chain({ data: NEW_MODEL_VERSION_ROW, error: null }))
      .mockReturnValueOnce(chain({ data: null, error: null }))
      .mockReturnValueOnce(chain({ data: null, error: null }));

    const result = await computeQuoteForJob(baseInput({ serviceLevel: 'notarization_through_partners' }));
    expect('error' in result).toBe(false);
    expect(mockCalculatePrice).toHaveBeenCalledTimes(1);
  });

  it('no active pricing version at all -> PRICING_NOT_CONFIGURED, before any flag/version check', async () => {
    mockFrom.mockReturnValueOnce(chain({ data: null, error: null }));
    const result = await computeQuoteForJob(baseInput());
    expect(result).toEqual({ error: 'PRICING_NOT_CONFIGURED' });
  });
});

/**
 * 2026-07-26 fix: pricing_language_rates rows are RU->X base rates, not directional pairs.
 * getLanguageRate must resolve max(base(source), base(target)) symmetrically — Russian
 * contributes 0 (it has no stored row and is never "missing"), so RU<->EN and EN<->ZH both
 * resolve correctly from the same seeded RU->X rows without a separately-seeded reverse row.
 */
function baseRateRow(targetLanguage: string, rateKzt: number, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: `rate-ru-${targetLanguage}`,
    pricing_version_id: 'v1',
    source_language: 'ru',
    target_language: targetLanguage,
    rate_kzt_per_translation_page: rateKzt,
    active: true,
    requires_operator_review: false,
    ...overrides,
  };
}

describe('getLanguageRate — symmetric pair resolution', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('RU -> EN resolves to EN base rate (3000), source (ru) contributes null', async () => {
    mockFrom.mockReturnValueOnce(chain({ data: baseRateRow('en', 3000), error: null })); // base rate for 'en'
    const rate = await getLanguageRate('v1', 'ru', 'en');
    expect(rate?.rateKztPerTranslationPage).toBe(3000);
    expect(rate?.resolution.winningSide).toBe('target');
    expect(rate?.resolution.sourceBaseRate).toBeNull();
    expect(rate?.resolution.targetBaseRate?.language).toBe('en');
  });

  it('EN -> RU resolves symmetrically to the same 3000 as RU -> EN, target (ru) contributes null', async () => {
    mockFrom.mockReturnValueOnce(chain({ data: baseRateRow('en', 3000), error: null })); // base rate for 'en' (now the source side)
    const rate = await getLanguageRate('v1', 'en', 'ru');
    expect(rate?.rateKztPerTranslationPage).toBe(3000);
    expect(rate?.resolution.winningSide).toBe('source');
    expect(rate?.resolution.targetBaseRate).toBeNull();
    expect(rate?.resolution.sourceBaseRate?.language).toBe('en');
  });

  it('EN -> ZH resolves to max(base(en)=3000, base(zh)=5000) = 5000, zh wins', async () => {
    mockFrom
      .mockReturnValueOnce(chain({ data: baseRateRow('en', 3000), error: null })) // source base rate (en)
      .mockReturnValueOnce(chain({ data: baseRateRow('zh', 5000), error: null })); // target base rate (zh)
    const rate = await getLanguageRate('v1', 'en', 'zh');
    expect(rate?.rateKztPerTranslationPage).toBe(5000);
    expect(rate?.resolution.winningSide).toBe('target');
  });

  it('ZH -> EN resolves to the same 5000 as EN -> ZH (direction-independent)', async () => {
    mockFrom
      .mockReturnValueOnce(chain({ data: baseRateRow('zh', 5000), error: null })) // source base rate (zh)
      .mockReturnValueOnce(chain({ data: baseRateRow('en', 3000), error: null })); // target base rate (en)
    const rate = await getLanguageRate('v1', 'zh', 'en');
    expect(rate?.rateKztPerTranslationPage).toBe(5000);
    expect(rate?.resolution.winningSide).toBe('source');
  });

  it('does not return LANGUAGE_RATE_MISSING (null) when both languages have seeded base rates', async () => {
    mockFrom
      .mockReturnValueOnce(chain({ data: baseRateRow('en', 3000), error: null }))
      .mockReturnValueOnce(chain({ data: baseRateRow('zh', 5000), error: null }));
    const rate = await getLanguageRate('v1', 'en', 'zh');
    expect(rate).not.toBeNull();
  });

  it('returns null (routes to operator review) when a non-Russian side has no base rate at all', async () => {
    mockFrom
      .mockReturnValueOnce(chain({ data: baseRateRow('en', 3000), error: null })) // en exists
      .mockReturnValueOnce(chain({ data: null, error: null }));                    // xx does not
    const rate = await getLanguageRate('v1', 'en', 'xx');
    expect(rate).toBeNull();
  });

  it('normalizes language codes (case/whitespace) before resolving', async () => {
    mockFrom.mockReturnValueOnce(chain({ data: baseRateRow('en', 3000), error: null }));
    const rate = await getLanguageRate('v1', ' RU ', 'EN');
    expect(rate?.sourceLanguage).toBe('ru');
    expect(rate?.targetLanguage).toBe('en');
    expect(rate?.rateKztPerTranslationPage).toBe(3000);
  });
});

describe('markQuotePaid — status guard', () => {
  it('only transitions quoted/payment_pending/requires_operator_review quotes, mirroring markQuotePaymentPending', async () => {
    const updateChain = chain({ data: null, error: null });
    const reservationsChain = chain({ data: null, error: null });
    mockFrom.mockReturnValueOnce(updateChain).mockReturnValueOnce(reservationsChain);

    await markQuotePaid('quote-1', 'txn-1');

    expect(updateChain.in).toHaveBeenCalledWith('status', ['quoted', 'payment_pending', 'requires_operator_review']);
  });
});
