import { getJiraCredentials, makeAuthHeader } from './config';
import type { PartnerType } from '../partners/schema';

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
  const projectKey = process.env.JIRA_PARTNER_PROJECT_KEY
    ?? process.env.JIRA_PROJECT_KEY
    ?? 'WO';

  if (!creds || !projectKey) {
    console.log('[jira/partner] Jira not configured — skipping issue creation');
    return null;
  }

  const envLabel = (process.env.NEXT_PUBLIC_APP_ENV ?? 'production') === 'staging'
    ? 'wpo-staging'
    : 'wpo-production';

  const typeLabel = PARTNER_TYPE_LABELS[params.partnerType] ?? params.partnerType;

  const body = {
    fields: {
      project: { key: projectKey },
      issuetype: { name: process.env.JIRA_PARTNER_ISSUE_TYPE ?? 'Task' },
      summary: `[Partner Application] ${typeLabel} — ${params.applicationId}`,
      description: buildDescription(params),
      labels: [envLabel, 'wpo-partner-application'],
    },
  };

  const res = await jiraFetch('/issue', { method: 'POST', body: JSON.stringify(body) });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Jira createPartnerIssue failed: ${res.status} ${text.slice(0, 300)}`);
  }

  const data = (await res.json()) as { id: string; key: string };
  return {
    issueId: data.id,
    issueKey: data.key,
    issueUrl: `${creds.baseUrl}/browse/${data.key}`,
  };
}
