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
  aiItReservePerPageKzt: number;
  validFrom: string;
  validTo: string | null;
  metadata: Record<string, unknown>;
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
  physicalPageCount?: number;
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

export interface PricingResult {
  amountKzt: number;
  currency: 'KZT';
  status: QuoteStatus;
  items: QuoteLineItem[];
  pricingVersionId: string;
  pricingVersionCode: string;
  internalCosts: InternalCostBreakdown;
  margin: MarginBreakdown;
  requiresOperatorReview: boolean;
  reviewReasons: string[];
  context: {
    languagePair: string;
    baseMinimumKzt: number;
    extraWords: number;
    additionalPages: number;
    documentCoefficient: number;
    urgencyCoefficient: number;
    includedWordCount: number;
    includedPageCount: number;
    notaryCutoff?: NotaryCutoffSnapshot;
  };
}
