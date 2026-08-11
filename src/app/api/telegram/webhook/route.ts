// Telegram -> WPO callback-button handler.
//
// Telegram Operations is entirely Jira-driven — no Supabase table backs this
// feature. Railway/Vercel never calls a Jira transition; it only ever forwards a
// validated action request to the single Jira Automation incoming-webhook rule
// (JIRA_AUTOMATION_TELEGRAM_ACTION_WEBHOOK_URL).
//
// *_claim (translator_claim / notary_claim): Jira Automation is the SOLE
// authority for claim acceptance. This route does not fetch the Jira issue, does
// not inspect its status, and does not locally decide whether an order is
// already claimed — it only validates the Telegram-side envelope (webhook
// secret, chat, action shape) and dispatches. WO-122 production incident
// (2026-08-10): a local status precheck here rejected a legitimately-claimable
// OPEN issue ("Заказ уже назначен другому переводчику.") before Automation was
// ever contacted, based on a separately-fetched status value with no guarantee
// of matching what Automation's own check would see — removed entirely, not
// patched, per docs/ai-context/DECISIONS.md.
//
// *_start / *_done: ownership validation against the stored Jira User ID field
// DOES remain — these actions must only be available to whoever actually
// claimed the order, and that check is a plain read with no accept/reject
// ambiguity like the claim precheck had.
//
// This route never edits the Telegram message — the message is only ever edited
// by /api/telegram/jira-event's status_changed handler, driven by Jira's own
// normal status-change event. See docs/ai-context/60_INTEGRATIONS_JIRA_DRIVE_TELEGRAM.md.
//
// Auth: X-Telegram-Bot-Api-Secret-Token header must match TELEGRAM_WEBHOOK_SECRET
// (Telegram's native webhook-secret mechanism, set once via the setWebhook call —
// see docs/TELEGRAM_OPERATIONS_SETUP.md).

import { NextRequest, NextResponse } from 'next/server';
import { getJiraIssue } from '@/lib/jira/client';
import { answerCallbackQuery } from '@/lib/telegram/client';
import { forwardActionToJiraAutomation } from '@/lib/telegram-ops/automation-actions';
import { extractTextValue, REQUIRED_STATUS_FOR_ACTION, statusNamesMatch, type TelegramOpsAction, type TelegramOpsRole } from '@/lib/telegram-ops/order-message';
import { telegramRoleFieldIds } from '@/lib/telegram-ops/jira-fields';

const ACTION_PATTERN = /^(translator|notary)_(claim|start|done):(.+)$/;

interface TelegramFrom {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
}

interface TelegramCallbackQuery {
  id: string;
  from: TelegramFrom;
  message?: { chat?: { id?: number } };
  data?: string;
}

interface TelegramUpdate {
  callback_query?: TelegramCallbackQuery;
}

// Diagnostic only, per-callback — logs the raw non-secret identity fields Telegram
// sent, so a "???" executor name can be distinguished from an encoding bug (real
// Telegram-side data) vs. anything happening in our own pipeline. No secrets here:
// first_name/last_name/username/id are all fields the recipient chat already sees.
function logRawIdentityFields(issueKey: string, from: TelegramFrom): void {
  console.log(
    `[telegram-webhook] callback_query.from identity issueKey=${issueKey} ` +
    `first_name=${from.first_name ?? '-'} last_name=${from.last_name ?? '-'} ` +
    `username=${from.username ?? '-'} id=${from.id}`,
  );
}

const PLACEHOLDER_NAME_PATTERN = /^\?+$/;

/**
 * Telegram accounts can genuinely have a first/last name consisting only of "?"
 * characters — confirmed independently via Telegram's own service messages for this
 * exact account ("??? created the group", "??? updated group photo"), which is
 * Telegram-rendered, not something WPO's pipeline could corrupt. Not evidence of an
 * encoding bug (see docs/ai-context/DECISIONS.md, 2026-08-10). Such a name is
 * useless as an executor identifier though, so it's treated the same as an absent
 * name and skipped in favor of the next fallback.
 */
function isPlaceholderName(value: string): boolean {
  const stripped = value.replace(/\s+/g, '');
  return stripped.length > 0 && PLACEHOLDER_NAME_PATTERN.test(stripped);
}

function displayNameFor(from: TelegramFrom): string {
  const parts = [from.first_name, from.last_name].filter(
    (p): p is string => !!p && !isPlaceholderName(p),
  );
  if (parts.length > 0) return parts.join(' ');
  if (from.username && !isPlaceholderName(from.username)) return from.username;
  return `tg:${from.id}`;
}

function chatIdForRole(role: TelegramOpsRole): string | undefined {
  return role === 'translator'
    ? process.env.TELEGRAM_TRANSLATOR_CHAT_ID
    : process.env.TELEGRAM_NOTARY_CHAT_ID;
}

/**
 * Explicit, structured log line for every action callback (claim/start/done),
 * regardless of outcome — the single place all of issueKey/action/telegramUserId/
 * role/dispatch-decision/Automation HTTP status are recorded together, for
 * production debugging of exactly the WO-122 class of incident.
 */
function logCallbackOutcome(params: {
  issueKey: string;
  action: TelegramOpsAction;
  telegramUserId: string;
  role: TelegramOpsRole;
  dispatched: boolean;
  rejectionReason?: string;
  automationHttpStatus?: number | null;
}): void {
  console.log(
    `[telegram-webhook] callback issueKey=${params.issueKey} action=${params.action} ` +
    `telegramUserId=${params.telegramUserId} role=${params.role} ` +
    `dispatch=${params.dispatched ? 'yes' : 'no'} ` +
    `reason=${params.rejectionReason ?? '-'} ` +
    `automationStatus=${params.automationHttpStatus ?? '-'}`,
  );
}

// ─── Handling ─────────────────────────────────────────────────────────────────

/**
 * translator_claim / notary_claim: Jira Automation is the sole authority.
 * No Jira read, no local accept/reject decision — validate the Telegram-side
 * envelope only (already done by the caller: secret, chat, action shape) and
 * always dispatch. Automation validates the current status itself and either
 * writes ownership fields + transitions, or silently no-ops.
 */
async function handleClaim(
  issueKey: string,
  role: TelegramOpsRole,
  from: TelegramFrom,
  callbackQueryId: string,
): Promise<void> {
  const action: TelegramOpsAction = role === 'translator' ? 'translator_claim' : 'notary_claim';
  const telegramUserId = String(from.id);
  logRawIdentityFields(issueKey, from);
  const displayName = displayNameFor(from);

  const result = await forwardActionToJiraAutomation({
    issueKey,
    action,
    telegramUserId,
    executorName: displayName,
    role,
  });

  logCallbackOutcome({
    issueKey,
    action,
    telegramUserId,
    role,
    dispatched: true,
    automationHttpStatus: result.httpStatus,
  });

  await answerCallbackQuery(callbackQueryId, 'Принято, ожидайте подтверждения.');
}

async function handleStartOrDone(
  issueKey: string,
  role: TelegramOpsRole,
  kind: 'start' | 'done',
  from: TelegramFrom,
  callbackQueryId: string,
): Promise<void> {
  const action: TelegramOpsAction = `${role}_${kind}` as TelegramOpsAction;
  const telegramUserId = String(from.id);

  const userIdField = telegramRoleFieldIds(role).userId;
  const issue = await getJiraIssue(issueKey, [userIdField]);
  if (!issue) {
    console.error(`[telegram-webhook] ${action} rejected: Jira issue ${issueKey} not found`);
    logCallbackOutcome({ issueKey, action, telegramUserId, role, dispatched: false, rejectionReason: 'issue_not_found' });
    await answerCallbackQuery(callbackQueryId, 'Заказ не найден.', true);
    return;
  }

  const storedUserId = extractTextValue(issue.fields[userIdField]);
  if (!storedUserId) {
    console.error(`[telegram-webhook] ${action} rejected: no claimant recorded on ${issueKey} yet`);
    logCallbackOutcome({ issueKey, action, telegramUserId, role, dispatched: false, rejectionReason: 'no_claimant_recorded' });
    await answerCallbackQuery(callbackQueryId, 'Заказ ещё не назначен.', true);
    return;
  }
  if (storedUserId !== telegramUserId) {
    logCallbackOutcome({ issueKey, action, telegramUserId, role, dispatched: false, rejectionReason: 'not_owner' });
    await answerCallbackQuery(callbackQueryId, 'Этот заказ назначен другому исполнителю.', true);
    return;
  }

  // "start" only unlocks once Jira has confirmed the claim; "done" only unlocks
  // once Jira has confirmed work started. Both preconditions are the issue's own
  // current status — this is what makes "Telegram only a projection of Jira" also
  // the concurrency guard here: nobody can forward "done" before Jira itself
  // confirmed "in progress" (this route's check is a fast UX nicety; Automation
  // re-validates the same precondition authoritatively before transitioning).
  // Case/whitespace-insensitive per WO-122 (2026-08-10): Jira's real statusName
  // comes back sentence-case ("Назначен переводчик"), not this file's ALL-CAPS
  // REQUIRED_STATUS_FOR_ACTION values — an exact-match comparison here rejected
  // legitimate translator_start/notary_start/translator_done/notary_done taps.
  if (!statusNamesMatch(issue.statusName, REQUIRED_STATUS_FOR_ACTION[action])) {
    logCallbackOutcome({ issueKey, action, telegramUserId, role, dispatched: false, rejectionReason: `wrong_status:${issue.statusName}` });
    await answerCallbackQuery(callbackQueryId, 'Действие уже выполнено или ожидает подтверждения от Jira.');
    return;
  }

  logRawIdentityFields(issueKey, from);
  const displayName = displayNameFor(from);

  const result = await forwardActionToJiraAutomation({
    issueKey,
    action,
    telegramUserId,
    executorName: displayName,
    role,
  });

  logCallbackOutcome({
    issueKey,
    action,
    telegramUserId,
    role,
    dispatched: true,
    automationHttpStatus: result.httpStatus,
  });

  await answerCallbackQuery(callbackQueryId, 'Принято, ожидайте подтверждения.');
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest): Promise<NextResponse> {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret) {
    console.error('[telegram-webhook] TELEGRAM_WEBHOOK_SECRET not configured — rejecting request');
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 });
  }
  if (request.headers.get('x-telegram-bot-api-secret-token') !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let update: TelegramUpdate;
  try {
    update = (await request.json()) as TelegramUpdate;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const cb = update.callback_query;
  if (!cb?.data) {
    // Not a callback_query we care about (e.g. a plain message) — Telegram just
    // needs a 200 so it doesn't retry.
    return NextResponse.json({ ok: true });
  }

  const match = ACTION_PATTERN.exec(cb.data);
  if (!match) {
    console.warn(`[telegram-webhook] unrecognized callback_data: ${cb.data}`);
    await answerCallbackQuery(cb.id);
    return NextResponse.json({ ok: true });
  }

  const [, role, kind, issueKey] = match as unknown as [string, TelegramOpsRole, 'claim' | 'start' | 'done', string];

  const expectedChatId = chatIdForRole(role);
  const actualChatId = cb.message?.chat?.id;
  if (!expectedChatId || String(actualChatId) !== expectedChatId) {
    console.warn(`[telegram-webhook] callback from unexpected chat ${String(actualChatId)} for role=${role}`);
    await answerCallbackQuery(cb.id, 'Недоступно в этом чате.', true);
    return NextResponse.json({ ok: true });
  }

  if (kind === 'claim') {
    await handleClaim(issueKey, role, cb.from, cb.id);
  } else {
    await handleStartOrDone(issueKey, role, kind, cb.from, cb.id);
  }

  return NextResponse.json({ ok: true });
}
