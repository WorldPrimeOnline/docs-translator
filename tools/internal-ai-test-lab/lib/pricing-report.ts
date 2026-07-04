/**
 * Pure transformation of the real pricing engine's output
 * (src/lib/pricing/{calculator,service,types}.ts) into report-ready sections.
 *
 * This module NEVER calls saveQuote / markQuotePaid / verifyQuotePayable and
 * never writes to price_quotes, cost_reservations, or payment_transactions —
 * it only shapes data that was already computed by computeQuoteForJob().
 *
 * Design note on "do not hide zero-value rows": the production calculator
 * already emits zero-amount line items (included_words, included_pages,
 * urgency_fee at standard rate, notary fees when not notarized, etc.) with
 * metadataJson explaining why. This module renders every item verbatim and
 * only synthesizes a fallback explanation when the calculator didn't attach one.
 */

// Minimal local mirrors of src/lib/pricing/types.ts shapes (kept structural —
// this file is intentionally decoupled from a live import so it stays unit
// testable without pulling in @/lib/supabase/server).
export interface PricingItemLike {
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

export interface InternalCostBreakdownLike {
  taxReserve: number;
  acquiringFee: number;
  riskReserve: number;
  ownerReserve: number;
  marketingReserve: number;
  partnerCommission: number;
  aiItReserve: number;
  translatorReserved: number;
  /** notary_official_cost — actual notary tariff, payable to the notary (pass-through). */
  notaryFee: number;
  /** Real internal cost of notary coordination — 0 for now, NOT the 5000 KZT client fee. */
  notaryCoordinationInternalCostKzt: number;
  courierCost: number;
  printingCost: number;
}

export interface MarginBreakdownLike {
  // Whole-order (blended) view
  grossRevenue: number;
  totalCosts: number;
  targetProfit: number;
  estimatedMarginKzt: number;
  estimatedMarginRate: number;
  // WPO service/translation layer — the 50% floor applies HERE ONLY
  rawPriceBeforeMarginFloor: number;
  estimatedMarginRateBeforeFloor: number;
  marginFloorAdjustmentKzt: number;
  targetMarginFloorRate: number;
  wpoServiceLayerFinalPrice: number;
  // WPO marginable revenue pool = wpoServiceLayerFinalPrice + notaryCoordinationRevenueKzt.
  // The 50% floor is checked against THIS pool, not the translation layer alone.
  wpoMarginableRevenueKzt: number;
  wpoServiceLayerCosts: number;
  wpoServiceMarginKzt: number;
  wpoServiceMarginRate: number;
  profitBufferAboveTargetKzt: number;
  profitBufferAboveTargetRate: number;
  // Notary/delivery add-ons — pass-through, never grossed by the floor
  notaryDeliveryAddonsKzt: number;
  // notary_coordination_fee is WPO commercial revenue, not a pass-through — improves margin.
  notaryCoordinationRevenueKzt: number;
  notaryCoordinationMarginKzt: number;
  // Payment-wide fees — applied to the whole final client price
  paymentWideFeeRate: number;
  paymentWideFeesKzt: number;
  paymentWideFeeAdjustmentKzt: number;
}

export interface PricingResultLike {
  amountKzt: number;
  currency: string;
  status: string;
  items: PricingItemLike[];
  pricingVersionId: string;
  pricingVersionCode: string;
  internalCosts: InternalCostBreakdownLike;
  margin: MarginBreakdownLike;
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
    notaryCutoff?: unknown;
  };
}

export interface PriceComponentRow {
  itemType: string;
  label: string;
  quantity: number;
  unitPriceKzt: number | null;
  amountKzt: number;
  visibleToClient: boolean;
  metadata: Record<string, unknown>;
}

export interface InternalCostRow {
  costType: string;
  label: string;
  amountKzt: number;
  metadata: Record<string, unknown>;
}

export interface MarginSection {
  // Whole-order (blended) view
  grossRevenueKzt: number;
  totalInternalCostsKzt: number;
  targetProfitKzt: number;
  estimatedMarginKzt: number;
  estimatedMarginPercent: number;
  // WPO service/translation layer — the 50% floor applies HERE ONLY, never to notary/delivery
  /** WPO layer's raw price before its own floor step (normal rounding only). */
  rawPriceBeforeMarginFloorKzt: number;
  /** margin_floor_adjustment amount added to the WPO layer's price (0 if already at/above target). */
  marginFloorAdjustmentKzt: number;
  /** WPO layer's margin % at rawPriceBeforeMarginFloorKzt, before any floor adjustment. */
  estimatedMarginPercentBeforeFloor: number;
  /** The margin floor target for this order's service level (e.g. 50). */
  targetMarginFloorPercent: number;
  /** WPO layer's final price after its floor step (translation/service layer revenue alone). */
  wpoServiceLayerFinalPriceKzt: number;
  /** WPO marginable revenue pool = wpoServiceLayerFinalPriceKzt + notaryCoordinationRevenueKzt — the 50% floor is checked against this. */
  wpoMarginableRevenueKzt: number;
  /** WPO marginable pool's costs (translator + AI/IT + notary_coordination_internal_cost + owner + marketing, sized against the pool). */
  wpoServiceLayerCostsKzt: number;
  /** WPO layer's margin in KZT. */
  wpoServiceMarginKzt: number;
  /** WPO layer's margin % — guaranteed >= targetMarginFloorPercent when the floor is enabled. */
  wpoServiceMarginPercent: number;
  /** How far the WPO layer's margin exceeds its floor target, in KZT. */
  profitBufferAboveTargetKzt: number;
  /** How far the WPO layer's margin exceeds its floor target, in percentage points. */
  profitBufferAboveTargetPercent: number;
  // Notary/delivery add-ons — pass-through, never grossed by the floor
  notaryDeliveryAddonsKzt: number;
  // notary_coordination_fee is WPO commercial revenue, not a pass-through — improves margin.
  notaryCoordinationRevenueKzt: number;
  notaryCoordinationMarginKzt: number;
  // Payment-wide fees — applied to the whole final client price
  paymentWideFeePercent: number;
  paymentWideFeesKzt: number;
  paymentWideFeeAdjustmentKzt: number;
}

export interface ReconciliationResult {
  /** Sum of isClientVisible items only — before the calculator's rounding step. */
  rawSubtotalKzt: number;
  /** amountKzt of the `rounding_adjustment` item, or 0 if none was found. */
  roundingAdjustmentKzt: number;
  /** Whether a `rounding_adjustment` item was present in result.items at all. */
  roundingAdjustmentFound: boolean;
  /** amountKzt of the `margin_floor_adjustment` item, or 0 if none was found. */
  marginFloorAdjustmentKzt: number;
  /** Whether a `margin_floor_adjustment` item was present in result.items at all. */
  marginFloorAdjustmentFound: boolean;
  /** amountKzt of the `payment_wide_fee_adjustment` item, or 0 if none was found. */
  paymentWideFeeAdjustmentKzt: number;
  /** Whether a `payment_wide_fee_adjustment` item was present in result.items at all. */
  paymentWideFeeAdjustmentFound: boolean;
  /** rawSubtotalKzt + roundingAdjustmentKzt + marginFloorAdjustmentKzt + paymentWideFeeAdjustmentKzt. */
  canonicalSubtotalKzt: number;
  finalAmountKzt: number;
  /** finalAmountKzt - canonicalSubtotalKzt. Must be ~0 for status OK. */
  differenceKzt: number;
  status: 'OK' | 'WARNING';
  /** Human-readable explanation for every check that failed; empty when status is OK. */
  reasons: string[];
}

const ZERO_ROW_TOLERANCE = 0.01;

/**
 * Financial-audit precision tolerance for reconciliation equality checks —
 * NOT a rounding allowance. src/lib/pricing/calculator.ts rounds the raw
 * subtotal UP to the nearest 100 KZT and records that exact delta as its own
 * `rounding_adjustment` line item (isClientVisible: false, isCost: false).
 * Reconciliation must verify that delta against the item explicitly, never
 * wave it through with a blanket "<100 KZT is fine" band — see
 * buildReconciliation() below.
 */
const RECONCILIATION_EPSILON_KZT = 0.0001;

function fallbackMetadata(item: PricingItemLike): Record<string, unknown> {
  if (item.metadataJson && Object.keys(item.metadataJson).length > 0) {
    return item.metadataJson;
  }
  if (Math.abs(item.amountKzt) < ZERO_ROW_TOLERANCE) {
    return { included_in_minimum: true, reason: 'Included in minimum check' };
  }
  return {};
}

/**
 * Table 6 — "Client / Revenue Price Components". Includes every non-cost item
 * the calculator produced, zero-amount rows included, so the report proves
 * each pricing component was checked (and either charged or included/n-a).
 */
export function buildClientPriceComponents(result: PricingResultLike): PriceComponentRow[] {
  return result.items
    .filter((i) => !i.isCost)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((item) => ({
      itemType: item.itemType,
      label: item.label,
      quantity: item.quantity,
      unitPriceKzt: item.unitPriceKzt,
      amountKzt: item.amountKzt,
      visibleToClient: item.isClientVisible,
      metadata: fallbackMetadata(item),
    }));
}

const INTERNAL_COST_LABELS: Record<keyof InternalCostBreakdownLike, string> = {
  taxReserve: 'Tax reserve',
  acquiringFee: 'Acquiring fee estimate (Halyk ePay)',
  riskReserve: 'Risk / chargeback reserve',
  ownerReserve: 'Owner reserve',
  marketingReserve: 'Marketing / CAC reserve',
  partnerCommission: 'Partner commission fee',
  aiItReserve: 'AI / IT processing reserve',
  translatorReserved: 'Translator cost reserve',
  notaryFee: 'Notary official cost (payable to notary)',
  notaryCoordinationInternalCostKzt: 'Notary coordination internal cost (not the WPO fee)',
  courierCost: 'Courier / delivery cost',
  printingCost: 'Printing / binding cost',
};

/**
 * Table 7 — "Internal Cost / Reserve Allocation". Built from the fixed-shape
 * InternalCostBreakdown, so every field is always present — zero-amount
 * reserves (e.g. notary/courier/printing on a non-notarized electronic order)
 * are never silently dropped.
 */
export function buildInternalCostRows(result: PricingResultLike): InternalCostRow[] {
  return (Object.keys(INTERNAL_COST_LABELS) as Array<keyof InternalCostBreakdownLike>).map((key) => {
    const amountKzt = result.internalCosts[key];
    const applicable = Math.abs(amountKzt) >= ZERO_ROW_TOLERANCE;
    return {
      costType: key,
      label: INTERNAL_COST_LABELS[key],
      amountKzt,
      metadata: applicable
        ? { applicable: true }
        : { applicable: false, reason: 'Not applicable / zero for this order configuration' },
    };
  });
}

export function buildMarginSection(result: PricingResultLike): MarginSection {
  return {
    grossRevenueKzt: result.margin.grossRevenue,
    totalInternalCostsKzt: result.margin.totalCosts,
    targetProfitKzt: result.margin.targetProfit,
    estimatedMarginKzt: result.margin.estimatedMarginKzt,
    estimatedMarginPercent: result.margin.estimatedMarginRate * 100,
    rawPriceBeforeMarginFloorKzt: result.margin.rawPriceBeforeMarginFloor,
    marginFloorAdjustmentKzt: result.margin.marginFloorAdjustmentKzt,
    estimatedMarginPercentBeforeFloor: result.margin.estimatedMarginRateBeforeFloor * 100,
    targetMarginFloorPercent: result.margin.targetMarginFloorRate * 100,
    wpoServiceLayerFinalPriceKzt: result.margin.wpoServiceLayerFinalPrice,
    wpoMarginableRevenueKzt: result.margin.wpoMarginableRevenueKzt,
    wpoServiceLayerCostsKzt: result.margin.wpoServiceLayerCosts,
    wpoServiceMarginKzt: result.margin.wpoServiceMarginKzt,
    wpoServiceMarginPercent: result.margin.wpoServiceMarginRate * 100,
    profitBufferAboveTargetKzt: result.margin.profitBufferAboveTargetKzt,
    profitBufferAboveTargetPercent: result.margin.profitBufferAboveTargetRate * 100,
    notaryDeliveryAddonsKzt: result.margin.notaryDeliveryAddonsKzt,
    notaryCoordinationRevenueKzt: result.margin.notaryCoordinationRevenueKzt,
    notaryCoordinationMarginKzt: result.margin.notaryCoordinationMarginKzt,
    paymentWideFeePercent: result.margin.paymentWideFeeRate * 100,
    paymentWideFeesKzt: result.margin.paymentWideFeesKzt,
    paymentWideFeeAdjustmentKzt: result.margin.paymentWideFeeAdjustmentKzt,
  };
}

/**
 * Reconciliation rules (financial audit — no tolerance band for "small" gaps):
 *   1. rawSubtotalKzt   = sum of isClientVisible items (pre-rounding, pre-floor).
 *   2. roundingItem, marginFloorItem, paymentWideFeeItem = result.items.find(itemType === ...).
 *   3. canonicalSubtotalKzt = rawSubtotalKzt + rounding_adjustment + margin_floor_adjustment
 *      + payment_wide_fee_adjustment. All three are isClientVisible=false (never shown to the
 *      client) but ARE part of the final price — internal-only price-shaping steps.
 *   4. OK only if canonicalSubtotalKzt == finalAmountKzt (within
 *      RECONCILIATION_EPSILON_KZT) — checked explicitly, not inferred.
 *   5. No blanket "<100 KZT is fine" allowance — every gap must be explained by an actual
 *      adjustment item, exactly.
 *   6. No adjustment item present + finalAmountKzt != rawSubtotalKzt -> WARNING.
 *   7. rounding_adjustment present alone but its amount != (final - raw) -> WARNING.
 */
export function buildReconciliation(result: PricingResultLike): ReconciliationResult {
  const rawSubtotalKzt = result.items
    .filter((i) => i.isClientVisible)
    .reduce((sum, i) => sum + i.amountKzt, 0);

  const roundingItem = result.items.find((i) => i.itemType === 'rounding_adjustment');
  const roundingAdjustmentFound = roundingItem !== undefined;
  const roundingAdjustmentKzt = roundingItem?.amountKzt ?? 0;

  const marginFloorItem = result.items.find((i) => i.itemType === 'margin_floor_adjustment');
  const marginFloorAdjustmentFound = marginFloorItem !== undefined;
  const marginFloorAdjustmentKzt = marginFloorItem?.amountKzt ?? 0;

  const paymentWideFeeItem = result.items.find((i) => i.itemType === 'payment_wide_fee_adjustment');
  const paymentWideFeeAdjustmentFound = paymentWideFeeItem !== undefined;
  const paymentWideFeeAdjustmentKzt = paymentWideFeeItem?.amountKzt ?? 0;

  const canonicalSubtotalKzt = rawSubtotalKzt + roundingAdjustmentKzt + marginFloorAdjustmentKzt + paymentWideFeeAdjustmentKzt;
  const finalAmountKzt = result.amountKzt;
  const differenceKzt = Number((finalAmountKzt - canonicalSubtotalKzt).toFixed(4));
  const impliedAdjustmentKzt = Number((finalAmountKzt - rawSubtotalKzt).toFixed(4));

  const anyAdjustmentFound = roundingAdjustmentFound || marginFloorAdjustmentFound || paymentWideFeeAdjustmentFound;
  const reasons: string[] = [];

  if (!anyAdjustmentFound && Math.abs(impliedAdjustmentKzt) > RECONCILIATION_EPSILON_KZT) {
    reasons.push(
      `Final amount (${finalAmountKzt} KZT) differs from raw subtotal (${rawSubtotalKzt} KZT) by ${impliedAdjustmentKzt} KZT, but no rounding_adjustment, margin_floor_adjustment, or payment_wide_fee_adjustment item was found to explain it.`,
    );
  }

  if (roundingAdjustmentFound && !marginFloorAdjustmentFound && !paymentWideFeeAdjustmentFound && Math.abs(roundingAdjustmentKzt - impliedAdjustmentKzt) > RECONCILIATION_EPSILON_KZT) {
    reasons.push(
      `rounding_adjustment item declares ${roundingAdjustmentKzt} KZT, but (final amount − raw subtotal) is ${impliedAdjustmentKzt} KZT — they must match exactly (no other adjustment item present to explain the rest).`,
    );
  }

  if (Math.abs(differenceKzt) > RECONCILIATION_EPSILON_KZT) {
    reasons.push(
      `Canonical subtotal (raw ${rawSubtotalKzt} + rounding_adjustment ${roundingAdjustmentKzt} + margin_floor_adjustment ${marginFloorAdjustmentKzt} + payment_wide_fee_adjustment ${paymentWideFeeAdjustmentKzt} = ${canonicalSubtotalKzt} KZT) does not equal final amount (${finalAmountKzt} KZT); difference ${differenceKzt} KZT.`,
    );
  }

  return {
    rawSubtotalKzt,
    roundingAdjustmentKzt,
    roundingAdjustmentFound,
    marginFloorAdjustmentKzt,
    marginFloorAdjustmentFound,
    paymentWideFeeAdjustmentKzt,
    paymentWideFeeAdjustmentFound,
    canonicalSubtotalKzt,
    finalAmountKzt,
    differenceKzt,
    status: reasons.length === 0 ? 'OK' : 'WARNING',
    reasons,
  };
}
