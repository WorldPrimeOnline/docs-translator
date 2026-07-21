export type ServiceLevel =
  | 'electronic'
  | 'official_with_translator_signature_and_provider_stamp'
  | 'notarization_through_partners';

export type UrgencyLevel = 'standard' | 'within_24h' | 'six_to_twelve_hours' | 'two_to_four_hours' | 'night_or_weekend';

export type ScanQuality = 'normal' | 'poor_scan' | 'handwritten';

export type LayoutComplexity = 'standard' | 'tables' | 'complex_tables' | 'complex_layout';

export type VisualMarksComplexity = 'normal' | 'many_stamps';

export type ApplicantType = 'individual' | 'legal_entity' | 'unknown';

export type DeliveryZone = 'almaty_standard' | 'remote_area' | 'other_city' | 'urgent_delivery';

export type NotaryUrgencyLevel = 'standard' | 'same_day';

export type SalesChannel = 'direct' | 'referral' | 'reseller';

export type QuoteStatus =
  | 'draft'
  | 'quoted'
  | 'expired'
  | 'payment_pending'
  | 'paid'
  | 'canceled'
  | 'refunded'
  | 'requires_operator_review';

export interface PricingVersion {
  id: string;
  code: string;
  status: 'draft' | 'active' | 'archived';
  currency: string;
  internalFxRate: number | null;
  mrpValue: number | null;
  taxRate: number;
  acquiringRate: number;
  riskReserveRate: number;
  ownerReserveRate: number;
  marketingRateDirect: number;
  partnerCommissionRate: number;
  targetProfitRate: number;
  /** Legacy per-page internal cost reserve — electronic/pre-rewrite formula only. Distinct from the new formula's ocrRatePerPhysicalPageKzt/aiItRate — never conflate the two (see migration 0049). */
  aiItReservePerPageKzt: number;
  validFrom: string;
  validTo: string | null;
  metadata: Record<string, unknown>;

  // ─── New formula fields (2026-07-17 rewrite, migration 0049) — official/notary only ────
  /** Gross-up %: ai_it_reserve = actual_payment * aiItRate. NOT the same as aiItReservePerPageKzt. */
  aiItRate: number;
  channelReserveRate: number;
  clientDiscountRate: number;
  wpoCoordinationRate: number;
  /** Added in migration 0056 (gap found during calculator rewrite — was missing from 0049). translator_payout = T * translatorPayoutRate. */
  translatorPayoutRate: number;
  /** Customer-facing O component rate — distinct from aiItReservePerPageKzt even though both are 100 KZT/page today. */
  ocrRatePerPhysicalPageKzt: number;
  courierFeeKzt: number;
  printingFeeKzt: number;
  extraPaperCopyFeeKzt: number;
  roundingStepOfficialKzt: number;
  roundingStepNotaryKzt: number;
  /** Persisted public "from" price snapshot — null until scripts/staging/populate-public-pricing-snapshot.ts has run. Never computed at request time. */
  publicElectronicPriceKzt: number | null;
  publicOfficialMinPriceKzt: number | null;
  publicNotaryMinPriceKzt: number | null;
}

/**
 * One contributing side of a resolved language pair (2026-07-26 symmetric pair resolution) —
 * the actual pricing_language_rates row for a single non-Russian language's base rate.
 */
export interface LanguagePairBaseRate {
  language: string;
  rateId: string;
  rateKztPerTranslationPage: number;
  active: boolean;
  requiresOperatorReview: boolean;
}

/**
 * Records which two base rates produced a resolved pair rate (2026-07-26 decision):
 * pricing_language_rates rows are RU->X base rates, not directional pairs — a pair's rate is
 * max(base(source), base(target)), so both contributing sides must be snapshotted for audit,
 * not just the winning one. null on a side means that side IS the Russian anchor language
 * (no stored row — the anchor contributes 0 to the max, never "missing").
 */
export interface LanguagePairResolution {
  sourceBaseRate: LanguagePairBaseRate | null;
  targetBaseRate: LanguagePairBaseRate | null;
  winningSide: 'source' | 'target';
}

/**
 * A pricing_language_rates-derived rate, resolved for one source->target pair at quote time.
 * Since 2026-07-26 this is a SYMMETRIC resolution built from up to two RU->X base rate rows
 * (see getLanguageRate in service.ts) — `id` is the winning contributor's row id (kept so
 * price_quotes.language_rate_id's FK to pricing_language_rates stays valid), and `resolution`
 * carries the full audit trail of both contributing sides.
 */
export interface PricingLanguageRate {
  id: string;
  pricingVersionId: string;
  sourceLanguage: string;
  targetLanguage: string;
  rateKztPerTranslationPage: number;
  active: boolean;
  requiresOperatorReview: boolean;
  resolution: LanguagePairResolution;
}

export interface QuoteLineItem {
  itemType: string;
  label: string;
  quantity: number;
  unitPriceKzt: number | null;
  amountKzt: number;
  isClientVisible: boolean;
  isCost: boolean;
  sortOrder: number;
  metadataJson?: Record<string, unknown>;
}

export interface PricingInput {
  documentId?: string;
  jobId?: string;
  userId?: string;
  sourceLanguage: string;
  targetLanguage: string;
  serviceLevel: ServiceLevel;
  documentType?: string;
  sourceWordCount?: number;
  /** null/undefined means "no reliable physical page count" — billing falls back to characterPages. */
  physicalPageCount?: number | null;
  complexity?: 'simple' | 'complex';
  urgencyLevel?: UrgencyLevel;
  scanQuality?: ScanQuality;
  layoutComplexity?: LayoutComplexity;
  visualMarksComplexity?: VisualMarksComplexity;
  applicantType?: ApplicantType;
  deliveryZone?: DeliveryZone;
  extraPaperCopies?: number;
  fulfillmentMethod?: 'pickup' | 'delivery';
  deliveryRequired?: boolean;
  salesChannel?: SalesChannel;
  partnerId?: string;
  notaryUrgencyLevel?: NotaryUrgencyLevel;

  // ─── New formula fields (2026-07-17 rewrite) — official/notary only ───────────────────
  /** Normalized (via normalizeSourceTextForPricing) character count with spaces, from a completed document_analysis revision. Required for official/notary quote creation — never guessed. */
  sourceCharacterCountWithSpaces?: number;
  /** The specific document_analysis.id this quote is based on. */
  analysisId?: string;
  /** The specific pricing_language_rates row resolved for sourceLanguage->targetLanguage. Resolved by the caller (service.ts), never looked up inside calculatePrice — keeps the function DB-free/pure. */
  languageRate?: PricingLanguageRate;
  /** Pre-quote-only manual price adjustment (M term), with mandatory reason when non-zero. */
  manualAdjustmentKzt?: number;
  manualAdjustmentReason?: string;
  /**
   * Resolved referral commission rate for THIS specific partner (partners.commission_rate,
   * 5% or 10%), snapshotted at quote time. Falls back to pricing_versions.partnerCommissionRate
   * only when no partner record exists. Resolved by the caller — calculatePrice never queries
   * the partners table itself.
   */
  partnerCommissionRateOverride?: number;
  /**
   * ISO timestamp used instead of the real current time when resolving the notary same_day
   * cutoff window (getNotaryCutoffWindow). Absent in every real customer-facing call site —
   * production quote creation always uses the real current time. Exists so tooling (the
   * internal Pricing Lab) can exercise before_noon/after_noon/after_18 deterministically
   * without mocking a module in a running server. Never persisted onto a real price_quotes row.
   */
  nowOverride?: string;
}

export interface NotaryCutoffSnapshot {
  notaryUrgencyLevel: NotaryUrgencyLevel;
  effectiveWindow: string;    // 'before_noon' | 'after_noon' | 'after_18' | 'standard'
  multiplier: number;
  quoteExpiresAt: string;     // ISO — cutoff-aware expiry for same_day, '' for standard
  cutoffAt: string | null;    // ISO of the window boundary (12:00 or 18:00 Almaty)
  pricingTimezone: 'Asia/Almaty';
  windowLabel: string;
}

export interface InternalCostBreakdown {
  taxReserve: number;
  acquiringFee: number;
  riskReserve: number;
  ownerReserve: number;
  marketingReserve: number;
  partnerCommission: number;
  aiItReserve: number;
  translatorReserved: number;
  /** notary_official_cost — the actual notary tariff, payable to the notary (pass-through). */
  notaryFee: number;
  /**
   * The REAL internal cost of coordinating with the notary — currently 0 (not configured).
   * NOT the notary_coordination_fee charged to the client (that's WPO commercial revenue,
   * see MarginBreakdown.notaryCoordinationRevenueKzt) — do not conflate the two.
   */
  notaryCoordinationInternalCostKzt: number;
  courierCost: number;
  printingCost: number;
}

/**
 * Margin is reported at THREE layers, because the 50% floor applies only to the WPO
 * service/translation layer — never to notary/courier/printing pass-throughs, and never to
 * payment-wide fees (tax/acquiring/risk/partner commission), which apply to the whole final
 * price but must not cause the notary official fee to be treated as WPO-marginable revenue.
 *
 * 1. WPO service layer (`*MarginFloor*`, `wpoService*`) — floor-protected, this is what the
 *    50% target actually governs.
 * 2. Notary/delivery add-ons (`notaryDeliveryAddonsKzt`) — pure pass-through, added after the
 *    floor, never grossed up.
 * 3. Whole order / blended (`grossRevenue`, `totalCosts`, `estimatedMargin*`) — the final
 *    client-facing numbers; for notarized orders this blended rate is expected to be well
 *    below 50%, by design, since notary/courier/printing dilute it.
 */
export interface MarginBreakdown {
  // ─── Whole-order (blended) view ──────────────────────────────────────────────
  /** Final client price (WPO layer + notary/delivery add-ons + payment-wide fee gross-up). */
  grossRevenue: number;
  /** Sum of ALL costs: WPO layer costs + notary/courier/printing pass-through + payment-wide fees. */
  totalCosts: number;
  /** Target profit *benchmark* (subtotal × targetProfitRate) — informational only, never a cost. */
  targetProfit: number;
  /** grossRevenue - totalCosts. NOT guaranteed >= 50% for notarized orders — that's by design. */
  estimatedMarginKzt: number;
  /** estimatedMarginKzt / grossRevenue (blended, whole-order rate). */
  estimatedMarginRate: number;

  // ─── WPO marginable revenue pool — the 50% floor applies HERE ONLY ───────────
  // The pool = translation/service layer price + notary_coordination_fee (both WPO-controlled
  // revenue). notary_official_fee/printing/delivery are NEVER part of this pool.
  /** Translation/service layer's raw price before its own floor step (normal rounding only; does NOT include notary_coordination_fee). */
  rawPriceBeforeMarginFloor: number;
  /** WPO marginable pool's margin rate at (rawPriceBeforeMarginFloor + notary_coordination_fee), before any floor adjustment. */
  estimatedMarginRateBeforeFloor: number;
  /** margin_floor_adjustment amount added to the translation layer's price (0 if the pool was already >= target — common when notary_coordination_fee alone covers it). */
  marginFloorAdjustmentKzt: number;
  /** The margin floor target rate for this order's service level (e.g. 0.50). */
  targetMarginFloorRate: number;
  /** Translation/service layer's OWN final price after the floor step (rawPriceBeforeMarginFloor + marginFloorAdjustmentKzt) — excludes notary_coordination_fee. */
  wpoServiceLayerFinalPrice: number;
  /** WPO marginable revenue pool = wpoServiceLayerFinalPrice + notary_coordination_fee (0 for non-notarized orders, so identical to wpoServiceLayerFinalPrice there). */
  wpoMarginableRevenueKzt: number;
  /** WPO marginable pool's costs (translator + AI/IT + notary_coordination_internal_cost + owner reserve + marketing/CAC — owner/marketing sized against wpoMarginableRevenueKzt). */
  wpoServiceLayerCosts: number;
  /** wpoMarginableRevenueKzt - wpoServiceLayerCosts. */
  wpoServiceMarginKzt: number;
  /** wpoServiceMarginKzt / wpoMarginableRevenueKzt — guaranteed >= targetMarginFloorRate whenever the floor is enabled. */
  wpoServiceMarginRate: number;
  /** How far the WPO marginable pool's margin exceeds its floor target, in KZT (>= 0 whenever the floor holds). */
  profitBufferAboveTargetKzt: number;
  /** How far the WPO marginable pool's margin exceeds its floor target, as a rate (>= 0 whenever the floor holds). */
  profitBufferAboveTargetRate: number;

  // ─── Notary/delivery add-ons — pass-through, never grossed by the floor ──────
  /** notary_official_fee + notary_coordination_fee + printing_binding_fee + delivery_fee (+ notary urgency surcharge + extra paper copies). */
  notaryDeliveryAddonsKzt: number;
  /**
   * notary_coordination_fee is WPO commercial revenue, NOT a pass-through like
   * notary_official_fee — it improves WPO's margin. Reported separately here (before
   * payment-wide fees) so it isn't hidden inside the pass-through add-ons total above.
   */
  notaryCoordinationRevenueKzt: number;
  /** notaryCoordinationRevenueKzt - internalCosts.notaryCoordinationInternalCostKzt, before payment-wide fees. */
  notaryCoordinationMarginKzt: number;

  // ─── Payment-wide fees — applied to the WHOLE final client price ────────────
  /** Combined rate: tax + acquiring + risk + (referral) partner commission. */
  paymentWideFeeRate: number;
  /** tax_reserve + acquiring_fee_estimate + risk_chargeback_reserve + partner_commission_cost, computed against the final client price. */
  paymentWideFeesKzt: number;
  /** Gross-up + final-rounding residual added on top of (WPO layer + notary add-ons) to cover payment-wide fees. */
  paymentWideFeeAdjustmentKzt: number;
}

/** Which candidate won max(1, reliablePhysicalPageCount, characterPages) — see calculator.ts's calculateOfficialNotaryPrice. */
export type TranslationPageBasis = 'minimum_one_page' | 'physical_pages' | 'character_count';

/**
 * Full snapshot of the 2026-07-21 flat formula (official/notary only; supersedes the 2026-07-17
 * version's billable-pages/delivery/urgency semantics — see docs/finance/PRICING_ENGINE.md and
 * docs/ai-context/DECISIONS.md for the full rationale). Field names match the WPO-approved
 * report vocabulary 1:1 (see the Russian financial report renderer) so the report and quote
 * snapshot never need a separate translation layer between them.
 *
 * Terminology note: netProfitWpoKzt is deliberately NOT called "net profit" / "чистая прибыль"
 * anywhere user-facing — it is margin BEFORE the business's own fixed costs (Jira, Vercel,
 * Railway, salaries, accounting) are deducted. The Russian report labels it
 * «Маржинальная прибыль заказа до постоянных расходов».
 */
export interface NewModelBreakdown {
  // ─── Billable translation pages (2026-07-21) ───────────────────────────────────
  /** Reliable physical page count used for pricing, or null when unavailable (e.g. DOCX with
   * no manualPhysicalPageCountOverride) — never fabricated by rendering/guessing. */
  physicalPageCount: number | null;
  /** charactersWithSpaces / 1800 — full precision, never rounded or floored. */
  characterPages: number;
  /** max(1, physicalPageCount, characterPages) — the actual billable page count used for T. */
  billableTranslationPages: number;
  /** Which of the three candidates won the max() above. */
  translationPageBasis: TranslationPageBasis;

  // ─── Components (pre-gross-up) ────────────────────────────────────────────────
  translationAmountKzt: number;        // T
  ocrAmountKzt: number;                // O
  notaryAmountKzt: number;             // N
  courierAmountKzt: number;            // C
  printingAmountKzt: number;           // P
  /** WPO coordination fee (30% × (T+N+C), OCR excluded per the approved model). Never
   * urgency-multiplied as of 2026-07-21 — urgency now multiplies the whole standard retail
   * instead (see urgencyMultiplier/urgencySurchargeKzt/retailKzt below), never just this fee. */
  coordinationBaseAmountKzt: number;   // W
  manualAdjustmentKzt: number;         // M
  componentSubtotalKzt: number;

  // ─── Gross-up / rounding (standard order, BEFORE urgency) ──────────────────────
  grossUpRate: number;
  grossUpAmountKzt: number;
  retailBeforeRoundingKzt: number;
  roundingStepKzt: number;
  roundingAdjustmentKzt: number;
  /** Full standard-order retail (T+O+N+C+P+W+M, grossed up, rounded to step) — BEFORE any
   * urgency multiplier. This is what the order would cost with no urgency at all. */
  standardRetailKzt: number;

  // ─── Urgency (2026-07-21: multiplies the ENTIRE standard retail) ───────────────
  /** 1 for standard/before_noon or official; 1.5 for after_noon; 2 for after_18 (notary only). */
  urgencyMultiplier: number;
  /** retailKzt - standardRetailKzt — the whole-order surcharge for urgency. NOT part of
   * coordinationBaseAmountKzt/W, and NOT applied to any external payout. */
  urgencySurchargeKzt: number;
  /** standardRetailKzt × urgencyMultiplier — the actual client-facing retail price. */
  retailKzt: number;

  // ─── Referral / channel (computed from retailKzt, i.e. AFTER urgency) ──────────
  salesChannel: SalesChannel;
  clientDiscountKzt: number;
  actualPaymentKzt: number;
  partnerCommissionRate: number;
  channelBudgetKzt: number;
  unusedChannelReserveKzt: number;

  // ─── External payouts — NEVER urgency-multiplied (translator/notary/courier get the same
  // payout regardless of how urgent the client's order was) ──────────────────────
  // (cost_reservations: translator_payout, notary_payout, courier_payout, printing_cost, acquiring_fee, tax_reserve, partner_commission)
  translatorPayoutKzt: number;
  notaryPayoutKzt: number;
  courierPayoutKzt: number;
  printingCostKzt: number;
  acquiringFeeKzt: number;
  taxReserveKzt: number;
  partnerCommissionKzt: number;

  // ─── Internal reserves (cost_reservations: risk_reserve, marketing_reserve, ai_it_reserve, owner_reserve, unused_channel_reserve) ──
  riskReserveKzt: number;
  marketingReserveKzt: number;
  aiItReserveKzt: number;
  ownerReserveKzt: number;

  // ─── Result ──────────────────────────────────────────────────────────────────
  totalAllocationsKzt: number;
  /** Margin BEFORE fixed business costs. Never labeled "net profit"/"чистая прибыль" user-facing. */
  netProfitWpoKzt: number;
  netMargin: number;
  totalInternalReservesKzt: number;
  totalCashRetainedByWpoKzt: number;
  reconciliationDifferenceKzt: number;

  // ─── Snapshot references ────────────────────────────────────────────────────────
  languageRateId: string | null;
  ratePerTranslationPageKzt: number;
  /** null only when languageRateId is also null (no language rate resolved at all). */
  languagePairResolution: LanguagePairResolution | null;
}

export interface PricingResult {
  amountKzt: number;
  currency: 'KZT';
  status: QuoteStatus;
  items: QuoteLineItem[];
  pricingVersionId: string;
  pricingVersionCode: string;
  /** Present for the legacy formula (electronic; and pre-2026-07-17 official/notary quotes). Absent for new-model official/notary quotes — see newModel. */
  internalCosts?: InternalCostBreakdown;
  /** Present for the legacy formula. Absent for new-model official/notary quotes — see newModel. */
  margin?: MarginBreakdown;
  /** Present ONLY for official/notary quotes computed by the new (2026-07-17) flat formula. */
  newModel?: NewModelBreakdown;
  requiresOperatorReview: boolean;
  reviewReasons: string[];
  context: {
    languagePair: string;
    /** Legacy-formula-only (electronic). Undefined for new-model official/notary quotes. */
    baseMinimumKzt?: number;
    extraWords?: number;
    additionalPages?: number;
    documentCoefficient?: number;
    urgencyCoefficient?: number;
    includedWordCount?: number;
    includedPageCount?: number;
    notaryCutoff?: NotaryCutoffSnapshot;
    /** New-model only: exact translation page count (chars/1800, min 1) — reporting/snapshot value, never fed back into T. */
    translationPageCountExact?: number;
    /** New-model only: normalized character count used to derive T. */
    sourceCharacterCountWithSpaces?: number;
  };
}
