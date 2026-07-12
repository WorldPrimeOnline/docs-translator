/**
 * @jest-environment node
 *
 * Integration-style test: confirms that when an order was placed via a partner
 * referral, the partner's Application ID (partner_applications.id, stored on
 * partners.application_id) reaches the main Jira order issue's customfield_10121
 * — not just that the pure field-builder in order-fields.ts is correct
 * (worker/src/lib/jira/__tests__/order-fields.test.ts already covers that).
 */

// Dynamic import() only inside test bodies, no top-level static import/export —
// force module scope so top-level consts don't collide with sibling test files.
export {};

const fetchCalls: Array<{ url: string; body: string | undefined }> = [];
let referralPartnerId: string | null = null;
let partnerApplicationId: string | null = null;

jest.mock('../supabase', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'partner_referrals') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: referralPartnerId ? { partner_id: referralPartnerId } : null, error: null }),
            }),
          }),
        };
      }
      if (table === 'partners') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: partnerApplicationId ? { application_id: partnerApplicationId } : null, error: null }),
            }),
          }),
        };
      }
      // jobs (and anything else touched by the idempotency guard / job updates)
      return {
        select: () => ({
          eq: () => ({
            single: async () => ({ data: null, error: null }), // no existing jira/drive record — proceeds to create
          }),
        }),
        update: () => ({ eq: async () => ({ data: null, error: null }) }),
      };
    },
  },
}));

jest.mock('../google-drive', () => ({
  createOrderFolder: jest.fn(),
  uploadFileToDrive: jest.fn(),
  getSubfolderId: jest.fn(),
  isDriveConfigured: () => false, // Drive out of scope for this test — only Jira fields matter here
  DRIVE_SUBFOLDER_NAMES: { source: '01_SOURCE', aiDraft: '02_AI_DRAFT' },
}));

jest.mock('../r2', () => ({ downloadFile: jest.fn() }));

beforeEach(() => {
  fetchCalls.length = 0;
  referralPartnerId = null;
  partnerApplicationId = null;
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

function issueFields(body: string): Record<string, unknown> {
  return (JSON.parse(body) as { fields: Record<string, unknown> }).fields;
}

describe('initializeOrderIntegrations — partner Application ID reaches customfield_10121', () => {
  const baseParams = {
    jobId: 'job-1',
    serviceLevel: 'notarization_through_partners' as const,
    sourceLang: 'ru',
    targetLang: 'zh',
    documentType: 'passport_id',
    customerId: 'user-1',
  };

  it('referred order — partners.application_id is written to customfield_10121', async () => {
    referralPartnerId = 'partner-1';
    partnerApplicationId = '34c19be3-f501-4c24-894f-e46d22c229d9';

    const { initializeOrderIntegrations } = await import('../integrations');
    await initializeOrderIntegrations(baseParams);

    const issueCreateCall = fetchCalls.find((c) => c.url.endsWith('/issue'));
    expect(issueCreateCall?.body).toBeDefined();
    const fields = issueFields(issueCreateCall!.body!);
    expect(fields['customfield_10121']).toBe('34c19be3-f501-4c24-894f-e46d22c229d9');
  });

  it('non-referred order — no partner_referrals row — customfield_10121 is omitted', async () => {
    referralPartnerId = null;

    const { initializeOrderIntegrations } = await import('../integrations');
    await initializeOrderIntegrations(baseParams);

    const issueCreateCall = fetchCalls.find((c) => c.url.endsWith('/issue'));
    const fields = issueFields(issueCreateCall!.body!);
    expect(fields['customfield_10121']).toBeUndefined();
  });

  it('referral row exists but partner has no application_id on file — field is omitted, never fabricated', async () => {
    referralPartnerId = 'partner-2';
    partnerApplicationId = null;

    const { initializeOrderIntegrations } = await import('../integrations');
    await initializeOrderIntegrations(baseParams);

    const issueCreateCall = fetchCalls.find((c) => c.url.endsWith('/issue'));
    const fields = issueFields(issueCreateCall!.body!);
    expect(fields['customfield_10121']).toBeUndefined();
  });

  it('electronic order — no main Jira issue at all, partner lookup is moot', async () => {
    referralPartnerId = 'partner-1';
    partnerApplicationId = '34c19be3-f501-4c24-894f-e46d22c229d9';

    const { initializeOrderIntegrations } = await import('../integrations');
    await initializeOrderIntegrations({ ...baseParams, serviceLevel: 'electronic' });

    const issueCreateCall = fetchCalls.find((c) => c.url.endsWith('/issue'));
    expect(issueCreateCall).toBeUndefined();
  });
});
