/**
 * @jest-environment node
 *
 * Direct tests for backfillJiraOrderFields()'s handling of partnerApplicationId
 * (customfield_10121) — added alongside the existing documentsLink/delivery
 * fields it already backfilled. Confirms it never overwrites a value already
 * on the issue and skips cleanly when there's nothing to backfill.
 */
export {};

const fetchCalls: Array<{ url: string; method: string | undefined; body: string | undefined }> = [];
let existingFieldValue: string | null = null;

jest.mock('../supabase', () => ({ supabase: { from: () => ({}) } }));
jest.mock('../env', () => ({ env: { SITE_URL: 'https://wpo.test' } }));
jest.mock('../r2', () => ({ downloadFile: jest.fn() }));

beforeEach(() => {
  fetchCalls.length = 0;
  existingFieldValue = null;
  jest.resetModules();
  process.env.JIRA_BASE_URL = 'https://wpo.atlassian.net';
  process.env.JIRA_EMAIL = 'bot@wpo.test';
  process.env.JIRA_API_TOKEN = 'test-token';

  global.fetch = jest.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method;
    const body = init?.body as string | undefined;
    fetchCalls.push({ url, method, body });

    if (method === undefined || method === 'GET') {
      return {
        ok: true,
        json: async () => ({ fields: { customfield_10121: existingFieldValue } }),
      } as unknown as Response;
    }
    if (method === 'PUT') {
      return { ok: true, json: async () => ({}) } as unknown as Response;
    }
    return { ok: true, json: async () => ({}) } as unknown as Response;
  }) as unknown as typeof fetch;
});

afterEach(() => {
  delete process.env.JIRA_BASE_URL;
  delete process.env.JIRA_EMAIL;
  delete process.env.JIRA_API_TOKEN;
});

describe('backfillJiraOrderFields — partnerApplicationId (customfield_10121)', () => {
  it('sets the field when currently empty on the issue', async () => {
    existingFieldValue = null;
    const { backfillJiraOrderFields } = await import('../integrations');

    const result = await backfillJiraOrderFields('WO-1', {
      partnerApplicationId: '34c19be3-f501-4c24-894f-e46d22c229d9',
    });

    expect(result.ok).toBe(true);
    expect(result.updatedFields).toContain('partnerApplicationId');
    const putCall = fetchCalls.find((c) => c.method === 'PUT');
    expect(putCall).toBeDefined();
    expect(JSON.parse(putCall!.body!).fields.customfield_10121).toBe('34c19be3-f501-4c24-894f-e46d22c229d9');
  });

  it('never overwrites a value already set on the issue', async () => {
    existingFieldValue = 'already-there-uuid';
    const { backfillJiraOrderFields } = await import('../integrations');

    const result = await backfillJiraOrderFields('WO-1', {
      partnerApplicationId: '34c19be3-f501-4c24-894f-e46d22c229d9',
    });

    expect(result.ok).toBe(true);
    expect(result.skippedFields.some((f) => f.includes('partnerApplicationId'))).toBe(true);
    const putCall = fetchCalls.find((c) => c.method === 'PUT');
    expect(putCall).toBeUndefined(); // nothing to write at all in this single-field scenario
  });

  it('is a no-op when no partnerApplicationId is available to backfill', async () => {
    existingFieldValue = null;
    const { backfillJiraOrderFields } = await import('../integrations');

    const result = await backfillJiraOrderFields('WO-1', { partnerApplicationId: null });

    expect(result.ok).toBe(true);
    expect(result.updatedFields.length).toBe(0);
    const putCall = fetchCalls.find((c) => c.method === 'PUT');
    expect(putCall).toBeUndefined();
  });
});
