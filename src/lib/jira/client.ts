import type { ServiceLevel } from '../translation-prompts/types';
import { getJiraCredentials, makeAuthHeader } from './config';
import { JIRA_PROJECT_CONFIG, JIRA_ISSUE_TYPE } from './project-config';

export interface CreateIssueParams {
  jobId: string;
  serviceLevel: ServiceLevel;
  sourceLang: string;
  targetLang: string;
  documentType: string;
  notaryCity?: string | null;
  fulfillmentMethod?: 'pickup' | 'delivery' | null;
  driveUrl?: string | null;
  wpoUrl: string;
  createdAt?: string | null;
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

function serviceLevelLabel(level: ServiceLevel): string {
  if (level === 'notarization_through_partners') return 'notarized';
  if (level === 'official_with_translator_signature_and_provider_stamp') return 'certified';
  return 'electronic';
}

function buildDescription(params: CreateIssueParams): object {
  const lines: string[] = [
    `Job ID: ${params.jobId}`,
    `Service: ${serviceLevelLabel(params.serviceLevel)}`,
    `Languages: ${params.sourceLang} → ${params.targetLang}`,
    `Document type: ${params.documentType.split('|')[0]}`,
  ];

  if (params.notaryCity) lines.push(`Notary city: ${params.notaryCity}`);
  if (params.fulfillmentMethod) lines.push(`Fulfillment: ${params.fulfillmentMethod}`);
  if (params.driveUrl) lines.push(`Drive: ${params.driveUrl}`);
  lines.push(`WPO order: ${params.wpoUrl}`);
  if (params.createdAt) lines.push(`Created: ${params.createdAt}`);

  return {
    type: 'doc',
    version: 1,
    content: lines.map((text) => ({
      type: 'paragraph',
      content: [{ type: 'text', text }],
    })),
  };
}

export async function createJiraIssue(
  params: CreateIssueParams,
): Promise<JiraIssueResult | null> {
  const creds = getJiraCredentials();
  if (!creds || !JIRA_PROJECT_CONFIG.projectKey) {
    console.log('[jira] Jira not configured — skipping issue creation');
    return null;
  }

  const body = {
    fields: {
      project: { key: JIRA_PROJECT_CONFIG.projectKey },
      issuetype: { name: JIRA_ISSUE_TYPE },
      summary: params.jobId,
      description: buildDescription(params),
    },
  };

  const res = await jiraFetch('/issue', { method: 'POST', body: JSON.stringify(body) });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Jira createIssue failed: ${res.status} ${text.slice(0, 300)}`);
  }

  const data = (await res.json()) as { id: string; key: string };
  return {
    issueId: data.id,
    issueKey: data.key,
    issueUrl: `${creds.baseUrl}/browse/${data.key}`,
  };
}
