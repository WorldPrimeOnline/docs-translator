/**
 * pricing-test-config.json loading + the 5-layer priority chain (see README §Configuration):
 *   CLI flags > file-specific manifest entry > manifest defaults > pricing-test-config.json > safe defaults.
 * Each layer is a Partial<PricingParamsInput>; mergeParamsLayers() shallow-merges left-to-right,
 * with `versionOverrides` merged key-by-key instead of replaced wholesale.
 */
import * as fs from 'node:fs';
import { z } from 'zod';
import type { PricingParamsInput } from './types';
import { VERSION_OVERRIDE_KEYS } from './version-overrides';
import { DEFAULT_PRICING_VERSION_CODE } from './default-pricing-version';

const VersionOverridesSchema = z
  .object(Object.fromEntries(VERSION_OVERRIDE_KEYS.map((k) => [k, z.number().optional()])) as Record<
    (typeof VERSION_OVERRIDE_KEYS)[number],
    z.ZodOptional<z.ZodNumber>
  >)
  .strict()
  .partial();

const PricingParamsSchema = z
  .object({
    pricingVersionCode: z.string().min(1).optional(),
    pricingVersionSource: z.enum(['local', 'staging']).optional(),
    sourceLanguage: z.string().min(1).optional(),
    targetLanguage: z.string().min(1).optional(),
    serviceLevel: z.string().min(1).optional(),
    applicantType: z.enum(['individual', 'legal_entity']).optional(),
    fulfillmentMethod: z.enum(['pickup', 'delivery']).optional(),
    deliveryRequired: z.boolean().optional(),
    notaryUrgency: z.string().min(1).optional(),
    extraPaperCopies: z.number().int().min(0).optional(),
    channel: z.enum(['direct', 'referral']).optional(),
    partnerCommissionRate: z.number().min(0).max(1).optional(),
    manualAdjustmentKzt: z.number().optional(),
    manualAdjustmentReason: z.string().optional(),
    languageRateOverrideKzt: z.number().min(0).optional(),
    manualPhysicalPageCountOverride: z.number().int().min(1).optional(),
    versionOverrides: VersionOverridesSchema.optional(),
  })
  .strict()
  .partial();

/**
 * The last-resort layer — matches the documented pricing-test-config.example.json exactly.
 *
 * deliveryRequired is the ONLY canonical delivery default here — fulfillmentMethod is
 * deliberately NOT set. If it were, it would sit in `withDefaults` before any higher-priority
 * layer's `deliveryRequired` is read, permanently shadowing the `?? (deliveryRequired ? 'delivery'
 * : 'pickup')` derivation in params-resolver.ts and silently producing the contradictory state
 * deliveryRequired=true + fulfillmentMethod='pickup' whenever a manifest set only deliveryRequired.
 * fulfillmentMethod must always be either explicitly set by a real layer (CLI flag / manifest
 * entry / config file) or derived from deliveryRequired — never defaulted independently.
 */
export const SAFE_DEFAULTS: PricingParamsInput = {
  pricingVersionCode: DEFAULT_PRICING_VERSION_CODE,
  pricingVersionSource: 'local',
  sourceLanguage: 'ru',
  targetLanguage: 'en',
  serviceLevel: 'official_with_translator_signature_and_provider_stamp',
  applicantType: 'individual',
  deliveryRequired: false,
  notaryUrgency: 'standard',
  extraPaperCopies: 0,
  channel: 'direct',
  manualAdjustmentKzt: 0,
};

export class InvalidConfigError extends Error {}

/** Returns {} if configPath is undefined. Throws InvalidConfigError on unreadable/invalid JSON. */
export function loadConfigFile(configPath: string | undefined): PricingParamsInput {
  if (!configPath) return {};
  let raw: string;
  try {
    raw = fs.readFileSync(configPath, 'utf-8');
  } catch (err) {
    throw new InvalidConfigError(`Cannot read config file '${configPath}': ${err instanceof Error ? err.message : String(err)}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new InvalidConfigError(`Config file '${configPath}' is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  const result = PricingParamsSchema.safeParse(parsed);
  if (!result.success) {
    throw new InvalidConfigError(
      `Config file '${configPath}' failed validation: ${JSON.stringify(result.error.flatten().fieldErrors)}`,
    );
  }
  return result.data;
}

/** Shallow-merges left-to-right; `versionOverrides` is merged key-by-key, not replaced wholesale. */
export function mergeParamsLayers(...layers: PricingParamsInput[]): PricingParamsInput {
  const merged: PricingParamsInput = {};
  for (const layer of layers) {
    for (const [key, value] of Object.entries(layer)) {
      if (value === undefined) continue;
      if (key === 'versionOverrides') {
        merged.versionOverrides = { ...(merged.versionOverrides ?? {}), ...(value as PricingParamsInput['versionOverrides']) };
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (merged as any)[key] = value;
      }
    }
  }
  return merged;
}

/** Validates a single manifest per-file entry the same way as the top-level config. */
export function validateParamsLayer(value: unknown, context: string): PricingParamsInput {
  const result = PricingParamsSchema.safeParse(value);
  if (!result.success) {
    throw new InvalidConfigError(`${context} failed validation: ${JSON.stringify(result.error.flatten().fieldErrors)}`);
  }
  return result.data;
}
