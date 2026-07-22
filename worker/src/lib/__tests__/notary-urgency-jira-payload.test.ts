/**
 * @jest-environment node
 *
 * End-to-end test (WO-77 incident, 2026-07-15): the main Jira issue's description
 * must explicitly show notary urgency — including a 0 KZT surcharge — and must
 * never show it for non-notarized service levels. Drives the real
 * initializeOrderIntegrations() -> createJiraIssue() path, asserting on the
 * actual POST payload sent to Jira (same pattern as jira-recovery.test.ts's
 * customfield_10121 regression test).
 *
 * Uses dynamic import() inside test bodies so this file's module-scope mock
 * state doesn't collide with other test files (see jira-recovery.test.ts).
 */
export {};

interface FakeJob {
  jira_issue_key: string | null;
  jira_issue_url: string | null;
  google_drive_folder_id: string | null;
  google_drive_folder_url: string | null;
  notary_urgency_level: string | null;
  notary_urgency_window: string | null;
  notary_urgency_multiplier: number | null;
  notary_urgency_cutoff_at: string | null;
  notary_urgency_fee_kzt: number | null;
}

const jobUpdates: Record<string, unknown>[] = [];
const fetchCalls: Array<{ url: string; method: string | undefined; body: string | undefined }> = [];

let fakeJob: FakeJob;
let fakeQuote: Record<string, unknown> | null;

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
      if (table === 'jobs') return { data: fakeJob, error: null };
      return { data: null, error: { message: 'not found' } };
    },
    maybeSingle: async () => {
      if (table === 'jobs') return { data: fakeJob, error: null };
      if (table === 'price_quotes') return { data: fakeQuote, error: null };
      if (table === 'partner_referrals') return { data: null, error: null };
      if (table === 'partners') return { data: null, error: null };
      return { data: null, error: null };
    },
    update: (payload: Record<string, unknown>) => {
      jobUpdates.push(payload);
      return { eq: async () => ({ data: null, error: null }) };
    },
    insert: () => Promise.resolve({ data: null, error: null }),
    then: (onFulfilled: (v: { data: unknown; error: unknown }) => void) => onFulfilled({ data: [], error: null }),
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
  fetchCalls.length = 0;
  jest.resetModules();

  process.env.JIRA_BASE_URL = 'https://wpo.atlassian.net';
  process.env.JIRA_EMAIL = 'bot@wpo.test';
  process.env.JIRA_API_TOKEN = 'test-token';
  process.env.JIRA_PROJECT_KEY = 'WO';

  fakeJob = {
    jira_issue_key: null,
    jira_issue_url: null,
    google_drive_folder_id: null,
    google_drive_folder_url: null,
    notary_urgency_level: null,
    notary_urgency_window: null,
    notary_urgency_multiplier: null,
    notary_urgency_cutoff_at: null,
    notary_urgency_fee_kzt: null,
  };
  fakeQuote = null;

  global.fetch = jest.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    fetchCalls.push({ url, method: init?.method, body: init?.body as string | undefined });
    if (url.includes('/issue') && init?.method === 'POST') {
      return { ok: true, status: 200, json: async () => ({ id: '1', key: 'WO-77' }), text: async () => '' } as unknown as Response;
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

function getIssueCreatePayload(): { description: unknown } {
  const call = fetchCalls.find((c) => c.url.endsWith('/issue') && c.method === 'POST');
  expect(call?.body).toBeDefined();
  return (JSON.parse(call!.body!) as { fields: { description: unknown } }).fields as unknown as { description: unknown };
}

describe('createJiraIssue description — notary urgency (WO-77, 2026-07-15)', () => {
  it('7/8. WO-77 exact case: same_day resolved to multiplier 1.0 and 0 KZT surcharge is shown, not omitted', async () => {
    fakeJob.notary_urgency_level = 'same_day';
    fakeJob.notary_urgency_window = 'before_noon';
    fakeJob.notary_urgency_multiplier = 1.0;
    fakeJob.notary_urgency_cutoff_at = '2026-07-15T07:00:00.000Z';
    fakeJob.notary_urgency_fee_kzt = 0;

    const { initializeOrderIntegrations } = await import('../integrations');
    await initializeOrderIntegrations({
      jobId: 'wo77-job',
      serviceLevel: 'notarization_through_partners' as never,
      sourceLang: 'ru',
      targetLang: 'en',
      documentType: 'other|docx',
    });

    const text = JSON.stringify(getIssueCreatePayload());
    expect(text).toContain('Срочность нотариального оформления');
    expect(text).toContain('В тот же день');
    expect(text).toContain('До 12:00 Алматы');
    expect(text).toContain('×1.0');
    expect(text).toContain('Доплата за срочность: 0 ₸');
    expect(text).toContain('Доступность нотариуса: требует операционного подтверждения');
  });

  it('does not show any notary urgency line for official (non-notarized) service level, even if jobs columns happen to be set', async () => {
    fakeJob.notary_urgency_level = 'same_day'; // should never be read for this service level
    fakeJob.notary_urgency_window = 'before_noon';
    fakeJob.notary_urgency_multiplier = 1.0;
    fakeJob.notary_urgency_fee_kzt = 0;

    const { initializeOrderIntegrations } = await import('../integrations');
    await initializeOrderIntegrations({
      jobId: 'official-job',
      serviceLevel: 'official_with_translator_signature_and_provider_stamp' as never,
      sourceLang: 'ru',
      targetLang: 'en',
      documentType: 'other|docx',
    });

    const text = JSON.stringify(getIssueCreatePayload());
    expect(text).not.toContain('Срочность нотариального оформления');
  });

  it('legacy job (no jobs columns): reads notary urgency from price_quotes.pricing_context_json fallback', async () => {
    fakeQuote = {
      pricing_context_json: {
        notaryCutoff: {
          notaryUrgencyLevel: 'same_day',
          effectiveWindow: 'after_noon',
          multiplier: 1.5,
          cutoffAt: '2026-05-01T13:00:00.000Z',
        },
      },
      breakdown_json: { items: [{ itemType: 'notary_urgency_fee', amountKzt: 2500 }] },
    };

    const { initializeOrderIntegrations } = await import('../integrations');
    await initializeOrderIntegrations({
      jobId: 'legacy-job',
      serviceLevel: 'notarization_through_partners' as never,
      sourceLang: 'ru',
      targetLang: 'en',
      documentType: 'other|docx',
    });

    const text = JSON.stringify(getIssueCreatePayload());
    expect(text).toContain('В тот же день');
    expect(text).toContain('12:00–18:00 Алматы');
    expect(text).toContain('×1.5');
    expect(text).toContain('Доплата за срочность: 2500 ₸');
  });
});
