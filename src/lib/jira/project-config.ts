// Non-secret Jira project configuration.
// Values are read from env vars at runtime so operators can configure without
// code changes. Set these in Vercel Preview/Production environment variables.
//
// Required env vars:
//   JIRA_PROJECT_KEY          — e.g. "WPO"
//   JIRA_ISSUE_TYPE_NAME      — e.g. "Task" (default)
//   JIRA_OPERATOR_QUERY       — email or display name of operator user
//   JIRA_TRANSLATOR_QUERY     — email or display name of translator user
//   JIRA_NOTARY_QUERY         — email or display name of notary user
//   JIRA_SECURITY_LEVEL_OPERATOR   — security level name for operator stage
//   JIRA_SECURITY_LEVEL_TRANSLATOR — security level name for translator stage
//   JIRA_SECURITY_LEVEL_NOTARY     — security level name for notary stage
//   JIRA_TRANSITION_TO_TRANSLATOR  — transition name (default: "In Progress")
//   JIRA_TRANSITION_TO_OPERATOR    — transition name (default: "Done")
//   JIRA_TRANSITION_TO_NOTARY      — transition name (default: "In Review")

export interface JiraProjectConfig {
  projectKey: string;
  issueTypeName: string;
  userQuery: {
    operator: string;
    translator: string;
    notary: string;
  };
  securityLevelNames: {
    operator: string;
    translator: string;
    notary: string;
  };
  transitionNames: {
    toTranslator: string;
    toOperator: string;
    toNotary: string;
  };
}

function getConfig(): JiraProjectConfig {
  return {
    projectKey: process.env.JIRA_PROJECT_KEY ?? '',
    issueTypeName: process.env.JIRA_ISSUE_TYPE_NAME ?? 'Task',
    userQuery: {
      operator: process.env.JIRA_OPERATOR_QUERY ?? '',
      translator: process.env.JIRA_TRANSLATOR_QUERY ?? '',
      notary: process.env.JIRA_NOTARY_QUERY ?? '',
    },
    securityLevelNames: {
      operator: process.env.JIRA_SECURITY_LEVEL_OPERATOR ?? '',
      translator: process.env.JIRA_SECURITY_LEVEL_TRANSLATOR ?? '',
      notary: process.env.JIRA_SECURITY_LEVEL_NOTARY ?? '',
    },
    transitionNames: {
      toTranslator: process.env.JIRA_TRANSITION_TO_TRANSLATOR ?? 'In Progress',
      toOperator: process.env.JIRA_TRANSITION_TO_OPERATOR ?? 'Done',
      toNotary: process.env.JIRA_TRANSITION_TO_NOTARY ?? 'In Review',
    },
  };
}

// Read fresh from env every call so Railway/Vercel env changes take effect
// without redeployment (e.g. when first setting up the project key).
export const JIRA_PROJECT_CONFIG: JiraProjectConfig = new Proxy({} as JiraProjectConfig, {
  get(_target, prop: keyof JiraProjectConfig) {
    return getConfig()[prop];
  },
});
