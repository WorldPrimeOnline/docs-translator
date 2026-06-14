// Runtime Jira ID resolver: looks up opaque IDs from human-readable names.
// Results are cached in memory for the lifetime of the process.

import { JIRA_PROJECT_CONFIG } from './project-config';

export interface ResolvedJiraIds {
  projectKey: string;
  issueTypeId: string | null;
  operatorAccountId: string | null;
  translatorAccountId: string | null;
  notaryAccountId: string | null;
  securityLevelOperatorId: string | null;
  securityLevelTranslatorId: string | null;
  securityLevelNotaryId: string | null;
  /** Map of transition name → transition ID, resolved per-issue on first transition */
}

interface JiraBaseCredentials {
  baseUrl: string;
  authHeader: string;
}

function makeAuth(email: string, token: string): string {
  return 'Basic ' + Buffer.from(`${email}:${token}`).toString('base64');
}

async function jiraGet<T>(creds: JiraBaseCredentials, path: string): Promise<T | null> {
  try {
    const res = await fetch(`${creds.baseUrl}/rest/api/3${path}`, {
      headers: {
        Authorization: creds.authHeader,
        Accept: 'application/json',
      },
    });
    if (!res.ok) {
      console.warn(`[jira-resolver] GET ${path} → ${res.status}`);
      return null;
    }
    return (await res.json()) as T;
  } catch (e) {
    console.warn(`[jira-resolver] GET ${path} failed:`, e instanceof Error ? e.message : e);
    return null;
  }
}

async function resolveIssueTypeId(
  creds: JiraBaseCredentials,
  projectKey: string,
  typeName: string,
): Promise<string | null> {
  if (!typeName) return null;
  const data = await jiraGet<{ values: { id: string; name: string }[] }>(
    creds,
    `/issuetype/project?projectId=${projectKey}`,
  );
  if (!data) {
    // fallback: list all issue types
    const all = await jiraGet<{ id: string; name: string }[]>(creds, '/issuetype');
    return all?.find((t) => t.name.toLowerCase() === typeName.toLowerCase())?.id ?? null;
  }
  return data.values.find((t) => t.name.toLowerCase() === typeName.toLowerCase())?.id ?? null;
}

async function resolveUserAccountId(
  creds: JiraBaseCredentials,
  query: string,
): Promise<string | null> {
  if (!query) return null;
  const results = await jiraGet<{ accountId: string; displayName: string; emailAddress?: string }[]>(
    creds,
    `/users/search?query=${encodeURIComponent(query)}&maxResults=10`,
  );
  if (!results || results.length === 0) return null;
  if (results.length === 1) return results[0]!.accountId;
  // If multiple, try exact email/name match
  const exact = results.find(
    (u) =>
      u.emailAddress?.toLowerCase() === query.toLowerCase() ||
      u.displayName.toLowerCase() === query.toLowerCase(),
  );
  if (exact) return exact.accountId;
  console.warn(
    `[jira-resolver] Ambiguous user query "${query}" — found ${results.length} users: ` +
      results.map((u) => `${u.displayName} <${u.emailAddress ?? '?'}>`).join(', ') +
      '. Set a more specific query in src/lib/jira/project-config.ts',
  );
  return null;
}

async function resolveSecurityLevelId(
  creds: JiraBaseCredentials,
  projectKey: string,
  levelName: string,
): Promise<string | null> {
  if (!levelName) return null;
  const data = await jiraGet<{ levels: { id: string; name: string }[] }>(
    creds,
    `/project/${projectKey}/securitylevel`,
  );
  if (!data) return null;
  const level = data.levels.find((l) => l.name.toLowerCase() === levelName.toLowerCase());
  if (!level) {
    console.warn(
      `[jira-resolver] Security level "${levelName}" not found. Available: ` +
        data.levels.map((l) => l.name).join(', '),
    );
    return null;
  }
  return level.id;
}

let _cache: ResolvedJiraIds | null = null;
let _resolving = false;

export async function resolveJiraIds(baseUrl: string, email: string, token: string): Promise<ResolvedJiraIds> {
  // Invalidate cache if projectKey changed (e.g. env var set after first cold start)
  if (_cache && _cache.projectKey !== JIRA_PROJECT_CONFIG.projectKey) {
    console.log('[jira-resolver] projectKey changed — invalidating cache');
    _cache = null;
  }
  if (_cache) return _cache;
  if (_resolving) {
    // Return empty shell during concurrent resolution (avoids duplicate requests)
    return buildEmpty();
  }

  _resolving = true;
  const creds: JiraBaseCredentials = { baseUrl, authHeader: makeAuth(email, token) };
  const cfg = JIRA_PROJECT_CONFIG;

  try {
    const [issueTypeId, operatorAccountId, translatorAccountId, notaryAccountId, secOp, secTr, secNo] =
      await Promise.all([
        cfg.projectKey && cfg.issueTypeName
          ? resolveIssueTypeId(creds, cfg.projectKey, cfg.issueTypeName)
          : Promise.resolve(null),
        resolveUserAccountId(creds, cfg.userQuery.operator),
        resolveUserAccountId(creds, cfg.userQuery.translator),
        resolveUserAccountId(creds, cfg.userQuery.notary),
        cfg.projectKey && cfg.securityLevelNames.operator
          ? resolveSecurityLevelId(creds, cfg.projectKey, cfg.securityLevelNames.operator)
          : Promise.resolve(null),
        cfg.projectKey && cfg.securityLevelNames.translator
          ? resolveSecurityLevelId(creds, cfg.projectKey, cfg.securityLevelNames.translator)
          : Promise.resolve(null),
        cfg.projectKey && cfg.securityLevelNames.notary
          ? resolveSecurityLevelId(creds, cfg.projectKey, cfg.securityLevelNames.notary)
          : Promise.resolve(null),
      ]);

    _cache = {
      projectKey: cfg.projectKey,
      issueTypeId,
      operatorAccountId,
      translatorAccountId,
      notaryAccountId,
      securityLevelOperatorId: secOp,
      securityLevelTranslatorId: secTr,
      securityLevelNotaryId: secNo,
    };

    console.log('[jira-resolver] Resolved IDs:', JSON.stringify({
      projectKey: _cache.projectKey,
      issueTypeId: _cache.issueTypeId,
      operatorAccountId: _cache.operatorAccountId ? '***' : null,
      translatorAccountId: _cache.translatorAccountId ? '***' : null,
      notaryAccountId: _cache.notaryAccountId ? '***' : null,
      secLevels: [secOp, secTr, secNo].map((s) => s ?? null),
    }));

    return _cache;
  } finally {
    _resolving = false;
  }
}

function buildEmpty(): ResolvedJiraIds {
  return {
    projectKey: JIRA_PROJECT_CONFIG.projectKey,
    issueTypeId: null,
    operatorAccountId: null,
    translatorAccountId: null,
    notaryAccountId: null,
    securityLevelOperatorId: null,
    securityLevelTranslatorId: null,
    securityLevelNotaryId: null,
  };
}

/** Resolve transition ID from name for a specific issue (transitions vary per status). */
export async function resolveTransitionId(
  baseUrl: string,
  authHeader: string,
  issueKey: string,
  transitionName: string,
): Promise<string | null> {
  if (!transitionName) return null;
  const creds: JiraBaseCredentials = { baseUrl, authHeader };
  const data = await jiraGet<{ transitions: { id: string; name: string }[] }>(
    creds,
    `/issue/${issueKey}/transitions`,
  );
  if (!data) return null;
  const t = data.transitions.find((tr) => tr.name.toLowerCase() === transitionName.toLowerCase());
  if (!t) {
    console.warn(
      `[jira-resolver] Transition "${transitionName}" not available for ${issueKey}. Available: ` +
        data.transitions.map((tr) => tr.name).join(', '),
    );
    return null;
  }
  return t.id;
}

/** Clear cache (used in tests). */
export function clearResolverCache(): void {
  _cache = null;
  _resolving = false;
}
