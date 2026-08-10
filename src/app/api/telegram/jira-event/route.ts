// Jira Automation -> WPO Telegram operations bridge.
//
// Telegram Operations is entirely Jira-driven — jira_issue_key + role is the sole
// operational identity. No Supabase table backs this feature; all persistence is
// Jira custom fields (message-id, claimant user-id, claimant display name — see
// docs/TELEGRAM_OPERATIONS_SETUP.md). A Jira issue with no corresponding WPO order
// at all (e.g. one created manually purely to test this integration end-to-end) is
// a fully valid Telegram Operations issue.
//
// One endpoint, three events (same auth boundary/header as /api/webhooks/jira —
// X-WPO-Webhook-Secret must match JIRA_WEBHOOK_SECRET):
//
//  - translator_order_created: broadcast a new order to TELEGRAM_TRANSLATOR_CHAT_ID.
//    Fired by Jira Automation right after the main order issue is created (order is
//    already paid at that point — no payment/AI-ready check happens here).
//  - notary_required: broadcast to TELEGRAM_NOTARY_CHAT_ID. Fired by Jira Automation
//    once its own service-level condition + the ПЕРЕВОД ЗАВЕРШЕН gate are satisfied.
//  - status_changed: the ONLY thing that ever edits an already-sent Telegram message.
//    Fired by a Jira Automation rule watching the 6 statuses in order-message.ts's
//    STATUS_MAP tables. Jira remains sole source of truth — this just projects it.
//
// WPO never calls a Jira transition from this route or anywhere else in this feature.
// The message-id field is the one exception to "Jira Automation writes everything":
// it's deterministic integration metadata (not part of the ownership/workflow state
// machine), written directly via the existing updateJiraIssue() the same way Drive
// URL backfill already does. See docs/ai-context/60_INTEGRATIONS_JIRA_DRIVE_TELEGRAM.md.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getJiraIssue, updateJiraIssue, JIRA_FIELDS } from '@/lib/jira/client';
import {
  buildOrderBroadcastData,
  buildOrderBroadcastMessage,
  buildStatusUpdateMessage,
  extractNumericTextValue,
  extractTextValue,
  resolveStatusMapping,
  type TelegramOpsRole,
} from '@/lib/telegram-ops/order-message';
import { PAGE_COUNT_FIELD, payoutFieldForRole, telegramRoleFieldIds } from '@/lib/telegram-ops/jira-fields';
import { sendMessageWithCallbackButtons, editMessageWithCallbackButtons } from '@/lib/telegram/client';

// ─── Payload schema ───────────────────────────────────────────────────────────

const EventSchema = z.discriminatedUnion('event', [
  z.object({ event: z.literal('translator_order_created'), issueKey: z.string().min(1) }),
  z.object({ event: z.literal('notary_required'), issueKey: z.string().min(1) }),
  z.object({ event: z.literal('status_changed'), issueKey: z.string().min(1), jiraStatus: z.string().min(1) }),
]);

function chatIdForRole(role: TelegramOpsRole): string | undefined {
  return role === 'translator'
    ? process.env.TELEGRAM_TRANSLATOR_CHAT_ID
    : process.env.TELEGRAM_NOTARY_CHAT_ID;
}

// ─── translator_order_created / notary_required ────────────────────────────────

async function handleBroadcast(issueKey: string, role: TelegramOpsRole): Promise<NextResponse> {
  const chatId = chatIdForRole(role);
  if (!chatId) {
    console.log(`[telegram-jira-event] chat id not configured for role=${role} — skipping`);
    return NextResponse.json({ ok: true, skipped: 'chat_not_configured' });
  }

  const fieldIds = telegramRoleFieldIds(role);
  const messageIdField = fieldIds.messageId;
  const payoutField = payoutFieldForRole(role);
  const requestedFields = [
    JIRA_FIELDS.translationType,
    JIRA_FIELDS.documentType,
    JIRA_FIELDS.languagePair,
    JIRA_FIELDS.documentsLink,
    messageIdField,
    PAGE_COUNT_FIELD,
    payoutField,
  ];

  const issue = await getJiraIssue(issueKey, requestedFields);
  if (!issue) {
    return NextResponse.json({ error: 'Jira issue not found or Jira not configured' }, { status: 404 });
  }

  // Idempotency — the message-id field already being set means this issue/role was
  // already broadcast; Automation retries must never post a second message.
  if (extractTextValue(issue.fields[messageIdField])) {
    return NextResponse.json({ ok: true, skipped: 'already_broadcast' });
  }

  // Both text fields hold a numeric value serialized as text, populated by the
  // order-creation pipeline at issue-creation time from the pricing engine's own
  // output — never computed here, never fabricated when absent.
  const pageCount = extractNumericTextValue(issue.fields[PAGE_COUNT_FIELD]);
  const payoutKzt = extractNumericTextValue(issue.fields[payoutField]);

  const data = buildOrderBroadcastData(issue, role, { pageCount, payoutKzt });
  const { text, buttons } = buildOrderBroadcastMessage(data);

  const sendResult = await sendMessageWithCallbackButtons(chatId, text, buttons);
  if (!sendResult.ok || !sendResult.messageId) {
    return NextResponse.json({ error: `Telegram send failed: ${sendResult.error}` }, { status: 502 });
  }

  try {
    await updateJiraIssue(issueKey, { [messageIdField]: sendResult.messageId });
  } catch (err) {
    // The Telegram message IS live at this point — a real, surfaced failure:
    // status_changed later would have no way to find/edit this message at all.
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[telegram-jira-event] Telegram message ${sendResult.messageId} sent for ${issueKey}/${role} but failed to persist the message-id field:`, msg);
    return NextResponse.json({ error: `Telegram message sent but Jira field update failed: ${msg}` }, { status: 500 });
  }

  return NextResponse.json({ ok: true, action: 'broadcast_sent' });
}

// ─── status_changed ─────────────────────────────────────────────────────────────

/**
 * Explicit, structured log line for every status_changed request, regardless of
 * outcome — so a 200 response can never silently hide a skipped or failed edit.
 * See docs/ai-context/DECISIONS.md (2026-08-10, "Назначен переводчик" case-mismatch
 * incident) for why this exists: resolveStatusMapping() previously failed silently
 * on a real Jira status casing with zero log trace.
 */
function logStatusChangedOutcome(params: {
  issueKey: string;
  jiraStatus: string;
  role: TelegramOpsRole | null;
  messageId: string | null;
  executorName: string | null;
  nextAction: string | null;
  editAttempted: boolean;
  editSuccess: boolean | null;
  skipReason: string | null;
}): void {
  console.log(
    `[telegram-jira-event] status_changed issueKey=${params.issueKey} jiraStatus=${params.jiraStatus} ` +
    `role=${params.role ?? '-'} messageId=${params.messageId ?? '-'} executorName=${params.executorName ?? '-'} ` +
    `nextAction=${params.nextAction ?? '-'} editAttempted=${params.editAttempted ? 'yes' : 'no'} ` +
    `editSuccess=${params.editSuccess === null ? '-' : params.editSuccess ? 'yes' : 'no'} ` +
    `skipReason=${params.skipReason ?? '-'}`,
  );
}

async function handleStatusChanged(issueKey: string, jiraStatus: string): Promise<NextResponse> {
  const mapping = resolveStatusMapping(jiraStatus);
  if (!mapping) {
    // Issues pass through many other statuses (delivery, pickup, etc.) unrelated to
    // this Telegram sub-flow — silently ignore rather than treat as an error.
    logStatusChangedOutcome({
      issueKey, jiraStatus, role: null, messageId: null, executorName: null, nextAction: null,
      editAttempted: false, editSuccess: null, skipReason: 'status_not_mapped',
    });
    return NextResponse.json({ ok: true, action: 'no_op' });
  }

  const chatId = chatIdForRole(mapping.role);
  if (!chatId) {
    logStatusChangedOutcome({
      issueKey, jiraStatus, role: mapping.role, messageId: null, executorName: null, nextAction: null,
      editAttempted: false, editSuccess: null, skipReason: 'chat_not_configured',
    });
    return NextResponse.json({ ok: true, skipped: 'chat_not_configured' });
  }

  const fieldIds = telegramRoleFieldIds(mapping.role);
  const messageIdField = fieldIds.messageId;

  const issue = await getJiraIssue(issueKey, [messageIdField, fieldIds.displayName]);
  if (!issue) {
    logStatusChangedOutcome({
      issueKey, jiraStatus, role: mapping.role, messageId: null, executorName: null, nextAction: null,
      editAttempted: false, editSuccess: null, skipReason: 'issue_not_found',
    });
    return NextResponse.json({ error: 'Jira issue not found or Jira not configured' }, { status: 404 });
  }

  const messageId = extractTextValue(issue.fields[messageIdField]);
  if (!messageId) {
    console.warn(`[telegram-jira-event] status_changed for ${issueKey}/${mapping.role} but no Telegram message has been broadcast yet (message-id field empty)`);
    logStatusChangedOutcome({
      issueKey, jiraStatus, role: mapping.role, messageId: null, executorName: null, nextAction: null,
      editAttempted: false, editSuccess: null, skipReason: 'no_broadcast_message',
    });
    return NextResponse.json({ ok: true, action: 'no_broadcast' });
  }

  const executorName = extractTextValue(issue.fields[fieldIds.displayName]);
  const nextAction = mapping.entry.nextButton?.action ?? null;

  const { text, buttons } = buildStatusUpdateMessage({
    issueKey,
    jiraStatus,
    entry: mapping.entry,
    executorName,
  });

  const editResult = await editMessageWithCallbackButtons(chatId, Number(messageId), text, buttons);
  if (!editResult.ok) {
    console.error(`[telegram-jira-event] failed to edit Telegram message ${messageId} for ${issueKey}/${mapping.role}: ${editResult.error}`);
  }

  logStatusChangedOutcome({
    issueKey, jiraStatus, role: mapping.role, messageId, executorName, nextAction,
    editAttempted: true, editSuccess: editResult.ok, skipReason: null,
  });

  return NextResponse.json({ ok: true, action: 'message_updated' });
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest): Promise<NextResponse> {
  const secret = process.env.JIRA_WEBHOOK_SECRET;
  if (!secret) {
    console.error('[telegram-jira-event] JIRA_WEBHOOK_SECRET not configured — rejecting request');
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 });
  }
  if (request.headers.get('x-wpo-webhook-secret') !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let payload: z.infer<typeof EventSchema>;
  try {
    const raw: unknown = await request.json();
    const parsed = EventSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid payload', details: parsed.error.flatten() }, { status: 400 });
    }
    payload = parsed.data;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  switch (payload.event) {
    case 'translator_order_created':
      return handleBroadcast(payload.issueKey, 'translator');
    case 'notary_required':
      return handleBroadcast(payload.issueKey, 'notary');
    case 'status_changed':
      return handleStatusChanged(payload.issueKey, payload.jiraStatus);
  }
}
