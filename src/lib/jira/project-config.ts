// Non-secret Jira project configuration.
// JIRA_PROJECT_KEY is the only operator-configurable value (e.g. "WO").
// Issue type is fixed: "Заказ".

export const JIRA_ISSUE_TYPE = 'Заказ';

export interface JiraProjectConfig {
  projectKey: string;
}

// Read fresh on every access so env changes take effect without redeployment.
export const JIRA_PROJECT_CONFIG: JiraProjectConfig = new Proxy({} as JiraProjectConfig, {
  get() {
    return process.env.JIRA_PROJECT_KEY ?? 'WO';
  },
});

// ─── Security level (staging isolation) ──────────────────────────────────────
// 2026-08-01, re-verified 2026-08-01 with the exact Jira user/token this app uses
// (getJiraCredentials() in ./config.ts): every Jira issue created in project WO
// (id 10033) while running as staging gets this hardcoded "Admin" issue security
// level, so staging test orders are never visible to the same broad set of Jira
// project users as real production orders.
//
// Confirmed on THREE independent Jira REST API checks against project WO (never
// guessed, never concluded from a single endpoint) — see
// scripts/staging/find-jira-security-levels.ts:
//   1. GET /project/WO/securitylevel                 -> id=10000, name="Admin"
//   2. GET /project/10033/issuesecuritylevelscheme    -> scheme "WPO Basic Scheme"
//      (id 10000) attached, with exactly one level: id=10000, name="Admin"
//   3. GET /issue/createmeta?issuetypeNames=Заказ     -> `security` field IS
//      offered for this issue type, allowedValues=[{id:10000, name:"Admin"}]
//
// project WPO (partner applications, a DIFFERENT project, id 10066) has NO issue
// security scheme at all — confirmed the same way, see
// src/lib/jira/partner-client.ts's own comment — so this constant/helper must
// never be applied there.
//
// Mirrors worker/src/lib/jira/order-fields.ts's identical constant (kept in sync
// manually — the worker cannot import from src/). No new env var — reuses the
// existing NEXT_PUBLIC_APP_ENV staging convention this file's caller
// (src/lib/jira/client.ts) already uses for its envLabel.
export const JIRA_ADMIN_SECURITY_LEVEL_ID = '10000';

export function isStagingJiraEnvironment(): boolean {
  return (process.env.NEXT_PUBLIC_APP_ENV ?? 'production') === 'staging';
}

/**
 * `{ security: { id: JIRA_ADMIN_SECURITY_LEVEL_ID } }` on staging, `{}` on
 * production — spread directly into any Jira issue-creation `fields` object.
 */
export function stagingSecurityField(): { security?: { id: string } } {
  return isStagingJiraEnvironment() ? { security: { id: JIRA_ADMIN_SECURITY_LEVEL_ID } } : {};
}
