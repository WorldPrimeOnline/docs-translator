// Non-secret Jira project configuration.
// These are project-specific constants, not credentials — commit freely.
//
// HOW TO FILL IN:
//   1. Deploy to staging (JIRA_BASE_URL + JIRA_EMAIL + JIRA_API_TOKEN must be set)
//   2. Call GET /api/admin/jira-discover?secret=<CRON_SECRET>
//   3. Use the returned JSON to fill in the values below
//   4. Commit the updated file
//
// Leave values empty to disable the relevant Jira step gracefully.

export interface JiraProjectConfig {
  /** Jira project key, e.g. "WPO" */
  projectKey: string;
  /** Issue type name to use for translation orders, e.g. "Task" */
  issueTypeName: string;
  /** Display names or emails to search users by (case-insensitive) */
  userQuery: {
    operator: string;
    translator: string;
    notary: string;
  };
  /** Jira security level names (exact, case-sensitive) */
  securityLevelNames: {
    operator: string;
    translator: string;
    notary: string;
  };
  /** Jira workflow transition names (exact, case-sensitive) */
  transitionNames: {
    /** Transition that moves issue to "in progress" / translator stage */
    toTranslator: string;
    /** Transition that moves issue back to operator */
    toOperator: string;
    /** Transition that moves issue to notary stage */
    toNotary: string;
  };
}

export const JIRA_PROJECT_CONFIG: JiraProjectConfig = {
  projectKey: '',
  issueTypeName: 'Task',
  userQuery: {
    operator: '',
    translator: '',
    notary: '',
  },
  securityLevelNames: {
    operator: '',
    translator: '',
    notary: '',
  },
  transitionNames: {
    toTranslator: 'In Progress',
    toOperator: 'Done',
    toNotary: 'In Review',
  },
};
