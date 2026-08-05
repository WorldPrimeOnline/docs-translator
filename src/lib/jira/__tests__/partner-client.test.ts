/**
 * Tests for createPartnerApplicationIssue() — 2026-08-01: project WPO (partner
 * applications) has NO Jira issue security scheme at all, verified on three
 * independent Jira REST API endpoints (see partner-client.ts's own comment and
 * scripts/staging/find-jira-security-levels.ts) — never assumed from a single
 * endpoint. This must stay true regardless of APP_ENV/NEXT_PUBLIC_APP_ENV: setting
 * fields.security here would make every staging issue creation fail with a 400.
 */
jest.mock('../config', () => ({
  getJiraCredentials: jest.fn(),
  makeAuthHeader: () => 'Basic dGVzdA==',
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getJiraCredentials: mockGetCreds } = require('../config') as { getJiraCredentials: jest.Mock };

import { createPartnerApplicationIssue } from '../partner-client';

const MOCK_CREDS = {
  baseUrl: 'https://wpo.atlassian.net',
  email: 'svc@wpo.com',
  apiToken: 'test-token',
  webhookSecret: 'secret',
};

const BASE_PARAMS = {
  applicationId: 'app-uuid-1',
  partnerType: 'translator' as const,
  name: 'Test Partner',
  email: 'partner@example.com',
  createdAt: '2026-08-01T00:00:00Z',
};

function mockFetchOk(): void {
  (global.fetch as jest.Mock).mockResolvedValueOnce({
    ok: true,
    json: async () => ({ id: '20001', key: 'WPO-5' }),
    text: async () => '',
  });
}

function parsedBody(): Record<string, unknown> {
  const call = ((global.fetch as jest.Mock).mock.calls as [string, { body: string }][])[0];
  if (!call) throw new Error('fetch was not called');
  return JSON.parse(call[1].body) as Record<string, unknown>;
}

const ORIGINAL_APP_ENV = process.env.NEXT_PUBLIC_APP_ENV;

beforeEach(() => {
  mockGetCreds.mockReturnValue(MOCK_CREDS);
  global.fetch = jest.fn();
});

afterEach(() => {
  jest.clearAllMocks();
  if (ORIGINAL_APP_ENV === undefined) delete process.env.NEXT_PUBLIC_APP_ENV;
  else process.env.NEXT_PUBLIC_APP_ENV = ORIGINAL_APP_ENV;
});

describe('createPartnerApplicationIssue — WPO has no security scheme (verified)', () => {
  it('production: no security field (baseline, unchanged)', async () => {
    process.env.NEXT_PUBLIC_APP_ENV = 'production';
    mockFetchOk();
    await createPartnerApplicationIssue(BASE_PARAMS);

    const fields = parsedBody().fields as Record<string, unknown>;
    expect('security' in fields).toBe(false);
  });

  it('staging: STILL no security field — WPO has no scheme to apply Admin (or any level) against', async () => {
    process.env.NEXT_PUBLIC_APP_ENV = 'staging';
    mockFetchOk();
    await createPartnerApplicationIssue(BASE_PARAMS);

    const fields = parsedBody().fields as Record<string, unknown>;
    expect('security' in fields).toBe(false);
    // project/issuetype are still project WPO's own values, unaffected
    expect((fields.project as Record<string, string>).key).toBe('WPO');
    expect((fields.issuetype as Record<string, string>).name).toBe('Partnership');
  });

  it('the labels-retry-on-400 fallback also never introduces a security field', async () => {
    process.env.NEXT_PUBLIC_APP_ENV = 'staging';
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({ ok: false, status: 400, text: async () => 'field labels is not valid' })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: '20002', key: 'WPO-6' }), text: async () => '' });

    await createPartnerApplicationIssue(BASE_PARAMS);

    const calls = (global.fetch as jest.Mock).mock.calls as [string, { body: string }][];
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      const body = JSON.parse(call[1].body) as { fields: Record<string, unknown> };
      expect('security' in body.fields).toBe(false);
    }
  });
});
