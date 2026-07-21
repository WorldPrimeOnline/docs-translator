import {
  buildPriceBreakdownDescription,
  buildPriceBreakdownSummary,
  hasLegacyItemTypes,
  mapPriceQuoteItem,
  mapCostReservation,
  mapPriceQuote,
  type PriceBreakdownFullParams,
  type DbPriceQuoteItem,
  type DbCostReservation,
  type DbPriceQuote,
} from '../price-breakdown';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Recursively extract all text values from an ADF node tree. */
function collectText(node: Record<string, unknown>): string {
  if (node.type === 'text') return (node.text as string) ?? '';
  const children = (node.content as Record<string, unknown>[] | undefined) ?? [];
  return children.map(collectText).filter(Boolean).join(' ');
}

function makeItem(overrides: Partial<DbPriceQuoteItem> = {}): DbPriceQuoteItem {
  return {
    id: 'item-1',
    itemType: 'minimum_check',
    label: 'Base minimum',
    quantity: 1,
    unitPriceKzt: 5500,
    amountKzt: 5500,
    isClientVisible: true,
    isCost: false,
    sortOrder: 0,
    metadataJson: {},
    ...overrides,
  };
}

function makeReservation(overrides: Partial<DbCostReservation> = {}): DbCostReservation {
  return {
    id: 'res-1',
    costType: 'tax_reserve',
    amountKzt: 216,
    status: 'committed',
    payableToType: null,
    payableToId: null,
    notes: 'Tax reserve (KZ)',
    ...overrides,
  };
}

function makeQuote(overrides: Partial<DbPriceQuote> = {}): DbPriceQuote {
  return {
    id: 'quote-uuid',
    amountKzt: 7200,
    currency: 'KZT',
    status: 'paid',
    sourceLanguage: 'en',
    targetLanguage: 'ru',
    languagePair: 'en→ru',
    documentType: 'passport_id',
    serviceLevel: 'official_with_translator_signature_and_provider_stamp',
    physicalPageCount: 1,
    includedPageCount: 1,
    includedWordCount: 250,
    sourceWordCount: 200,
    urgencyLevel: 'standard',
    salesChannel: 'direct',
    fulfillmentMethod: null,
    pricingVersionId: 'version-uuid',
    pricingContextJson: { languagePair: 'en→ru', baseMinimumKzt: 6500 },
    internalCostJson: { taxReserve: 216, acquiringFee: 180, translatorReserved: 1950 },
    marginJson: { grossRevenue: 7200, totalCosts: 4000, targetProfit: 1800, estimatedMarginKzt: 3200, estimatedMarginRate: 0.44 },
    breakdownJson: { items: [] },
    wpoFinancialBreakdownJson: {},
    sourceCharacterCountWithSpaces: null,
    ...overrides,
  };
}

function makeParams(overrides: Partial<PriceBreakdownFullParams> = {}): PriceBreakdownFullParams {
  return {
    jobId: 'job-uuid',
    mainIssueKey: 'WO-42',
    paymentTransactionId: 'tx-uuid',
    paymentSource: 'card_payment',
    documentId: 'doc-uuid',
    serviceLevel: 'official_with_translator_signature_and_provider_stamp',
    sourceLanguage: 'en',
    targetLanguage: 'ru',
    documentType: 'passport_id',
    quote: makeQuote(),
    items: [],
    reservations: [],
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('buildPriceBreakdownSummary', () => {
  it('returns canonical summary string', () => {
    expect(buildPriceBreakdownSummary('WO-42')).toBe('Price Breakdown for WO-42');
  });
});

describe('hasLegacyItemTypes', () => {
  it('returns true for known legacy item types', () => {
    expect(hasLegacyItemTypes([makeItem({ itemType: 'official_service_fee' })])).toBe(true);
    expect(hasLegacyItemTypes([makeItem({ itemType: 'risk_reserve' })])).toBe(true);
    expect(hasLegacyItemTypes([makeItem({ itemType: 'marketing_reserve' })])).toBe(true);
  });

  it('returns false for canonical item types', () => {
    expect(hasLegacyItemTypes([makeItem({ itemType: 'minimum_check' })])).toBe(false);
    expect(hasLegacyItemTypes([makeItem({ itemType: 'included_words' })])).toBe(false);
    expect(hasLegacyItemTypes([makeItem({ itemType: 'urgency_fee' })])).toBe(false);
  });

  it('returns false for empty items', () => {
    expect(hasLegacyItemTypes([])).toBe(false);
  });
});

describe('mapPriceQuoteItem', () => {
  it('maps snake_case row fields to camelCase', () => {
    const row: Record<string, unknown> = {
      id: 'item-1',
      item_type: 'minimum_check',
      label: 'Base minimum',
      quantity: 1,
      unit_price_kzt: '5500.00',
      amount_kzt: '5500.00',
      is_client_visible: true,
      is_cost: false,
      sort_order: 0,
      metadata_json: { note: 'test' },
    };
    const result = mapPriceQuoteItem(row);
    expect(result.itemType).toBe('minimum_check');
    expect(result.unitPriceKzt).toBe(5500);
    expect(result.amountKzt).toBe(5500);
    expect(result.isClientVisible).toBe(true);
    expect(result.isCost).toBe(false);
    expect(result.sortOrder).toBe(0);
    expect(result.metadataJson).toEqual({ note: 'test' });
  });

  it('handles null unit_price_kzt', () => {
    const result = mapPriceQuoteItem({ id: 'x', item_type: 'rounding_adjustment', label: 'Round', quantity: 1, unit_price_kzt: null, amount_kzt: 100, is_client_visible: false, is_cost: false, sort_order: 99, metadata_json: {} });
    expect(result.unitPriceKzt).toBeNull();
    expect(result.amountKzt).toBe(100);
  });

  it('defaults missing fields safely', () => {
    const result = mapPriceQuoteItem({ id: 'y', item_type: 'tax_reserve', label: 'Tax' });
    expect(result.quantity).toBe(1);
    expect(result.amountKzt).toBe(0);
    expect(result.isClientVisible).toBe(true);
    expect(result.isCost).toBe(false);
    expect(result.metadataJson).toEqual({});
  });
});

describe('mapCostReservation', () => {
  it('maps snake_case to camelCase', () => {
    const row: Record<string, unknown> = {
      id: 'res-1',
      cost_type: 'tax_reserve',
      amount_kzt: '216.00',
      status: 'committed',
      payable_to_type: null,
      payable_to_id: null,
      notes: 'Tax reserve',
    };
    const result = mapCostReservation(row);
    expect(result.costType).toBe('tax_reserve');
    expect(result.amountKzt).toBe(216);
    expect(result.payableToType).toBeNull();
    expect(result.notes).toBe('Tax reserve');
  });
});

describe('mapPriceQuote', () => {
  it('maps all fields including new ones', () => {
    const row: Record<string, unknown> = {
      id: 'q-1',
      amount_kzt: '7200.00',
      currency: 'KZT',
      status: 'paid',
      source_language: 'en',
      target_language: 'ru',
      language_pair: 'en→ru',
      document_type: 'passport_id',
      service_level: 'official_with_translator_signature_and_provider_stamp',
      physical_page_count: 1,
      included_page_count: 1,
      included_word_count: 250,
      source_word_count: 200,
      urgency_level: 'standard',
      sales_channel: 'direct',
      fulfillment_method: null,
      pricing_version_id: 'v-uuid',
      pricing_context_json: {},
      internal_cost_json: {},
      margin_json: {},
      breakdown_json: {},
    };
    const result = mapPriceQuote(row);
    expect(result.amountKzt).toBe(7200);
    expect(result.sourceWordCount).toBe(200);
    expect(result.urgencyLevel).toBe('standard');
    expect(result.salesChannel).toBe('direct');
    expect(result.fulfillmentMethod).toBeNull();
    expect(result.pricingVersionId).toBe('v-uuid');
  });

  it('handles null source_word_count', () => {
    const result = mapPriceQuote({ id: 'x', amount_kzt: 0, currency: 'KZT', status: 'draft', source_word_count: null });
    expect(result.sourceWordCount).toBeNull();
  });
});

describe('buildPriceBreakdownDescription — ADF structure', () => {
  it('returns a valid ADF document', () => {
    const doc = buildPriceBreakdownDescription(makeParams());
    expect(doc.version).toBe(1);
    expect(doc.type).toBe('doc');
    expect(Array.isArray(doc.content)).toBe(true);
    expect((doc.content as unknown[]).length).toBeGreaterThan(0);
  });

  it('top-level nodes are valid ADF types (headings, tables, paragraphs, codeBlocks, panels)', () => {
    const VALID_TOP_LEVEL_TYPES = new Set(['heading', 'table', 'codeBlock', 'paragraph', 'panel', 'bulletList']);
    const content = (buildPriceBreakdownDescription(makeParams()).content as Record<string, unknown>[]);
    content.forEach(node => {
      expect(VALID_TOP_LEVEL_TYPES.has(node.type as string)).toBe(true);
    });
  });

  it('contains ADF heading nodes', () => {
    const content = (buildPriceBreakdownDescription(makeParams({ items: [makeItem()] })).content as Record<string, unknown>[]);
    const headings = content.filter(n => n.type === 'heading');
    expect(headings.length).toBeGreaterThan(0);
  });

  it('contains ADF table nodes when items are present', () => {
    const content = (buildPriceBreakdownDescription(makeParams({ items: [makeItem()] })).content as Record<string, unknown>[]);
    const tables = content.filter(n => n.type === 'table');
    expect(tables.length).toBeGreaterThan(0);
  });

  it('contains ADF codeBlock nodes with json language for debug section', () => {
    const content = (buildPriceBreakdownDescription(makeParams()).content as Record<string, unknown>[]);
    const codeBlocks = content.filter(n => n.type === 'codeBlock');
    expect(codeBlocks.length).toBeGreaterThan(0);
    codeBlocks.forEach(cb => {
      expect((cb.attrs as Record<string, unknown>).language).toBe('json');
    });
  });
});

describe('buildPriceBreakdownDescription — new Russian FinancialReportModel report (2026-07-22)', () => {
  const NM_FIXTURE = {
    physicalPageCount: 1, characterPages: 1, billableTranslationPages: 1, translationPageBasis: 'physical_pages',
    translationAmountKzt: 3000, ocrAmountKzt: 100, notaryAmountKzt: 2292.25, courierAmountKzt: 5000, printingAmountKzt: 0,
    coordinationBaseAmountKzt: 3087.675, manualAdjustmentKzt: 0, componentSubtotalKzt: 13479.925,
    grossUpRate: 0.455, grossUpAmountKzt: 11253.89, roundingStepKzt: 500, standardRetailKzt: 25000,
    urgencyMultiplier: 1, urgencySurchargeKzt: 0, retailKzt: 25000,
    salesChannel: 'direct', clientDiscountKzt: 0, actualPaymentKzt: 25000,
    translatorPayoutKzt: 900, notaryPayoutKzt: 2292.25, courierPayoutKzt: 5000, printingCostKzt: 0,
    acquiringFeeKzt: 625, taxReserveKzt: 750, partnerCommissionKzt: 0,
    riskReserveKzt: 1250, marketingReserveKzt: 1250, aiItReserveKzt: 2500, ownerReserveKzt: 0, unusedChannelReserveKzt: 5000,
    netProfitWpoKzt: 5432.75, netMargin: 0.2173, totalCashRetainedByWpoKzt: 15432.75, reconciliationDifferenceKzt: 0,
    ratePerTranslationPageKzt: 3000,
  };

  afterEach(() => { delete process.env.ENABLE_NEW_JIRA_PRICING_REPORT; });

  it('flag off (default): uses the legacy English operator-audit report, never the new renderer', () => {
    const quote = makeQuote({ wpoFinancialBreakdownJson: NM_FIXTURE as unknown as Record<string, unknown> });
    const text = collectText(buildPriceBreakdownDescription(makeParams({ quote })));
    expect(text).toContain('WPO Price Breakdown');
    expect(text).not.toContain('Расчёт стоимости заказа');
  });

  it('flag on + no wpoFinancialBreakdownJson (legacy quote): falls through to the legacy report', () => {
    process.env.ENABLE_NEW_JIRA_PRICING_REPORT = 'true';
    const text = collectText(buildPriceBreakdownDescription(makeParams({ quote: makeQuote({ wpoFinancialBreakdownJson: {} }) })));
    expect(text).toContain('WPO Price Breakdown');
  });

  it('flag on + wpoFinancialBreakdownJson present: renders the new Russian report with all 6 blocks', () => {
    process.env.ENABLE_NEW_JIRA_PRICING_REPORT = 'true';
    const quote = makeQuote({ wpoFinancialBreakdownJson: NM_FIXTURE as unknown as Record<string, unknown>, fulfillmentMethod: 'delivery' });
    const doc = buildPriceBreakdownDescription(makeParams({ mainIssueKey: 'WO-77', quote }));
    const text = collectText(doc);

    expect(text).toContain('Расчёт стоимости заказа WO-77');
    expect(text).toContain('Документ и анализ');
    expect(text).toContain('Параметры заказа');
    expect(text).toContain('Формирование клиентской цены');
    expect(text).toContain('Внешние выплаты');
    expect(text).toContain('Внутренние резервы');
    expect(text).toContain('Результат');
    expect(text).toContain('Курьер');
    expect(text).not.toContain('WPO Price Breakdown — Operator Audit');
  });
});

describe('buildPriceBreakdownDescription — section A', () => {
  it('includes all required order/quote fields', () => {
    const params = makeParams();
    const text = collectText(buildPriceBreakdownDescription(params));

    expect(text).toContain('WO-42');         // mainIssueKey
    expect(text).toContain('quote-uuid');     // quote.id
    expect(text).toContain('tx-uuid');        // paymentTransactionId
    expect(text).toContain('job-uuid');       // jobId
    expect(text).toContain('doc-uuid');       // documentId
    expect(text).toContain('en→ru');          // languagePair
    expect(text).toContain('standard');       // urgencyLevel
    expect(text).toContain('direct');         // salesChannel
    expect(text).toContain('version-uuid');   // pricingVersionId
    expect(text).toContain('7200.00 KZT');    // finalAmount
  });

  it('shows — for null fields when quote is absent', () => {
    const text = collectText(buildPriceBreakdownDescription(makeParams({ quote: null })));
    expect(text).toContain('—');
  });
});

describe('buildPriceBreakdownDescription — section B', () => {
  it('shows all revenue items with amounts — no truncation', () => {
    const items: DbPriceQuoteItem[] = [
      makeItem({ itemType: 'minimum_check', amountKzt: 6500, isClientVisible: true }),
      makeItem({ id: 'item-2', itemType: 'human_review_fee', amountKzt: 0, label: 'Human review', isClientVisible: true }),
      makeItem({ id: 'item-3', itemType: 'urgency_fee', amountKzt: 0, label: 'Urgency standard', isClientVisible: false }),
    ];
    const text = collectText(buildPriceBreakdownDescription(makeParams({ items })));
    expect(text).toContain('minimum_check');
    expect(text).toContain('human_review_fee');
    expect(text).toContain('urgency_fee');
    expect(text).toContain('6500.00');
    expect(text).toContain('Revenue subtotal');
    expect(text).toContain('6500.00 KZT');
  });

  it('shows zero-value revenue items (not dropped)', () => {
    const items: DbPriceQuoteItem[] = [
      makeItem({ itemType: 'minimum_check', amountKzt: 6500 }),
      makeItem({ id: 'i2', itemType: 'included_words', amountKzt: 0, label: 'Included words' }),
      makeItem({ id: 'i3', itemType: 'delivery_fee', amountKzt: 0, label: 'Delivery not required', isClientVisible: false }),
    ];
    const text = collectText(buildPriceBreakdownDescription(makeParams({ items })));
    expect(text).toContain('included_words');
    expect(text).toContain('delivery_fee');
  });

  it('does not truncate long labels or metadata', () => {
    const longLabel = 'A'.repeat(100);
    const longMeta = { someKey: 'B'.repeat(200) };
    const items = [makeItem({ label: longLabel, metadataJson: longMeta })];
    const json = JSON.stringify(buildPriceBreakdownDescription(makeParams({ items })));
    expect(json).toContain(longLabel);
    expect(json).toContain('B'.repeat(200));
  });

  it('shows WARNING panel when price_quote_items is empty', () => {
    const text = collectText(buildPriceBreakdownDescription(makeParams({ items: [] })));
    expect(text).toContain('WARNING: price_quote_items not found');
    expect(text).toContain('canonical pricing breakdown migration');
  });

  it('displays notary_coordination_fee as the fixed 5000 KZT WPO commercial fee, separate from notary_official_fee', () => {
    const items: DbPriceQuoteItem[] = [
      makeItem({ itemType: 'notary_official_fee', amountKzt: 2292, label: 'Notary official fee (MRP-based estimate)', metadataJson: { notary_mrp_value_kzt: 4325, notary_mrp_coefficient: 0.53 } }),
      makeItem({
        id: 'item-coord',
        itemType: 'notary_coordination_fee',
        amountKzt: 5000,
        label: 'Notary coordination (WPO fixed fee)',
        metadataJson: { source: 'fixed_wpo_coordination_fee', amount: 5000 },
      }),
      makeItem({ id: 'item-print', itemType: 'printing_binding_fee', amountKzt: 500, label: 'Printing & binding' }),
      makeItem({ id: 'item-delivery', itemType: 'delivery_fee', amountKzt: 2500, label: 'Delivery (almaty_standard)' }),
    ];
    const text = collectText(buildPriceBreakdownDescription(makeParams({ items })));
    expect(text).toContain('notary_coordination_fee');
    expect(text).toContain('5000.00');
    expect(text).toContain('fixed_wpo_coordination_fee');
    expect(text).toContain('notary_official_fee');
    expect(text).toContain('2292.00');
    expect(text).toContain('4325');
    expect(text).toContain('printing_binding_fee');
    expect(text).toContain('500.00');
    expect(text).toContain('delivery_fee');
    expect(text).toContain('2500.00');
  });
});

describe('buildPriceBreakdownDescription — section C', () => {
  it('shows all internal cost items', () => {
    const items: DbPriceQuoteItem[] = [
      makeItem({ id: 'c1', itemType: 'tax_reserve', amountKzt: 216, label: 'Tax reserve', isCost: true, isClientVisible: false }),
      makeItem({ id: 'c2', itemType: 'translator_reserved_cost', amountKzt: 1950, label: 'Translator cost', isCost: true, isClientVisible: false }),
      makeItem({ id: 'c3', itemType: 'acquiring_fee_estimate', amountKzt: 180, label: 'Acquiring fee', isCost: true, isClientVisible: false }),
    ];
    const text = collectText(buildPriceBreakdownDescription(makeParams({ items })));
    expect(text).toContain('tax_reserve');
    expect(text).toContain('translator_reserved_cost');
    expect(text).toContain('acquiring_fee_estimate');
    expect(text).toContain('Cost items subtotal');
  });
});

describe('buildPriceBreakdownDescription — section D', () => {
  it('shows cost reservations with full notes — no truncation', () => {
    const longNote = 'N'.repeat(500);
    const reservations: DbCostReservation[] = [
      makeReservation({ costType: 'tax_reserve', amountKzt: 216, status: 'committed' }),
      makeReservation({ id: 'r2', costType: 'translator_reserved_cost', amountKzt: 1950, status: 'committed', notes: longNote }),
    ];
    const json = JSON.stringify(buildPriceBreakdownDescription(makeParams({ reservations })));
    expect(json).toContain('tax_reserve');
    expect(json).toContain('translator_reserved_cost');
    expect(json).toContain(longNote);
    const text = collectText(buildPriceBreakdownDescription(makeParams({ reservations })));
    expect(text).toContain('Total reserved');
    expect(text).toContain('2166.00 KZT');
  });
});

describe('buildPriceBreakdownDescription — section E', () => {
  it('shows blended margin fields including target_profit (legacy quote, no layered fields)', () => {
    const text = collectText(buildPriceBreakdownDescription(makeParams()));
    expect(text).toContain('Whole Order (Blended)');
    expect(text).toContain('Final price');
    expect(text).toContain('Total costs');
    expect(text).toContain('Target profit');
    expect(text).toContain('1800.00 KZT');      // targetProfit from makeQuote
    expect(text).toContain('Blended order margin');
    expect(text).toContain('44.00%');
  });

  it('shows WPO service layer, notary/delivery add-ons, notary coordination margin, and payment-wide fees when present in margin_json', () => {
    const quote = makeQuote({
      internalCostJson: { notaryFee: 2292, notaryCoordinationInternalCostKzt: 0, printingCost: 500, courierCost: 2500 },
      marginJson: {
        grossRevenue: 21500,
        totalCosts: 7127,
        targetProfit: 1375,
        estimatedMarginKzt: 9373,
        estimatedMarginRate: 0.436,
        rawPriceBeforeMarginFloor: 5500,
        estimatedMarginRateBeforeFloor: 0.4068,
        marginFloorAdjustmentKzt: 2300,
        targetMarginFloorRate: 0.50,
        wpoServiceLayerFinalPrice: 7800,
        wpoMarginableRevenueKzt: 12800,
        wpoServiceLayerCosts: 3895,
        wpoServiceMarginKzt: 3905,
        wpoServiceMarginRate: 0.5006,
        profitBufferAboveTargetKzt: 3.9,
        profitBufferAboveTargetRate: 0.0006,
        notaryDeliveryAddonsKzt: 9958,
        notaryCoordinationRevenueKzt: 5000,
        notaryCoordinationMarginKzt: 5000,
        paymentWideFeeRate: 0.105,
        paymentWideFeesKzt: 2257.5,
        paymentWideFeeAdjustmentKzt: 1000,
      },
    });
    const text = collectText(buildPriceBreakdownDescription(makeParams({ quote })));
    expect(text).toContain('Translation / WPO Service Layer');
    expect(text).toContain('Raw price before WPO margin floor');
    expect(text).toContain('5500.00 KZT');
    expect(text).toContain('WPO margin floor adjustment');
    expect(text).toContain('2300.00 KZT');
    expect(text).toContain('WPO marginable revenue');
    expect(text).toContain('12800.00 KZT');
    expect(text).toContain('WPO marginable margin');
    expect(text).toContain('Target margin %');
    expect(text).toContain('50.00%');
    expect(text).toContain('Profit buffer above target');
    expect(text).toContain('Notary & Delivery Add-ons');
    expect(text).toContain('9958.00 KZT');
    expect(text).toContain('Notary coordination fee (WPO revenue)');
    expect(text).toContain('Notary coordination internal cost (not the WPO fee)');
    expect(text).toContain('Notary coordination margin');
    expect(text).toContain('5000.00 KZT');
    expect(text).toContain('Payment-wide Fees / Reserves');
    expect(text).toContain('Whole Order (Blended)');
  });

  it('omits WPO-layer rows for older quotes whose margin_json predates this feature', () => {
    // makeQuote()'s default marginJson has no layered-model keys — simulates a quote
    // created before this feature. Section E must still render (blended-only) without them.
    const text = collectText(buildPriceBreakdownDescription(makeParams()));
    expect(text).not.toContain('Raw price before WPO margin floor');
    expect(text).not.toContain('WPO margin floor adjustment');
    expect(text).not.toContain('Translation / WPO Service Layer');
    expect(text).not.toContain('Notary & Delivery Add-ons');
  });
});

describe('buildPriceBreakdownDescription — section F reconciliation', () => {
  it('OK when item subtotal matches final amount', () => {
    const items = [makeItem({ itemType: 'minimum_check', amountKzt: 7200 })];
    const quote = makeQuote({ amountKzt: 7200 });
    const text = collectText(buildPriceBreakdownDescription(makeParams({ items, quote })));
    expect(text).toContain('OK: subtotal reconciles');
  });

  it('WARNING when item subtotal differs from final amount', () => {
    const items = [makeItem({ itemType: 'minimum_check', amountKzt: 6000 })];
    const quote = makeQuote({ amountKzt: 7200 });
    const text = collectText(buildPriceBreakdownDescription(makeParams({ items, quote })));
    expect(text).toContain('WARNING');
    expect(text).toContain('1200.00 KZT');
  });

  it('cannot reconcile when no items', () => {
    const text = collectText(buildPriceBreakdownDescription(makeParams({ items: [] })));
    expect(text).toContain('cannot reconcile');
  });
});

describe('buildPriceBreakdownDescription — section G debug JSON', () => {
  it('includes codeBlock nodes for all four JSON fields', () => {
    const text = collectText(buildPriceBreakdownDescription(makeParams()));
    expect(text).toContain('pricing_context_json');
    expect(text).toContain('internal_cost_json');
    expect(text).toContain('margin_json');
    expect(text).toContain('breakdown_json');
  });

  it('debug JSON values are not truncated', () => {
    const bigJson = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`key${i}`, 'X'.repeat(100)]));
    const quote = makeQuote({ pricingContextJson: bigJson });
    const json = JSON.stringify(buildPriceBreakdownDescription(makeParams({ quote })));
    expect(json).toContain('X'.repeat(100));
  });

  it('shows quote not available when quote is null', () => {
    const text = collectText(buildPriceBreakdownDescription(makeParams({ quote: null })));
    expect(text).toContain('quote not available');
  });
});

describe('buildPriceBreakdownDescription — legacy warning', () => {
  it('shows legacy warning panel when old item types are present', () => {
    const items = [makeItem({ itemType: 'official_service_fee' })];
    const text = collectText(buildPriceBreakdownDescription(makeParams({ items })));
    expect(text).toContain('WARNING: legacy quote item taxonomy detected');
    expect(text).toContain('Rebuild/new quote required');
  });

  it('does not show legacy warning for canonical item types', () => {
    const items = [
      makeItem({ itemType: 'minimum_check' }),
      makeItem({ id: 'i2', itemType: 'included_words' }),
      makeItem({ id: 'i3', itemType: 'urgency_fee' }),
    ];
    const text = collectText(buildPriceBreakdownDescription(makeParams({ items })));
    expect(text).not.toContain('WARNING: legacy quote item taxonomy detected');
  });

  it('does not show legacy warning when items array is empty', () => {
    const text = collectText(buildPriceBreakdownDescription(makeParams({ items: [] })));
    expect(text).not.toContain('WARNING: legacy quote item taxonomy detected');
  });
});
