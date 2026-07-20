/**
 * Integration tests for POST /api/internal/pricing-lab/calculate.
 *
 * Only `@/lib/internal/require-pricing-lab-access` (the auth/cookie layer) and
 * `@/lib/supabase/server` (the DB client) are mocked. Everything else — the route handler,
 * getPricingVersionByCode/getLanguageRate/validateChannelReserveInvariant (service.ts), and
 * calculatePrice (calculator.ts) — is the REAL production code, proving Pricing Lab reuses the
 * real pricing engine rather than a parallel implementation (test requirement #1).
 */
export {};

const writeCalls: Array<{ table: string; op: string }> = [];
const touchedTables = new Set<string>();

let pricingVersionsRow: Record<string, unknown> | null;
let languageRatesRows: Record<string, unknown>[];
let partnersRows: Record<string, unknown>[];

function makeQuery(table: string) {
  touchedTables.add(table);
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    limit: () => chain,
    or: () => chain,
    insert: (payload: unknown) => { writeCalls.push({ table, op: 'insert' }); return { ...chain, select: () => ({ single: async () => ({ data: payload, error: null }) }) }; },
    update: () => { writeCalls.push({ table, op: 'update' }); return chain; },
    upsert: () => { writeCalls.push({ table, op: 'upsert' }); return chain; },
    maybeSingle: async () => {
      if (table === 'pricing_versions') return { data: pricingVersionsRow, error: null };
      if (table === 'pricing_language_rates') return { data: languageRatesRows[0] ?? null, error: null };
      if (table === 'partners') return { data: partnersRows[0] ?? null, error: null };
      return { data: null, error: null };
    },
    then: (resolve: (v: { data: unknown; error: unknown }) => void) => {
      if (table === 'partners') return resolve({ data: partnersRows, error: null });
      return resolve({ data: [], error: null });
    },
  };
  return chain;
}

jest.mock('@/lib/supabase/server', () => ({
  supabaseServer: { from: (table: string) => makeQuery(table) },
}));

jest.mock('@/lib/internal/require-pricing-lab-access', () => ({
  requirePricingLabAccess: jest.fn(async () => ({ ok: true, userId: 'test-operator', userEmail: 'ops@wpo.test' })),
}));

const NEW_MODEL_VERSION_ROW = {
  id: 'v-newmodel', code: '2026-Q3-KZ-NEWMODEL', status: 'draft', currency: 'KZT',
  internal_fx_rate: null, mrp_value: 4.325,
  tax_rate: 0.03, acquiring_rate: 0.025, risk_reserve_rate: 0.05, owner_reserve_rate: 0.00,
  marketing_rate_direct: 0.05, partner_commission_rate: 0.10, target_profit_rate: 0.25,
  ai_it_reserve_per_page_kzt: 100,
  valid_from: '2026-07-17', valid_to: null, metadata: { formula_version: 'new_2026_07' },
  ai_it_rate: 0.10, channel_reserve_rate: 0.20, client_discount_rate: 0.10, wpo_coordination_rate: 0.30,
  translator_payout_rate: 0.30, ocr_rate_per_physical_page_kzt: 100, courier_fee_kzt: 5000,
  printing_fee_kzt: 0, extra_paper_copy_fee_kzt: 0, rounding_step_official_kzt: 100, rounding_step_notary_kzt: 500,
  public_electronic_price_kzt: null, public_official_min_price_kzt: null, public_notary_min_price_kzt: null,
};

const RU_EN_RATE_ROW = {
  id: 'rate-ru-en', pricing_version_id: 'v-newmodel', source_language: 'ru', target_language: 'en',
  rate_kzt_per_translation_page: 3000, active: true, requires_operator_review: false,
};

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/internal/pricing-lab/calculate', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}

function baseBody(overrides: Record<string, unknown> = {}) {
  return {
    pricingVersionCode: '2026-Q3-KZ-NEWMODEL',
    serviceLevel: 'official_with_translator_signature_and_provider_stamp',
    sourceLanguage: 'ru', targetLanguage: 'en',
    sourceCharacterCountWithSpaces: 1800, physicalPageCount: 1,
    salesChannel: 'direct',
    ...overrides,
  };
}

beforeEach(() => {
  writeCalls.length = 0;
  touchedTables.clear();
  pricingVersionsRow = { ...NEW_MODEL_VERSION_ROW };
  languageRatesRows = [RU_EN_RATE_ROW];
  partnersRows = [];
  jest.resetModules();
});

describe('POST /api/internal/pricing-lab/calculate', () => {
  it('resolves the DRAFT version by explicit code (test #2) and computes Fixture 1 exactly (7400 ₸)', async () => {
    const { POST } = await import('../route');
    const res = await POST(makeRequest(baseBody()));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.resolvedVersion.status).toBe('draft');
    expect(data.result.newModel.retailPriceKzt).toBe(7400);
    expect(data.result.newModel.channelBudgetKzt).toBe(1480);
    expect(data.result.newModel.reconciliationDifferenceKzt).toBe(0);
  });

  it('Fixture 2: Notary, no delivery, standard → 13000 ₸', async () => {
    const { POST } = await import('../route');
    const res = await POST(makeRequest(baseBody({
      serviceLevel: 'notarization_through_partners', applicantType: 'individual',
      fulfillmentMethod: 'pickup', deliveryRequired: false, notaryUrgencyLevel: 'standard',
    })));
    const data = await res.json();
    expect(data.result.newModel.retailPriceKzt).toBe(13000);
    expect(data.result.newModel.notaryAmountKzt).toBe(2292.25);
    expect(data.result.newModel.reconciliationDifferenceKzt).toBe(0);
  });

  it('Fixture 3: Notary + delivery + after_noon → 28000 ₸, courier = 5000 (test #10)', async () => {
    const { POST } = await import('../route');
    const res = await POST(makeRequest(baseBody({
      serviceLevel: 'notarization_through_partners', applicantType: 'individual',
      fulfillmentMethod: 'delivery', deliveryRequired: true,
      notaryUrgencyLevel: 'same_day', notaryUrgencyWindowOverride: 'after_noon',
    })));
    const data = await res.json();
    expect(data.result.newModel.courierAmountKzt).toBe(5000);
    expect(data.result.newModel.retailPriceKzt).toBe(28000);
    expect(data.result.newModel.reconciliationDifferenceKzt).toBe(0);
  });

  it('Fixture 4: Official Referral 10% → discount from ROUNDED retail, no re-rounding (test #11, #12)', async () => {
    const { POST } = await import('../route');
    const res = await POST(makeRequest(baseBody({ salesChannel: 'referral', partnerCommissionRateOverride: 0.10 })));
    const data = await res.json();
    const nm = data.result.newModel;
    expect(nm.retailPriceKzt).toBe(7400);
    expect(nm.clientDiscountKzt).toBe(740);
    expect(nm.actualPaymentKzt).toBe(6660);
    expect(nm.partnerCommissionKzt).toBe(666);
    expect(nm.unusedChannelReserveKzt).toBe(74);
  });

  it('Fixture 5: 3366 characters → 1.87 pages, T = 5610 (test #13, decimal precision)', async () => {
    const { POST } = await import('../route');
    const res = await POST(makeRequest(baseBody({ sourceCharacterCountWithSpaces: 3366 })));
    const data = await res.json();
    expect(data.result.context.translationPageCountExact).toBeCloseTo(1.87, 2);
    expect(data.result.newModel.translationAmountKzt).toBe(5610);
  });

  it('Fixture 6: stress scenario (RU→TH, legal entity, delivery, after_18, referral) — reconciliation converges to 0', async () => {
    languageRatesRows = [{ ...RU_EN_RATE_ROW, id: 'rate-ru-th', target_language: 'th', rate_kzt_per_translation_page: 10000 }];
    const { POST } = await import('../route');
    const res = await POST(makeRequest(baseBody({
      targetLanguage: 'th', serviceLevel: 'notarization_through_partners',
      sourceCharacterCountWithSpaces: 50000, physicalPageCount: 20,
      applicantType: 'legal_entity', fulfillmentMethod: 'delivery', deliveryRequired: true,
      notaryUrgencyLevel: 'same_day', notaryUrgencyWindowOverride: 'after_18',
      salesChannel: 'referral', partnerCommissionRateOverride: 0.10,
    })));
    const data = await res.json();
    expect(data.result.newModel.reconciliationDifferenceKzt).toBe(0);
  });

  it('official ignores notary fields even if supplied (test #9)', async () => {
    const { POST } = await import('../route');
    const res = await POST(makeRequest(baseBody({
      applicantType: 'legal_entity', fulfillmentMethod: 'delivery', deliveryRequired: true, notaryUrgencyLevel: 'same_day',
    })));
    const data = await res.json();
    expect(data.result.newModel.notaryAmountKzt).toBe(0);
    expect(data.result.newModel.courierAmountKzt).toBe(0);
  });

  it('missing language rate produces a clear operator_review error, never a fabricated rate (test #6)', async () => {
    languageRatesRows = [];
    const { POST } = await import('../route');
    const res = await POST(makeRequest(baseBody({ targetLanguage: 'zz' })));
    const data = await res.json();
    expect(data.result.status).toBe('requires_operator_review');
    expect(data.result.reviewReasons.some((r: string) => r.includes('language rate'))).toBe(true);
  });

  it('an invalid gross-up override (>=100%) is blocked, not silently computed (test #7)', async () => {
    const { POST } = await import('../route');
    const res = await POST(makeRequest(baseBody({
      versionOverrides: { taxRate: 0.5, acquiringRate: 0.5, riskReserveRate: 0.05, marketingRateDirect: 0.05, aiItRate: 0.1, ownerReserveRate: 0, channelReserveRate: 0.2 },
    })));
    const data = await res.json();
    expect(res.status).toBe(422);
    expect(data.blocked).toBe(true);
    expect(data.error).toContain('PRICING_CONFIG_INVALID');
  });

  it('an invalid channel_reserve_rate override (cannot cover discount+commission) is blocked (test #8)', async () => {
    partnersRows = [{ commission_rate: 0.10 }];
    const { POST } = await import('../route');
    const res = await POST(makeRequest(baseBody({
      salesChannel: 'referral', partnerCommissionRateOverride: 0.10,
      versionOverrides: { channelReserveRate: 0.01 }, // far too low to cover 10% discount + 10% commission
    })));
    const data = await res.json();
    expect(res.status).toBe(422);
    expect(data.blocked).toBe(true);
  });

  it('never writes to the database — no insert/update/upsert calls at all (test #3, #15)', async () => {
    const { POST } = await import('../route');
    await POST(makeRequest(baseBody()));
    expect(writeCalls).toHaveLength(0);
  });

  it('never touches jobs/documents/payment_transactions/price_quotes tables (test #15)', async () => {
    const { POST } = await import('../route');
    await POST(makeRequest(baseBody({ salesChannel: 'referral', partnerCommissionRateOverride: 0.05 })));
    for (const forbidden of ['jobs', 'documents', 'payment_transactions', 'price_quotes', 'price_quote_items', 'cost_reservations']) {
      expect(touchedTables.has(forbidden)).toBe(false);
    }
  });

  it('temporary version overrides are applied for this request only — the fetched version row is never mutated (test #3)', async () => {
    const { POST } = await import('../route');
    const before = JSON.stringify(pricingVersionsRow);
    await POST(makeRequest(baseBody({ versionOverrides: { wpoCoordinationRate: 0.5 } })));
    expect(JSON.stringify(pricingVersionsRow)).toBe(before); // mock row object itself never mutated
    expect(writeCalls).toHaveLength(0);
  });
});
