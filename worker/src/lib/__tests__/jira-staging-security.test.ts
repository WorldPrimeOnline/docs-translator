/**
 * @jest-environment node
 *
 * 2026-08-01: on staging, every Jira issue this project creates gets a hardcoded
 * "Admin" issue security level (JIRA_ADMIN_SECURITY_LEVEL_ID = '10000', looked up
 * via the real Jira metadata API for project WO — see
 * scripts/staging/find-jira-security-levels.ts). Production issues get no security
 * field at all. Drives the real initializeOrderIntegrations() -> createJiraIssue()
 * path end-to-end, asserting on the actual POST payload sent to Jira — same pattern
 * as notary-urgency-jira-payload.test.ts.
 *
 * Uses dynamic import() inside test bodies so this file's module-scope mock state
 * doesn't collide with other test files (see jira-recovery.test.ts).
 */
export {};

interface FakeJob {
  jira_issue_key: string | null;
  jira_issue_url: string | null;
  google_drive_folder_id: string | null;
  google_drive_folder_url: string | null;
}

const fetchCalls: Array<{ url: string; method: string | undefined; body: string | undefined }> = [];
let fakeJob: FakeJob;

function makeQuery(table: string) {
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    in: () => chain,
    is: () => chain,
    lt: () => chain,
    order: () => chain,
    limit: () => chain,
    single: async () => (table === 'jobs' ? { data: fakeJob, error: null } : { data: null, error: { message: 'not found' } }),
    maybeSingle: async () => (table === 'jobs' ? { data: fakeJob, error: null } : { data: null, error: null }),
    update: () => ({ eq: async () => ({ data: null, error: null }) }),
    insert: () => Promise.resolve({ data: null, error: null }),
    then: (onFulfilled: (v: { data: unknown; error: unknown }) => void) => onFulfilled({ data: [], error: null }),
  };
  return chain;
}

jest.mock('../supabase', () => ({ supabase: { from: (table: string) => makeQuery(table) } }));
jest.mock('../env', () => ({ env: { SITE_URL: 'https://wpo.test' } }));
jest.mock('../r2', () => ({ downloadFile: jest.fn() }));

const ORIGINAL_APP_ENV = process.env.APP_ENV;

beforeEach(() => {
  fetchCalls.length = 0;
  jest.resetModules();

  process.env.JIRA_BASE_URL = 'https://wpo.atlassian.net';
  process.env.JIRA_EMAIL = 'bot@wpo.test';
  process.env.JIRA_API_TOKEN = 'test-token';
  process.env.JIRA_PROJECT_KEY = 'WO';

  fakeJob = { jira_issue_key: null, jira_issue_url: null, google_drive_folder_id: null, google_drive_folder_url: null };

  global.fetch = jest.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    fetchCalls.push({ url, method: init?.method, body: init?.body as string | undefined });
    if (url.includes('/issue') && init?.method === 'POST') {
      return { ok: true, status: 200, json: async () => ({ id: '1', key: 'WO-99' }), text: async () => '' } as unknown as Response;
    }
    return { ok: true, json: async () => ({}) } as unknown as Response;
  }) as unknown as typeof fetch;
});

afterEach(() => {
  delete process.env.JIRA_BASE_URL;
  delete process.env.JIRA_EMAIL;
  delete process.env.JIRA_API_TOKEN;
  delete process.env.JIRA_PROJECT_KEY;
  if (ORIGINAL_APP_ENV === undefined) delete process.env.APP_ENV;
  else process.env.APP_ENV = ORIGINAL_APP_ENV;
});

function getIssueCreateFields(): Record<string, unknown> {
  const call = fetchCalls.find((c) => c.url.endsWith('/issue') && c.method === 'POST');
  expect(call?.body).toBeDefined();
  return (JSON.parse(call!.body!) as { fields: Record<string, unknown> }).fields;
}

describe('main order Jira issue — staging Admin security level', () => {
  it('staging: notarized order — main issue fields.security is the hardcoded Admin level', async () => {
    process.env.APP_ENV = 'staging';
    const { initializeOrderIntegrations } = await import('../integrations');
    await initializeOrderIntegrations({
      jobId: 'job-staging-2',
      serviceLevel: 'notarization_through_partners' as never,
      sourceLang: 'ru',
      targetLang: 'en',
      documentType: 'other|docx',
    });

    const fields = getIssueCreateFields();
    expect(fields.security).toEqual({ id: '10000' });
  });

  it('production: notarized order — fields.security is completely absent', async () => {
    process.env.APP_ENV = 'production';
    const { initializeOrderIntegrations } = await import('../integrations');
    await initializeOrderIntegrations({
      jobId: 'job-prod-1',
      serviceLevel: 'notarization_through_partners' as never,
      sourceLang: 'ru',
      targetLang: 'en',
      documentType: 'other|docx',
    });

    const fields = getIssueCreateFields();
    expect('security' in fields).toBe(false);
  });

  it('the rest of the payload (project, issuetype, summary, custom fields) is identical between staging and production — only security and the env label legitimately differ', async () => {
    process.env.APP_ENV = 'staging';
    const { initializeOrderIntegrations: initStaging } = await import('../integrations');
    await initStaging({
      jobId: 'job-compare-1',
      serviceLevel: 'notarization_through_partners' as never,
      sourceLang: 'ru',
      targetLang: 'en',
      documentType: 'other|docx',
      applicantType: 'individual',
    });
    const stagingFields = getIssueCreateFields();

    fetchCalls.length = 0;
    jest.resetModules();
    fakeJob = { jira_issue_key: null, jira_issue_url: null, google_drive_folder_id: null, google_drive_folder_url: null };
    process.env.APP_ENV = 'production';
    const { initializeOrderIntegrations: initProd } = await import('../integrations');
    await initProd({
      jobId: 'job-compare-1', // same jobId → same summary/orderId field
      serviceLevel: 'notarization_through_partners' as never,
      sourceLang: 'ru',
      targetLang: 'en',
      documentType: 'other|docx',
      applicantType: 'individual',
    });
    const prodFields = getIssueCreateFields();

    // security legitimately differs (the fix under test) and labels legitimately
    // differs (wpo-staging vs wpo-production, pre-existing behavior) — description
    // also contains a live timestamp, so compare only the genuinely-stable fields.
    expect(stagingFields.project).toEqual(prodFields.project);
    expect(stagingFields.issuetype).toEqual(prodFields.issuetype);
    expect(stagingFields.summary).toEqual(prodFields.summary);
    expect(stagingFields.customfield_10074).toEqual(prodFields.customfield_10074);
    expect(stagingFields.customfield_10073).toEqual(prodFields.customfield_10073);
  });
});
