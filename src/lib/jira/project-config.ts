// Non-secret Jira project configuration.
// Read from env vars at runtime so operators can configure without code changes.
//
// Required env vars:
//   JIRA_PROJECT_KEY     — project key, e.g. "WO"
//   JIRA_ISSUE_TYPE_NAME — issue type name, e.g. "Заказ"

export interface JiraProjectConfig {
  projectKey: string;
  issueTypeName: string;
}

function getConfig(): JiraProjectConfig {
  return {
    projectKey: process.env.JIRA_PROJECT_KEY ?? 'WO',
    issueTypeName: process.env.JIRA_ISSUE_TYPE_NAME ?? 'Заказ',
  };
}

// Read fresh from env on every access so Railway/Vercel env changes take effect
// without redeployment.
export const JIRA_PROJECT_CONFIG: JiraProjectConfig = new Proxy({} as JiraProjectConfig, {
  get(_target, prop: keyof JiraProjectConfig) {
    return getConfig()[prop];
  },
});
