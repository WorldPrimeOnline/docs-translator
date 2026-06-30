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
  email: string;
  phone?: string | null;
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
    `Email: ${params.email}`,
  ];
  if (params.phone) lines.push(`Phone: ${params.phone}`);
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

// ─── Partner activation / deactivation comments ───────────────────────────────

export interface PartnerActivationCommentParams {
  referralCode: string;
  partnerLink: string;
  qrCodeUrl: string;
  commissionRate: number;
  clientDiscountEnabled: boolean;
  clientDiscountType: string | null;
  clientDiscountValue: number | null;
  clientDiscountMinOrderAmount: number | null;
  clientDiscountMaxAmount: number | null;
}

function fmtNum(n: number): string {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

function formatCommission(rate: number): string {
  const pct = Math.round(rate * 100 * 10) / 10;
  return `${pct}%`;
}

function formatDiscount(p: PartnerActivationCommentParams): string {
  if (!p.clientDiscountEnabled || !p.clientDiscountType || p.clientDiscountValue == null) {
    return 'не настроена';
  }
  const parts: string[] = [];
  if (p.clientDiscountType === 'percent') {
    parts.push(`${p.clientDiscountValue}%`);
  } else {
    parts.push(`${fmtNum(p.clientDiscountValue)} ₸`);
  }
  if (p.clientDiscountMinOrderAmount) {
    parts.push(`от заказа от ${fmtNum(p.clientDiscountMinOrderAmount)} ₸`);
  }
  if (p.clientDiscountMaxAmount) {
    parts.push(`максимум ${fmtNum(p.clientDiscountMaxAmount)} ₸`);
  }
  return parts.join(', ');
}

function buildActivationCommentAdf(p: PartnerActivationCommentParams): object {
  const lines = [
    'Партнёр активирован.',
    '',
    `Код партнёра: ${p.referralCode}`,
    '',
    'Партнёрская ссылка:',
    p.partnerLink,
    '',
    'QR-код:',
    p.qrCodeUrl,
    '',
    'Текст для отправки клиенту:',
    `"Для перевода документов используйте WPO Translations:\n${p.partnerLink}\n\nИли введите код ${p.referralCode} в поле «Промокод / код партнёра» при оформлении заказа."`,
    '',
    'Условия:',
    `- Комиссия партнёра: ${formatCommission(p.commissionRate)}`,
    `- Скидка клиенту: ${formatDiscount(p)}`,
  ];
  return {
    type: 'doc',
    version: 1,
    content: lines.map((text) => ({
      type: 'paragraph',
      content: text === '' ? [] : [{ type: 'text', text }],
    })),
  };
}

async function jiraFetchPartner(path: string, options: RequestInit): Promise<Response> {
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

/**
 * Add an activation summary comment to the Jira Partnership issue.
 * Called after partner creation/reactivation. Must be wrapped in try/catch by caller.
 */
export async function addPartnerActivationComment(
  issueKey: string,
  params: PartnerActivationCommentParams,
): Promise<void> {
  const creds = getJiraCredentials();
  if (!creds) {
    console.log('[jira/partner] Jira not configured — skipping activation comment');
    return;
  }

  const body = buildActivationCommentAdf(params);
  const res = await jiraFetchPartner(`/issue/${issueKey}/comment`, {
    method: 'POST',
    body: JSON.stringify({ body }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Jira addComment failed: ${res.status} — ${errText.slice(0, 200)}`);
  }

  console.log(`[jira/partner] Activation comment added to ${issueKey} for code ${params.referralCode}`);
}

/**
 * Add a deactivation notice comment to the Jira Partnership issue.
 * Called after partner deactivation. Must be wrapped in try/catch by caller.
 */
export async function addPartnerDeactivationComment(
  issueKey: string,
  referralCode: string,
): Promise<void> {
  const creds = getJiraCredentials();
  if (!creds) {
    console.log('[jira/partner] Jira not configured — skipping deactivation comment');
    return;
  }

  const body = {
    type: 'doc',
    version: 1,
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text: `Партнёрство отменено. Код ${referralCode} деактивирован и больше не применяется на сайте.` }],
      },
    ],
  };

  const res = await jiraFetchPartner(`/issue/${issueKey}/comment`, {
    method: 'POST',
    body: JSON.stringify({ body }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Jira addDeactivationComment failed: ${res.status} — ${errText.slice(0, 200)}`);
  }

  console.log(`[jira/partner] Deactivation comment added to ${issueKey} for code ${referralCode}`);
}
