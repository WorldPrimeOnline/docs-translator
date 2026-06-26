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
  type PriceBreakdownParams,
  type PriceBreakdownPricingResult,
} from '../jira/price-breakdown';

const SAMPLE_PRICING: PriceBreakdownPricingResult = {
  amountKzt: 15000,
  currency: 'KZT',
  status: 'quoted',
  pricingVersionCode: 'v3',
  items: [
    { itemType: 'base_translation', label: 'Translation fee', quantity: 1, unitPriceKzt: 10000, amountKzt: 10000, isClientVisible: true, isCost: false, sortOrder: 1 },
    { itemType: 'urgency_surcharge', label: 'Urgency (1.5×)', quantity: 1, unitPriceKzt: 5000, amountKzt: 5000, isClientVisible: true, isCost: false, sortOrder: 2 },
    { itemType: 'internal_tax_reserve', label: 'Tax reserve', quantity: 1, unitPriceKzt: 450, amountKzt: 450, isClientVisible: false, isCost: true, sortOrder: 10 },
  ],
  context: {
    languagePair: 'ru-kk',
    baseMinimumKzt: 8000,
    extraWords: 0,
    additionalPages: 0,
    documentCoefficient: 1.2,
    urgencyCoefficient: 1.5,
    includedWordCount: 300,
    includedPageCount: 2,
  },
};

const BASE_PARAMS: PriceBreakdownParams = {
  jobId: 'test-job-id-1234',
  mainIssueKey: 'WO-42',
  quoteId: 'quote-abc',
  serviceLevel: 'official_with_translator_signature_and_provider_stamp',
  sourceLanguage: 'ru',
  targetLanguage: 'en',
  documentType: 'passport',
  paymentSource: 'subscription',
  pricingResult: SAMPLE_PRICING,
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

  it('includes client-visible line items', () => {
    const desc = buildPriceBreakdownDescription(BASE_PARAMS);
    const text = JSON.stringify(desc);
    expect(text).toContain('Translation fee');
    expect(text).toContain('Urgency (1.5×)');
    // toLocaleString('ru-RU') uses a narrow no-break space (U+202F or U+00A0)
    expect(text).toMatch(/15[\s  ]000/);
  });

  it('does NOT include internal (non-client-visible) line items', () => {
    const desc = buildPriceBreakdownDescription(BASE_PARAMS);
    const text = JSON.stringify(desc);
    expect(text).not.toContain('Tax reserve');
    expect(text).not.toContain('internal_tax_reserve');
  });

  it('handles missing pricingResult gracefully', () => {
    const desc = buildPriceBreakdownDescription({ ...BASE_PARAMS, pricingResult: null });
    const text = JSON.stringify(desc);
    expect(text).toContain('quote not available');
  });

  it('does not contain internal cost or margin fields', () => {
    const desc = buildPriceBreakdownDescription(BASE_PARAMS);
    const text = JSON.stringify(desc);
    // These appear only in the Finance Report — not here
    expect(text).not.toContain('CONFIDENTIAL');
    expect(text).not.toContain('Margin');
    expect(text).not.toContain('margin');
    expect(text).not.toContain('fiscal');
    expect(text).not.toContain('Payment TX');
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
    // Verify it is called after the main Jira issue is created
    expect(src).toMatch(/jira_sync_status.*'created'[\s\S]{0,2000}createPriceBreakdownIssue/);
  });

  it('createPriceBreakdownIssue is non-blocking (wrapped in void async IIFE)', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const src = fs.readFileSync(
      path.join(process.cwd(), 'worker/src/lib/integrations.ts'),
      'utf-8',
    );
    // Should be wrapped in void (async () => { ... })() to be non-blocking
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
