/**
 * @jest-environment node
 *
 * Tests for reconcileMissingPartnerIds() (WO-77/WO-78 incident follow-up,
 * 2026-07-15) — the periodic sweep that backfills customfield_10121 (Partner
 * ID) on already-created main Jira issues for referred, paid certified/
 * notarized orders.
 */

// Dynamic import() only inside test bodies — forces module scope so top-level
// consts don't collide with sibling test files (same convention as
// price-breakdown-reconcile.test.ts).
export {};

const jobUpdates: Record<string, unknown>[] = [];
const auditInserts: Record<string, unknown>[] = [];
const fetchCalls: Array<{ url: string; method: string | undefined; body: string | undefined }> = [];
const limitCalls: Array<{ table: string; n: number }> = [];

let candidateJobs: Array<{ id: string; jira_issue_key: string; service_level: string; created_at: string }>;
let referralByJob: Record<string, { partner_id: string } | null>;
let partnerById: Record<string, { application_id: string | null } | null>;
let jiraCustomFieldByIssue: Record<string, string | null>;

function makeQuery(table: string) {
  let lastEqCol = '';
  let lastEqVal = '';
  const chain: Record<string, unknown> = {
    select: () => chain,
    not: () => chain,
    in: () => chain,
    gt: () => chain,
    order: () => chain,
    limit: (n: number) => { limitCalls.push({ table, n }); return chain; },
    eq: (col: string, val: string) => { lastEqCol = col; lastEqVal = val; return chain; },
    maybeSingle: async () => {
      if (table === 'partner_referrals') {
        return { data: referralByJob[lastEqVal] ?? null, error: null };
      }
      if (table === 'partners') {
        return { data: partnerById[lastEqVal] ?? null, error: null };
      }
      return { data: null, error: null };
    },
    update: (payload: Record<string, unknown>) => {
      jobUpdates.push({ table, payload });
      return { eq: () => Promise.resolve({ error: null }) };
    },
    insert: (payload: Record<string, unknown>) => {
      auditInserts.push(payload);
      return Promise.resolve({ data: null, error: null });
    },
    then: (onFulfilled: (v: { data: unknown; error: unknown }) => void) => {
      if (table === 'jobs') {
        return onFulfilled({ data: candidateJobs, error: null });
      }
      return onFulfilled({ data: null, error: null });
    },
  };
  void lastEqCol;
  return chain;
}

jest.mock('../supabase', () => ({
  supabase: { from: (table: string) => makeQuery(table) },
}));

jest.mock('../env', () => ({ env: { SITE_URL: 'https://wpo.test' } }));
jest.mock('../r2', () => ({ downloadFile: jest.fn() }));

beforeEach(() => {
  jobUpdates.length = 0;
  auditInserts.length = 0;
  fetchCalls.length = 0;
  limitCalls.length = 0;
  delete process.env.PARTNER_ID_RECONCILE_BATCH_SIZE;
  process.env.JIRA_BASE_URL = 'https://wpo.atlassian.net';
  process.env.JIRA_EMAIL = 'bot@wpo.test';
  process.env.JIRA_API_TOKEN = 'test-token';

  candidateJobs = [{ id: 'job-1', jira_issue_key: 'WO-78', service_level: 'notarization_through_partners', created_at: new Date().toISOString() }];
  referralByJob = { 'job-1': { partner_id: 'partner-1' } };
  partnerById = { 'partner-1': { application_id: '34c19be3-f501-4c24-894f-e46d22c229d9' } };
  jiraCustomFieldByIssue = { 'WO-78': null };

  global.fetch = jest.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method;
    fetchCalls.push({ url, method, body: init?.body as string | undefined });

    if (method === undefined || method === 'GET') {
      const issueKey = url.match(/\/issue\/([^?]+)/)?.[1] ?? '';
      return { ok: true, json: async () => ({ fields: { customfield_10121: jiraCustomFieldByIssue[issueKey] ?? null } }) } as unknown as Response;
    }
    if (method === 'PUT') {
      const issueKey = url.match(/\/issue\/([^?]+)/)?.[1] ?? '';
      const body = JSON.parse(init?.body as string) as { fields: Record<string, unknown> };
      jiraCustomFieldByIssue[issueKey] = body.fields['customfield_10121'] as string;
      return { ok: true, json: async () => ({}) } as unknown as Response;
    }
    return { ok: true, json: async () => ({}) } as unknown as Response;
  }) as unknown as typeof fetch;
});

afterEach(() => {
  jest.resetModules();
  delete process.env.JIRA_BASE_URL;
  delete process.env.JIRA_EMAIL;
  delete process.env.JIRA_API_TOKEN;
});

describe('reconcileMissingPartnerIds', () => {
  it('backfills customfield_10121 for a candidate with a referral and application_id, and writes an audit event', async () => {
    const { reconcileMissingPartnerIds } = await import('../integrations');
    await reconcileMissingPartnerIds();

    const putCall = fetchCalls.find((c) => c.method === 'PUT');
    expect(putCall).toBeDefined();
    expect(JSON.parse(putCall!.body!).fields.customfield_10121).toBe('34c19be3-f501-4c24-894f-e46d22c229d9');
    expect(auditInserts.some((a) => a.action === 'partner_id_backfilled')).toBe(true);
  });

  it('skips a candidate with no referral — no Jira call at all', async () => {
    referralByJob = { 'job-1': null };
    const { reconcileMissingPartnerIds } = await import('../integrations');
    await reconcileMissingPartnerIds();

    expect(fetchCalls.length).toBe(0);
    expect(auditInserts.length).toBe(0);
  });

  it('skips a candidate whose partner has no application_id on file — no Jira call', async () => {
    partnerById = { 'partner-1': { application_id: null } };
    const { reconcileMissingPartnerIds } = await import('../integrations');
    await reconcileMissingPartnerIds();

    expect(fetchCalls.length).toBe(0);
    expect(auditInserts.length).toBe(0);
  });

  it('is a silent no-op when customfield_10121 is already set — no PUT, no audit log', async () => {
    jiraCustomFieldByIssue = { 'WO-78': '34c19be3-f501-4c24-894f-e46d22c229d9' };
    const { reconcileMissingPartnerIds } = await import('../integrations');
    await reconcileMissingPartnerIds();

    const putCall = fetchCalls.find((c) => c.method === 'PUT');
    expect(putCall).toBeUndefined();
    expect(auditInserts.length).toBe(0);
  });

  it('does nothing when there are no candidates', async () => {
    candidateJobs = [];
    const { reconcileMissingPartnerIds } = await import('../integrations');
    await reconcileMissingPartnerIds();

    expect(fetchCalls.length).toBe(0);
  });

  it('a Jira failure for one candidate is non-fatal and does not throw', async () => {
    candidateJobs = [
      { id: 'job-1', jira_issue_key: 'WO-78', service_level: 'notarization_through_partners', created_at: new Date().toISOString() },
      { id: 'job-2', jira_issue_key: 'WO-79', service_level: 'notarization_through_partners', created_at: new Date().toISOString() },
    ];
    referralByJob = { 'job-1': { partner_id: 'partner-1' }, 'job-2': { partner_id: 'partner-1' } };
    jiraCustomFieldByIssue = { 'WO-78': null, 'WO-79': null };

    global.fetch = jest.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('WO-78')) return { ok: false, status: 500, text: async () => 'boom' } as unknown as Response;
      const method = init?.method;
      if (method === undefined || method === 'GET') {
        return { ok: true, json: async () => ({ fields: { customfield_10121: null } }) } as unknown as Response;
      }
      return { ok: true, json: async () => ({}) } as unknown as Response;
    }) as unknown as typeof fetch;

    const { reconcileMissingPartnerIds } = await import('../integrations');
    await expect(reconcileMissingPartnerIds()).resolves.not.toThrow();
  });

  it('defaults the per-cycle batch size to 10', async () => {
    const { reconcileMissingPartnerIds } = await import('../integrations');
    await reconcileMissingPartnerIds();
    const jobsLimitCall = limitCalls.find((c) => c.table === 'jobs');
    expect(jobsLimitCall?.n).toBe(10);
  });

  it('respects PARTNER_ID_RECONCILE_BATCH_SIZE', async () => {
    process.env.PARTNER_ID_RECONCILE_BATCH_SIZE = '3';
    const { reconcileMissingPartnerIds } = await import('../integrations');
    await reconcileMissingPartnerIds();
    const jobsLimitCall = limitCalls.find((c) => c.table === 'jobs');
    expect(jobsLimitCall?.n).toBe(3);
  });
});
