// Jira base credentials — only these come from env vars.
// All project-specific IDs (project key, issue type, users, security levels, transitions)
// are discovered via the Jira REST API and sourced from src/lib/jira/project-config.ts.

export interface JiraCredentials {
  baseUrl: string;
  email: string;
  apiToken: string;
  webhookSecret: string;
}

let _credentials: JiraCredentials | null = null;

export function getJiraCredentials(): JiraCredentials | null {
  if (_credentials) return _credentials;

  const { JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN } = process.env;
  if (!JIRA_BASE_URL || !JIRA_EMAIL || !JIRA_API_TOKEN) return null;

  _credentials = {
    baseUrl: JIRA_BASE_URL.replace(/\/$/, ''),
    email: JIRA_EMAIL,
    apiToken: JIRA_API_TOKEN,
    webhookSecret: process.env.JIRA_WEBHOOK_SECRET ?? '',
  };
  return _credentials;
}

export function makeAuthHeader(creds: JiraCredentials): string {
  return 'Basic ' + Buffer.from(`${creds.email}:${creds.apiToken}`).toString('base64');
}

/** Legacy alias — returns null if Jira is not configured. */
export function getJiraConfig(): JiraCredentials | null {
  return getJiraCredentials();
}
