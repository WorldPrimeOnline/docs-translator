import {
  buildClientPriceComponents,
  buildInternalCostRows,
  buildMarginSection,
  buildReconciliation,
  type PricingResultLike,
} from '../lib/pricing-report';

function makeResult(overrides: Partial<PricingResultLike> = {}): PricingResultLike {
  return {
    amountKzt: 5000,
    currency: 'KZT',
    status: 'quoted',
    pricingVersionId: 'v1',
    pricingVersionCode: 'v2026.1',
    requiresOperatorReview: false,
    reviewReasons: [],
    context: {
      languagePair: 'ru-en',
      baseMinimumKzt: 5000,
      extraWords: 0,
      additionalPages: 0,
      documentCoefficient: 1,
      urgencyCoefficient: 1,
      includedWordCount: 250,
      includedPageCount: 1,
    },
    items: [
      {
        itemType: 'minimum_check',
        label: 'Base minimum (ru_en, electronic)',
        quantity: 1,
        unitPriceKzt: 5000,
        amountKzt: 5000,
        isClientVisible: true,
        isCost: false,
        sortOrder: 0,
        metadataJson: { languageGroup: 'ru_en', baseMinimum: 5000 },
      },
      {
        itemType: 'included_words',
        label: 'Included words (up to 250)',
        quantity: 250,
        unitPriceKzt: 0,
        amountKzt: 0,
        isClientVisible: true,
        isCost: false,
        sortOrder: 1,
        metadataJson: { included_word_count: 250, included_in_minimum: true },
      },
      {
        itemType: 'urgency_fee',
        label: 'Urgency (standard, standard)',
        quantity: 1,
        unitPriceKzt: 0,
        amountKzt: 0,
        isClientVisible: false,
        isCost: false,
        sortOrder: 2,
        // no metadataJson — exercises the fallback path
      },
      {
        itemType: 'ai_it_reserve',
        label: 'AI/IT reserve',
        quantity: 1,
        unitPriceKzt: 100,
        amountKzt: 100,
        isClientVisible: false,
        isCost: true,
        sortOrder: 3,
      },
    ],
    internalCosts: {
      taxReserve: 150,
      acquiringFee: 125,
      riskReserve: 0,
      ownerReserve: 350,
      marketingReserve: 0,
      partnerCommission: 0,
      aiItReserve: 100,
      translatorReserved: 1500,
      notaryFee: 0,
      notaryCoordFee: 0,
      courierCost: 0,
      printingCost: 0,
    },
    margin: {
      grossRevenue: 5000,
      totalCosts: 2225,
      targetProfit: 500,
      estimatedMarginKzt: 2275,
      estimatedMarginRate: 0.455,
      rawPriceBeforeMarginFloor: 5000,
      estimatedMarginRateBeforeFloor: 0.455,
      marginFloorAdjustmentKzt: 0,
      targetMarginFloorRate: 0.50,
      profitBufferAboveTargetKzt: -225,
      profitBufferAboveTargetRate: -0.045,
    },
    ...overrides,
  };
}

describe('buildClientPriceComponents', () => {
  it('includes zero-amount rows, not just non-zero ones', () => {
    const rows = buildClientPriceComponents(makeResult());
    const zeroRows = rows.filter((r) => r.amountKzt === 0);
    expect(zeroRows.length).toBeGreaterThan(0);
    expect(rows.some((r) => r.itemType === 'included_words' && r.amountKzt === 0)).toBe(true);
  });

  it('excludes isCost items (those belong to the internal cost table)', () => {
    const rows = buildClientPriceComponents(makeResult());
    expect(rows.some((r) => r.itemType === 'ai_it_reserve')).toBe(false);
  });

  it('preserves calculator-provided metadata verbatim', () => {
    const rows = buildClientPriceComponents(makeResult());
    const includedWords = rows.find((r) => r.itemType === 'included_words')!;
    expect(includedWords.metadata).toEqual({ included_word_count: 250, included_in_minimum: true });
  });

  it('synthesizes fallback metadata for zero-amount items with no metadataJson', () => {
    const rows = buildClientPriceComponents(makeResult());
    const urgency = rows.find((r) => r.itemType === 'urgency_fee')!;
    expect(urgency.metadata).toEqual({ included_in_minimum: true, reason: 'Included in minimum check' });
    expect(urgency.visibleToClient).toBe(false);
  });

  it('sorts by sortOrder', () => {
    const rows = buildClientPriceComponents(makeResult());
    const sortOrders = rows.map((_, i) => i);
    expect(sortOrders).toEqual([...sortOrders].sort((a, b) => a - b));
  });
});

describe('buildInternalCostRows', () => {
  it('always returns all 12 fixed cost types, including zero ones', () => {
    const rows = buildInternalCostRows(makeResult());
    expect(rows).toHaveLength(12);
    const notary = rows.find((r) => r.costType === 'notaryFee')!;
    expect(notary.amountKzt).toBe(0);
    expect(notary.metadata).toEqual({ applicable: false, reason: 'Not applicable / zero for this order configuration' });
  });

  it('marks non-zero costs as applicable', () => {
    const rows = buildInternalCostRows(makeResult());
    const tax = rows.find((r) => r.costType === 'taxReserve')!;
    expect(tax.amountKzt).toBe(150);
    expect(tax.metadata).toEqual({ applicable: true });
  });
});

describe('buildMarginSection', () => {
  it('maps margin fields and converts rate to percent', () => {
    const margin = buildMarginSection(makeResult());
    expect(margin.grossRevenueKzt).toBe(5000);
    expect(margin.estimatedMarginKzt).toBe(2275);
    expect(margin.estimatedMarginPercent).toBeCloseTo(45.5);
  });

  it('exposes raw price, margin floor adjustment, target margin %, and profit buffer', () => {
    const margin = buildMarginSection(makeResult({
      margin: {
        grossRevenue: 7800,
        totalCosts: 3895,
        targetProfit: 1375,
        estimatedMarginKzt: 3905,
        estimatedMarginRate: 0.5006,
        rawPriceBeforeMarginFloor: 5500,
        estimatedMarginRateBeforeFloor: 0.4068,
        marginFloorAdjustmentKzt: 2300,
        targetMarginFloorRate: 0.50,
        profitBufferAboveTargetKzt: 3.9,
        profitBufferAboveTargetRate: 0.0006,
      },
    }));
    expect(margin.rawPriceBeforeMarginFloorKzt).toBe(5500);
    expect(margin.marginFloorAdjustmentKzt).toBe(2300);
    expect(margin.estimatedMarginPercentBeforeFloor).toBeCloseTo(40.68);
    expect(margin.targetMarginFloorPercent).toBe(50);
    expect(margin.profitBufferAboveTargetKzt).toBeCloseTo(3.9);
    expect(margin.profitBufferAboveTargetPercent).toBeCloseTo(0.06);
  });
});

/** Injects a `rounding_adjustment` item (isClientVisible: false, isCost: false) into the base fixture. */
function withRoundingItem(amountKzt: number): Partial<PricingResultLike> {
  return {
    items: [
      ...makeResult().items,
      {
        itemType: 'rounding_adjustment',
        label: 'Rounding adjustment',
        quantity: 1,
        unitPriceKzt: amountKzt,
        amountKzt,
        isClientVisible: false,
        isCost: false,
        sortOrder: 99,
      },
    ],
  };
}

describe('buildReconciliation', () => {
  // Real staging run, 2026-07-02: bank-statement OCR/translation exercised the
  // production calculator end-to-end. raw subtotal 11047.2, rounding_adjustment
  // item 52.8, final amount 11100 — exact match required, not a tolerance band.
  it('1. exact match with rounding_adjustment => OK (real-run numbers: raw 11047.2 + rounding 52.8 = final 11100)', () => {
    const base = makeResult();
    const items = base.items.map((i) =>
      i.itemType === 'minimum_check' ? { ...i, amountKzt: 11047.2, unitPriceKzt: 11047.2 } : i,
    );
    items.push({
      itemType: 'rounding_adjustment',
      label: 'Rounding adjustment',
      quantity: 1,
      unitPriceKzt: 52.8,
      amountKzt: 52.8,
      isClientVisible: false,
      isCost: false,
      sortOrder: 99,
    });
    const result = { ...base, items, amountKzt: 11100 };
    const recon = buildReconciliation(result);
    expect(recon.rawSubtotalKzt).toBeCloseTo(11047.2);
    expect(recon.roundingAdjustmentFound).toBe(true);
    expect(recon.roundingAdjustmentKzt).toBe(52.8);
    expect(recon.canonicalSubtotalKzt).toBeCloseTo(11100);
    expect(recon.finalAmountKzt).toBe(11100);
    expect(recon.differenceKzt).toBeCloseTo(0);
    expect(recon.status).toBe('OK');
    expect(recon.reasons).toEqual([]);
  });

  it('2. difference below 100 but no rounding_adjustment item => WARNING (no blanket "<100 is fine" allowance)', () => {
    const recon = buildReconciliation(makeResult({ amountKzt: 5052.8 }));
    expect(recon.rawSubtotalKzt).toBe(5000);
    expect(recon.roundingAdjustmentFound).toBe(false);
    expect(recon.roundingAdjustmentKzt).toBe(0);
    expect(recon.canonicalSubtotalKzt).toBe(5000);
    expect(recon.status).toBe('WARNING');
    expect(recon.reasons.length).toBeGreaterThan(0);
  });

  it('3. rounding_adjustment exists but its amount does not match (final - raw) => WARNING', () => {
    const recon = buildReconciliation(makeResult({ ...withRoundingItem(50), amountKzt: 5052.8 }));
    expect(recon.rawSubtotalKzt).toBe(5000);
    expect(recon.roundingAdjustmentFound).toBe(true);
    expect(recon.roundingAdjustmentKzt).toBe(50);
    expect(recon.status).toBe('WARNING');
    expect(recon.reasons.some((r) => r.includes('rounding_adjustment item declares'))).toBe(true);
  });

  it('4. canonical subtotal (raw + rounding_adjustment) differs from final amount => WARNING', () => {
    const recon = buildReconciliation(makeResult({ ...withRoundingItem(52.8), amountKzt: 5060 }));
    expect(recon.rawSubtotalKzt).toBe(5000);
    expect(recon.roundingAdjustmentKzt).toBe(52.8);
    expect(recon.canonicalSubtotalKzt).toBe(5052.8);
    expect(recon.finalAmountKzt).toBe(5060);
    expect(recon.status).toBe('WARNING');
    expect(recon.reasons.some((r) => r.includes('Canonical subtotal'))).toBe(true);
  });

  it('5. no rounding needed, exact subtotal == final => OK', () => {
    const recon = buildReconciliation(makeResult());
    expect(recon.rawSubtotalKzt).toBe(5000);
    expect(recon.roundingAdjustmentFound).toBe(false);
    expect(recon.canonicalSubtotalKzt).toBe(5000);
    expect(recon.finalAmountKzt).toBe(5000);
    expect(recon.differenceKzt).toBe(0);
    expect(recon.status).toBe('OK');
    expect(recon.reasons).toEqual([]);
  });

  /** Injects a `margin_floor_adjustment` item (isClientVisible: false, isCost: false). */
  function withMarginFloorItem(amountKzt: number): Partial<PricingResultLike> {
    return {
      items: [
        ...makeResult().items,
        {
          itemType: 'margin_floor_adjustment',
          label: 'Margin floor adjustment',
          quantity: 1,
          unitPriceKzt: amountKzt,
          amountKzt,
          isClientVisible: false,
          isCost: false,
          sortOrder: 100,
        },
      ],
    };
  }

  it('6. margin_floor_adjustment present alone (no rounding) => OK when it exactly explains the gap', () => {
    const recon = buildReconciliation(makeResult({ ...withMarginFloorItem(2300), amountKzt: 7300 }));
    expect(recon.rawSubtotalKzt).toBe(5000);
    expect(recon.marginFloorAdjustmentFound).toBe(true);
    expect(recon.marginFloorAdjustmentKzt).toBe(2300);
    expect(recon.canonicalSubtotalKzt).toBe(7300);
    expect(recon.finalAmountKzt).toBe(7300);
    expect(recon.differenceKzt).toBe(0);
    expect(recon.status).toBe('OK');
    expect(recon.reasons).toEqual([]);
  });

  it('7. rounding_adjustment AND margin_floor_adjustment both present, correct sum => OK', () => {
    const base = makeResult();
    const items = [
      ...base.items,
      { itemType: 'rounding_adjustment', label: 'Rounding adjustment', quantity: 1, unitPriceKzt: 52.8, amountKzt: 52.8, isClientVisible: false, isCost: false, sortOrder: 99 },
      { itemType: 'margin_floor_adjustment', label: 'Margin floor adjustment', quantity: 1, unitPriceKzt: 2300, amountKzt: 2300, isClientVisible: false, isCost: false, sortOrder: 100 },
    ];
    const recon = buildReconciliation({ ...base, items, amountKzt: 5000 + 52.8 + 2300 });
    expect(recon.roundingAdjustmentFound).toBe(true);
    expect(recon.marginFloorAdjustmentFound).toBe(true);
    expect(recon.canonicalSubtotalKzt).toBeCloseTo(7352.8);
    expect(recon.differenceKzt).toBeCloseTo(0);
    expect(recon.status).toBe('OK');
    expect(recon.reasons).toEqual([]);
  });

  it('8. margin_floor_adjustment present but wrong amount => WARNING (no tolerance band)', () => {
    const recon = buildReconciliation(makeResult({ ...withMarginFloorItem(2300), amountKzt: 7400 }));
    expect(recon.marginFloorAdjustmentFound).toBe(true);
    expect(recon.marginFloorAdjustmentKzt).toBe(2300);
    expect(recon.canonicalSubtotalKzt).toBe(7300);
    expect(recon.finalAmountKzt).toBe(7400);
    expect(recon.status).toBe('WARNING');
    expect(recon.reasons.some((r) => r.includes('Canonical subtotal'))).toBe(true);
  });
});
