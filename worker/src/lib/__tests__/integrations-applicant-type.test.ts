/**
 * @jest-environment node
 *
 * Integration-style test: confirms applicantType actually reaches the Jira
 * issue-creation POST body's description, not just that the pure label helper
 * is correct (worker/src/lib/jira/__tests__/order-fields.test.ts already covers
 * that). WO-75 incident follow-up, 2026-07-10 — the customer's individual vs
 * legal_entity choice (jobs.applicant_type, migration 0046) determines the
 * notary official fee tier but had no visibility in Jira.
 */

const jobsUpdates: Record<string, unknown>[] = [];
const fetchCalls: Array<{ url: string; body: string | undefined }> = [];

jest.mock('../supabase', () => ({
  supabase: {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: null, error: null }), // no existing jira/drive record — proceeds to create
        }),
      }),
      update: (payload: Record<string, unknown>) => {
        jobsUpdates.push({ table, payload });
        return { eq: async () => ({ data: null, error: null }) };
      },
    }),
  },
}));

jest.mock('../google-drive', () => ({
  createOrderFolder: jest.fn(),
  uploadFileToDrive: jest.fn(),
  getSubfolderId: jest.fn(),
  isDriveConfigured: () => false, // Drive out of scope for this test — only Jira description matters here
  DRIVE_SUBFOLDER_NAMES: { source: '01_SOURCE', aiDraft: '02_AI_DRAFT' },
}));

jest.mock('../r2', () => ({ downloadFile: jest.fn() }));

beforeEach(() => {
  jobsUpdates.length = 0;
  fetchCalls.length = 0;
  process.env.JIRA_BASE_URL = 'https://wpo.atlassian.net';
  process.env.JIRA_EMAIL = 'bot@wpo.test';
  process.env.JIRA_API_TOKEN = 'test-token';

  global.fetch = jest.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body as string | undefined;
    fetchCalls.push({ url, body });
    if (url.endsWith('/issue') && init?.method === 'POST') {
      return { ok: true, json: async () => ({ id: '10001', key: 'WO-99' }) } as Response;
    }
    return { ok: true, json: async () => ({}) } as Response;
  }) as unknown as typeof fetch;
});

afterEach(() => {
  jest.resetModules();
  delete process.env.JIRA_BASE_URL;
  delete process.env.JIRA_EMAIL;
  delete process.env.JIRA_API_TOKEN;
});

function descriptionText(body: string): string {
  const parsed = JSON.parse(body) as { fields: { description: { content: Array<{ content: Array<{ text: string }> }> } } };
  return parsed.fields.description.content.map((p) => p.content.map((c) => c.text).join('')).join('\n');
}

describe('initializeOrderIntegrations — applicant type reaches the Jira issue description', () => {
  const baseParams = {
    jobId: 'job-1',
    serviceLevel: 'notarization_through_partners' as const,
    sourceLang: 'ru',
    targetLang: 'zh',
    documentType: 'passport_id',
    customerId: 'user-1',
  };

  it('individual — appears as "Физическое лицо"', async () => {
    const { initializeOrderIntegrations } = await import('../integrations');
    await initializeOrderIntegrations({ ...baseParams, applicantType: 'individual' });

    const issueCreateCall = fetchCalls.find((c) => c.url.endsWith('/issue'));
    expect(issueCreateCall?.body).toBeDefined();
    const desc = descriptionText(issueCreateCall!.body!);
    expect(desc).toContain('Тип заказчика для нотариального тарифа: Физическое лицо');
  });

  it('legal_entity — appears as "Юридическое лицо"', async () => {
    const { initializeOrderIntegrations } = await import('../integrations');
    await initializeOrderIntegrations({ ...baseParams, applicantType: 'legal_entity' });

    const issueCreateCall = fetchCalls.find((c) => c.url.endsWith('/issue'));
    const desc = descriptionText(issueCreateCall!.body!);
    expect(desc).toContain('Тип заказчика для нотариального тарифа: Юридическое лицо');
  });

  it('null (old order, never recorded) — no fabricated line appears anywhere in the description', async () => {
    const { initializeOrderIntegrations } = await import('../integrations');
    await initializeOrderIntegrations({ ...baseParams, applicantType: null });

    const issueCreateCall = fetchCalls.find((c) => c.url.endsWith('/issue'));
    const desc = descriptionText(issueCreateCall!.body!);
    expect(desc).not.toContain('Тип заказчика');
  });
});
