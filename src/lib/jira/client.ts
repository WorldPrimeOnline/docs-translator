import type { ServiceLevel } from '../translation-prompts/types';
import { getJiraCredentials, makeAuthHeader } from './config';
import { JIRA_PROJECT_CONFIG } from './project-config';
import { resolveJiraIds, resolveTransitionId } from './resolver';

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
  if (level === 'notarization_through_partners') return 'Notarization';
  if (level === 'official_with_translator_signature_and_provider_stamp') return 'Certified';
  return 'Electronic';
}

function buildSummary(params: CreateIssueParams): string {
  const label = serviceLevelLabel(params.serviceLevel);
  const docType = params.documentType.split('|')[0] ?? params.documentType;
  return `WPO-${params.jobId.slice(0, 8)} | ${params.sourceLang.toUpperCase()} → ${params.targetLang.toUpperCase()} | ${docType} | ${label}`;
}

export async function createJiraIssue(
  params: CreateIssueParams,
): Promise<JiraIssueResult | null> {
  const creds = getJiraCredentials();
  if (!creds || !JIRA_PROJECT_CONFIG.projectKey) {
    console.log('[jira] Jira not configured — skipping issue creation');
    return null;
  }

  const ids = await resolveJiraIds(creds.baseUrl, creds.email, creds.apiToken);
  if (!ids.issueTypeId) {
    console.warn('[jira] issueTypeId not resolved — skipping issue creation');
    return null;
  }

  const summary = buildSummary(params);
  const descriptionLines = [
    `WPO Job ID: ${params.jobId}`,
    `Service Level: ${params.serviceLevel}`,
    `Languages: ${params.sourceLang} → ${params.targetLang}`,
    `Document Type: ${params.documentType.split('|')[0]}`,
    params.notaryCity ? `City: ${params.notaryCity}` : null,
    params.fulfillmentMethod ? `Fulfillment: ${params.fulfillmentMethod}` : null,
    params.driveUrl ? `Drive: ${params.driveUrl}` : null,
    `WPO Order: ${params.wpoUrl}`,
  ].filter(Boolean).join('\n');

  const body: Record<string, unknown> = {
    fields: {
      project: { key: JIRA_PROJECT_CONFIG.projectKey },
      issuetype: { id: ids.issueTypeId },
      summary,
      ...(ids.operatorAccountId ? { assignee: { accountId: ids.operatorAccountId } } : {}),
      ...(ids.securityLevelOperatorId ? { security: { id: ids.securityLevelOperatorId } } : {}),
      description: {
        type: 'doc',
        version: 1,
        content: [{ type: 'paragraph', content: [{ type: 'text', text: descriptionLines }] }],
      },
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

export async function assignJiraIssue(issueKey: string, accountId: string): Promise<void> {
  if (!accountId) return;
  const res = await jiraFetch(`/issue/${issueKey}/assignee`, {
    method: 'PUT',
    body: JSON.stringify({ accountId }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Jira assignIssue failed: ${res.status} ${t.slice(0, 200)}`);
  }
}

export async function setJiraSecurityLevel(issueKey: string, securityLevelId: string): Promise<void> {
  if (!securityLevelId) return;
  const res = await jiraFetch(`/issue/${issueKey}`, {
    method: 'PUT',
    body: JSON.stringify({ fields: { security: { id: securityLevelId } } }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Jira setSecurityLevel failed: ${res.status} ${t.slice(0, 200)}`);
  }
}

export async function transitionJiraIssue(issueKey: string, transitionName: string): Promise<void> {
  const creds = getJiraCredentials();
  if (!creds) return;

  const transitionId = await resolveTransitionId(
    creds.baseUrl,
    makeAuthHeader(creds),
    issueKey,
    transitionName,
  );

  if (!transitionId) {
    console.warn(`[jira] Transition "${transitionName}" not found for ${issueKey} — skipping`);
    return;
  }

  const res = await jiraFetch(`/issue/${issueKey}/transitions`, {
    method: 'POST',
    body: JSON.stringify({ transition: { id: transitionId } }),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Jira transition "${transitionName}" failed: ${res.status} ${t.slice(0, 200)}`);
  }
}

export async function addJiraComment(issueKey: string, text: string): Promise<void> {
  const res = await jiraFetch(`/issue/${issueKey}/comment`, {
    method: 'POST',
    body: JSON.stringify({
      body: {
        type: 'doc',
        version: 1,
        content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
      },
    }),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => '');
    console.warn(`[jira] addComment failed: ${res.status} ${t.slice(0, 200)}`);
  }
}

export async function updateJiraIssue(issueKey: string, fields: Record<string, unknown>): Promise<void> {
  const res = await jiraFetch(`/issue/${issueKey}`, {
    method: 'PUT',
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Jira updateIssue failed: ${res.status} ${t.slice(0, 200)}`);
  }
}
