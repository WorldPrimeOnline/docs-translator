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
  it('shows margin fields including target_profit', () => {
    const text = collectText(buildPriceBreakdownDescription(makeParams()));
    expect(text).toContain('Gross revenue');
    expect(text).toContain('Total costs');
    expect(text).toContain('Target profit');
    expect(text).toContain('1800.00 KZT');      // targetProfit from makeQuote
    expect(text).toContain('Estimated margin');
    expect(text).toContain('44.00%');
  });

  it('shows margin floor fields when present in margin_json', () => {
    const quote = makeQuote({
      marginJson: {
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
    });
    const text = collectText(buildPriceBreakdownDescription(makeParams({ quote })));
    expect(text).toContain('Raw price before margin floor');
    expect(text).toContain('5500.00 KZT');
    expect(text).toContain('Margin floor adjustment');
    expect(text).toContain('2300.00 KZT');
    expect(text).toContain('Target margin %');
    expect(text).toContain('50.00%');
    expect(text).toContain('Profit buffer above target');
  });

  it('omits margin floor rows for older quotes whose margin_json predates this feature', () => {
    // makeQuote()'s default marginJson has no margin-floor keys — simulates a quote
    // created before this feature. Section E must still render without them.
    const text = collectText(buildPriceBreakdownDescription(makeParams()));
    expect(text).not.toContain('Raw price before margin floor');
    expect(text).not.toContain('Margin floor adjustment');
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
