import { getJiraCredentials, makeAuthHeader } from './config';
import type { PartnerType } from '../partners/schema';

const PARTNER_JIRA_PROJECT_KEY = 'WPO';
const PARTNER_JIRA_ISSUE_TYPE = 'Partnership';

const PARTNER_TYPE_LABELS: Record<PartnerType, string> = {
  translator:            'Переводчик',
  notary:                'Нотариус',
  agency:                'Переводческое агентство',
  visa_center:           'Визовый центр',
  migration_consultant:  'Миграционный консультант',
  education_agency:      'Образовательное агентство',
  legal_firm:            'Юридическая фирма',
  corporate:             'Организация / HR',
  other:                 'Другое',
};

export interface CreatePartnerApplicationIssueParams {
  applicationId: string;
  partnerType: PartnerType;
  name: string;
  organization?: string | null;
  message?: string | null;
  createdAt: string;
}

export interface JiraIssueResult {
  issueId: string;
  issueKey: string;
  issueUrl: string;
}

async function jiraFetch(path: string, options: RequestInit): Promise<Response> {
  const creds = getJiraCredentials();
  if (!creds) throw new Error('Jira not configured');
  return fetch(`${creds.baseUrl}/rest/api/3${path}`, {
    ...options,
    headers: {
      Authorization: makeAuthHeader(creds),
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(options.headers as Record<string, string> ?? {}),
    },
  });
}

function buildDescription(params: CreatePartnerApplicationIssueParams): object {
  const typeLabel = PARTNER_TYPE_LABELS[params.partnerType] ?? params.partnerType;
  const lines: string[] = [
    `Application ID: ${params.applicationId}`,
    `Partner type: ${typeLabel}`,
    `Name: ${params.name}`,
  ];
  if (params.organization) lines.push(`Organization: ${params.organization}`);
  if (params.message) {
    const excerpt = params.message.length > 300
      ? params.message.slice(0, 300) + '…'
      : params.message;
    lines.push(`Message: ${excerpt}`);
  }
  lines.push(`Submitted: ${params.createdAt}`);
  return {
    type: 'doc', version: 1,
    content: lines.map((text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })),
  };
}

export async function createPartnerApplicationIssue(
  params: CreatePartnerApplicationIssueParams,
): Promise<JiraIssueResult | null> {
  const creds = getJiraCredentials();

  if (!creds) {
    console.log('[jira/partner] Jira not configured — skipping issue creation');
    return null;
  }

  const envLabel = (process.env.NEXT_PUBLIC_APP_ENV ?? 'production') === 'staging'
    ? 'wpo-staging'
    : 'wpo-production';

  const typeLabel = PARTNER_TYPE_LABELS[params.partnerType] ?? params.partnerType;

  const baseFields = {
    project: { key: PARTNER_JIRA_PROJECT_KEY },
    issuetype: { name: PARTNER_JIRA_ISSUE_TYPE },
    summary: `[Partner Application] ${typeLabel} — ${params.applicationId}`,
    description: buildDescription(params),
  };

  console.log(
    `[jira/partner] Creating issue: project=${PARTNER_JIRA_PROJECT_KEY} type=${PARTNER_JIRA_ISSUE_TYPE} appId=${params.applicationId}`,
  );

  // Attempt 1: with labels
  let res = await jiraFetch('/issue', {
    method: 'POST',
    body: JSON.stringify({ fields: { ...baseFields, labels: [envLabel, 'wpo-partner-application'] } }),
  });

  // Attempt 2: retry without labels if Jira rejects the field (screen/field config)
  if (!res.ok && res.status === 400) {
    const errText = await res.text().catch(() => '');
    console.warn(
      `[jira/partner] 400 with labels (appId=${params.applicationId}): ${errText.slice(0, 200)} — retrying without labels`,
    );
    res = await jiraFetch('/issue', {
      method: 'POST',
      body: JSON.stringify({ fields: baseFields }),
    });
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    console.error(
      `[jira/partner] Issue creation failed: project=${PARTNER_JIRA_PROJECT_KEY} type=${PARTNER_JIRA_ISSUE_TYPE} status=${res.status} appId=${params.applicationId} error=${errText.slice(0, 300)}`,
    );
    throw new Error(`Jira createPartnerIssue failed: ${res.status} — ${errText.slice(0, 200)}`);
  }

  const data = (await res.json()) as { id: string; key: string };
  const issueUrl = `${creds.baseUrl}/browse/${data.key}`;
  console.log(`[jira/partner] Issue created: ${data.key} (${issueUrl}) appId=${params.applicationId}`);
  return {
    issueId: data.id,
    issueKey: data.key,
    issueUrl,
  };
}
