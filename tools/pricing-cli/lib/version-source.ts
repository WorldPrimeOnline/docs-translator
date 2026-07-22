/**
 * Resolves a PricingVersion + PricingLanguageRate either from the built-in local default
 * (default-pricing-version.ts, offline, no credentials needed) or by a READ-ONLY fetch from
 * staging (--from-staging; dynamically imports @/lib/pricing/service so importing this module
 * never requires Supabase credentials unless staging mode is actually used — see README
 * §Staging mode).
 *
 * Overrides (lib/version-overrides.ts) are applied IN MEMORY ONLY, after resolution, in both
 * modes. Never calls saveQuote/markQuotePaid/verifyQuotePayable and never writes to
 * pricing_versions, pricing_language_rates, price_quotes, or cost_reservations.
 */
import type { PricingLanguageRate, PricingVersion } from '@/lib/pricing/types';
import { toDecimal } from '@/lib/pricing/money';
import type { ResolvedFileParams } from './types';
import { applyVersionOverrides, hasAnyOverride } from './version-overrides';
import { DEFAULT_PRICING_VERSION, DEFAULT_PRICING_VERSION_CODE, getDefaultLanguageRate } from './default-pricing-version';

export class PricingVersionNotFoundError extends Error {}
export class ChannelReserveInvariantError extends Error {}

export type LanguageRateSource = 'override' | 'db' | 'default' | 'not_found';

export interface ResolvedVersion {
  version: PricingVersion;
  languageRate: PricingLanguageRate | undefined;
  languageRateSource: LanguageRateSource;
  usedTemporaryOverrides: boolean;
}

/**
 * Same channel-reserve invariant as src/lib/pricing/service.ts's validateChannelReserveInvariant
 * (2026-07-17 decision), but DB-free — local mode has no `partners` table to read, so it uses
 * version.partnerCommissionRate as the worst case directly (the real function's own fallback
 * when its partners lookup errors). Never touches Supabase; safe to call with zero credentials.
 */
function validateChannelReserveInvariantLocal(version: PricingVersion): void {
  const required = toDecimal(version.clientDiscountRate)
    .plus(toDecimal(version.partnerCommissionRate).times(toDecimal(1).minus(version.clientDiscountRate)))
    .toNumber();

  if (version.channelReserveRate < required) {
    throw new ChannelReserveInvariantError(
      `PRICING_CONFIG_INVALID: channel_reserve_rate (${version.channelReserveRate}) < required (${required}) for pricing version '${version.code}' — client_discount_rate (${version.clientDiscountRate}) + partner_commission_rate (${version.partnerCommissionRate}) is not covered.`,
    );
  }
}

export async function resolvePricingVersion(params: ResolvedFileParams): Promise<ResolvedVersion> {
  let baseVersion: PricingVersion;
  let validateOnStaging: ((v: PricingVersion) => Promise<void>) | undefined;

  if (params.pricingVersionSource === 'staging') {
    const { getPricingVersionByCode, validateChannelReserveInvariant } = await import('@/lib/pricing/service');
    const fetched = await getPricingVersionByCode(params.pricingVersionCode);
    if (!fetched) {
      throw new PricingVersionNotFoundError(`No pricing_versions row found on staging for code '${params.pricingVersionCode}'.`);
    }
    baseVersion = fetched;
    validateOnStaging = validateChannelReserveInvariant;
  } else {
    if (params.pricingVersionCode !== DEFAULT_PRICING_VERSION_CODE) {
      throw new PricingVersionNotFoundError(
        `Local mode only knows the built-in default pricing version '${DEFAULT_PRICING_VERSION_CODE}'. ` +
          `Set pricingVersionCode to '${DEFAULT_PRICING_VERSION_CODE}', or pass --from-staging to fetch '${params.pricingVersionCode}' from the real staging pricing_versions table.`,
      );
    }
    baseVersion = DEFAULT_PRICING_VERSION;
  }

  // Apply overrides BEFORE validating the invariant — overrides are exactly the kind of input
  // that can break it, so checking the pre-override version would miss that (matches the
  // deleted Pricing Lab calculate route's order: merge first, then validate the merged version).
  const version = applyVersionOverrides(baseVersion, params.versionOverrides);
  const usedTemporaryOverrides = hasAnyOverride(params.versionOverrides);

  if (params.serviceLevel !== 'electronic') {
    if (validateOnStaging) await validateOnStaging(version);
    else validateChannelReserveInvariantLocal(version);
  }

  let languageRate: PricingLanguageRate | undefined;
  let languageRateSource: LanguageRateSource;

  if (params.languageRateOverrideKzt != null) {
    languageRate = {
      id: 'cli-override',
      pricingVersionId: version.id,
      sourceLanguage: params.sourceLanguage,
      targetLanguage: params.targetLanguage,
      rateKztPerTranslationPage: params.languageRateOverrideKzt,
      active: true,
      requiresOperatorReview: false,
      // A direct CLI rate override bypasses base-rate resolution entirely — no base rates
      // contributed, so there is nothing to record on either side.
      resolution: { sourceBaseRate: null, targetBaseRate: null, winningSide: 'source' },
    };
    languageRateSource = 'override';
  } else if (params.pricingVersionSource === 'staging') {
    const { getLanguageRate } = await import('@/lib/pricing/service');
    const resolved = await getLanguageRate(version.id, params.sourceLanguage, params.targetLanguage);
    languageRate = resolved ?? undefined;
    languageRateSource = resolved ? 'db' : 'not_found';
  } else {
    const resolved = getDefaultLanguageRate(version.id, params.sourceLanguage, params.targetLanguage);
    languageRate = resolved ?? undefined;
    languageRateSource = resolved ? 'default' : 'not_found';
  }

  return { version, languageRate, languageRateSource, usedTemporaryOverrides };
}
