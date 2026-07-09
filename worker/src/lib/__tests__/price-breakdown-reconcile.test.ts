/**
 * @jest-environment node
 *
 * Tests for reconcilePendingPriceBreakdownIssues() (WO-75 incident follow-up,
 * 2026-07-09) — the periodic sweep that retries price breakdown Jira issue
 * creation for jobs where the original fire-and-forget attempt in
 * initializeOrderIntegrations() never completed (e.g. worker restarted mid-flight).
 */

const jobsUpdates: Record<string, unknown>[] = [];
const fetchCalls: Array<{ url: string; method: string | undefined }> = [];

let candidateJobs: Array<{
  id: string; document_id: string; service_level: string | null;
  payment_source: string | null; jira_issue_key: string; price_jira_issue_key: string | null;
}>;
let documentRow: { source_language: string; target_language: string; document_type: string } | null;
let quoteRow: Record<string, unknown> | null;

function makeQuery(table: string) {
  let lastSelect = '';
  const chain: Record<string, unknown> = {
    select: (arg: string) => { lastSelect = arg; return chain; },
    not: () => chain,
    is: () => chain,
    lt: () => chain,
    order: () => chain,
    limit: () => chain,
    eq: () => chain,
    update: (payload: Record<string, unknown>) => {
      jobsUpdates.push({ table, payload });
      return { eq: () => Promise.resolve({ error: null }) };
    },
    maybeSingle: () => {
      if (table === 'jobs' && lastSelect === 'price_jira_issue_key') {
        return Promise.resolve({ data: { price_jira_issue_key: null }, error: null });
      }
      if (table === 'documents') {
        return Promise.resolve({ data: documentRow, error: null });
      }
      if (table === 'price_quotes') {
        return Promise.resolve({ data: quoteRow, error: null });
      }
      if (table === 'payment_transactions') {
        return Promise.resolve({ data: { id: 'tx-1' }, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
    then: (onFulfilled: (v: { data: unknown; error: unknown }) => void) => {
      if (table === 'jobs' && lastSelect.includes('document_id, service_level')) {
        return onFulfilled({ data: candidateJobs, error: null });
      }
      if (table === 'price_quote_items' || table === 'cost_reservations') {
        return onFulfilled({ data: [], error: null });
      }
      return onFulfilled({ data: null, error: null });
    },
  };
  return chain;
}

jest.mock('../supabase', () => ({
  supabase: { from: (table: string) => makeQuery(table) },
}));

// integrations.ts transitively imports ./r2, which imports ./env and validates
// required env vars (R2/AI provider keys) at module load time via zod — not
// relevant to this test, so stub both out.
jest.mock('../env', () => ({ env: { SITE_URL: 'https://wpo.test' } }));
jest.mock('../r2', () => ({ downloadFile: jest.fn() }));

beforeEach(() => {
  jobsUpdates.length = 0;
  fetchCalls.length = 0;
  process.env.JIRA_PRICE_BREAKDOWN_ISSUE_ENABLED = 'true';
  process.env.JIRA_BASE_URL = 'https://wpo.atlassian.net';
  process.env.JIRA_EMAIL = 'bot@wpo.test';
  process.env.JIRA_API_TOKEN = 'test-token';

  candidateJobs = [{
    id: 'job-1', document_id: 'doc-1', service_level: 'notarization_through_partners',
    payment_source: 'card_payment', jira_issue_key: 'WO-75', price_jira_issue_key: null,
  }];
  documentRow = { source_language: 'ru', target_language: 'zh', document_type: 'passport_id' };
  quoteRow = {
    id: 'quote-1', document_id: 'doc-1', amount_kzt: 20700, currency: 'KZT', status: 'paid',
    source_language: 'ru', target_language: 'zh', language_pair: 'ru-zh', document_type: 'passport_id',
    service_level: 'notarization_through_partners', physical_page_count: 1, included_page_count: 1,
    included_word_count: 250, source_word_count: 100, urgency_level: 'standard', sales_channel: null,
    fulfillment_method: 'delivery', pricing_version_id: 'pv-1', pricing_context_json: {},
    internal_cost_json: {}, margin_json: {}, breakdown_json: {},
  };

  global.fetch = jest.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    fetchCalls.push({ url, method: init?.method });
    if (url.includes('/issue') && !url.includes('/issueLink') && init?.method === 'POST') {
      return { ok: true, json: async () => ({ id: '10001', key: 'WO-99' }) } as Response;
    }
    if (url.includes('/issueLink')) {
      return { ok: true, json: async () => ({}) } as Response;
    }
    return { ok: true, json: async () => ({}) } as Response;
  }) as unknown as typeof fetch;
});

afterEach(() => {
  jest.resetModules();
  delete process.env.JIRA_PRICE_BREAKDOWN_ISSUE_ENABLED;
  delete process.env.JIRA_BASE_URL;
  delete process.env.JIRA_EMAIL;
  delete process.env.JIRA_API_TOKEN;
});

describe('reconcilePendingPriceBreakdownIssues', () => {
  it('does nothing when JIRA_PRICE_BREAKDOWN_ISSUE_ENABLED is not "true"', async () => {
    process.env.JIRA_PRICE_BREAKDOWN_ISSUE_ENABLED = 'false';
    const { reconcilePendingPriceBreakdownIssues } = await import('../integrations');
    await reconcilePendingPriceBreakdownIssues();
    expect(fetchCalls.length).toBe(0);
    expect(jobsUpdates.length).toBe(0);
  });

  it('creates a price breakdown issue for a candidate job missing one', async () => {
    const { reconcilePendingPriceBreakdownIssues } = await import('../integrations');
    await reconcilePendingPriceBreakdownIssues();

    const issueCreateCall = fetchCalls.find((c) => c.url.includes('/issue') && !c.url.includes('/issueLink'));
    expect(issueCreateCall).toBeDefined();

    const linkCall = fetchCalls.find((c) => c.url.includes('/issueLink'));
    expect(linkCall).toBeDefined();

    const jobUpdate = jobsUpdates.find((u) => u.table === 'jobs' && (u.payload as Record<string, unknown>).price_jira_issue_key === 'WO-99');
    expect(jobUpdate).toBeDefined();
  });

  it('skips a candidate gracefully when its document is missing (does not throw, does not block other candidates)', async () => {
    documentRow = null;
    const { reconcilePendingPriceBreakdownIssues } = await import('../integrations');
    await expect(reconcilePendingPriceBreakdownIssues()).resolves.not.toThrow();
    expect(fetchCalls.some((c) => c.url.includes('/issue') && !c.url.includes('/issueLink'))).toBe(false);
  });

  it('does nothing when there are no candidates', async () => {
    candidateJobs = [];
    const { reconcilePendingPriceBreakdownIssues } = await import('../integrations');
    await reconcilePendingPriceBreakdownIssues();
    expect(fetchCalls.length).toBe(0);
  });
});
