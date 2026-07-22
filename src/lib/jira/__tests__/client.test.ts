/**
 * @jest-environment node
 *
 * Tests for the simplified Jira client:
 *  1. Certified order → project.key=WO, issuetype.name=Заказ
 *  2. Notarized order → single POST /issue
 *  3. Returns null when Jira not configured (electronic orders never create issues)
 *  4. summary = job UUID only
 *  5. Returns {issueId, issueKey, issueUrl} from Jira response
 *  6. No assignee or security fields in body (no discovery calls)
 *  7. Throws on API error so caller can save jira_sync_status=failed
 *  8. Only one fetch call — no user/security/transition discovery
 *  9. Description ADF contains no phone numbers or street address patterns
 * 10. Description includes Drive URL and WPO order URL
 */

jest.mock('../config', () => ({
  getJiraCredentials: jest.fn(),
  makeAuthHeader: () => 'Basic dGVzdA==',
  getJiraConfig: jest.fn(),
}));

jest.mock('../project-config', () => ({
  JIRA_PROJECT_CONFIG: { projectKey: 'WO' },
  JIRA_ISSUE_TYPE: 'Заказ',
  JIRA_ADMIN_SECURITY_LEVEL_ID: '10000',
  // Mirrors the real implementation's env-driven behavior (not hardcoded true/false)
  // so tests #11/#12's NEXT_PUBLIC_APP_ENV manipulation is honored here too.
  stagingSecurityField: () =>
    (process.env.NEXT_PUBLIC_APP_ENV ?? 'production') === 'staging' ? { security: { id: '10000' } } : {},
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getJiraCredentials: mockGetCreds } = require('../config') as { getJiraCredentials: jest.Mock };

import { createJiraIssue } from '../client';

const MOCK_CREDS = {
  baseUrl: 'https://wpo.atlassian.net',
  email: 'svc@wpo.com',
  apiToken: 'test-token',
  webhookSecret: 'secret',
};

const JOB_UUID = '9f5f3b72-4a1c-4f2d-b3e8-cdef01234567';

const BASE_PARAMS = {
  jobId: JOB_UUID,
  serviceLevel: 'official_with_translator_signature_and_provider_stamp' as const,
  sourceLang: 'ru',
  targetLang: 'en',
  documentType: 'passport_id|pdf',
  driveUrl: 'https://drive.google.com/drive/folders/abc123',
  wpoUrl: 'https://wpotranslations.org/dashboard',
  createdAt: '2026-06-14T12:00:00Z',
};

function mockFetchOk(): void {
  (global.fetch as jest.Mock).mockResolvedValueOnce({
    ok: true,
    json: async () => ({ id: '10001', key: 'WO-123' }),
    text: async () => '',
  });
}

function parsedBody(): Record<string, unknown> {
  const call = ((global.fetch as jest.Mock).mock.calls as [string, { body: string }][])[0];
  if (!call) throw new Error('fetch was not called');
  return JSON.parse(call[1].body) as Record<string, unknown>;
}

function firstFetchUrl(): string {
  const call = ((global.fetch as jest.Mock).mock.calls as [string, RequestInit][])[0];
  if (!call) throw new Error('fetch was not called');
  return call[0];
}

beforeEach(() => {
  mockGetCreds.mockReturnValue(MOCK_CREDS);
  global.fetch = jest.fn();
});

afterEach(() => {
  jest.clearAllMocks();
});

// ── Test 1 ────────────────────────────────────────────────────────────────────
it('1: certified order → POST /issue with project.key=WO and issuetype.name=Заказ', async () => {
  mockFetchOk();
  await createJiraIssue(BASE_PARAMS);

  expect(global.fetch).toHaveBeenCalledTimes(1);
  const url = firstFetchUrl();
  expect(url).toMatch(/\/rest\/api\/3\/issue$/);

  const body = parsedBody();
  const fields = body.fields as Record<string, unknown>;
  expect((fields.project as Record<string, string>).key).toBe('WO');
  expect((fields.issuetype as Record<string, string>).name).toBe('Заказ');
});

// ── Test 2 ────────────────────────────────────────────────────────────────────
it('2: notarized order creates one Jira issue', async () => {
  mockFetchOk();
  await createJiraIssue({ ...BASE_PARAMS, serviceLevel: 'notarization_through_partners' });

  expect(global.fetch).toHaveBeenCalledTimes(1);
  const url = firstFetchUrl();
  expect(url).toContain('/rest/api/3/issue');
});

// ── Test 3 ────────────────────────────────────────────────────────────────────
it('3: returns null when Jira not configured (electronic orders must not create issues)', async () => {
  mockGetCreds.mockReturnValue(null);

  const result = await createJiraIssue({ ...BASE_PARAMS, serviceLevel: 'electronic' as never });
  expect(result).toBeNull();
  expect(global.fetch).not.toHaveBeenCalled();
});

// ── Test 4 ────────────────────────────────────────────────────────────────────
it('4: summary field equals the job UUID only', async () => {
  mockFetchOk();
  await createJiraIssue(BASE_PARAMS);

  const fields = parsedBody().fields as Record<string, unknown>;
  expect(fields.summary).toBe(JOB_UUID);
});

// ── Test 5 ────────────────────────────────────────────────────────────────────
it('5: returns {issueId, issueKey, issueUrl} from Jira response', async () => {
  mockFetchOk();
  const result = await createJiraIssue(BASE_PARAMS);

  expect(result?.issueId).toBe('10001');
  expect(result?.issueKey).toBe('WO-123');
  expect(result?.issueUrl).toBe('https://wpo.atlassian.net/browse/WO-123');
});

// ── Test 6 ────────────────────────────────────────────────────────────────────
it('6: issue body has no assignee field, and no security field on production (default)', async () => {
  mockFetchOk();
  await createJiraIssue(BASE_PARAMS);

  const fields = parsedBody().fields as Record<string, unknown>;
  expect(fields.assignee).toBeUndefined();
  expect(fields.security).toBeUndefined();
});

// ── Test 7 ────────────────────────────────────────────────────────────────────
it('7: throws on Jira API error so caller can catch and save jira_sync_status=failed', async () => {
  (global.fetch as jest.Mock).mockResolvedValueOnce({
    ok: false,
    status: 500,
    text: async () => 'Internal Server Error',
  });

  await expect(createJiraIssue(BASE_PARAMS)).rejects.toThrow('Jira createIssue failed: 500');
});

// ── Test 8 ────────────────────────────────────────────────────────────────────
it('8: exactly one fetch call — no user/security/transition discovery endpoints', async () => {
  mockFetchOk();
  await createJiraIssue(BASE_PARAMS);

  expect(global.fetch).toHaveBeenCalledTimes(1);
  const url = firstFetchUrl();
  expect(url).not.toContain('/users/search');
  expect(url).not.toContain('/securitylevel');
  expect(url).not.toContain('/transitions');
  expect(url).not.toContain('/assignee');
});

// ── Test 9 ────────────────────────────────────────────────────────────────────
it('9: description is ADF and contains no phone numbers or street address patterns', async () => {
  mockFetchOk();
  await createJiraIssue({
    ...BASE_PARAMS,
    notaryCity: 'Алматы',
    fulfillmentMethod: 'pickup',
  });

  const fields = parsedBody().fields as Record<string, unknown>;
  const desc = fields.description as { type: string; version: number; content: unknown[] };

  // Correct ADF structure
  expect(desc.type).toBe('doc');
  expect(desc.version).toBe(1);
  expect(Array.isArray(desc.content)).toBe(true);

  const allText = JSON.stringify(desc);
  // No phone patterns (RU/KZ formats)
  expect(allText).not.toMatch(/\+?[78]\s*\(?\d{3}\)?\s*\d{3}[\s-]?\d{2}[\s-]?\d{2}/);
  // No street/address keywords in Russian
  expect(allText).not.toMatch(/\bул\.\b|\bпр\.\b|\bпроспект\b|\bулица\b/i);
  // No ИИН/IIN pattern (12-digit number)
  expect(allText).not.toMatch(/\b\d{12}\b/);
});

// ── Test 10 ───────────────────────────────────────────────────────────────────
it('10: description includes Drive URL and WPO order URL', async () => {
  mockFetchOk();
  await createJiraIssue(BASE_PARAMS);

  const fields = parsedBody().fields as Record<string, unknown>;
  const descText = JSON.stringify(fields.description);
  expect(descText).toContain(BASE_PARAMS.driveUrl!);
  expect(descText).toContain(BASE_PARAMS.wpoUrl);
});

// ── Test 11 ───────────────────────────────────────────────────────────────────
it('11: adds wpo-staging label when NEXT_PUBLIC_APP_ENV=staging', async () => {
  process.env.NEXT_PUBLIC_APP_ENV = 'staging';
  mockFetchOk();
  await createJiraIssue(BASE_PARAMS);

  const fields = parsedBody().fields as Record<string, unknown>;
  expect(fields.labels).toEqual(['wpo-staging']);
  delete process.env.NEXT_PUBLIC_APP_ENV;
});

// ── Test 12 ───────────────────────────────────────────────────────────────────
it('12: adds wpo-production label when NEXT_PUBLIC_APP_ENV=production (default)', async () => {
  process.env.NEXT_PUBLIC_APP_ENV = 'production';
  mockFetchOk();
  await createJiraIssue(BASE_PARAMS);

  const fields = parsedBody().fields as Record<string, unknown>;
  expect(fields.labels).toEqual(['wpo-production']);
  delete process.env.NEXT_PUBLIC_APP_ENV;
});

// ── Test 13 (2026-08-01 staging Jira Admin security level) ────────────────────
it('13: staging → fields.security is the hardcoded Admin level', async () => {
  process.env.NEXT_PUBLIC_APP_ENV = 'staging';
  mockFetchOk();
  await createJiraIssue(BASE_PARAMS);

  const fields = parsedBody().fields as Record<string, unknown>;
  expect(fields.security).toEqual({ id: '10000' });
  delete process.env.NEXT_PUBLIC_APP_ENV;
});

// ── Test 14 ───────────────────────────────────────────────────────────────────
it('14: production → security field completely absent, not null/undefined key', async () => {
  process.env.NEXT_PUBLIC_APP_ENV = 'production';
  mockFetchOk();
  await createJiraIssue(BASE_PARAMS);

  const fields = parsedBody().fields as Record<string, unknown>;
  expect('security' in fields).toBe(false);
  delete process.env.NEXT_PUBLIC_APP_ENV;
});

// ── Test 15 ───────────────────────────────────────────────────────────────────
it('15: the rest of the payload is unchanged by the environment (only security/labels differ)', async () => {
  process.env.NEXT_PUBLIC_APP_ENV = 'staging';
  mockFetchOk();
  await createJiraIssue(BASE_PARAMS);
  const stagingFields = parsedBody().fields as Record<string, unknown>;

  jest.clearAllMocks();
  mockGetCreds.mockReturnValue(MOCK_CREDS);
  process.env.NEXT_PUBLIC_APP_ENV = 'production';
  mockFetchOk();
  await createJiraIssue(BASE_PARAMS);
  const prodFields = parsedBody().fields as Record<string, unknown>;

  const { security: _s, labels: _l1, ...stagingRest } = stagingFields;
  const { security: _p, labels: _l2, ...prodRest } = prodFields;
  expect(stagingRest).toEqual(prodRest);
  delete process.env.NEXT_PUBLIC_APP_ENV;
});
