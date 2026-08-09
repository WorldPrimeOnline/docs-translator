// Telegram -> WPO callback-button handler.
//
// Flow: Telegram button tap -> this route validates chat/user/ownership, arbitrates
// simultaneous claims, records an audit trail row, and forwards the action to the
// single Jira Automation incoming-webhook rule (JIRA_AUTOMATION_TELEGRAM_ACTION_WEBHOOK_URL)
// which validates the current Jira status and performs the actual transition.
//
// This route never edits the Telegram message and never calls a Jira transition —
// the message is only ever edited by /api/telegram/jira-event's status_changed
// handler, driven by Jira's own normal status-change event. See
// docs/ai-context/60_INTEGRATIONS_JIRA_DRIVE_TELEGRAM.md.
//
// Auth: X-Telegram-Bot-Api-Secret-Token header must match TELEGRAM_WEBHOOK_SECRET
// (Telegram's native webhook-secret mechanism, set once via the setWebhook call —
// see docs/TELEGRAM_OPERATIONS_SETUP.md).

import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { answerCallbackQuery } from '@/lib/telegram/client';
import { forwardActionToJiraAutomation } from '@/lib/telegram-ops/automation-actions';
import type { TelegramOpsAction, TelegramOpsRole } from '@/lib/telegram-ops/order-message';

// A claim_pending reservation older than this is treated as a lost/failed Jira
// Automation execution — a later claim attempt is allowed to atomically re-arbitrate
// from claim_pending (not just from open), so one dropped webhook can never
// permanently lock an order. 3 minutes comfortably exceeds a normal Automation
// rule's execution time.
const CLAIM_PENDING_STALE_MS = 3 * 60 * 1000;

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
  const staleThreshold = new Date(Date.now() - CLAIM_PENDING_STALE_MS).toISOString();
  const displayName = displayNameFor(from);

  const { data: claimed } = await supabaseServer
    .from('telegram_assignments')
    .update({
      telegram_user_id: from.id,
      telegram_display_name: displayName,
      telegram_username: from.username ?? null,
      status: 'claim_pending',
      claim_pending_at: new Date().toISOString(),
    })
    .eq('jira_issue_key', issueKey)
    .eq('role', role)
    .or(`status.eq.open,and(status.eq.claim_pending,claim_pending_at.lt.${staleThreshold})`)
    .select('id, job_id')
    .maybeSingle();

  if (!claimed) {
    // Distinguish a genuine lost race (row exists, already claimed by someone else —
    // expected, benign) from no row existing at all (broadcast failed or was never
    // sent for this issue/role — a real anomaly worth logging loudly, since it means
    // the button the user just tapped can never succeed no matter who taps it).
    const { data: anyRow } = await supabaseServer
      .from('telegram_assignments')
      .select('id')
      .eq('jira_issue_key', issueKey)
      .eq('role', role)
      .maybeSingle();
    if (!anyRow) {
      console.error(`[telegram-webhook] claim rejected: no telegram_assignments row exists at all for issueKey=${issueKey} role=${role} — broadcast never created it or failed`);
    }
    await answerCallbackQuery(callbackQueryId, CLAIM_TAKEN_MESSAGE[role], true);
    return;
  }

  const action: TelegramOpsAction = role === 'translator' ? 'translator_claim' : 'notary_claim';

  // job_audit_log.job_id is NOT NULL and is a job-domain audit system — never
  // forced for a Jira-only operational issue with no real WPO job. Application
  // logs + Jira Automation's own comment on the issue are the audit trail then.
  if (claimed.job_id) {
    await supabaseServer.from('job_audit_log').insert({
      job_id: claimed.job_id,
      actor: displayName,
      source: 'telegram',
      action: `telegram_${action}`,
      jira_issue_key: issueKey,
      metadata: { telegramUserId: from.id, telegramUsername: from.username ?? null },
    });
  } else {
    console.log(`[telegram-webhook] ${action} for ${issueKey} has no linked WPO job — skipping job_audit_log`);
  }

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
  const { data: assignment } = await supabaseServer
    .from('telegram_assignments')
    .select('id, job_id, status, telegram_user_id, telegram_display_name')
    .eq('jira_issue_key', issueKey)
    .eq('role', role)
    .maybeSingle();

  if (!assignment) {
    // Unlike the claim path, there is no legitimate "lost race" explanation here —
    // start/done buttons only ever appear on a message for an already-claimed order,
    // so a missing row always means something is broken (e.g. the row was never
    // created, or was removed out from under an in-flight claim). Always worth a
    // loud log, not just a user-facing message.
    console.error(`[telegram-webhook] ${kind} rejected: no telegram_assignments row exists for issueKey=${issueKey} role=${role} telegramUserId=${from.id}`);
    await answerCallbackQuery(callbackQueryId, 'Заказ не найден.', true);
    return;
  }

  if (assignment.telegram_user_id !== from.id) {
    await answerCallbackQuery(callbackQueryId, 'Этот заказ назначен другому исполнителю.', true);
    return;
  }

  // "start" only unlocks once Jira has confirmed the claim; "done" only unlocks
  // once Jira has confirmed work started. Both preconditions are driven solely by
  // telegram_assignments.status, which only the status_changed handler advances —
  // this is what makes "Telegram only a projection of Jira" also the concurrency
  // guard here: nobody can forward "done" before Jira itself confirmed "in progress".
  const requiredStatus = kind === 'start' ? 'claimed' : 'in_progress';
  if (assignment.status !== requiredStatus) {
    await answerCallbackQuery(callbackQueryId, 'Действие уже выполнено или ожидает подтверждения от Jira.');
    return;
  }

  const action: TelegramOpsAction = `${role}_${kind}` as TelegramOpsAction;
  const displayName = assignment.telegram_display_name ?? displayNameFor(from);

  if (assignment.job_id) {
    await supabaseServer.from('job_audit_log').insert({
      job_id: assignment.job_id,
      actor: displayName,
      source: 'telegram',
      action: `telegram_${action}`,
      jira_issue_key: issueKey,
      metadata: { telegramUserId: from.id },
    });
  } else {
    console.log(`[telegram-webhook] ${action} for ${issueKey} has no linked WPO job — skipping job_audit_log`);
  }

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
