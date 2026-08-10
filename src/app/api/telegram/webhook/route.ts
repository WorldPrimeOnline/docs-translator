// Telegram -> WPO callback-button handler.
//
// Telegram Operations is entirely Jira-driven — no Supabase table backs this
// feature. Ownership state (who claimed an issue) lives only in Jira custom
// fields, written ONLY by Jira Automation as part of the same rule execution that
// validates the current status and performs the claim transition — this route
// never pre-writes ownership fields itself. Railway/Vercel never calls a Jira
// transition either; it only ever forwards a validated action request to the
// single Jira Automation incoming-webhook rule
// (JIRA_AUTOMATION_TELEGRAM_ACTION_WEBHOOK_URL).
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
import { extractTextValue, REQUIRED_STATUS_FOR_ACTION, type TelegramOpsAction, type TelegramOpsRole } from '@/lib/telegram-ops/order-message';
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

function displayNameFor(from: TelegramFrom): string {
  const parts = [from.first_name, from.last_name].filter((p): p is string => !!p);
  if (parts.length > 0) return parts.join(' ');
  return from.username ?? `tg:${from.id}`;
}

function chatIdForRole(role: TelegramOpsRole): string | undefined {
  return role === 'translator'
    ? process.env.TELEGRAM_TRANSLATOR_CHAT_ID
    : process.env.TELEGRAM_NOTARY_CHAT_ID;
}

const CLAIM_TAKEN_MESSAGE: Record<TelegramOpsRole, string> = {
  translator: 'Заказ уже назначен другому переводчику.',
  notary: 'Заказ уже назначен другому нотариусу.',
};

// ─── Handling ─────────────────────────────────────────────────────────────────

async function handleClaim(
  issueKey: string,
  role: TelegramOpsRole,
  from: TelegramFrom,
  callbackQueryId: string,
): Promise<void> {
  const action: TelegramOpsAction = role === 'translator' ? 'translator_claim' : 'notary_claim';

  // Read-only, fast-fail precheck only — never writes anything. Jira Automation's
  // own status check, as part of the same execution that sets the ownership
  // fields and transitions, is the real (and only) gate against a double claim.
  const issue = await getJiraIssue(issueKey, []);
  if (!issue) {
    console.error(`[telegram-webhook] ${action} rejected: Jira issue ${issueKey} not found`);
    await answerCallbackQuery(callbackQueryId, 'Заказ не найден.', true);
    return;
  }
  if (issue.statusName !== REQUIRED_STATUS_FOR_ACTION[action]) {
    await answerCallbackQuery(callbackQueryId, CLAIM_TAKEN_MESSAGE[role], true);
    return;
  }

  const displayName = displayNameFor(from);

  await forwardActionToJiraAutomation({
    issueKey,
    action,
    telegramUserId: String(from.id),
    executorName: displayName,
    role,
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

  const userIdField = telegramRoleFieldIds(role).userId;
  const issue = await getJiraIssue(issueKey, [userIdField]);
  if (!issue) {
    console.error(`[telegram-webhook] ${action} rejected: Jira issue ${issueKey} not found`);
    await answerCallbackQuery(callbackQueryId, 'Заказ не найден.', true);
    return;
  }

  const storedUserId = extractTextValue(issue.fields[userIdField]);
  if (!storedUserId) {
    console.error(`[telegram-webhook] ${action} rejected: no claimant recorded on ${issueKey} yet`);
    await answerCallbackQuery(callbackQueryId, 'Заказ ещё не назначен.', true);
    return;
  }
  if (storedUserId !== String(from.id)) {
    await answerCallbackQuery(callbackQueryId, 'Этот заказ назначен другому исполнителю.', true);
    return;
  }

  // "start" only unlocks once Jira has confirmed the claim; "done" only unlocks
  // once Jira has confirmed work started. Both preconditions are the issue's own
  // current status — this is what makes "Telegram only a projection of Jira" also
  // the concurrency guard here: nobody can forward "done" before Jira itself
  // confirmed "in progress" (this route's check is a fast UX nicety; Automation
  // re-validates the same precondition authoritatively before transitioning).
  if (issue.statusName !== REQUIRED_STATUS_FOR_ACTION[action]) {
    await answerCallbackQuery(callbackQueryId, 'Действие уже выполнено или ожидает подтверждения от Jira.');
    return;
  }

  const displayName = displayNameFor(from);

  await forwardActionToJiraAutomation({
    issueKey,
    action,
    telegramUserId: String(from.id),
    executorName: displayName,
    role,
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
