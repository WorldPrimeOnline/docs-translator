/**
 * Shared Jira Cloud JQL search helper.
 *
 * Jira Cloud removed GET /rest/api/3/search (returns 410 Gone as of the 2025
 * migration to the enhanced JQL search API) — the current endpoint is
 * POST /rest/api/3/search/jql. Found via the WO-75 incident, 2026-07-09: the
 * price breakdown backfill scripts were still calling the old endpoint.
 *
 * The new endpoint drops `total` from the response — it uses token-based
 * pagination (`nextPageToken`/`isLast`) instead of `startAt`/`total`. Do not
 * rely on a total count from this helper; only `issues.length` (bounded by
 * `maxResults`) is meaningful.
 *
 * Safety contract: a failed search (network error or non-2xx response, e.g.
 * another future endpoint deprecation) returns `{ ok: false }`. Callers MUST
 * treat this as a hard stop and refuse to proceed with any "create if not
 * found" logic — silently assuming nothing was found risks creating a
 * duplicate Jira issue. Never add a fallback that treats a failed search the
 * same as an empty result.
 */

export interface JiraIssueRef {
  id: string;
  key: string;
  fields: { summary: string; created: string };
}

export type JiraSearchOutcome =
  | { ok: true; issues: JiraIssueRef[]; endpoint: string; httpStatus: number }
  | { ok: false; error: string; endpoint: string; httpStatus: number | null };

const SEARCH_ENDPOINT = '/search/jql';

export async function searchJiraIssuesByJql(
  jiraFetch: (path: string, options?: RequestInit) => Promise<Response>,
  jql: string,
  fields: string[],
  maxResults: number,
): Promise<JiraSearchOutcome> {
  try {
    const res = await jiraFetch(SEARCH_ENDPOINT, {
      method: 'POST',
      body: JSON.stringify({ jql, fields, maxResults }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return {
        ok: false,
        error: `Jira search failed: ${res.status} ${text.slice(0, 300)}`,
        endpoint: SEARCH_ENDPOINT,
        httpStatus: res.status,
      };
    }

    const data = await res.json() as { issues?: JiraIssueRef[] };
    return { ok: true, issues: data.issues ?? [], endpoint: SEARCH_ENDPOINT, httpStatus: res.status };
  } catch (err) {
    return {
      ok: false,
      error: `Jira search threw: ${err instanceof Error ? err.message : String(err)}`,
      endpoint: SEARCH_ENDPOINT,
      httpStatus: null,
    };
  }
}
