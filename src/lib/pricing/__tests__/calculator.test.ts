/**
 * Tests for calculatePrice() — rewritten for the 2026-07-17 flat-formula rewrite.
 *
 * Two independent paths are tested:
 *   - Electronic: MUST remain byte-identical to before the rewrite (calculateElectronicPrice
 *     is untouched legacy code, only renamed) — a small regression suite proves the dispatcher
 *     still routes to it correctly and its old behaviors (document coefficient, urgency,
 *     margin floor) still work.
 *   - Official/notary: the new flat formula (T/O/N/C/P/W/M, gross-up, rounding, referral,
 *     reserves) — the bulk of this file, encoding the WPO-approved fixtures exactly.
 *
 * Decimal-precision edge cases (1.005, 2.675, etc.) are covered in money.test.ts — not
 * repeated here; this file focuses on formula wiring and fixture-level correctness.
 */
import * as almatyTime from '../almaty-time';
import { calculatePrice } from '../calculator';
import { BASE_MINIMUM_KZT } from '../config';
import type { PricingInput, PricingLanguageRate, PricingVersion } from '../types';

// ─── Fixtures ───────────────────────────────────────────────────────────────────

function mockElectronicVersion(overrides: Partial<PricingVersion> = {}): PricingVersion {
  return {
    id: 'v-electronic', code: 'electronic-legacy', status: 'active', currency: 'KZT',
    internalFxRate: null, mrpValue: 4.325,
    taxRate: 0.03, acquiringRate: 0.025, riskReserveRate: 0.05, ownerReserveRate: 0.07,
    marketingRateDirect: 0.10, partnerCommissionRate: 0.10, targetProfitRate: 0.25,
    aiItReservePerPageKzt: 100,
    validFrom: '2026-01-01', validTo: null, metadata: {},
    aiItRate: 0.10, channelReserveRate: 0.20, clientDiscountRate: 0.10, wpoCoordinationRate: 0.30,
    translatorPayoutRate: 0.30, ocrRatePerPhysicalPageKzt: 100, courierFeeKzt: 5000,
    printingFeeKzt: 0, extraPaperCopyFeeKzt: 0, roundingStepOfficialKzt: 100, roundingStepNotaryKzt: 500,
    publicElectronicPriceKzt: null, publicOfficialMinPriceKzt: null, publicNotaryMinPriceKzt: null,
    ...overrides,
  };
}

/** The WPO-approved new-model version — exact values per docs/ai-context/DECISIONS.md (2026-07-17). */
function mockNewModelVersion(overrides: Partial<PricingVersion> = {}): PricingVersion {
  return {
    id: 'v-newmodel', code: '2026-Q3-KZ-NEWMODEL', status: 'draft', currency: 'KZT',
    internalFxRate: null, mrpValue: 4.325,
    taxRate: 0.03, acquiringRate: 0.025, riskReserveRate: 0.05, ownerReserveRate: 0.00,
    marketingRateDirect: 0.05, partnerCommissionRate: 0.10, targetProfitRate: 0.25,
    aiItReservePerPageKzt: 100,
    validFrom: '2026-07-17', validTo: null, metadata: { formula_version: 'new_2026_07_21' },
    aiItRate: 0.10, channelReserveRate: 0.20, clientDiscountRate: 0.10, wpoCoordinationRate: 0.30,
    translatorPayoutRate: 0.30, ocrRatePerPhysicalPageKzt: 100, courierFeeKzt: 5000,
    printingFeeKzt: 0, extraPaperCopyFeeKzt: 0, roundingStepOfficialKzt: 100, roundingStepNotaryKzt: 500,
    publicElectronicPriceKzt: null, publicOfficialMinPriceKzt: null, publicNotaryMinPriceKzt: null,
    ...overrides,
  };
}

function mockLanguageRate(overrides: Partial<PricingLanguageRate> = {}): PricingLanguageRate {
  return {
    id: 'rate-ru-en', pricingVersionId: 'v-newmodel', sourceLanguage: 'ru', targetLanguage: 'en',
    rateKztPerTranslationPage: 3000, active: true, requiresOperatorReview: false,
    // ru is the anchor (no stored row) — en's base rate (3000) wins the max() by default.
    resolution: {
      sourceBaseRate: null,
      targetBaseRate: { language: 'en', rateId: 'rate-ru-en', rateKztPerTranslationPage: 3000, active: true, requiresOperatorReview: false },
      winningSide: 'target',
    },
    ...overrides,
  };
}

function baseOfficialInput(overrides: Partial<PricingInput> = {}): PricingInput {
  return {
    sourceLanguage: 'ru', targetLanguage: 'en',
    serviceLevel: 'official_with_translator_signature_and_provider_stamp',
    sourceCharacterCountWithSpaces: 1000, // <= 1800, bills exactly 1 page
    physicalPageCount: 1,
    languageRate: mockLanguageRate(),
    salesChannel: 'direct',
    ...overrides,
  };
}

function baseNotaryInput(overrides: Partial<PricingInput> = {}): PricingInput {
  return {
    ...baseOfficialInput(),
    serviceLevel: 'notarization_through_partners',
    applicantType: 'individual',
    notaryUrgencyLevel: 'standard',
    ...overrides,
  };
}

// ─── Electronic regression (must remain unaffected by the rewrite) ────────────────

describe('calculatePrice — electronic (unchanged legacy formula)', () => {
  it('applies document type coefficient (legacy behavior, still active for electronic)', () => {
    const input: PricingInput = {
      sourceLanguage: 'ru', targetLanguage: 'en', serviceLevel: 'electronic',
      documentType: 'contract', sourceWordCount: 500, physicalPageCount: 1,
    };
    const result = calculatePrice(input, mockElectronicVersion());
    expect(result.context.documentCoefficient).toBe(1.40); // contract coefficient, unchanged
    expect(result.internalCosts).toBeDefined();
    expect(result.margin).toBeDefined();
    expect(result.newModel).toBeUndefined();
  });

  it('still reads BASE_MINIMUM_KZT for electronic', () => {
    const input: PricingInput = { sourceLanguage: 'ru', targetLanguage: 'kk', serviceLevel: 'electronic' };
    const result = calculatePrice(input, mockElectronicVersion());
    expect(result.context.baseMinimumKzt).toBe(BASE_MINIMUM_KZT.ru_kz.electronic);
  });

  it('still applies the margin floor for electronic', () => {
    const input: PricingInput = { sourceLanguage: 'ru', targetLanguage: 'en', serviceLevel: 'electronic', sourceWordCount: 10 };
    const result = calculatePrice(input, mockElectronicVersion());
    expect(result.margin?.targetMarginFloorRate).toBe(0.50);
  });
});

// ─── New formula: WPO-approved fixtures ────────────────────────────────────────────

describe('calculatePrice — official/notary new formula: approved fixtures', () => {
  it('Fixture 1: Official RU→EN, 1 page, Direct → retail/actual payment 7400 ₸', () => {
    const result = calculatePrice(baseOfficialInput(), mockNewModelVersion());
    const nm = result.newModel!;
    expect(nm.translationAmountKzt).toBe(3000);
    expect(nm.ocrAmountKzt).toBe(100);
    expect(nm.notaryAmountKzt).toBe(0);
    expect(nm.courierAmountKzt).toBe(0);
    expect(nm.coordinationBaseAmountKzt).toBe(900);
    expect(nm.componentSubtotalKzt).toBe(4000);
    expect(nm.grossUpRate).toBeCloseTo(0.455, 10);
    expect(nm.standardRetailKzt).toBe(7400);
    expect(nm.urgencyMultiplier).toBe(1);
    expect(nm.urgencySurchargeKzt).toBe(0);
    expect(nm.retailKzt).toBe(7400);
    expect(nm.actualPaymentKzt).toBe(7400);
    expect(result.amountKzt).toBe(7400);
    // Full external/internal breakdown per the original worked example
    expect(nm.translatorPayoutKzt).toBe(900);
    expect(nm.taxReserveKzt).toBe(222);
    expect(nm.acquiringFeeKzt).toBe(185);
    expect(nm.riskReserveKzt).toBe(370);
    expect(nm.marketingReserveKzt).toBe(370);
    expect(nm.aiItReserveKzt).toBe(740);
    expect(nm.ownerReserveKzt).toBe(0);
    expect(nm.channelBudgetKzt).toBe(1480);
    expect(nm.unusedChannelReserveKzt).toBe(1480);
    expect(nm.totalAllocationsKzt).toBe(4267);
    expect(nm.netProfitWpoKzt).toBe(3133);
    expect(nm.reconciliationDifferenceKzt).toBe(0);
  });

  it('Fixture 2: Notary RU→EN, individual, no delivery, standard urgency, Direct → 13000 ₸', () => {
    const result = calculatePrice(baseNotaryInput(), mockNewModelVersion());
    const nm = result.newModel!;
    expect(nm.notaryAmountKzt).toBe(2292.25);
    expect(nm.courierAmountKzt).toBe(0);
    expect(nm.coordinationBaseAmountKzt).toBeCloseTo(1587.675, 3);
    expect(nm.urgencyMultiplier).toBe(1);
    expect(nm.urgencySurchargeKzt).toBe(0);
    expect(nm.componentSubtotalKzt).toBeCloseTo(6979.925, 2);
    expect(nm.standardRetailKzt).toBe(13000);
    expect(nm.retailKzt).toBe(13000);
    expect(nm.actualPaymentKzt).toBe(13000);
  });

  it('Fixture 3 (2026-07-21 revision): Notary RU→EN, individual, WITH delivery, after_noon (×1.5) — urgency now multiplies the WHOLE standard retail, not just WPO commission → 37500 ₸, courier = 5000 ₸', () => {
    // Superseded value: this fixture was previously asserted at 28000 ₸ under the OLD (buggy)
    // formula, where the urgency multiplier only touched the WPO coordination fee (W). Under
    // the corrected formula, the multiplier applies to the entire standard retail (25000 ₸
    // here, itself now correctly including the 5000 ₸ courier fee) — see
    // docs/ai-context/DECISIONS.md (2026-07-21) for the full before/after derivation.
    jest.spyOn(almatyTime, 'getNotaryCutoffWindow').mockReturnValue({
      window: 'after_noon', almatyHour: 14, almatyMinute: 0, multiplier: 1.5,
      quoteExpiresAt: '2026-07-17T13:00:00.000Z', windowLabel: 'same_day_after_noon',
      cutoffAt: '2026-07-17T13:00:00.000Z', pricingTimezone: 'Asia/Almaty',
    });
    const input = baseNotaryInput({
      notaryUrgencyLevel: 'same_day',
      fulfillmentMethod: 'delivery',
      deliveryRequired: true,
    });
    const result = calculatePrice(input, mockNewModelVersion());
    const nm = result.newModel!;
    expect(nm.courierAmountKzt).toBe(5000); // NOT 2500 — corrected value
    expect(nm.coordinationBaseAmountKzt).toBeCloseTo(3087.675, 2); // 30% × (T+N+C) = 30% × 10292.25 — courier IS in the base
    expect(nm.componentSubtotalKzt).toBeCloseTo(13479.925, 2); // T+O+N+C+P+W, no urgency folded in
    expect(nm.standardRetailKzt).toBe(25000); // the full standard order, courier included, urgency NOT yet applied
    expect(nm.urgencyMultiplier).toBe(1.5);
    expect(nm.urgencySurchargeKzt).toBe(12500); // 37500 - 25000 — the WHOLE-retail surcharge, not a W-only sliver
    expect(nm.retailKzt).toBe(37500); // 25000 × 1.5
    expect(nm.actualPaymentKzt).toBe(37500);
    // External payouts are never urgency-multiplied.
    expect(nm.translatorPayoutKzt).toBe(900); // 30% of T (3000), unaffected by urgency
    expect(nm.notaryPayoutKzt).toBe(2292.25); // the actual notary tariff, unaffected by urgency
    expect(nm.courierPayoutKzt).toBe(5000); // flat fee, unaffected by urgency
    expect(nm.reconciliationDifferenceKzt).toBe(0);
    jest.restoreAllMocks();
  });

  it('Fixture 4: Official Referral — 10% discount on retail, no re-rounding, partner commission from actualPayment', () => {
    const input = baseOfficialInput({ salesChannel: 'referral', partnerCommissionRateOverride: 0.10 });
    const result = calculatePrice(input, mockNewModelVersion());
    const nm = result.newModel!;
    expect(nm.retailKzt).toBe(7400);
    expect(nm.clientDiscountKzt).toBe(740);
    expect(nm.actualPaymentKzt).toBe(6660); // 7400 - 740, never re-rounded
    expect(nm.partnerCommissionKzt).toBe(666); // 6660 * 0.10
    expect(nm.channelBudgetKzt).toBe(1480); // 20% of RETAIL (rounded), unaffected by discount
    expect(nm.unusedChannelReserveKzt).toBe(74); // 1480 - 740 - 666
    expect(nm.taxReserveKzt).toBe(199.8); // 6660 * 0.03, against actualPayment
    expect(nm.acquiringFeeKzt).toBe(166.5); // 6660 * 0.025
  });
});

// ─── Corrected values (regressions against earlier draft mistakes) ────────────────

describe('calculatePrice — corrected values', () => {
  it('courier fee is 5000 ₸, never 2500 ₸', () => {
    const input = baseNotaryInput({ fulfillmentMethod: 'delivery', deliveryRequired: true });
    const result = calculatePrice(input, mockNewModelVersion());
    expect(result.newModel!.courierAmountKzt).toBe(5000);
  });

  it('marketing reserve is 5% of actual payment, never 10%', () => {
    const result = calculatePrice(baseOfficialInput(), mockNewModelVersion());
    expect(result.newModel!.marketingReserveKzt).toBe(370); // 7400 * 0.05, not 740
  });

  it('gross-up rate is exactly 45.5%', () => {
    const result = calculatePrice(baseOfficialInput(), mockNewModelVersion());
    expect(result.newModel!.grossUpRate).toBeCloseTo(0.455, 10);
  });

  it('channel budget uses the urgent retail price (retailKzt), never retailBeforeRounding or standardRetailKzt (do not use 1467.89/2561.44/5513.31/2600)', () => {
    const official = calculatePrice(baseOfficialInput(), mockNewModelVersion());
    expect(official.newModel!.channelBudgetKzt).toBe(1480);

    const notaryNoDelivery = calculatePrice(baseNotaryInput(), mockNewModelVersion());
    expect(notaryNoDelivery.newModel!.channelBudgetKzt).toBe(2600);

    jest.spyOn(almatyTime, 'getNotaryCutoffWindow').mockReturnValue({
      window: 'after_noon', almatyHour: 14, almatyMinute: 0, multiplier: 1.5,
      quoteExpiresAt: '', windowLabel: 'same_day_after_noon', cutoffAt: null, pricingTimezone: 'Asia/Almaty',
    });
    const notaryUrgentDelivery = calculatePrice(
      baseNotaryInput({ notaryUrgencyLevel: 'same_day', fulfillmentMethod: 'delivery', deliveryRequired: true }),
      mockNewModelVersion(),
    );
    // 2026-07-21 revision: retailKzt is now 37500 (25000 standard × 1.5 urgency), so
    // channelBudgetKzt = 37500 × 0.20 = 7500 — was 5600 under the old (buggy) formula, where
    // urgency barely touched retail at all.
    expect(notaryUrgentDelivery.newModel!.channelBudgetKzt).toBe(7500);
    jest.restoreAllMocks();
  });
});

// ─── Character-count precision (end-to-end wiring; edge-case rounding covered in money.test.ts) ──

describe('calculatePrice — character counting precision', () => {
  it('bills exactly 1 page for <=1800 characters', () => {
    const result = calculatePrice(baseOfficialInput({ sourceCharacterCountWithSpaces: 1799 }), mockNewModelVersion());
    expect(result.newModel!.translationAmountKzt).toBe(3000);
    expect(result.context.translationPageCountExact).toBe(1);
  });

  it('3366 characters at 3000 ₸/page → 1.87 pages, T = 5610 ₸ exactly', () => {
    const result = calculatePrice(baseOfficialInput({ sourceCharacterCountWithSpaces: 3366 }), mockNewModelVersion());
    expect(result.context.translationPageCountExact).toBeCloseTo(1.87, 2);
    expect(result.newModel!.translationAmountKzt).toBe(5610);
  });

  it('2001 characters at a 10,000 ₸/page rate → T = 11116.67 ₸ (rounding stress case)', () => {
    const input = baseOfficialInput({
      sourceCharacterCountWithSpaces: 2001,
      languageRate: mockLanguageRate({ rateKztPerTranslationPage: 10000 }),
    });
    const result = calculatePrice(input, mockNewModelVersion());
    expect(result.newModel!.translationAmountKzt).toBe(11116.67);
  });

  it('translation_page_count_exact is never fed back into T (T comes from the raw character count)', () => {
    const result = calculatePrice(
      baseOfficialInput({ sourceCharacterCountWithSpaces: 2001, languageRate: mockLanguageRate({ rateKztPerTranslationPage: 10000 }) }),
      mockNewModelVersion(),
    );
    // 1.112 (rounded page count) * 10000 = 11120 -- would be WRONG if T were derived this way
    expect(result.newModel!.translationAmountKzt).not.toBe(11120);
    expect(result.newModel!.translationAmountKzt).toBe(11116.67);
  });
});

// ─── operator_review triggers (no automatic surcharges/fallbacks) ─────────────────

describe('calculatePrice — operator_review triggers (new formula)', () => {
  it('routes to operator_review when no language rate is found (never fabricates a rate)', () => {
    const result = calculatePrice(baseOfficialInput({ languageRate: undefined }), mockNewModelVersion());
    expect(result.status).toBe('requires_operator_review');
    expect(result.requiresOperatorReview).toBe(true);
    expect(result.reviewReasons.some(r => r.includes('language rate'))).toBe(true);
  });

  it('routes to operator_review when no character count is available (never guesses)', () => {
    const result = calculatePrice(baseOfficialInput({ sourceCharacterCountWithSpaces: undefined }), mockNewModelVersion());
    expect(result.status).toBe('requires_operator_review');
    expect(result.reviewReasons.some(r => r.includes('character count'))).toBe(true);
  });

  it('routes presentation documents to operator_review — no auto pricing yet', () => {
    const result = calculatePrice(baseOfficialInput({ documentType: 'presentation' }), mockNewModelVersion());
    expect(result.status).toBe('requires_operator_review');
    expect(result.reviewReasons.some(r => r.includes('presentation'))).toBe(true);
  });

  it('routes non-normal scan quality to operator_review with NO automatic surcharge', () => {
    const result = calculatePrice(baseOfficialInput({ scanQuality: 'poor_scan' }), mockNewModelVersion());
    expect(result.status).toBe('requires_operator_review');
    expect(result.items.some(i => i.itemType === 'readability_surcharge')).toBe(false);
  });

  it('routes non-standard layout to operator_review with NO automatic fee', () => {
    const result = calculatePrice(baseOfficialInput({ layoutComplexity: 'complex_tables' }), mockNewModelVersion());
    expect(result.status).toBe('requires_operator_review');
    expect(result.items.some(i => i.itemType === 'layout_fee')).toBe(false);
  });

  it('does NOT apply an automatic visual marks surcharge', () => {
    const result = calculatePrice(baseOfficialInput({ visualMarksComplexity: 'many_stamps' }), mockNewModelVersion());
    expect(result.status).toBe('requires_operator_review'); // flagged, but...
    expect(result.items.some(i => i.itemType === 'visual_marks_fee')).toBe(false); // ...never priced automatically
  });
});

// ─── Manual adjustment ──────────────────────────────────────────────────────────────

describe('calculatePrice — manual adjustment (pre-quote only)', () => {
  it('folds a manual adjustment into the formula with a reason', () => {
    const result = calculatePrice(
      baseOfficialInput({ manualAdjustmentKzt: 500, manualAdjustmentReason: 'Client requested extra formatting' }),
      mockNewModelVersion(),
    );
    expect(result.newModel!.manualAdjustmentKzt).toBe(500);
    expect(result.newModel!.componentSubtotalKzt).toBe(4500); // 4000 + 500
    expect(result.status).toBe('quoted'); // reason provided, no review needed
  });

  it('requires a reason whenever a non-zero manual adjustment is present', () => {
    const result = calculatePrice(baseOfficialInput({ manualAdjustmentKzt: 500 }), mockNewModelVersion());
    expect(result.status).toBe('requires_operator_review');
    expect(result.reviewReasons.some(r => r.includes('reason'))).toBe(true);
  });
});

// ─── Legacy config never read by the new formula ───────────────────────────────────

describe('calculatePrice — legacy BASE_MINIMUM_KZT is never read by official/notary', () => {
  it('official price is unaffected by BASE_MINIMUM_KZT.ru_en_uz values', () => {
    const before = calculatePrice(baseOfficialInput(), mockNewModelVersion()).newModel!.retailKzt;
    const original = BASE_MINIMUM_KZT.ru_en_uz.official_with_translator_signature_and_provider_stamp;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (BASE_MINIMUM_KZT.ru_en_uz as any).official_with_translator_signature_and_provider_stamp = 999999;
    const after = calculatePrice(baseOfficialInput(), mockNewModelVersion()).newModel!.retailKzt;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (BASE_MINIMUM_KZT.ru_en_uz as any).official_with_translator_signature_and_provider_stamp = original;
    expect(after).toBe(before);
  });

  it('notary price is unaffected by BASE_MINIMUM_KZT.ru_en_uz notarization values', () => {
    const before = calculatePrice(baseNotaryInput(), mockNewModelVersion()).newModel!.retailKzt;
    const original = BASE_MINIMUM_KZT.ru_en_uz.notarization_through_partners;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (BASE_MINIMUM_KZT.ru_en_uz as any).notarization_through_partners = 999999;
    const after = calculatePrice(baseNotaryInput(), mockNewModelVersion()).newModel!.retailKzt;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (BASE_MINIMUM_KZT.ru_en_uz as any).notarization_through_partners = original;
    expect(after).toBe(before);
  });
});

// ─── Notary urgency — reused mechanism, scoped correctly ───────────────────────────

describe('calculatePrice — notary urgency (reused resolveNotaryUrgencySnapshot/getNotaryCutoffWindow)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('official orders always use multiplier 1, regardless of notaryUrgencyLevel input', () => {
    const result = calculatePrice(baseOfficialInput({ notaryUrgencyLevel: 'same_day' }), mockNewModelVersion());
    expect(result.newModel!.urgencyMultiplier).toBe(1);
    expect(result.newModel!.urgencySurchargeKzt).toBe(0);
  });

  it('same_day before 12:00 -> multiplier 1.0, 0 surcharge', () => {
    jest.spyOn(almatyTime, 'getNotaryCutoffWindow').mockReturnValue({
      window: 'before_noon', almatyHour: 8, almatyMinute: 0, multiplier: 1.0,
      quoteExpiresAt: '', windowLabel: 'same_day_before_noon', cutoffAt: '2026-07-17T07:00:00.000Z', pricingTimezone: 'Asia/Almaty',
    });
    const result = calculatePrice(baseNotaryInput({ notaryUrgencyLevel: 'same_day' }), mockNewModelVersion());
    expect(result.newModel!.urgencyMultiplier).toBe(1);
    expect(result.newModel!.urgencySurchargeKzt).toBe(0);
  });

  it('same_day after 18:00 -> multiplier 2.0', () => {
    jest.spyOn(almatyTime, 'getNotaryCutoffWindow').mockReturnValue({
      window: 'after_18', almatyHour: 20, almatyMinute: 0, multiplier: 2.0,
      quoteExpiresAt: '', windowLabel: 'same_day_after_18', cutoffAt: null, pricingTimezone: 'Asia/Almaty',
    });
    const result = calculatePrice(baseNotaryInput({ notaryUrgencyLevel: 'same_day' }), mockNewModelVersion());
    expect(result.newModel!.urgencyMultiplier).toBe(2);
    // 2026-07-21 revision: the surcharge is now on the WHOLE standard retail (13000, same as
    // Fixture 2 — no delivery here), not a sliver of the WPO commission — was 1587.675 (= W_base)
    // under the old (buggy) formula.
    expect(result.newModel!.standardRetailKzt).toBe(13000);
    expect(result.newModel!.urgencySurchargeKzt).toBe(13000); // 26000 - 13000
    expect(result.newModel!.retailKzt).toBe(26000);
  });
});

// ─── Reconciliation identity ────────────────────────────────────────────────────────

describe('calculatePrice — reconciliation identity holds across scenarios', () => {
  it('actualPayment === totalAllocations + netProfitWpo for a Direct official order', () => {
    const nm = calculatePrice(baseOfficialInput(), mockNewModelVersion()).newModel!;
    expect(nm.reconciliationDifferenceKzt).toBe(0);
  });

  it('actualPayment === totalAllocations + netProfitWpo for a Referral order', () => {
    const nm = calculatePrice(baseOfficialInput({ salesChannel: 'referral', partnerCommissionRateOverride: 0.05 }), mockNewModelVersion()).newModel!;
    expect(nm.reconciliationDifferenceKzt).toBe(0);
  });
});

// ─── 2026-07-21 formula rewrite — 20-scenario regression suite (spec section 6) ─────
// Each `it` below is numbered to match the user's enumerated regression list exactly, so a
// failing test maps directly back to the requirement it protects.

describe('2026-07-21 formula rewrite — regression suite', () => {
  it('#1: 671 chars + 2 physical pages -> billable = 2 (physical pages win), translation = 2 × rate', () => {
    const nm = calculatePrice(baseOfficialInput({ sourceCharacterCountWithSpaces: 671, physicalPageCount: 2 }), mockNewModelVersion()).newModel!;
    expect(nm.characterPages).toBeCloseTo(0.372777, 5);
    expect(nm.billableTranslationPages).toBe(2);
    expect(nm.translationPageBasis).toBe('physical_pages');
    expect(nm.translationAmountKzt).toBe(6000);
  });

  it('#2: 3366 chars + 1 physical page -> billable = 1.87 (characters win), translation = chars × rate / 1800', () => {
    const nm = calculatePrice(baseOfficialInput({ sourceCharacterCountWithSpaces: 3366, physicalPageCount: 1 }), mockNewModelVersion()).newModel!;
    expect(nm.characterPages).toBeCloseTo(1.87, 5);
    expect(nm.billableTranslationPages).toBeCloseTo(1.87, 5);
    expect(nm.translationPageBasis).toBe('character_count');
    expect(nm.translationAmountKzt).toBe(5610);
  });

  it('#3: dense document (few physical pages, many characters) -> uses characterPages', () => {
    const nm = calculatePrice(baseOfficialInput({ sourceCharacterCountWithSpaces: 5000, physicalPageCount: 1 }), mockNewModelVersion()).newModel!;
    expect(nm.characterPages).toBeCloseTo(2.777778, 5);
    expect(nm.translationPageBasis).toBe('character_count');
    expect(nm.billableTranslationPages).toBeCloseTo(2.777778, 5);
    expect(nm.translationAmountKzt).toBeCloseTo(8333.33, 2);
  });

  it('#4: sparse/table document (many physical pages, few characters) -> uses physical pages', () => {
    const nm = calculatePrice(baseOfficialInput({ sourceCharacterCountWithSpaces: 100, physicalPageCount: 5 }), mockNewModelVersion()).newModel!;
    expect(nm.characterPages).toBeCloseTo(0.055556, 5);
    expect(nm.translationPageBasis).toBe('physical_pages');
    expect(nm.billableTranslationPages).toBe(5);
    expect(nm.translationAmountKzt).toBe(15000);
  });

  // #5 (PNG physical pages = 1) and #6 (PDF uses actual physical pages) are analysis-layer
  // concerns, not calculator concerns — covered in src/lib/document-analysis/__tests__/analyze.test.ts.

  it('#7: no reliable physical page count (DOCX render failure) -> falls back to characterPages, never invents a physical count', () => {
    const nm = calculatePrice(baseOfficialInput({ sourceCharacterCountWithSpaces: 4000, physicalPageCount: undefined }), mockNewModelVersion()).newModel!;
    expect(nm.physicalPageCount).toBeNull();
    expect(nm.translationPageBasis).toBe('character_count');
    expect(nm.characterPages).toBeCloseTo(2.222222, 5);
    expect(nm.translationAmountKzt).toBeCloseTo(6666.67, 2);
  });

  // #8 (manual physical-page override for DOCX) is a CLI-layer concern (params-resolver +
  // pricing-run wiring) — covered in tools/pricing-cli/__tests__/manual-physical-pages.test.ts.

  it('#9: deliveryRequired=true -> courier = 5000', () => {
    const nm = calculatePrice(baseNotaryInput({ fulfillmentMethod: 'delivery', deliveryRequired: true }), mockNewModelVersion()).newModel!;
    expect(nm.courierAmountKzt).toBe(5000);
  });

  it('#10: deliveryRequired=false -> courier = 0', () => {
    const nm = calculatePrice(baseNotaryInput({ fulfillmentMethod: 'pickup', deliveryRequired: false }), mockNewModelVersion()).newModel!;
    expect(nm.courierAmountKzt).toBe(0);
  });

  it('#11: contradictory deliveryRequired/fulfillmentMethod -> throws PRICING_CONFIG_INVALID, never silently picks one', () => {
    expect(() =>
      calculatePrice(baseNotaryInput({ fulfillmentMethod: 'pickup', deliveryRequired: true }), mockNewModelVersion()),
    ).toThrow(/PRICING_CONFIG_INVALID/);
    expect(() =>
      calculatePrice(baseNotaryInput({ fulfillmentMethod: 'delivery', deliveryRequired: false }), mockNewModelVersion()),
    ).toThrow(/PRICING_CONFIG_INVALID/);
  });

  it('#12: courier is included in the WPO coordination base (W = (T+N+C) × rate)', () => {
    const withDelivery = calculatePrice(baseNotaryInput({ fulfillmentMethod: 'delivery', deliveryRequired: true }), mockNewModelVersion()).newModel!;
    const withoutDelivery = calculatePrice(baseNotaryInput({ fulfillmentMethod: 'pickup', deliveryRequired: false }), mockNewModelVersion()).newModel!;
    expect(withDelivery.coordinationBaseAmountKzt).toBeGreaterThan(withoutDelivery.coordinationBaseAmountKzt);
    expect(withDelivery.coordinationBaseAmountKzt).toBeCloseTo(3087.675, 2);
  });

  it('#13: after_noon (×1.5) multiplies the WHOLE standard retail, not just WPO commission', () => {
    jest.spyOn(almatyTime, 'getNotaryCutoffWindow').mockReturnValue({
      window: 'after_noon', almatyHour: 14, almatyMinute: 0, multiplier: 1.5,
      quoteExpiresAt: '', windowLabel: 'same_day_after_noon', cutoffAt: null, pricingTimezone: 'Asia/Almaty',
    });
    const nm = calculatePrice(baseNotaryInput({ notaryUrgencyLevel: 'same_day', fulfillmentMethod: 'delivery', deliveryRequired: true }), mockNewModelVersion()).newModel!;
    expect(nm.standardRetailKzt).toBe(25000);
    expect(nm.urgencyMultiplier).toBe(1.5);
    expect(nm.retailKzt).toBe(37500);
    jest.restoreAllMocks();
  });

  it('#14: after_18 (×2) multiplies the WHOLE standard retail', () => {
    jest.spyOn(almatyTime, 'getNotaryCutoffWindow').mockReturnValue({
      window: 'after_18', almatyHour: 20, almatyMinute: 0, multiplier: 2.0,
      quoteExpiresAt: '', windowLabel: 'same_day_after_18', cutoffAt: null, pricingTimezone: 'Asia/Almaty',
    });
    const nm = calculatePrice(baseNotaryInput({ notaryUrgencyLevel: 'same_day', fulfillmentMethod: 'delivery', deliveryRequired: true }), mockNewModelVersion()).newModel!;
    expect(nm.standardRetailKzt).toBe(25000);
    expect(nm.urgencyMultiplier).toBe(2);
    expect(nm.retailKzt).toBe(50000);
    jest.restoreAllMocks();
  });

  it('#15: translator/notary/courier payouts are never multiplied by urgency', () => {
    jest.spyOn(almatyTime, 'getNotaryCutoffWindow').mockReturnValue({
      window: 'after_18', almatyHour: 20, almatyMinute: 0, multiplier: 2.0,
      quoteExpiresAt: '', windowLabel: 'same_day_after_18', cutoffAt: null, pricingTimezone: 'Asia/Almaty',
    });
    const urgent = calculatePrice(baseNotaryInput({ notaryUrgencyLevel: 'same_day', fulfillmentMethod: 'delivery', deliveryRequired: true }), mockNewModelVersion()).newModel!;
    const standard = calculatePrice(baseNotaryInput({ fulfillmentMethod: 'delivery', deliveryRequired: true }), mockNewModelVersion()).newModel!;
    expect(urgent.translatorPayoutKzt).toBe(standard.translatorPayoutKzt);
    expect(urgent.notaryPayoutKzt).toBe(standard.notaryPayoutKzt);
    expect(urgent.courierPayoutKzt).toBe(standard.courierPayoutKzt);
    expect(urgent.courierPayoutKzt).toBe(5000);
    jest.restoreAllMocks();
  });

  it('#16: referral discount is computed from the URGENT retail (post-urgency), not the standard retail', () => {
    jest.spyOn(almatyTime, 'getNotaryCutoffWindow').mockReturnValue({
      window: 'after_noon', almatyHour: 14, almatyMinute: 0, multiplier: 1.5,
      quoteExpiresAt: '', windowLabel: 'same_day_after_noon', cutoffAt: null, pricingTimezone: 'Asia/Almaty',
    });
    const nm = calculatePrice(
      baseNotaryInput({
        notaryUrgencyLevel: 'same_day', fulfillmentMethod: 'delivery', deliveryRequired: true,
        salesChannel: 'referral', partnerCommissionRateOverride: 0.10,
      }),
      mockNewModelVersion(),
    ).newModel!;
    expect(nm.retailKzt).toBe(37500);
    expect(nm.clientDiscountKzt).toBe(3750); // 37500 × 0.10, NOT 25000 × 0.10
    expect(nm.actualPaymentKzt).toBe(33750);
    jest.restoreAllMocks();
  });

  it('#17: partner commission is computed from the actual payment (post-urgency, post-discount)', () => {
    jest.spyOn(almatyTime, 'getNotaryCutoffWindow').mockReturnValue({
      window: 'after_noon', almatyHour: 14, almatyMinute: 0, multiplier: 1.5,
      quoteExpiresAt: '', windowLabel: 'same_day_after_noon', cutoffAt: null, pricingTimezone: 'Asia/Almaty',
    });
    const nm = calculatePrice(
      baseNotaryInput({
        notaryUrgencyLevel: 'same_day', fulfillmentMethod: 'delivery', deliveryRequired: true,
        salesChannel: 'referral', partnerCommissionRateOverride: 0.10,
      }),
      mockNewModelVersion(),
    ).newModel!;
    expect(nm.partnerCommissionKzt).toBe(3375); // 33750 × 0.10
    jest.restoreAllMocks();
  });

  it('#18: reconciliationDifferenceKzt is 0 for every revised-fixture scenario (delivery + urgency + referral combined)', () => {
    jest.spyOn(almatyTime, 'getNotaryCutoffWindow').mockReturnValue({
      window: 'after_18', almatyHour: 20, almatyMinute: 0, multiplier: 2.0,
      quoteExpiresAt: '', windowLabel: 'same_day_after_18', cutoffAt: null, pricingTimezone: 'Asia/Almaty',
    });
    const nm = calculatePrice(
      baseNotaryInput({
        notaryUrgencyLevel: 'same_day', fulfillmentMethod: 'delivery', deliveryRequired: true,
        salesChannel: 'referral', partnerCommissionRateOverride: 0.10,
      }),
      mockNewModelVersion(),
    ).newModel!;
    expect(nm.reconciliationDifferenceKzt).toBe(0);
    jest.restoreAllMocks();
  });

  // #19 (CLI report shows all new fields/formulas) is a CLI-layer concern — covered in
  // tools/pricing-cli/__tests__/russian-report-and-summary.test.ts.

  it('#20: existing Electronic pricing is untouched by the rewrite — dispatcher still bypasses newModel entirely', () => {
    const input: PricingInput = {
      sourceLanguage: 'ru', targetLanguage: 'en', serviceLevel: 'electronic',
      documentType: 'contract', sourceWordCount: 500, physicalPageCount: 1,
    };
    const result = calculatePrice(input, mockElectronicVersion());
    expect(result.newModel).toBeUndefined();
    expect(result.context.documentCoefficient).toBe(1.40);
    expect(result.amountKzt).toBeGreaterThan(0);
  });
});
