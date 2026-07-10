/**
 * Jira custom-field IDs, option values, and payload builder for WPO orders.
 *
 * Field IDs and option values are hardcoded here — NOT in env vars.
 * Project key (WO) and issue type (Заказ) are fixed in the worker.
 *
 * Security constraints (never put these in Jira fields):
 *  - Document number / IIN
 *  - Full payment credentials
 *  - Document content / AI draft
 *  - Files
 *
 * Delivery phone and address go ONLY in customfield_10075 / customfield_10076
 * (not in summary or description).
 */

import { normalizeDocumentType } from '../translation-prompts';
import type { ServiceLevel } from '../output-plan';

// ─── Field IDs ────────────────────────────────────────────────────────────────

export const JIRA_FIELDS = {
  customerId:        'customfield_10074', // Supabase user ID
  orderId:           'customfield_10073', // job UUID (same as summary)
  deliveryAddress:   'customfield_10076', // only when fulfillment_method=delivery
  deliveryPhone:     'customfield_10075', // only when fulfillment_method=delivery
  totalCost:         'customfield_10077', // number, KZT
  paymentMethod:     'customfield_10080', // single-select
  internalCost:      'customfield_10078', // number
  documentsLink:     'customfield_10079', // text — Google Drive URL
  translationType:   'customfield_10083', // single-select
  documentType:      'customfield_10082', // single-select
  languagePair:      'customfield_10088', // text
  fulfillmentMethod: 'customfield_10087', // single-select
} as const;

// ─── Language names (Russian display) ────────────────────────────────────────

const LANG_NAMES: Record<string, string> = {
  ru:   'Русский',
  en:   'Английский',
  zh:   'Китайский',
  ko:   'Корейский',
  kk:   'Казахский',
  tj:   'Таджикский',
  uz:   'Узбекский',
  tk:   'Туркменский',
  mn:   'Монгольский',
  ky:   'Кыргызский',
  es:   'Испанский',
  de:   'Немецкий',
  fr:   'Французский',
  ar:   'Арабский',
  auto: 'Автоопределение',
};

function langName(code: string): string {
  return LANG_NAMES[code.toLowerCase()] ?? code.toUpperCase();
}

// ─── Document type mapping ────────────────────────────────────────────────────

const DOC_TYPE_LABELS: Record<string, string> = {
  passport_id:         'Паспорт',
  diploma_transcript:  'Диплом',
  contract:            'Договор',
  bank_statement:      'Банковская выписка',
  medical_document:    'Медицинский документ',
  police_clearance:    'Справка о несудимости',
  visa_documents:      'Визовый документ',
  driver_license:      'Водительское удостоверение',
  presentation:        'Презентация',
  employment_document: 'Другое',
  other:               'Другое',
  unknown:             'Другое',
};

function docTypeLabel(raw: string): string {
  // Strip output-format suffix (e.g. "passport_id|pdf" → "passport_id")
  const stripped = raw.split('|')[0] ?? raw;
  const normalized = normalizeDocumentType(stripped);
  return DOC_TYPE_LABELS[normalized] ?? 'Другое';
}

// ─── Translation type mapping ─────────────────────────────────────────────────

const TRANSLATION_TYPE_LABELS: Record<string, string> = {
  official_with_translator_signature_and_provider_stamp: 'Сертифицированный переводчиком',
  notarization_through_partners:                         'Нотариально заверенный',
};

// ─── Payment method mapping ───────────────────────────────────────────────────

function paymentMethodLabel(paymentSource: string | null): string {
  return paymentSource === 'subscription' ? 'Подписка' : 'За документ';
}

// ─── Fulfillment method mapping ───────────────────────────────────────────────

const FULFILLMENT_LABELS: Record<string, string> = {
  delivery: 'Курьер',
  pickup:   'Самовывоз',
};

// ─── Applicant type description line (notarized orders only) ─────────────────
// individual vs legal_entity directly determines the notary official fee tier
// (NOTARY_APPLICANT_MRP_COEFFICIENT — src/lib/pricing/config.ts) but had no
// visibility in Jira until this fix. No custom field exists for it, so it goes
// into the issue description as a plain line (like the other operator-facing
// context lines in createJiraIssue()'s descLines), not a custom field.

const APPLICANT_TYPE_LABELS: Record<'individual' | 'legal_entity', string> = {
  individual:   'Физическое лицо',
  legal_entity: 'Юридическое лицо',
};

const APPLICANT_TYPE_UNSPECIFIED_LABEL = 'Не указан';

/**
 * Builds the "Тип заказчика для нотариального тарифа: ..." description line.
 *
 * Returns null ONLY when the order isn't notarized — the two-tier notary fee
 * (individual vs legal_entity) doesn't apply to electronic/official orders, so
 * the line is omitted entirely there, not shown with a placeholder.
 *
 * For notarized orders this ALWAYS returns a line: the real label for a known
 * choice ('individual'/'legal_entity'), or the honest "Не указан" fallback for
 * anything else — null, undefined, 'unknown', or any unsupported string (the
 * jobs.applicant_type column has no DB-level CHECK constraint, so defend
 * against unexpected values here rather than assuming the TS type at runtime).
 * Never fabricates 'individual' as a default and never infers from price.
 */
export function buildApplicantTypeDescriptionLine(
  serviceLevel: string,
  applicantType: string | null | undefined,
): string | null {
  if (serviceLevel !== 'notarization_through_partners') return null;
  const label = applicantType === 'individual' || applicantType === 'legal_entity'
    ? APPLICANT_TYPE_LABELS[applicantType]
    : APPLICANT_TYPE_UNSPECIFIED_LABEL;
  return `Тип заказчика для нотариального тарифа: ${label}`;
}

// ─── Payload builder ──────────────────────────────────────────────────────────

export interface JiraIssueFieldsInput {
  orderId: string;
  customerId: string | null;
  sourceLang: string;
  targetLang: string;
  documentType: string;
  serviceLevel: ServiceLevel;
  paymentSource: 'card_payment' | 'subscription' | null;
  fulfillmentMethod: 'pickup' | 'delivery' | null;
  deliveryPhone: string | null;
  deliveryAddress: string | null;
  driveUrl: string | null;
  amountKzt?: number | null;
}

/**
 * Builds the `fields` object for a Jira POST /issue payload.
 * Omits any field that has no meaningful value to avoid Jira 400 errors.
 */
export function buildJiraIssueFields(input: JiraIssueFieldsInput): Record<string, unknown> {
  const f = JIRA_FIELDS;
  const fields: Record<string, unknown> = {};

  // Required identifiers
  if (input.customerId) fields[f.customerId] = input.customerId;
  fields[f.orderId] = input.orderId;

  // Delivery-only PII — only included when fulfillment_method=delivery
  if (input.fulfillmentMethod === 'delivery') {
    if (input.deliveryPhone) fields[f.deliveryPhone] = input.deliveryPhone;
    if (input.deliveryAddress) fields[f.deliveryAddress] = input.deliveryAddress;
  }

  if (input.amountKzt != null && input.amountKzt > 0) fields[f.totalCost] = input.amountKzt;
  fields[f.internalCost] = 0;

  // Payment method (single-select)
  fields[f.paymentMethod] = { value: paymentMethodLabel(input.paymentSource) };

  // Documents link
  if (input.driveUrl) fields[f.documentsLink] = input.driveUrl;

  // Translation type (single-select)
  const translationLabel = TRANSLATION_TYPE_LABELS[input.serviceLevel];
  if (translationLabel) fields[f.translationType] = { value: translationLabel };

  // Document type (single-select)
  fields[f.documentType] = { value: docTypeLabel(input.documentType) };

  // Language pair (text)
  const autoLabel = 'Автоопределение';
  const srcName = input.sourceLang === 'auto' ? autoLabel : langName(input.sourceLang);
  fields[f.languagePair] = `${srcName} → ${langName(input.targetLang)}`;

  // Fulfillment method (single-select)
  if (input.fulfillmentMethod) {
    const label = FULFILLMENT_LABELS[input.fulfillmentMethod];
    if (label) fields[f.fulfillmentMethod] = { value: label };
  }

  return fields;
}
