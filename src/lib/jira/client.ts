import type { ServiceLevel } from '../translation-prompts/types';
import { getJiraConfig, getTransitionMap, type JiraConfig } from './config';

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

function makeAuthHeader(cfg: JiraConfig): string {
  return 'Basic ' + Buffer.from(`${cfg.email}:${cfg.apiToken}`).toString('base64');
}

function serviceLevelLabel(level: ServiceLevel): string {
  if (level === 'notarization_through_partners') return 'Notarization';
  if (level === 'official_with_translator_signature_and_provider_stamp') return 'Certified';
  return 'Electronic';
}

function buildSummary(params: CreateIssueParams): string {
  const label = serviceLevelLabel(params.serviceLevel);
  const docType = params.documentType.split('|')[0] ?? params.documentType;
  // Format: WPO-{jobId_short} | EN → RU | Passport | Certified
  return `WPO-${params.jobId.slice(0, 8)} | ${params.sourceLang.toUpperCase()} → ${params.targetLang.toUpperCase()} | ${docType} | ${label}`;
}

async function jiraFetch(
  cfg: JiraConfig,
  path: string,
  options: RequestInit,
): Promise<Response> {
  const url = `${cfg.baseUrl}/rest/api/3${path}`;
  return fetch(url, {
    ...options,
    headers: {
      'Authorization': makeAuthHeader(cfg),
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...(options.headers as Record<string, string> ?? {}),
    },
  });
}

export async function createJiraIssue(
  params: CreateIssueParams,
): Promise<JiraIssueResult | null> {
  const cfg = getJiraConfig();
  if (!cfg) {
    console.log('[jira] Jira not configured — skipping issue creation');
    return null;
  }

  const summary = buildSummary(params);

  const body: Record<string, unknown> = {
    fields: {
      project: { key: cfg.projectKey },
      issuetype: { id: cfg.issueTypeId },
      summary,
      assignee: cfg.operatorAccountId ? { accountId: cfg.operatorAccountId } : undefined,
      ...(cfg.securityLevelOperatorId
        ? { security: { id: cfg.securityLevelOperatorId } }
        : {}),
      description: {
        type: 'doc',
        version: 1,
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: [
                  `WPO Job ID: ${params.jobId}`,
                  `Service Level: ${params.serviceLevel}`,
                  `Languages: ${params.sourceLang} → ${params.targetLang}`,
                  `Document Type: ${params.documentType.split('|')[0]}`,
                  params.notaryCity ? `City: ${params.notaryCity}` : null,
                  params.fulfillmentMethod ? `Fulfillment: ${params.fulfillmentMethod}` : null,
                  params.driveUrl ? `Drive: ${params.driveUrl}` : null,
                  `WPO Order: ${params.wpoUrl}`,
                ]
                  .filter(Boolean)
                  .join('\n'),
              },
            ],
          },
        ],
      },
    },
  };

  const res = await jiraFetch(cfg, '/issue', {
    method: 'POST',
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Jira createIssue failed: ${res.status} ${text.slice(0, 300)}`);
  }

  const data = (await res.json()) as { id: string; key: string; self: string };
  return {
    issueId: data.id,
    issueKey: data.key,
    issueUrl: `${cfg.baseUrl}/browse/${data.key}`,
  };
}

export async function updateJiraIssue(
  issueKey: string,
  fields: Record<string, unknown>,
): Promise<void> {
  const cfg = getJiraConfig();
  if (!cfg) return;

  const res = await jiraFetch(cfg, `/issue/${issueKey}`, {
    method: 'PUT',
    body: JSON.stringify({ fields }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Jira updateIssue failed: ${res.status} ${text.slice(0, 300)}`);
  }
}

export async function assignJiraIssue(
  issueKey: string,
  accountId: string,
): Promise<void> {
  const cfg = getJiraConfig();
  if (!cfg) return;

  const res = await jiraFetch(cfg, `/issue/${issueKey}/assignee`, {
    method: 'PUT',
    body: JSON.stringify({ accountId }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Jira assignIssue failed: ${res.status} ${text.slice(0, 300)}`);
  }
}

export async function setJiraSecurityLevel(
  issueKey: string,
  securityLevelId: string,
): Promise<void> {
  const cfg = getJiraConfig();
  if (!cfg || !securityLevelId) return;

  await updateJiraIssue(issueKey, {
    security: { id: securityLevelId },
  });
}

export async function transitionJiraIssue(
  issueKey: string,
  transitionName: string,
): Promise<void> {
  const cfg = getJiraConfig();
  if (!cfg) return;

  const map = getTransitionMap(cfg);
  const transitionId = map[transitionName];
  if (!transitionId) {
    console.warn(`[jira] No transition ID found for "${transitionName}" in JIRA_TRANSITION_MAP_JSON`);
    return;
  }

  const res = await jiraFetch(cfg, `/issue/${issueKey}/transitions`, {
    method: 'POST',
    body: JSON.stringify({ transition: { id: transitionId } }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Jira transition "${transitionName}" failed: ${res.status} ${text.slice(0, 300)}`);
  }
}

export async function addJiraComment(
  issueKey: string,
  text: string,
): Promise<void> {
  const cfg = getJiraConfig();
  if (!cfg) return;

  const res = await jiraFetch(cfg, `/issue/${issueKey}/comment`, {
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
    const text2 = await res.text().catch(() => '');
    console.warn(`[jira] addComment failed: ${res.status} ${text2.slice(0, 200)}`);
  }
}
