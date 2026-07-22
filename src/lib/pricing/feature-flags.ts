/**
 * Feature flags gating the new-model formula (2026-07-21 revision) for Official/Notary
 * checkout. Mirrors src/lib/payments/halyk/config.ts's pattern exactly — a plain boolean env
 * var, read lazily and cached, never routed through the Zod-validated `src/lib/env.ts` Proxy
 * (which validates its whole schema on first property access; these flags must be readable
 * with zero relation to R2/Supabase/Anthropic/Mistral env vars).
 *
 * There is no separate "old" Official/Notary formula left to fall back to in this codebase
 * (production's calculator.ts is a single monolithic function with no calculateOfficialNotaryPrice
 * split at all — see docs/ai-context/DECISIONS.md, 2026-07-22). So when a flag is off,
 * computeQuoteForJob() refuses to quote that service level entirely rather than silently
 * falling back to anything. Both default to false — Official/Notary checkout stays blocked
 * until explicitly turned on, together with pricing version activation, as one controlled step.
 */

export interface PricingFeatureFlags {
  enableNewOfficialPricing: boolean;
  enableNewNotaryPricing: boolean;
}

let _flags: PricingFeatureFlags | null = null;

export function getPricingFeatureFlags(): PricingFeatureFlags {
  if (_flags) return _flags;

  _flags = {
    enableNewOfficialPricing: process.env.ENABLE_NEW_OFFICIAL_PRICING === 'true',
    enableNewNotaryPricing: process.env.ENABLE_NEW_NOTARY_PRICING === 'true',
  };

  return _flags;
}

/** For tests: reset cached flags so env vars are re-read. */
export function _resetPricingFeatureFlagsCache(): void {
  _flags = null;
}
