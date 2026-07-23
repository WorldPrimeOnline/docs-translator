/**
 * Pricing service — DB integration for price quotes.
 * Server-side only. Never import in client bundles.
 */
import { supabaseServer } from '@/lib/supabase/server';
import { calculatePrice } from './calculator';
import { toDecimal } from './money';
import { getPricingFeatureFlags } from './feature-flags';
import { buildPriceQuoteInsertRow } from './quote-row-mapper';
import { parseCoordinationConfig } from './coordination-tiers';
import type { LanguagePairBaseRate, NotaryUrgencyLevel, PricingInput, PricingLanguageRate, PricingResult, PricingVersion, QuoteStatus } from './types';

/**
 * Russian is the anchor language for pricing_language_rates (2026-07-26 decision): every seeded
 * row is RU->X, encoding X's base rate relative to Russian. Russian itself has no stored row —
 * it is never "missing", it simply contributes 0 to the pair-rate max() below.
 */
const RUSSIAN_ANCHOR_LANGUAGE = 'ru';

function normalizeLanguageCode(language: string): string {
  return language.trim().toLowerCase();
}

/** The only pricing_versions row the new-model flags are allowed to consider "correct". */
const NEW_MODEL_VERSION_CODE = '2026-Q3-KZ-NEWMODEL';
const NEW_MODEL_FORMULA_VERSION = 'new_2026_07_21';

// ─── Raw DB row shapes (new tables not yet in generated supabase.ts) ───────────

interface PricingVersionRow {
  id: string;
  code: string;
  status: string;
  currency: string;
  internal_fx_rate: string | number | null;
  mrp_value: string | number | null;
  tax_rate: string | number;
  acquiring_rate: string | number;
  risk_reserve_rate: string | number;
  owner_reserve_rate: string | number;
  marketing_rate_direct: string | number;
  partner_commission_rate: string | number;
  target_profit_rate: string | number;
  ai_it_reserve_per_page_kzt: string | number;
  valid_from: string;
  valid_to: string | null;
  metadata: Record<string, unknown>;
  // ─── New formula fields (migration 0049/0056) ──────────────────────────────
  ai_it_rate: string | number;
  channel_reserve_rate: string | number;
  client_discount_rate: string | number;
  wpo_coordination_rate: string | number;
  translator_payout_rate: string | number;
  ocr_rate_per_physical_page_kzt: string | number;
  courier_fee_kzt: string | number;
  printing_fee_kzt: string | number;
  extra_paper_copy_fee_kzt: string | number;
  rounding_step_official_kzt: string | number;
  rounding_step_notary_kzt: string | number;
  public_electronic_price_kzt: string | number | null;
  public_official_min_price_kzt: string | number | null;
  public_notary_min_price_kzt: string | number | null;
}

interface PricingLanguageRateRow {
  id: string;
  pricing_version_id: string;
  source_language: string;
  target_language: string;
  rate_kzt_per_translation_page: string | number;
  active: boolean;
  requires_operator_review: boolean;
}

const PRICING_VERSION_COLUMNS = [
  'id', 'code', 'status', 'currency', 'internal_fx_rate', 'mrp_value',
  'tax_rate', 'acquiring_rate', 'risk_reserve_rate', 'owner_reserve_rate',
  'marketing_rate_direct', 'partner_commission_rate', 'target_profit_rate',
  'ai_it_reserve_per_page_kzt', 'valid_from', 'valid_to', 'metadata',
  'ai_it_rate', 'channel_reserve_rate', 'client_discount_rate', 'wpo_coordination_rate',
  'translator_payout_rate', 'ocr_rate_per_physical_page_kzt', 'courier_fee_kzt',
  'printing_fee_kzt', 'extra_paper_copy_fee_kzt', 'rounding_step_official_kzt',
  'rounding_step_notary_kzt', 'public_electronic_price_kzt', 'public_official_min_price_kzt',
  'public_notary_min_price_kzt',
].join(', ');

function mapPricingVersionRow(row: PricingVersionRow): PricingVersion {
  const coordinationConfig = parseCoordinationConfig(row.metadata);
  return {
    id: row.id,
    code: row.code,
    status: row.status as PricingVersion['status'],
    currency: row.currency,
    internalFxRate: row.internal_fx_rate != null ? Number(row.internal_fx_rate) : null,
    mrpValue: row.mrp_value != null ? Number(row.mrp_value) : null,
    taxRate: Number(row.tax_rate),
    acquiringRate: Number(row.acquiring_rate),
    riskReserveRate: Number(row.risk_reserve_rate),
    ownerReserveRate: Number(row.owner_reserve_rate),
    marketingRateDirect: Number(row.marketing_rate_direct),
    partnerCommissionRate: Number(row.partner_commission_rate),
    targetProfitRate: Number(row.target_profit_rate),
    aiItReservePerPageKzt: Number(row.ai_it_reserve_per_page_kzt),
    validFrom: row.valid_from,
    validTo: row.valid_to,
    metadata: row.metadata ?? {},
    aiItRate: Number(row.ai_it_rate),
    channelReserveRate: Number(row.channel_reserve_rate),
    clientDiscountRate: Number(row.client_discount_rate),
    wpoCoordinationRate: Number(row.wpo_coordination_rate),
    translatorPayoutRate: Number(row.translator_payout_rate),
    ocrRatePerPhysicalPageKzt: Number(row.ocr_rate_per_physical_page_kzt),
    courierFeeKzt: Number(row.courier_fee_kzt),
    printingFeeKzt: Number(row.printing_fee_kzt),
    extraPaperCopyFeeKzt: Number(row.extra_paper_copy_fee_kzt),
    roundingStepOfficialKzt: Number(row.rounding_step_official_kzt),
    roundingStepNotaryKzt: Number(row.rounding_step_notary_kzt),
    publicElectronicPriceKzt: row.public_electronic_price_kzt != null ? Number(row.public_electronic_price_kzt) : null,
    publicOfficialMinPriceKzt: row.public_official_min_price_kzt != null ? Number(row.public_official_min_price_kzt) : null,
    publicNotaryMinPriceKzt: row.public_notary_min_price_kzt != null ? Number(row.public_notary_min_price_kzt) : null,
    coordinationVolumeTiers: coordinationConfig.translationTiers,
    notaryCoordinationRate: coordinationConfig.notaryCoordinationRate,
    courierCoordinationRate: coordinationConfig.courierCoordinationRate,
  };
}

interface PriceQuoteRow {
  id: string;
  job_id: string | null;
  user_id: string | null;
  status: string;
  amount_kzt: string | number;
  expires_at: string;
}

// ─── DB helpers (cast to any for new tables) ──────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabaseServer as any;

// ─── Public API ──────────────────────────────────────────────────────────────

export async function getActivePricingVersion(): Promise<PricingVersion | null> {
  const { data, error } = await db
    .from('pricing_versions')
    .select(PRICING_VERSION_COLUMNS)
    .eq('status', 'active')
    .or(`valid_to.is.null,valid_to.gt.${new Date().toISOString()}`)
    .order('valid_from', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return mapPricingVersionRow(data as PricingVersionRow);
}

/**
 * Fetch a pricing_versions row by its explicit `code`, regardless of `status`. Used only by
 * tests/tooling that need to exercise the new-model draft version (2026-Q3-KZ-NEWMODEL) before
 * it's activated — never by production quote-creation code, which always goes through
 * getActivePricingVersion(). See docs/ai-context/DECISIONS.md (2026-07-17, activation order).
 */
export async function getPricingVersionByCode(code: string): Promise<PricingVersion | null> {
  const { data, error } = await db
    .from('pricing_versions')
    .select(PRICING_VERSION_COLUMNS)
    .eq('code', code)
    .maybeSingle();

  if (error || !data) return null;
  return mapPricingVersionRow(data as PricingVersionRow);
}

/**
 * Look up a single non-Russian language's base rate row (pricing_language_rates: source_language
 * = 'ru', target_language = that language). Russian itself has no row — callers must special-case
 * it before calling this (see getLanguageRate below); this function is never called with 'ru'.
 */
async function getBaseLanguageRate(pricingVersionId: string, language: string): Promise<LanguagePairBaseRate | null> {
  const { data, error } = await db
    .from('pricing_language_rates')
    .select('id, pricing_version_id, source_language, target_language, rate_kzt_per_translation_page, active, requires_operator_review')
    .eq('pricing_version_id', pricingVersionId)
    .eq('source_language', RUSSIAN_ANCHOR_LANGUAGE)
    .eq('target_language', language)
    .maybeSingle();

  if (error || !data) return null;

  const row = data as PricingLanguageRateRow;
  return {
    language,
    rateId: row.id,
    rateKztPerTranslationPage: Number(row.rate_kzt_per_translation_page),
    active: row.active,
    requiresOperatorReview: row.requires_operator_review,
  };
}

/**
 * Resolve a source->target language pair's rate under a given pricing_version_id.
 *
 * 2026-07-26 decision: pricing_language_rates rows are NOT directional pairs — the seeded
 * RU->X rows each represent language X's base rate relative to Russian, the anchor language.
 * A pair's actual rate is max(base(source), base(target)), independent of direction, so
 * RU->EN, EN->RU, EN->ZH, and ZH->EN all resolve correctly from the same 14 seeded rows —
 * every language-pair permutation is never separately seeded.
 *
 * Returns null (routes to operator_review, never a fabricated rate) only when at least one
 * non-Russian side has no base rate row at all under this version — Russian itself is never
 * "missing" since it has no row by design. An inactive or requires_operator_review base row on
 * either contributing side still resolves (so the calculator can report WHY review is needed),
 * propagated onto the resolved pair via active/requiresOperatorReview below — the pair is only
 * as trustworthy as its least-confirmed contributing base rate.
 */
export async function getLanguageRate(
  pricingVersionId: string,
  sourceLanguage: string,
  targetLanguage: string,
): Promise<PricingLanguageRate | null> {
  const source = normalizeLanguageCode(sourceLanguage);
  const target = normalizeLanguageCode(targetLanguage);

  const [sourceBaseRate, targetBaseRate] = await Promise.all([
    source === RUSSIAN_ANCHOR_LANGUAGE ? Promise.resolve(null) : getBaseLanguageRate(pricingVersionId, source),
    target === RUSSIAN_ANCHOR_LANGUAGE ? Promise.resolve(null) : getBaseLanguageRate(pricingVersionId, target),
  ]);

  if (source !== RUSSIAN_ANCHOR_LANGUAGE && !sourceBaseRate) return null;
  if (target !== RUSSIAN_ANCHOR_LANGUAGE && !targetBaseRate) return null;
  // ru->ru is not a real translation pair — nothing to resolve either side.
  if (!sourceBaseRate && !targetBaseRate) return null;

  const sourceRateKzt = sourceBaseRate?.rateKztPerTranslationPage ?? 0;
  const targetRateKzt = targetBaseRate?.rateKztPerTranslationPage ?? 0;
  const winningSide: 'source' | 'target' = sourceRateKzt >= targetRateKzt ? 'source' : 'target';
  const winner = (winningSide === 'source' ? sourceBaseRate : targetBaseRate)!;

  return {
    id: winner.rateId,
    pricingVersionId,
    sourceLanguage: source,
    targetLanguage: target,
    rateKztPerTranslationPage: Math.max(sourceRateKzt, targetRateKzt),
    active: (sourceBaseRate?.active ?? true) && (targetBaseRate?.active ?? true),
    requiresOperatorReview: (sourceBaseRate?.requiresOperatorReview ?? false) || (targetBaseRate?.requiresOperatorReview ?? false),
    resolution: { sourceBaseRate, targetBaseRate, winningSide },
  };
}

/**
 * Validates the channel-reserve invariant at config-load time (2026-07-17 decision):
 * channel_reserve_rate must cover the worst case of client_discount_rate + the highest active
 * partner commission rate, or unused_channel_reserve could go negative for a real referral
 * order. Throws PRICING_CONFIG_INVALID rather than silently proceeding — a bad config must
 * never produce a quote with a negative internal reserve.
 */
export async function validateChannelReserveInvariant(version: PricingVersion): Promise<void> {
  const { data, error } = await db
    .from('partners')
    .select('commission_rate')
    .eq('is_active', true)
    .order('commission_rate', { ascending: false })
    .limit(1)
    .maybeSingle();

  const maxPartnerCommissionRate = !error && data ? Number((data as { commission_rate: string | number }).commission_rate) : version.partnerCommissionRate;

  const required = toDecimal(version.clientDiscountRate)
    .plus(toDecimal(maxPartnerCommissionRate).times(toDecimal(1).minus(version.clientDiscountRate)))
    .toNumber();

  if (version.channelReserveRate < required) {
    throw new Error(
      `PRICING_CONFIG_INVALID: channel_reserve_rate (${version.channelReserveRate}) < required (${required}) for pricing version '${version.code}' — client_discount_rate (${version.clientDiscountRate}) + max active partner commission (${maxPartnerCommissionRate}) is not covered. Fix pricing_versions.channel_reserve_rate before activating.`,
    );
  }
}

// ─── Notary urgency snapshot ────────────────────────────────────────────────

/** Immutable copy of a PricingResult's notary urgency data, for jobs.notary_urgency_*. */
export interface NotaryUrgencySnapshot {
  level: NotaryUrgencyLevel;
  /** 'standard' | 'before_noon' | 'after_noon' | 'after_18' */
  effectiveWindow: string;
  multiplier: number;
  cutoffAt: string | null;
  /** notary_urgency_fee line item amount, 0 when same_day resolved to multiplier 1.0 (no item pushed). */
  feeKzt: number;
}

/**
 * Derives the notary urgency snapshot to persist on jobs at order-creation time.
 * Returns null for non-notarized orders (result.context.notaryCutoff is only ever
 * set for serviceLevel === 'notarization_through_partners' — see calculator.ts).
 * Must be called with the SAME PricingResult already used to save the quote —
 * never recompute this later against current time.
 */
export function extractNotaryUrgencySnapshot(result: PricingResult): NotaryUrgencySnapshot | null {
  const cutoff = result.context.notaryCutoff;
  if (!cutoff) return null;

  const feeItem = result.items.find(item => item.itemType === 'notary_urgency_fee');

  return {
    level: cutoff.notaryUrgencyLevel,
    effectiveWindow: cutoff.effectiveWindow,
    multiplier: cutoff.multiplier,
    cutoffAt: cutoff.cutoffAt,
    feeKzt: feeItem?.amountKzt ?? 0,
  };
}

export async function computeQuoteForJob(
  input: PricingInput,
): Promise<{ result: PricingResult; version: PricingVersion } | { error: string }> {
  const version = await getActivePricingVersion();
  if (!version) return { error: 'PRICING_NOT_CONFIGURED' };

  let resolvedInput = input;
  if (input.serviceLevel !== 'electronic') {
    // 2026-07-22: Official/Notary gate. There is no separate legacy formula for these two
    // service levels left in this codebase (calculator.ts's dispatcher sends anything but
    // 'electronic' straight to calculateOfficialNotaryPrice) — so when the matching flag is
    // off, this refuses to quote at all rather than silently pricing against whatever version
    // happens to be active. See docs/ai-context/DECISIONS.md.
    const flags = getPricingFeatureFlags();
    const flagForServiceLevel =
      input.serviceLevel === 'official_with_translator_signature_and_provider_stamp'
        ? flags.enableNewOfficialPricing
        : input.serviceLevel === 'notarization_through_partners'
          ? flags.enableNewNotaryPricing
          : true; // any other future non-electronic service level is not yet gated by these two flags

    if (!flagForServiceLevel) return { error: 'SERVICE_LEVEL_PRICING_DISABLED' };

    // The flag being on is only meaningful against the corrected new-model version — never
    // silently price a gated service level against a version that doesn't carry the approved
    // 2026-07-21 rates (e.g. the MVP row's stale marketing/owner-reserve/mrp defaults).
    if (version.code !== NEW_MODEL_VERSION_CODE || version.metadata?.formula_version !== NEW_MODEL_FORMULA_VERSION) {
      return { error: 'PRICING_VERSION_MISMATCH' };
    }

    // Config-load-time invariant check — scoped to non-electronic quotes, the only ones that
    // use channel_reserve_rate/client_discount_rate/partner commissions. Throws rather than
    // silently proceeding with a config that could produce a negative internal reserve.
    await validateChannelReserveInvariant(version);

    const languageRate = await getLanguageRate(version.id, input.sourceLanguage, input.targetLanguage);
    resolvedInput = { ...input, languageRate: languageRate ?? undefined };
  }

  const result = calculatePrice(resolvedInput, version);
  return { result, version };
}

export async function saveQuote(
  input: PricingInput,
  result: PricingResult,
  version: PricingVersion,
  expiresInHours = 24,
  overrideExpiresAt?: string,
): Promise<{ quoteId: string } | { error: string }> {
  // Use override expiry for same-day notary cutoff windows; otherwise default 24h
  const expiresAt =
    overrideExpiresAt && overrideExpiresAt.length > 0
      ? overrideExpiresAt
      : new Date(Date.now() + expiresInHours * 60 * 60 * 1000).toISOString();

  const { data: quote, error: quoteError } = await db
    .from('price_quotes')
    .insert(buildPriceQuoteInsertRow(input, result, version, expiresAt))
    .select('id')
    .single();

  if (quoteError || !quote) {
    return { error: quoteError?.message ?? 'quote_insert_failed' };
  }

  const quoteId = (quote as { id: string }).id;
  const nm = result.newModel;

  // Insert line items
  if (result.items.length > 0) {
    await db.from('price_quote_items').insert(
      result.items.map(item => ({
        quote_id: quoteId,
        item_type: item.itemType,
        label: item.label,
        quantity: item.quantity,
        unit_price_kzt: item.unitPriceKzt ?? null,
        amount_kzt: item.amountKzt,
        is_client_visible: item.isClientVisible,
        is_cost: item.isCost,
        sort_order: item.sortOrder,
        metadata_json: item.metadataJson ?? {},
      })),
    );
  }

  // Create cost reservations
  const reservations: Array<{
    quote_id: string;
    job_id: string | null;
    cost_type: string;
    amount_kzt: number;
    status: string;
    notes: string;
  }> = [];

  const addReservation = (cost_type: string, amount_kzt: number, notes: string) => {
    if (amount_kzt > 0.01) {
      reservations.push({ quote_id: quoteId, job_id: input.jobId ?? null, cost_type, amount_kzt, status: 'reserved', notes });
    }
  };

  if (nm) {
    // New formula (2026-07-17) — EXACTLY these 12 cost_types. WPO's own coordination fee, its
    // urgency surcharge, and manual_adjustment_kzt are revenue/price changes, not costs, and
    // are deliberately NEVER reserved here — see docs/ai-context/DECISIONS.md.
    // External payouts:
    addReservation('translator_payout', nm.translatorPayoutKzt, 'Translator payout (30% of translation amount)');
    addReservation('notary_payout',     nm.notaryPayoutKzt,     'Notary official fee (MRP × applicant coefficient)');
    addReservation('courier_payout',    nm.courierPayoutKzt,    'Courier fee');
    addReservation('printing_cost',     nm.printingCostKzt,     'Printing/binding + extra paper copies');
    addReservation('acquiring_fee',     nm.acquiringFeeKzt,     'Halyk ePay acquiring fee reserve');
    addReservation('tax_reserve',       nm.taxReserveKzt,       'Tax reserve (KZ)');
    addReservation('partner_commission', nm.partnerCommissionKzt, 'Partner commission (referral)');
    // Internal reserves:
    addReservation('risk_reserve',            nm.riskReserveKzt,            'Risk/chargeback reserve');
    addReservation('marketing_reserve',       nm.marketingReserveKzt,       'Marketing/CAC reserve');
    addReservation('ai_it_reserve',           nm.aiItReserveKzt,            'AI/IT reserve');
    addReservation('owner_reserve',           nm.ownerReserveKzt,           'Owner reserve');
    addReservation('unused_channel_reserve',  nm.unusedChannelReserveKzt,   'Unused channel budget (retained internally for Direct; remainder after discount/commission for Referral)');
  } else if (result.internalCosts) {
    // Legacy formula (electronic; pre-2026-07-17 official/notary quotes) — unchanged.
    addReservation('ai_it_reserve',            result.internalCosts.aiItReserve,       'AI/IT processing cost reserve');
    addReservation('tax_reserve',              result.internalCosts.taxReserve,        'Tax reserve (KZ)');
    addReservation('acquiring_fee_estimate',   result.internalCosts.acquiringFee,      'Halyk ePay acquiring fee estimate');
    addReservation('risk_reserve',             result.internalCosts.riskReserve,       'Chargeback/risk reserve');
    addReservation('owner_reserve',            result.internalCosts.ownerReserve,      'Owner reserve');
    addReservation('marketing_reserve',        result.internalCosts.marketingReserve,  'Marketing/CAC reserve');
    addReservation('translator_reserved_cost', result.internalCosts.translatorReserved, 'Translator cost estimate (30% of translation)');
    if (result.internalCosts.partnerCommission > 0) {
      addReservation('partner_commission', result.internalCosts.partnerCommission, 'Partner commission');
    }
  }

  if (reservations.length > 0) {
    await db.from('cost_reservations').insert(reservations);
  }

  return { quoteId };
}

export async function markQuotePaymentPending(quoteId: string): Promise<void> {
  await db
    .from('price_quotes')
    .update({ status: 'payment_pending', updated_at: new Date().toISOString() })
    .eq('id', quoteId)
    .in('status', ['quoted', 'requires_operator_review', 'payment_pending']);
}

export async function markQuotePaid(quoteId: string, paymentTransactionId: string): Promise<void> {
  const now = new Date().toISOString();
  await db
    .from('price_quotes')
    .update({ status: 'paid', paid_at: now, price_locked_at: now, updated_at: now })
    .eq('id', quoteId)
    // Mirrors markQuotePaymentPending's guard — never re-run this against an already-paid
    // quote (a retried webhook/callback must not touch paid_at/price_locked_at a second time).
    .in('status', ['quoted', 'payment_pending', 'requires_operator_review']);

  await db
    .from('cost_reservations')
    .update({ status: 'committed', payment_transaction_id: paymentTransactionId, updated_at: now })
    .eq('quote_id', quoteId)
    .eq('status', 'reserved');
}

export async function verifyQuotePayable(
  quoteId: string,
  jobId: string,
  userId: string,
): Promise<{ ok: true; amountKzt: number; status: QuoteStatus } | { ok: false; error: string }> {
  const { data: quote, error } = await db
    .from('price_quotes')
    .select('id, job_id, user_id, status, amount_kzt, expires_at')
    .eq('id', quoteId)
    .maybeSingle();

  if (error || !quote) return { ok: false, error: 'QUOTE_NOT_FOUND' };

  const row = quote as PriceQuoteRow;
  if (row.user_id !== userId) return { ok: false, error: 'QUOTE_NOT_FOUND' };
  if (row.job_id !== jobId)   return { ok: false, error: 'QUOTE_JOB_MISMATCH' };

  const status = row.status as QuoteStatus;

  if (new Date(row.expires_at) < new Date() && !['paid', 'payment_pending'].includes(status)) {
    await db.from('price_quotes').update({ status: 'expired', updated_at: new Date().toISOString() }).eq('id', quoteId);
    return { ok: false, error: 'QUOTE_EXPIRED' };
  }
  if (status === 'expired')   return { ok: false, error: 'QUOTE_EXPIRED' };
  if (status === 'paid')      return { ok: false, error: 'QUOTE_ALREADY_PAID' };
  if (status === 'canceled')  return { ok: false, error: 'QUOTE_CANCELED' };
  if (!['quoted', 'payment_pending', 'requires_operator_review'].includes(status)) {
    return { ok: false, error: 'QUOTE_NOT_PAYABLE' };
  }
  if (Number(row.amount_kzt) <= 0) return { ok: false, error: 'QUOTE_AMOUNT_ZERO' };

  return { ok: true, amountKzt: Number(row.amount_kzt), status };
}
