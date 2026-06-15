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
