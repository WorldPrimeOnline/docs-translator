/**
 * @jest-environment node
 *
 * Tests for the shared Jira JQL search helper (WO-75 incident follow-up,
 * 2026-07-09) — Jira Cloud removed GET /rest/api/3/search (410 Gone); this
 * migrated to POST /rest/api/3/search/jql. Callers must treat a failed search
 * as a hard stop, never as "assume nothing found".
 */

import { searchJiraIssuesByJql } from '../search';

function mockJiraFetch(response: { ok: boolean; status: number; body: unknown }) {
  return jest.fn(async () => ({
    ok: response.ok,
    status: response.status,
    json: async () => response.body,
    text: async () => JSON.stringify(response.body),
  })) as unknown as (path: string, options?: RequestInit) => Promise<Response>;
}

describe('searchJiraIssuesByJql', () => {
  it('calls POST /search/jql with jql, fields, and maxResults in the body', async () => {
    const calls: Array<{ path: string; options?: RequestInit }> = [];
    const jiraFetch = jest.fn(async (path: string, options?: RequestInit) => {
      calls.push({ path, options });
      return { ok: true, status: 200, json: async () => ({ issues: [] }), text: async () => '{}' } as unknown as Response;
    });

    await searchJiraIssuesByJql(jiraFetch, 'labels = "wpo-price-breakdown"', ['summary', 'created'], 20);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.path).toBe('/search/jql');
    expect(calls[0]!.options?.method).toBe('POST');
    const body = JSON.parse(calls[0]!.options?.body as string);
    expect(body).toEqual({ jql: 'labels = "wpo-price-breakdown"', fields: ['summary', 'created'], maxResults: 20 });
  });

  it('returns ok:true with issues on a 200 response', async () => {
    const issues = [{ id: '1', key: 'WO-73', fields: { summary: 'Price Breakdown for WO-73', created: '2026-07-01T00:00:00Z' } }];
    const jiraFetch = mockJiraFetch({ ok: true, status: 200, body: { issues } });

    const result = await searchJiraIssuesByJql(jiraFetch, 'jql', ['summary'], 20);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.issues).toEqual(issues);
      expect(result.httpStatus).toBe(200);
      expect(result.endpoint).toBe('/search/jql');
    }
  });

  it('returns ok:true with an empty array when the new endpoint response has no issues field', async () => {
    const jiraFetch = mockJiraFetch({ ok: true, status: 200, body: {} });
    const result = await searchJiraIssuesByJql(jiraFetch, 'jql', ['summary'], 20);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.issues).toEqual([]);
  });

  it('returns ok:false (hard stop) on a non-2xx response — e.g. the 410 that started this fix', async () => {
    const jiraFetch = mockJiraFetch({ ok: false, status: 410, body: { errorMessages: ['Gone'] } });
    const result = await searchJiraIssuesByJql(jiraFetch, 'jql', ['summary'], 20);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.httpStatus).toBe(410);
      expect(result.error).toContain('410');
    }
  });

  it('returns ok:false (hard stop) when the fetch itself throws (network error)', async () => {
    const jiraFetch = jest.fn(async () => { throw new Error('ECONNRESET'); });
    const result = await searchJiraIssuesByJql(jiraFetch, 'jql', ['summary'], 20);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.httpStatus).toBeNull();
      expect(result.error).toContain('ECONNRESET');
    }
  });

  it('never returns ok:true when the response was not ok — no silent "assume empty" fallback', async () => {
    const jiraFetch = mockJiraFetch({ ok: false, status: 500, body: {} });
    const result = await searchJiraIssuesByJql(jiraFetch, 'jql', ['summary'], 20);
    expect(result.ok).toBe(false);
  });
});
