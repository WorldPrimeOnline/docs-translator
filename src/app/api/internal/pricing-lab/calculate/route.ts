/**
 * Pricing Lab — POST /api/internal/pricing-lab/calculate
 *
 * Calls the REAL production calculatePrice() (src/lib/pricing/calculator.ts) against a
 * resolved pricing_versions row (fetched by explicit code, draft allowed — never requires
 * status='active') and a resolved pricing_language_rates row (fetched by service.ts's real
 * getLanguageRate(), or an in-memory-only test override). Never reimplements the formula.
 *
 * Zero DB writes. No jobs/documents/payment_transactions/price_quotes/orders row is ever
 * created or touched by this route — temporary version/rate overrides exist only for the
 * duration of this single request, merged onto the fetched objects in memory.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase/server';
import { requirePricingLabAccess } from '@/lib/internal/require-pricing-lab-access';
import { getPricingVersionByCode, getLanguageRate, validateChannelReserveInvariant } from '@/lib/pricing/service';
import { calculatePrice } from '@/lib/pricing/calculator';
import type { PricingInput, PricingLanguageRate, PricingVersion } from '@/lib/pricing/types';

const VersionOverridesSchema = z.object({
  taxRate: z.number().min(0).max(1).optional(),
  acquiringRate: z.number().min(0).max(1).optional(),
  riskReserveRate: z.number().min(0).max(1).optional(),
  ownerReserveRate: z.number().min(0).max(1).optional(),
  marketingRateDirect: z.number().min(0).max(1).optional(),
  aiItRate: z.number().min(0).max(1).optional(),
  channelReserveRate: z.number().min(0).max(1).optional(),
  clientDiscountRate: z.number().min(0).max(1).optional(),
  wpoCoordinationRate: z.number().min(0).max(1).optional(),
  translatorPayoutRate: z.number().min(0).max(1).optional(),
  partnerCommissionRate: z.number().min(0).max(1).optional(),
  ocrRatePerPhysicalPageKzt: z.number().min(0).optional(),
  courierFeeKzt: z.number().min(0).optional(),
  printingFeeKzt: z.number().min(0).optional(),
  extraPaperCopyFeeKzt: z.number().min(0).optional(),
  roundingStepOfficialKzt: z.number().min(1).optional(),
  roundingStepNotaryKzt: z.number().min(1).optional(),
  mrpValue: z.number().min(0).optional(),
}).strict();

const CalculateRequestSchema = z.object({
  pricingVersionCode: z.string().min(1),
  serviceLevel: z.enum(['official_with_translator_signature_and_provider_stamp', 'notarization_through_partners']),
  sourceLanguage: z.string().min(1),
  targetLanguage: z.string().min(1),
  sourceCharacterCountWithSpaces: z.number().int().positive().optional(),
  physicalPageCount: z.number().int().positive().optional(),
  applicantType: z.enum(['individual', 'legal_entity']).optional(),
  fulfillmentMethod: z.enum(['pickup', 'delivery']).optional(),
  deliveryRequired: z.boolean().optional(),
  notaryUrgencyLevel: z.enum(['standard', 'same_day']).optional(),
  notaryUrgencyWindowOverride: z.enum(['before_noon', 'after_noon', 'after_18']).optional(),
  extraPaperCopies: z.number().int().min(0).optional(),
  salesChannel: z.enum(['direct', 'referral']).optional(),
  partnerId: z.string().uuid().optional(),
  partnerCommissionRateOverride: z.number().min(0).max(1).optional(),
  manualAdjustmentKzt: z.number().optional(),
  manualAdjustmentReason: z.string().optional(),
  languageRateOverrideKzt: z.number().min(0).optional(),
  versionOverrides: VersionOverridesSchema.optional(),
}).strict();

/** Deterministic ISO timestamp that resolves to the requested Almaty notary-cutoff window. */
function buildNowOverride(window: 'before_noon' | 'after_noon' | 'after_18' | undefined): string | undefined {
  if (!window) return undefined;
  const now = new Date();
  const hourUtc = window === 'before_noon' ? 3 : window === 'after_noon' ? 9 : 15; // Almaty = UTC+5
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hourUtc, 0, 0)).toISOString();
}

export async function POST(request: Request): Promise<NextResponse> {
  const access = await requirePricingLabAccess();
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = CalculateRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
  }
  const req = parsed.data;

  const baseVersion = await getPricingVersionByCode(req.pricingVersionCode);
  if (!baseVersion) {
    return NextResponse.json({ error: `No pricing_versions row found for code '${req.pricingVersionCode}'` }, { status: 404 });
  }

  // Merge temporary overrides IN MEMORY ONLY — never written back to pricing_versions.
  const version: PricingVersion = { ...baseVersion, ...(req.versionOverrides ?? {}) };

  // Resolve language rate — real DB lookup, or an explicit in-memory-only test override.
  let languageRate: PricingLanguageRate | undefined;
  let languageRateSource: 'db' | 'override' | 'not_found' = 'not_found';
  if (req.languageRateOverrideKzt != null) {
    languageRate = {
      id: 'lab-override', pricingVersionId: version.id,
      sourceLanguage: req.sourceLanguage, targetLanguage: req.targetLanguage,
      rateKztPerTranslationPage: req.languageRateOverrideKzt, active: true, requiresOperatorReview: false,
    };
    languageRateSource = 'override';
  } else {
    const resolved = await getLanguageRate(version.id, req.sourceLanguage, req.targetLanguage);
    if (resolved) {
      languageRate = resolved;
      languageRateSource = 'db';
    }
  }

  // Resolve partner commission — real staging partner (read-only lookup) or a manual override.
  let partnerCommissionRateOverride = req.partnerCommissionRateOverride;
  let resolvedPartner: { id: string; name: string; commissionRate: number } | null = null;
  if (req.partnerId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: partner } = await (supabaseServer as any)
      .from('partners')
      .select('id, name, commission_rate')
      .eq('id', req.partnerId)
      .maybeSingle();
    if (partner) {
      resolvedPartner = { id: partner.id, name: partner.name, commissionRate: Number(partner.commission_rate) };
      partnerCommissionRateOverride = Number(partner.commission_rate);
    }
  }

  // Same config-load-time invariant check production uses — surfaced as a blocking validation
  // error here instead of a silent pass, so a bad override combination is caught in the Lab.
  try {
    await validateChannelReserveInvariant(version);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err), blocked: true }, { status: 422 });
  }

  const input: PricingInput = {
    sourceLanguage: req.sourceLanguage,
    targetLanguage: req.targetLanguage,
    serviceLevel: req.serviceLevel,
    sourceCharacterCountWithSpaces: req.sourceCharacterCountWithSpaces,
    physicalPageCount: req.physicalPageCount,
    applicantType: req.applicantType,
    fulfillmentMethod: req.fulfillmentMethod,
    deliveryRequired: req.deliveryRequired,
    notaryUrgencyLevel: req.notaryUrgencyLevel,
    extraPaperCopies: req.extraPaperCopies,
    salesChannel: req.salesChannel,
    partnerCommissionRateOverride,
    manualAdjustmentKzt: req.manualAdjustmentKzt,
    manualAdjustmentReason: req.manualAdjustmentReason,
    languageRate,
    nowOverride: buildNowOverride(req.notaryUrgencyWindowOverride),
  };

  let result;
  try {
    result = calculatePrice(input, version);
  } catch (err) {
    // e.g. PRICING_CONFIG_INVALID from an invalid gross-up override — blocked, not a crash.
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err), blocked: true }, { status: 422 });
  }

  return NextResponse.json({
    result,
    resolvedVersion: {
      id: version.id, code: version.code, status: version.status,
      overridesApplied: req.versionOverrides ?? {},
    },
    resolvedLanguageRate: languageRate
      ? { ...languageRate, source: languageRateSource }
      : null,
    resolvedPartner,
  });
}
