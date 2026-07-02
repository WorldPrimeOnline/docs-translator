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
});

describe('buildReconciliation', () => {
  it('reports OK when client-visible items sum to the final amount', () => {
    const recon = buildReconciliation(makeResult());
    expect(recon.clientPriceSubtotalKzt).toBe(5000);
    expect(recon.finalAmountKzt).toBe(5000);
    expect(recon.status).toBe('OK');
  });

  it('reports WARNING when client-visible items do not sum to the final amount', () => {
    const recon = buildReconciliation(makeResult({ amountKzt: 5200 }));
    expect(recon.differenceKzt).toBe(200);
    expect(recon.status).toBe('WARNING');
  });
});
