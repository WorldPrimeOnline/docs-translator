// Telegram operations integration — pure message/keyboard builders.
//
// No network calls here — callers (src/app/api/telegram/jira-event/route.ts,
// src/app/api/telegram/webhook/route.ts) fetch data and pass plain values in.
// Keeping this module pure makes the exact UX templates directly unit-testable.
//
// Telegram Operations is entirely Jira-driven: jira_issue_key + role is the sole
// operational identity, and no Supabase table backs any of it — see
// docs/ai-context/60_INTEGRATIONS_JIRA_DRIVE_TELEGRAM.md.
//
// Telegram is a projection of Jira state, never the other way round — every button
// here carries callback_data routed back through /api/telegram/webhook, which only
// ever forwards actions to Jira Automation. Nothing in this file (or its callers)
// performs a Jira transition.

import { JIRA_FIELDS, type JiraIssueSnapshot } from '@/lib/jira/client';

export type TelegramOpsRole = 'translator' | 'notary';
export type TelegramOpsAction =
  | 'translator_claim' | 'translator_start' | 'translator_done'
  | 'notary_claim' | 'notary_start' | 'notary_done';

export interface CallbackButtonSpec {
  text: string;
  callback_data: string;
}

// ─── Jira field extraction helpers ─────────────────────────────────────────────

/** Jira single-select custom fields come back as `{ id, value }` in GET responses. */
export function extractSelectValue(field: unknown): string | null {
  if (field && typeof field === 'object' && 'value' in field) {
    const v = (field as { value?: unknown }).value;
    return typeof v === 'string' && v.length > 0 ? v : null;
  }
  return null;
}

export function extractTextValue(field: unknown): string | null {
  return typeof field === 'string' && field.length > 0 ? field : null;
}

/** The Telegram Operations page-count/payout fields are Text fields holding a
 * numeric value serialized as a string (not native Jira Number fields) — parses
 * and validates, returning null for anything absent or non-numeric rather than
 * fabricating a value. */
export function extractNumericTextValue(field: unknown): number | null {
  const raw = extractTextValue(field);
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

// ─── Initial broadcast message ─────────────────────────────────────────────────

export interface OrderBroadcastData {
  issueKey: string;
  role: TelegramOpsRole;
  translationType: string | null;
  languagePair: string | null;
  documentType: string | null;
  /** price_quotes.translation_page_count_exact (the pricing engine's authoritative
   * payable/billable page count — NOT the raw physical PDF page count), populated
   * into the Jira field at issue-creation time. Null when absent. */
  pageCount: number | null;
  /** cost_reservations.amount_kzt for this role's payout cost_type, populated into
   * the Jira field at issue-creation time. Null when absent. */
  payoutKzt: number | null;
  driveUrl: string | null;
}

/** Builds OrderBroadcastData from a raw Jira issue snapshot plus the already-extracted page-count/payout extras. */
export function buildOrderBroadcastData(
  issue: JiraIssueSnapshot,
  role: TelegramOpsRole,
  extra: { pageCount: number | null; payoutKzt: number | null },
): OrderBroadcastData {
  return {
    issueKey: issue.key,
    role,
    translationType: extractSelectValue(issue.fields[JIRA_FIELDS.translationType]),
    languagePair: extractTextValue(issue.fields[JIRA_FIELDS.languagePair]),
    documentType: extractSelectValue(issue.fields[JIRA_FIELDS.documentType]),
    pageCount: extra.pageCount,
    payoutKzt: extra.payoutKzt,
    driveUrl: extractTextValue(issue.fields[JIRA_FIELDS.documentsLink]),
  };
}

const CLAIM_BUTTON_TEXT: Record<TelegramOpsRole, string> = {
  translator: '🙋 Назначить себя',
  notary: '⚖️ Назначить себя',
};

const CLAIM_ACTION: Record<TelegramOpsRole, TelegramOpsAction> = {
  translator: 'translator_claim',
  notary: 'notary_claim',
};

const PAYOUT_LABEL: Record<TelegramOpsRole, string> = {
  translator: 'Выплата переводчику',
  notary: 'Выплата нотариусу',
};

function formatKzt(amount: number): string {
  // toLocaleString('ru-RU') groups thousands with U+00A0 (non-breaking space) —
  // normalize to a plain space so the Telegram message text is predictable/copy-safe.
  return `${Math.round(amount).toLocaleString('ru-RU').replace(/\u00A0/g, ' ')} ₸`;
}

export function buildOrderBroadcastMessage(
  data: OrderBroadcastData,
): { text: string; buttons: CallbackButtonSpec[] } {
  const lines: string[] = [`🆕 <b>${data.issueKey}</b>`, ''];
  if (data.translationType) lines.push(`Тип услуги: ${data.translationType}`);
  if (data.documentType) lines.push(`Тип документа: ${data.documentType}`);
  if (data.languagePair) lines.push(`Языковая пара: ${data.languagePair}`);
  if (data.pageCount != null) lines.push(`Оплачиваемые страницы: ${data.pageCount}`);
  if (data.payoutKzt != null) lines.push(`${PAYOUT_LABEL[data.role]}: ${formatKzt(data.payoutKzt)}`);
  if (data.driveUrl) lines.push(`Материалы: ${data.driveUrl}`);
  lines.push('');
  lines.push('Исполнитель: не назначен');

  return {
    text: lines.join('\n'),
    buttons: [{
      text: CLAIM_BUTTON_TEXT[data.role],
      callback_data: `${CLAIM_ACTION[data.role]}:${data.issueKey}`,
    }],
  };
}

// ─── Status-driven message (the only thing that ever edits the broadcast) ─────

export interface StatusMapEntry {
  emoji: string;
  internalStatus: 'claimed' | 'in_progress' | 'completed';
  nextButton: { text: string; action: TelegramOpsAction } | null;
}

const TRANSLATOR_STATUS_MAP: Record<string, StatusMapEntry> = {
  'НАЗНАЧЕН ПЕРЕВОДЧИК': { emoji: '🟡', internalStatus: 'claimed', nextButton: { text: '▶️ Взять в работу', action: 'translator_start' } },
  'ПЕРЕВОД В РАБОТЕ': { emoji: '🔵', internalStatus: 'in_progress', nextButton: { text: '✅ Завершить перевод', action: 'translator_done' } },
  'ПЕРЕВОД ЗАВЕРШЕН': { emoji: '🟢', internalStatus: 'completed', nextButton: null },
};

const NOTARY_STATUS_MAP: Record<string, StatusMapEntry> = {
  'НАЗНАЧЕН НОТАРИУС': { emoji: '🟡', internalStatus: 'claimed', nextButton: { text: '▶️ Взять в работу', action: 'notary_start' } },
  'В РАБОТЕ У НОТАРИУСА': { emoji: '🔵', internalStatus: 'in_progress', nextButton: { text: '✅ Документ заверен', action: 'notary_done' } },
  'ПЕРЕВОД ЗАВЕРЕН': { emoji: '🟢', internalStatus: 'completed', nextButton: null },
};

/**
 * Required current Jira status for each Telegram action to be legitimate — the
 * precondition Jira Automation itself re-validates authoritatively (as part of the
 * same rule execution that performs the transition, and for claim actions, also
 * sets the ownership fields). /api/telegram/webhook's own check against this map
 * is a fast, non-authoritative UX nicety only — it never substitutes for
 * Automation's real gate.
 */
export const REQUIRED_STATUS_FOR_ACTION: Record<TelegramOpsAction, string> = {
  translator_claim: 'OPEN',
  translator_start: 'НАЗНАЧЕН ПЕРЕВОДЧИК',
  translator_done: 'ПЕРЕВОД В РАБОТЕ',
  notary_claim: 'ПЕРЕВОД ЗАВЕРШЕН',
  notary_start: 'НАЗНАЧЕН НОТАРИУС',
  notary_done: 'В РАБОТЕ У НОТАРИУСА',
};

/**
 * Maps a raw Jira status name to the role + display entry it belongs to.
 * Returns null for any status outside these 6 — the issue may pass through many
 * other statuses (delivery, pickup, etc.) unrelated to this Telegram sub-flow, and
 * those must be silently ignored, not treated as errors.
 */
export function resolveStatusMapping(
  jiraStatus: string,
): { role: TelegramOpsRole; entry: StatusMapEntry } | null {
  const translatorEntry = TRANSLATOR_STATUS_MAP[jiraStatus];
  if (translatorEntry) return { role: 'translator', entry: translatorEntry };

  const notaryEntry = NOTARY_STATUS_MAP[jiraStatus];
  if (notaryEntry) return { role: 'notary', entry: notaryEntry };

  return null;
}

export function buildStatusUpdateMessage(params: {
  issueKey: string;
  jiraStatus: string;
  entry: StatusMapEntry;
  executorName: string | null;
}): { text: string; buttons: CallbackButtonSpec[] } {
  const lines = [
    `${params.entry.emoji} <b>${params.issueKey}</b>`,
    `Исполнитель: ${params.executorName ?? 'не назначен'}`,
    `Статус: ${params.jiraStatus}`,
  ];

  const buttons: CallbackButtonSpec[] = params.entry.nextButton
    ? [{ text: params.entry.nextButton.text, callback_data: `${params.entry.nextButton.action}:${params.issueKey}` }]
    : [];

  return { text: lines.join('\n'), buttons };
}
