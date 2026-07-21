import { applyVersionOverrides, hasAnyOverride } from '../lib/version-overrides';
import { DEFAULT_PRICING_VERSION, DEFAULT_PRICING_VERSION_CODE, getDefaultLanguageRate } from '../lib/default-pricing-version';
import { resolvePricingVersion, PricingVersionNotFoundError, ChannelReserveInvariantError } from '../lib/version-source';
import type { ResolvedFileParams } from '../lib/types';

function baseParams(overrides: Partial<ResolvedFileParams> = {}): ResolvedFileParams {
  return {
    pricingVersionCode: DEFAULT_PRICING_VERSION_CODE,
    pricingVersionSource: 'local',
    sourceLanguage: 'ru',
    targetLanguage: 'en',
    serviceLevel: 'official_with_translator_signature_and_provider_stamp',
    applicantType: 'individual',
    fulfillmentMethod: 'pickup',
    deliveryRequired: false,
    urgency: 'standard',
    extraPaperCopies: 0,
    salesChannel: 'direct',
    manualAdjustmentKzt: 0,
    versionOverrides: {},
    ...overrides,
  };
}

describe('version-overrides', () => {
  it('applies overrides on top of a version without mutating the original', () => {
    const merged = applyVersionOverrides(DEFAULT_PRICING_VERSION, { mrpValue: 9.999 });
    expect(merged.mrpValue).toBe(9.999);
    expect(DEFAULT_PRICING_VERSION.mrpValue).toBe(4.325); // original untouched
  });

  it('hasAnyOverride is false for an empty object, true otherwise', () => {
    expect(hasAnyOverride({})).toBe(false);
    expect(hasAnyOverride({ mrpValue: 1 })).toBe(true);
  });
});

describe('getDefaultLanguageRate', () => {
  it('resolves a seeded RU -> X pair', () => {
    const rate = getDefaultLanguageRate('v1', 'ru', 'en');
    expect(rate?.rateKztPerTranslationPage).toBe(3000);
  });

  it('returns null for an unseeded pair (e.g. en -> ru)', () => {
    expect(getDefaultLanguageRate('v1', 'en', 'ru')).toBeNull();
  });
});

describe('resolvePricingVersion — local mode', () => {
  it('resolves the built-in default version with no overrides', async () => {
    const resolved = await resolvePricingVersion(baseParams());
    expect(resolved.version.code).toBe(DEFAULT_PRICING_VERSION_CODE);
    expect(resolved.usedTemporaryOverrides).toBe(false);
    expect(resolved.languageRate?.rateKztPerTranslationPage).toBe(3000);
    expect(resolved.languageRateSource).toBe('default');
  });

  it('applies temporary overrides in memory only and flags usedTemporaryOverrides', async () => {
    const resolved = await resolvePricingVersion(baseParams({ versionOverrides: { mrpValue: 7 } }));
    expect(resolved.version.mrpValue).toBe(7);
    expect(resolved.usedTemporaryOverrides).toBe(true);
    expect(DEFAULT_PRICING_VERSION.mrpValue).toBe(4.325); // never mutated
  });

  it('honors an explicit languageRateOverrideKzt over the default table', async () => {
    const resolved = await resolvePricingVersion(baseParams({ languageRateOverrideKzt: 9999 }));
    expect(resolved.languageRate?.rateKztPerTranslationPage).toBe(9999);
    expect(resolved.languageRateSource).toBe('override');
  });

  it('rejects any pricingVersionCode other than the built-in default in local mode', async () => {
    await expect(resolvePricingVersion(baseParams({ pricingVersionCode: 'SOME-OTHER-CODE' }))).rejects.toThrow(
      PricingVersionNotFoundError,
    );
  });

  it('reports not_found for an unseeded language pair instead of fabricating a rate', async () => {
    const resolved = await resolvePricingVersion(baseParams({ sourceLanguage: 'en', targetLanguage: 'ru' }));
    expect(resolved.languageRate).toBeUndefined();
    expect(resolved.languageRateSource).toBe('not_found');
  });

  it('throws ChannelReserveInvariantError if an override makes channel_reserve_rate too small', async () => {
    await expect(
      resolvePricingVersion(
        baseParams({ salesChannel: 'referral', partnerCommissionRateOverride: 0.5, versionOverrides: { channelReserveRate: 0.01 } }),
      ),
    ).rejects.toThrow(ChannelReserveInvariantError);
  });

  it('skips the channel-reserve invariant for electronic (it never uses channel_reserve_rate)', async () => {
    await expect(
      resolvePricingVersion(baseParams({ serviceLevel: 'electronic', versionOverrides: { channelReserveRate: 0 } })),
    ).resolves.toBeDefined();
  });
});
