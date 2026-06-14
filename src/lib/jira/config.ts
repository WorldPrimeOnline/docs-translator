// All Jira IDs come from environment. Never hardcode.

export interface JiraConfig {
  baseUrl: string;
  email: string;
  apiToken: string;
  projectKey: string;
  issueTypeId: string;
  operatorAccountId: string;
  translatorAccountId: string;
  notaryAccountId: string;
  securityLevelOperatorId: string;
  securityLevelTranslatorId: string;
  securityLevelNotaryId: string;
  webhookSecret: string;
  /** JSON: { "TO_TRANSLATOR": "21", "TO_NOTARY": "31", "TO_OPERATOR": "41", "DONE": "51" } */
  transitionMapJson: string;
}

export type JiraTransitionMap = Record<string, string>;

let _config: JiraConfig | null = null;

export function getJiraConfig(): JiraConfig | null {
  if (_config) return _config;

  const {
    JIRA_BASE_URL,
    JIRA_EMAIL,
    JIRA_API_TOKEN,
    JIRA_PROJECT_KEY,
    JIRA_ISSUE_TYPE_ID,
    JIRA_OPERATOR_ACCOUNT_ID,
    JIRA_TRANSLATOR_ACCOUNT_ID,
    JIRA_NOTARY_ACCOUNT_ID,
    JIRA_SECURITY_LEVEL_OPERATOR_ID,
    JIRA_SECURITY_LEVEL_TRANSLATOR_ID,
    JIRA_SECURITY_LEVEL_NOTARY_ID,
    JIRA_WEBHOOK_SECRET,
    JIRA_TRANSITION_MAP_JSON,
  } = process.env;

  if (
    !JIRA_BASE_URL ||
    !JIRA_EMAIL ||
    !JIRA_API_TOKEN ||
    !JIRA_PROJECT_KEY ||
    !JIRA_ISSUE_TYPE_ID
  ) {
    return null;
  }

  _config = {
    baseUrl: JIRA_BASE_URL.replace(/\/$/, ''),
    email: JIRA_EMAIL,
    apiToken: JIRA_API_TOKEN,
    projectKey: JIRA_PROJECT_KEY,
    issueTypeId: JIRA_ISSUE_TYPE_ID,
    operatorAccountId: JIRA_OPERATOR_ACCOUNT_ID ?? '',
    translatorAccountId: JIRA_TRANSLATOR_ACCOUNT_ID ?? '',
    notaryAccountId: JIRA_NOTARY_ACCOUNT_ID ?? '',
    securityLevelOperatorId: JIRA_SECURITY_LEVEL_OPERATOR_ID ?? '',
    securityLevelTranslatorId: JIRA_SECURITY_LEVEL_TRANSLATOR_ID ?? '',
    securityLevelNotaryId: JIRA_SECURITY_LEVEL_NOTARY_ID ?? '',
    webhookSecret: JIRA_WEBHOOK_SECRET ?? '',
    transitionMapJson: JIRA_TRANSITION_MAP_JSON ?? '{}',
  };

  return _config;
}

export function getTransitionMap(cfg: JiraConfig): JiraTransitionMap {
  try {
    return JSON.parse(cfg.transitionMapJson) as JiraTransitionMap;
  } catch {
    return {};
  }
}
