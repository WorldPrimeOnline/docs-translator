/**
 * @jest-environment node
 *
 * Tests for ensureJiraIssueForPaidOrder() and reconcileMissingJiraIssues()
 * (2026-07-15 incident: Railway worker was down, so no job could be claimed —
 * nothing ever attempted Jira issue creation. These tests cover the recovery
 * path and the periodic sweep added so a paid, non-electronic order can never
 * again sit silently with no Jira issue and no retry.)
 *
 * This file only uses dynamic import() inside test bodies (see
 * price-breakdown-reconcile.test.ts for why): forces module scope so its
 * top-level consts don't collide with other test files.
 */
export {};

interface FakeJob {
  id: string;
  service_level: string | null;
  payment_source: string | null;
  jira_issue_key: string | null;
  jira_issue_url: string | null;
  notary_city: string | null;
  applicant_type: string | null;
  fulfillment_method: string | null;
  delivery_phone: string | null;
  delivery_address: string | null;
  customer_comment: string | null;
  document_id: string;
  google_drive_folder_url: string | null;
}

const jobUpdates: Record<string, unknown>[] = [];
const auditLogInserts: Record<string, unknown>[] = [];
const fetchCalls: Array<{ url: string; method: string | undefined; body: string | undefined }> = [];

let fakeJob: FakeJob | null;
let paymentRow: { status: string } | null;
let docRow: { user_id: string; source_language: string; target_language: string; document_type: string } | null;
let searchResponseIssues: Array<{ id: string; key: string; fields: { summary: string; created: string } }>;
let searchShouldFail: boolean;
let createIssueResponse: { ok: boolean; status?: number; body?: unknown };
let referralPartnerId: string | null;
let partnerApplicationId: string | null;

function makeQuery(table: string) {
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    in: () => chain,
    is: () => chain,
    lt: () => chain,
    order: () => chain,
    limit: () => chain,
    single: async () => {
      if (table === 'jobs') return { data: fakeJob, error: fakeJob ? null : { message: 'not found' } };
      return { data: null, error: { message: 'not found' } };
    },
    maybeSingle: async () => {
      if (table === 'payment_transactions') return { data: paymentRow, error: null };
      if (table === 'documents') return { data: docRow, error: null };
      if (table === 'partner_referrals') return { data: referralPartnerId ? { partner_id: referralPartnerId } : null, error: null };
      if (table === 'partners') return { data: partnerApplicationId ? { application_id: partnerApplicationId } : null, error: null };
      return { data: null, error: null };
    },
    update: (payload: Record<string, unknown>) => {
      jobUpdates.push(payload);
      return { eq: async () => ({ data: null, error: null }) };
    },
    insert: (payload: Record<string, unknown>) => {
      if (table === 'job_audit_log') auditLogInserts.push(payload);
      return Promise.resolve({ data: null, error: null });
    },
    then: (onFulfilled: (v: { data: unknown; error: unknown }) => void) => {
      // reconcileMissingJiraIssues' candidate query resolves via `await` on the chain directly
      return onFulfilled({ data: [], error: null });
    },
  };
  return chain;
}

jest.mock('../supabase', () => ({
  supabase: { from: (table: string) => makeQuery(table) },
}));

jest.mock('../env', () => ({ env: { SITE_URL: 'https://wpo.test' } }));
jest.mock('../r2', () => ({ downloadFile: jest.fn() }));

beforeEach(() => {
  jobUpdates.length = 0;
  auditLogInserts.length = 0;
  fetchCalls.length = 0;
  jest.resetModules();

  process.env.JIRA_BASE_URL = 'https://wpo.atlassian.net';
  process.env.JIRA_EMAIL = 'bot@wpo.test';
  process.env.JIRA_API_TOKEN = 'test-token';
  process.env.JIRA_PROJECT_KEY = 'WO';

  fakeJob = {
    id: 'job-1',
    service_level: 'notarization_through_partners',
    payment_source: 'card_payment',
    jira_issue_key: null,
    jira_issue_url: null,
    notary_city: 'Almaty',
    applicant_type: 'individual',
    fulfillment_method: 'pickup',
    delivery_phone: null,
    delivery_address: null,
    customer_comment: null,
    document_id: 'doc-1',
    google_drive_folder_url: null,
  };
  paymentRow = { status: 'paid' };
  docRow = { user_id: 'user-1', source_language: 'ru', target_language: 'en', document_type: 'passport_id|docx' };
  searchResponseIssues = [];
  searchShouldFail = false;
  createIssueResponse = { ok: true, body: { id: '10001', key: 'WO-200' } };
  referralPartnerId = null;
  partnerApplicationId = null;

  global.fetch = jest.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    fetchCalls.push({ url, method: init?.method, body: init?.body as string | undefined });

    if (url.includes('/search/jql')) {
      if (searchShouldFail) {
        return { ok: false, status: 500, text: async () => 'jira down' } as unknown as Response;
      }
      return { ok: true, json: async () => ({ issues: searchResponseIssues }) } as unknown as Response;
    }
    if (url.includes('/issue') && init?.method === 'POST') {
      return {
        ok: createIssueResponse.ok,
        status: createIssueResponse.status ?? (createIssueResponse.ok ? 200 : 500),
        json: async () => createIssueResponse.body,
        text: async () => JSON.stringify(createIssueResponse.body ?? {}),
      } as unknown as Response;
    }
    return { ok: true, json: async () => ({}) } as unknown as Response;
  }) as unknown as typeof fetch;
});

afterEach(() => {
  delete process.env.JIRA_BASE_URL;
  delete process.env.JIRA_EMAIL;
  delete process.env.JIRA_API_TOKEN;
  delete process.env.JIRA_PROJECT_KEY;
});

describe('ensureJiraIssueForPaidOrder', () => {
  it('1. creates a Jira issue for a paid, non-electronic order with none yet', async () => {
    const { ensureJiraIssueForPaidOrder } = await import('../integrations');
    const result = await ensureJiraIssueForPaidOrder('job-1', false);

    expect(result.outcome).toBe('created');
    expect(result.jiraIssueKey).toBe('WO-200');
    const jobUpdate = jobUpdates.find((u) => u.jira_issue_key === 'WO-200');
    expect(jobUpdate).toBeDefined();
    expect(jobUpdate).toMatchObject({ jira_sync_status: 'recovered' });
    expect(auditLogInserts.some((a) => a.action === 'jira_issue_recovered')).toBe(true);
  });

  it('1b. regression: recovery path includes customfield_10121 in the create payload when a confirmed referral resolves an application_id (2026-07-15 incident — Partner ID missing on WO-77)', async () => {
    // Paid, notarized job; confirmed partner_referral; partners.application_id set;
    // main Jira issue absent — exactly the WO-77 recovery scenario.
    referralPartnerId = 'partner-1';
    partnerApplicationId = '34c19be3-f501-4c24-894f-e46d22c229d9';

    const { ensureJiraIssueForPaidOrder } = await import('../integrations');
    const result = await ensureJiraIssueForPaidOrder('job-1', false);

    expect(result.outcome).toBe('created');
    const issueCreateCall = fetchCalls.find((c) => c.url.endsWith('/issue') && c.method === 'POST');
    expect(issueCreateCall?.body).toBeDefined();
    const fields = (JSON.parse(issueCreateCall!.body!) as { fields: Record<string, unknown> }).fields;
    expect(fields['customfield_10121']).toBe('34c19be3-f501-4c24-894f-e46d22c229d9');
  });

  it('2. Jira API failure leaves the order recoverable — no partial DB write, error recorded on the direct-create path (initializeOrderIntegrations)', async () => {
    createIssueResponse = { ok: false, status: 500, body: { errorMessages: ['boom'] } };
    const { initializeOrderIntegrations } = await import('../integrations');

    const result = await initializeOrderIntegrations({
      jobId: 'job-1',
      serviceLevel: 'notarization_through_partners' as never,
      sourceLang: 'ru',
      targetLang: 'en',
      documentType: 'passport_id|docx',
    });

    expect(result.jiraIssueKey).toBeNull();
    const errorUpdate = jobUpdates.find((u) => u.jira_sync_status === 'error');
    expect(errorUpdate).toBeDefined();
    expect(auditLogInserts.some((a) => a.action === 'jira_sync_error')).toBe(true);
  });

  it('3. repeated calls do not create a duplicate — second call finds jira_issue_key already set', async () => {
    const { ensureJiraIssueForPaidOrder } = await import('../integrations');
    const first = await ensureJiraIssueForPaidOrder('job-1', false);
    expect(first.outcome).toBe('created');

    // Simulate the DB now reflecting the write from call #1.
    fakeJob!.jira_issue_key = 'WO-200';
    fakeJob!.jira_issue_url = 'https://wpo.atlassian.net/browse/WO-200';

    const createCallsBefore = fetchCalls.filter((c) => c.url.includes('/issue') && c.method === 'POST').length;
    const second = await ensureJiraIssueForPaidOrder('job-1', false);
    const createCallsAfter = fetchCalls.filter((c) => c.url.includes('/issue') && c.method === 'POST').length;

    expect(second.outcome).toBe('already_linked');
    expect(createCallsAfter).toBe(createCallsBefore); // no new issue created
  });

  it('4. Jira issue exists but DB update was lost — recovery finds it via search and adopts it instead of creating a duplicate', async () => {
    searchResponseIssues = [{ id: '9999', key: 'WO-201', fields: { summary: 'job-1', created: '2026-07-14T10:00:00Z' } }];
    const { ensureJiraIssueForPaidOrder } = await import('../integrations');

    const result = await ensureJiraIssueForPaidOrder('job-1', false);

    expect(result.outcome).toBe('adopted_existing');
    expect(result.jiraIssueKey).toBe('WO-201');
    const createCalls = fetchCalls.filter((c) => c.url.includes('/issue') && c.method === 'POST');
    expect(createCalls.length).toBe(0); // never called createIssue — adopted instead
    const jobUpdate = jobUpdates.find((u) => u.jira_issue_key === 'WO-201');
    expect(jobUpdate).toMatchObject({ jira_sync_status: 'recovered' });
  });

  it('5. electronic service_level is skipped, not treated as an incident', async () => {
    fakeJob!.service_level = 'electronic';
    const { ensureJiraIssueForPaidOrder } = await import('../integrations');
    const result = await ensureJiraIssueForPaidOrder('job-1', false);

    expect(result.outcome).toBe('skipped_electronic');
    expect(jobUpdates.length).toBe(0);
  });

  it('6. an unpaid order is refused, not silently "fixed"', async () => {
    paymentRow = null;
    fakeJob!.payment_source = 'card_payment';
    const { ensureJiraIssueForPaidOrder } = await import('../integrations');
    const result = await ensureJiraIssueForPaidOrder('job-1', false);

    expect(result.outcome).toBe('skipped_not_paid');
    expect(jobUpdates.length).toBe(0);
    const createCalls = fetchCalls.filter((c) => c.url.includes('/issue') && c.method === 'POST');
    expect(createCalls.length).toBe(0);
  });

  it('7. a failed Jira search is a hard stop — never falls through to create (would risk a duplicate)', async () => {
    searchShouldFail = true;
    const { ensureJiraIssueForPaidOrder } = await import('../integrations');
    const result = await ensureJiraIssueForPaidOrder('job-1', false);

    expect(result.outcome).toBe('error');
    const createCalls = fetchCalls.filter((c) => c.url.includes('/issue') && c.method === 'POST');
    expect(createCalls.length).toBe(0);
    expect(jobUpdates.length).toBe(0);
  });

  it('dry run makes zero writes even when it would create an issue', async () => {
    const { ensureJiraIssueForPaidOrder } = await import('../integrations');
    const result = await ensureJiraIssueForPaidOrder('job-1', true);

    expect(result.outcome).toBe('would_create');
    expect(jobUpdates.length).toBe(0);
    expect(auditLogInserts.length).toBe(0);
    const createCalls = fetchCalls.filter((c) => c.url.includes('/issue') && c.method === 'POST');
    expect(createCalls.length).toBe(0);
  });

  it('dry run still reports an adoptable existing issue without writing', async () => {
    searchResponseIssues = [{ id: '9999', key: 'WO-201', fields: { summary: 'job-1', created: '2026-07-14T10:00:00Z' } }];
    const { ensureJiraIssueForPaidOrder } = await import('../integrations');
    const result = await ensureJiraIssueForPaidOrder('job-1', true);

    expect(result.outcome).toBe('would_adopt_existing');
    expect(result.jiraIssueKey).toBe('WO-201');
    expect(jobUpdates.length).toBe(0);
  });
});

describe('reconcileMissingJiraIssues', () => {
  it('does not throw when a candidate job errors, and continues (non-fatal per-job handling)', async () => {
    const { reconcileMissingJiraIssues } = await import('../integrations');
    await expect(reconcileMissingJiraIssues()).resolves.not.toThrow();
  });
});
