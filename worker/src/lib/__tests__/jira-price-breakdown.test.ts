/**
 * @jest-environment node
 *
 * Tests for the Jira price breakdown issue feature.
 * Uses the source-reading pattern consistent with other worker tests in this dir.
 */

import {
  buildPriceBreakdownSummary,
  buildPriceBreakdownDescription,
  buildPriceBreakdownPayload,
  getPriceBreakdownConfig,
  type PriceBreakdownFullParams,
  type DbPriceQuoteItem,
  type DbPriceQuote,
} from '../jira/price-breakdown';

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

function makeQuote(overrides: Partial<DbPriceQuote> = {}): DbPriceQuote {
  return {
    id: 'quote-abc',
    amountKzt: 15000,
    currency: 'KZT',
    status: 'quoted',
    sourceLanguage: 'ru',
    targetLanguage: 'en',
    languagePair: 'ru→en',
    documentType: 'passport',
    serviceLevel: 'official_with_translator_signature_and_provider_stamp',
    physicalPageCount: 1,
    includedPageCount: 1,
    includedWordCount: 250,
    sourceWordCount: 200,
    urgencyLevel: 'standard',
    salesChannel: 'direct',
    fulfillmentMethod: null,
    pricingVersionId: 'v3-uuid',
    pricingContextJson: { languagePair: 'ru→en', baseMinimumKzt: 8000 },
    internalCostJson: { taxReserve: 450 },
    marginJson: { grossRevenue: 15000, totalCosts: 6000, targetProfit: 3750, estimatedMarginKzt: 9000, estimatedMarginRate: 0.60 },
    breakdownJson: { items: [] },
    wpoFinancialBreakdownJson: {},
    sourceCharacterCountWithSpaces: null,
    ...overrides,
  };
}

const SAMPLE_ITEMS: DbPriceQuoteItem[] = [
  makeItem({ itemType: 'minimum_check', label: 'Base minimum', amountKzt: 10000, isClientVisible: true, isCost: false }),
  makeItem({ id: 'i2', itemType: 'urgency_fee', label: 'Urgency (1.5×)', amountKzt: 5000, isClientVisible: true, isCost: false, sortOrder: 2 }),
  makeItem({ id: 'i3', itemType: 'tax_reserve', label: 'Tax reserve', amountKzt: 450, isClientVisible: false, isCost: true, sortOrder: 10 }),
];

const BASE_PARAMS: PriceBreakdownFullParams = {
  jobId: 'test-job-id-1234',
  mainIssueKey: 'WO-42',
  paymentTransactionId: null,
  paymentSource: 'subscription',
  documentId: null,
  serviceLevel: 'official_with_translator_signature_and_provider_stamp',
  sourceLanguage: 'ru',
  targetLanguage: 'en',
  documentType: 'passport',
  quote: makeQuote(),
  items: SAMPLE_ITEMS,
  reservations: [],
};

// ─── Summary ──────────────────────────────────────────────────────────────────

describe('buildPriceBreakdownSummary', () => {
  it('includes main issue key', () => {
    expect(buildPriceBreakdownSummary('WO-99')).toBe('Price Breakdown for WO-99');
  });
});

// ─── Description formatting ───────────────────────────────────────────────────

describe('buildPriceBreakdownDescription', () => {
  it('returns an ADF document object', () => {
    const desc = buildPriceBreakdownDescription(BASE_PARAMS);
    expect(desc).toHaveProperty('type', 'doc');
    expect(desc).toHaveProperty('version', 1);
    expect(Array.isArray(desc.content)).toBe(true);
  });

  it('includes main issue key, job id, quote id', () => {
    const desc = buildPriceBreakdownDescription(BASE_PARAMS);
    const text = JSON.stringify(desc);
    expect(text).toContain('WO-42');
    expect(text).toContain('test-job-id-1234');
    expect(text).toContain('quote-abc');
  });

  it('section A includes source and target language', () => {
    const text = JSON.stringify(buildPriceBreakdownDescription(BASE_PARAMS));
    expect(text).toContain('ru');
    expect(text).toContain('en');
    expect(text).toContain('standard'); // urgency_level
    expect(text).toContain('direct');   // sales_channel
  });

  it('includes client-visible revenue items', () => {
    const text = JSON.stringify(buildPriceBreakdownDescription(BASE_PARAMS));
    expect(text).toContain('minimum_check');
    expect(text).toContain('Base minimum');
    expect(text).toContain('urgency_fee');
  });

  it('ALSO includes internal cost items (operator audit view)', () => {
    const text = JSON.stringify(buildPriceBreakdownDescription(BASE_PARAMS));
    expect(text).toContain('Tax reserve');
    expect(text).toContain('tax_reserve');
  });

  it('handles null quote gracefully', () => {
    const desc = buildPriceBreakdownDescription({ ...BASE_PARAMS, quote: null });
    const text = JSON.stringify(desc);
    expect(text).toContain('—');
  });

  it('shows margin fields including target_profit', () => {
    const text = JSON.stringify(buildPriceBreakdownDescription(BASE_PARAMS));
    expect(text).toContain('Margin');
    expect(text).toContain('Target profit');
    expect(text).toContain('3750.00');
  });

  it('shows Payment TX in section A', () => {
    const params: PriceBreakdownFullParams = { ...BASE_PARAMS, paymentTransactionId: 'tx-123' };
    const text = JSON.stringify(buildPriceBreakdownDescription(params));
    expect(text).toContain('Payment TX');
    expect(text).toContain('tx-123');
  });

  it('shows reconciliation section', () => {
    const text = JSON.stringify(buildPriceBreakdownDescription(BASE_PARAMS));
    expect(text).toContain('Reconciliation');
  });

  it('shows WARNING when items are empty (legacy quote)', () => {
    const text = JSON.stringify(buildPriceBreakdownDescription({ ...BASE_PARAMS, items: [] }));
    expect(text).toContain('WARNING');
  });
});

// ─── Notary urgency (WO-77, 2026-07-15) ────────────────────────────────────────

describe('buildPriceBreakdownDescription — notary urgency', () => {
  it('does NOT misleadingly show notary urgency as "standard" when the general urgency_level is standard but the customer selected same_day notary urgency', () => {
    const params: PriceBreakdownFullParams = {
      ...BASE_PARAMS,
      serviceLevel: 'notarization_through_partners',
      quote: makeQuote({
        serviceLevel: 'notarization_through_partners',
        urgencyLevel: 'standard', // general urgency — hardcoded 'standard' for all card orders
        pricingContextJson: {
          notaryCutoff: {
            notaryUrgencyLevel: 'same_day',
            effectiveWindow: 'before_noon',
            multiplier: 1.0,
            cutoffAt: '2026-07-15T07:00:00.000Z',
            pricingTimezone: 'Asia/Almaty',
          },
        },
        breakdownJson: { items: [] },
      }),
    };
    const text = JSON.stringify(buildPriceBreakdownDescription(params));
    expect(text).toContain('General translation urgency');
    expect(text).toContain('Notary urgency');
    // The general field is genuinely 'standard' — that row is allowed to say so —
    // but the notary-specific row must show 'same_day', which only this row can produce.
    expect(text).toContain('same_day');
  });

  it('WO-77 case: same_day resolved to multiplier 1.0 and 0 KZT surcharge is shown explicitly, not omitted', () => {
    const params: PriceBreakdownFullParams = {
      ...BASE_PARAMS,
      serviceLevel: 'notarization_through_partners',
      quote: makeQuote({
        serviceLevel: 'notarization_through_partners',
        pricingContextJson: {
          notaryCutoff: {
            notaryUrgencyLevel: 'same_day',
            effectiveWindow: 'before_noon',
            multiplier: 1.0,
            cutoffAt: '2026-07-15T07:00:00.000Z',
            pricingTimezone: 'Asia/Almaty',
          },
        },
        breakdownJson: { items: [] }, // no notary_urgency_fee item pushed — multiplier is 1.0
      }),
    };
    const text = JSON.stringify(buildPriceBreakdownDescription(params));
    expect(text).toContain('Effective notary window');
    expect(text).toContain('before_noon');
    expect(text).toContain('Notary urgency multiplier');
    expect(text).toContain('×1.0');
    expect(text).toContain('Notary urgency surcharge');
    expect(text).toContain('0.00 KZT');
  });

  it('shows "—" for notary urgency rows when the quote has no notaryCutoff (non-notarized order)', () => {
    const desc = buildPriceBreakdownDescription(BASE_PARAMS); // official_with_translator_signature_and_provider_stamp, no notaryCutoff
    const text = JSON.stringify(desc);
    expect(text).toContain('Notary urgency');
    expect(text).not.toContain('same_day');
  });
});

// ─── Payload builder ──────────────────────────────────────────────────────────

describe('buildPriceBreakdownPayload', () => {
  it('sets project key from config', () => {
    const original = process.env.JIRA_PRICE_BREAKDOWN_PROJECT_KEY;
    process.env.JIRA_PRICE_BREAKDOWN_PROJECT_KEY = 'MYPROJ';
    const payload = buildPriceBreakdownPayload(BASE_PARAMS);
    expect((payload.fields as Record<string, unknown>).project).toEqual({ key: 'MYPROJ' });
    process.env.JIRA_PRICE_BREAKDOWN_PROJECT_KEY = original;
  });

  it('sets issuetype from config', () => {
    const payload = buildPriceBreakdownPayload(BASE_PARAMS);
    const fields = payload.fields as Record<string, unknown>;
    expect(fields.issuetype).toEqual({ name: expect.any(String) });
  });

  it('includes wpo-price-breakdown label by default', () => {
    const original = process.env.JIRA_PRICE_BREAKDOWN_LABELS;
    delete process.env.JIRA_PRICE_BREAKDOWN_LABELS;
    const payload = buildPriceBreakdownPayload(BASE_PARAMS);
    const fields = payload.fields as Record<string, unknown>;
    expect(fields.labels).toContain('wpo-price-breakdown');
    process.env.JIRA_PRICE_BREAKDOWN_LABELS = original;
  });
});

// ─── Feature flag ─────────────────────────────────────────────────────────────

describe('getPriceBreakdownConfig', () => {
  it('is disabled by default when env var is absent', () => {
    const original = process.env.JIRA_PRICE_BREAKDOWN_ISSUE_ENABLED;
    delete process.env.JIRA_PRICE_BREAKDOWN_ISSUE_ENABLED;
    expect(getPriceBreakdownConfig().enabled).toBe(false);
    process.env.JIRA_PRICE_BREAKDOWN_ISSUE_ENABLED = original;
  });

  it('is enabled when env var is "true"', () => {
    const original = process.env.JIRA_PRICE_BREAKDOWN_ISSUE_ENABLED;
    process.env.JIRA_PRICE_BREAKDOWN_ISSUE_ENABLED = 'true';
    expect(getPriceBreakdownConfig().enabled).toBe(true);
    process.env.JIRA_PRICE_BREAKDOWN_ISSUE_ENABLED = original;
  });
});

// ─── Integration source checks ────────────────────────────────────────────────

describe('integrations.ts wiring', () => {
  it('imports createPriceBreakdownIssue and wires it after Jira issue creation', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const src = fs.readFileSync(
      path.join(process.cwd(), 'worker/src/lib/integrations.ts'),
      'utf-8',
    );
    expect(src).toContain('createPriceBreakdownIssue');
    expect(src).toContain("from './jira/price-breakdown'");
    expect(src).toMatch(/jira_sync_status.*'created'[\s\S]{0,2000}createPriceBreakdownIssue/);
  });

  it('createPriceBreakdownIssue is non-blocking (wrapped in void async IIFE)', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const src = fs.readFileSync(
      path.join(process.cwd(), 'worker/src/lib/integrations.ts'),
      'utf-8',
    );
    expect(src).toMatch(/void\s*\(\s*async\s*\(\s*\)\s*=>\s*\{[\s\S]{0,3000}createPriceBreakdownIssue/);
  });

  it('failure of createPriceBreakdownIssue is caught and logged non-fatally', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const src = fs.readFileSync(
      path.join(process.cwd(), 'worker/src/lib/integrations.ts'),
      'utf-8',
    );
    expect(src).toContain('createPriceBreakdownIssue failed (non-fatal)');
  });

  it('createPriceBreakdownIssue checks for existing price_jira_issue_key (idempotency)', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const src = fs.readFileSync(
      path.join(process.cwd(), 'worker/src/lib/integrations.ts'),
      'utf-8',
    );
    expect(src).toContain('price_jira_issue_key');
    expect(src).toContain('Price breakdown issue already exists');
  });

  it('uses JIRA_PRICE_BREAKDOWN_ISSUE_ENABLED feature flag', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const src = fs.readFileSync(
      path.join(process.cwd(), 'worker/src/lib/jira/price-breakdown.ts'),
      'utf-8',
    );
    expect(src).toContain('JIRA_PRICE_BREAKDOWN_ISSUE_ENABLED');
  });
});

// ─── Migration check ──────────────────────────────────────────────────────────

describe('migration', () => {
  it('0028 migration adds price_jira_issue_key column', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const sql = fs.readFileSync(
      path.join(process.cwd(), 'supabase/migrations/0028_jobs_price_breakdown_jira.sql'),
      'utf-8',
    );
    expect(sql).toContain('price_jira_issue_key');
    expect(sql).toContain('price_jira_sync_status');
    expect(sql).toContain('jobs_price_jira_key_idx');
  });
});
