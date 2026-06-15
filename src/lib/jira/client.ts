import type { ServiceLevel } from '../translation-prompts/types';
import { getJiraCredentials, makeAuthHeader } from './config';
import { JIRA_PROJECT_CONFIG, JIRA_ISSUE_TYPE } from './project-config';

// ─── Field IDs (kept here for web-app side; mirrored in worker/src/lib/jira/order-fields.ts) ──

const JIRA_FIELDS = {
  customerId:        'customfield_10074',
  orderId:           'customfield_10073',
  deliveryAddress:   'customfield_10076',
  deliveryPhone:     'customfield_10075',
  totalCost:         'customfield_10077',
  paymentMethod:     'customfield_10080',
  internalCost:      'customfield_10078',
  documentsLink:     'customfield_10079',
  translationType:   'customfield_10083',
  documentType:      'customfield_10082',
  languagePair:      'customfield_10088',
  fulfillmentMethod: 'customfield_10087',
} as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const LANG_NAMES: Record<string, string> = {
  ru: 'Русский', en: 'Английский', zh: 'Китайский', ko: 'Корейский',
  kk: 'Казахский', tj: 'Таджикский', uz: 'Узбекский', tk: 'Туркменский',
  mn: 'Монгольский', ky: 'Кыргызский', es: 'Испанский', de: 'Немецкий',
  fr: 'Французский', ar: 'Арабский', auto: 'Автоопределение',
};
function langName(code: string): string { return LANG_NAMES[code.toLowerCase()] ?? code.toUpperCase(); }

const DOC_TYPE_LABELS: Record<string, string> = {
  passport_id: 'Паспорт', diploma_transcript: 'Диплом', contract: 'Договор',
  bank_statement: 'Банковская выписка', medical_document: 'Медицинский документ',
  police_clearance: 'Справка о несудимости', visa_documents: 'Визовый документ',
  driver_license: 'Водительское удостоверение', presentation: 'Презентация',
  employment_document: 'Другое', other: 'Другое',
};

const TRANSLATION_TYPE_LABELS: Record<string, string> = {
  official_with_translator_signature_and_provider_stamp: 'Сертифицированный переводчиком',
  notarization_through_partners: 'Нотариально заверенный',
};

const FULFILLMENT_LABELS: Record<string, string> = { delivery: 'Курьер', pickup: 'Самовывоз' };

function stableHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = Math.imul(31, h) + s.charCodeAt(i); h |= 0; }
  return Math.abs(h);
}

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface CreateIssueParams {
  jobId: string;
  customerId?: string | null;
  serviceLevel: ServiceLevel;
  sourceLang: string;
  targetLang: string;
  documentType: string;
  notaryCity?: string | null;
  fulfillmentMethod?: 'pickup' | 'delivery' | null;
  deliveryPhone?: string | null;
  deliveryAddress?: string | null;
  paymentSource?: 'card_payment' | 'subscription' | null;
  driveUrl?: string | null;
  wpoUrl: string;
  createdAt?: string | null;
}

export interface JiraIssueResult {
  issueId: string;
  issueKey: string;
  issueUrl: string;
}

// ─── HTTP ─────────────────────────────────────────────────────────────────────

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

// ─── Payload builder ──────────────────────────────────────────────────────────

function buildDescription(params: CreateIssueParams): object {
  const lines: string[] = [
    `Job ID: ${params.jobId}`,
    `Languages: ${params.sourceLang} → ${params.targetLang}`,
    `Document type: ${params.documentType.split('|')[0]}`,
  ];
  if (params.notaryCity) lines.push(`Notary city: ${params.notaryCity}`);
  if (params.fulfillmentMethod) lines.push(`Fulfillment: ${params.fulfillmentMethod}`);
  if (params.driveUrl) lines.push(`Drive: ${params.driveUrl}`);
  lines.push(`WPO order: ${params.wpoUrl}`);
  if (params.createdAt) lines.push(`Created: ${params.createdAt}`);
  return {
    type: 'doc', version: 1,
    content: lines.map((text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })),
  };
}

function buildCustomFields(params: CreateIssueParams): Record<string, unknown> {
  const f = JIRA_FIELDS;
  const fields: Record<string, unknown> = {};

  if (params.customerId) fields[f.customerId] = params.customerId;
  fields[f.orderId] = params.jobId;

  if (params.fulfillmentMethod === 'delivery') {
    if (params.deliveryPhone) fields[f.deliveryPhone] = params.deliveryPhone;
    if (params.deliveryAddress) fields[f.deliveryAddress] = params.deliveryAddress;
  }

  // TODO: replace temporary Jira order price with final pricing engine result
  fields[f.totalCost] = 5000 + (stableHash(params.jobId) % 10001);
  // TODO: calculate translator, notary, delivery and operational internal costs
  fields[f.internalCost] = 0;

  fields[f.paymentMethod] = { value: params.paymentSource === 'subscription' ? 'Подписка' : 'За документ' };

  if (params.driveUrl) fields[f.documentsLink] = params.driveUrl;

  const translLabel = TRANSLATION_TYPE_LABELS[params.serviceLevel];
  if (translLabel) fields[f.translationType] = { value: translLabel };

  const docLabel = DOC_TYPE_LABELS[params.documentType.split('|')[0] ?? params.documentType] ?? 'Другое';
  fields[f.documentType] = { value: docLabel };

  const src = params.sourceLang === 'auto' ? 'Автоопределение' : langName(params.sourceLang);
  fields[f.languagePair] = `${src} → ${langName(params.targetLang)}`;

  if (params.fulfillmentMethod) {
    const fLabel = FULFILLMENT_LABELS[params.fulfillmentMethod];
    if (fLabel) fields[f.fulfillmentMethod] = { value: fLabel };
  }

  return fields;
}

// ─── Public API ───────────────────────────────────────────────────────────────

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
      ...buildCustomFields(params),
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

/** Update an existing Jira issue (used to backfill Drive URL after retry). */
export async function updateJiraIssue(
  issueKey: string,
  fields: Record<string, unknown>,
): Promise<void> {
  const res = await jiraFetch(`/issue/${issueKey}`, {
    method: 'PUT',
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Jira updateIssue failed: ${res.status} ${text.slice(0, 300)}`);
  }
}
