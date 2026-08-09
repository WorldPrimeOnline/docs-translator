// Jira Automation -> WPO Telegram operations bridge.
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
// See docs/ai-context/60_INTEGRATIONS_JIRA_DRIVE_TELEGRAM.md.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase/server';
import { getJiraIssue, JIRA_FIELDS } from '@/lib/jira/client';
import {
  buildOrderBroadcastData,
  buildOrderBroadcastMessage,
  buildStatusUpdateMessage,
  extractJobId,
  resolveStatusMapping,
  type TelegramOpsRole,
} from '@/lib/telegram-ops/order-message';
import { sendMessageWithCallbackButtons, editMessageWithCallbackButtons } from '@/lib/telegram/client';

// ─── Payload schema ───────────────────────────────────────────────────────────

const EventSchema = z.discriminatedUnion('event', [
  z.object({ event: z.literal('translator_order_created'), issueKey: z.string().min(1) }),
  z.object({ event: z.literal('notary_required'), issueKey: z.string().min(1) }),
  z.object({ event: z.literal('status_changed'), issueKey: z.string().min(1), jiraStatus: z.string().min(1) }),
]);

// cost_reservations.cost_type values that represent this role's external payout.
// translator_payout = new formula (migration 0056); translator_reserved_cost = legacy
// formula's equivalent (src/lib/pricing/service.ts). notary_payout has no legacy
// equivalent — older notarized quotes may have no reservation row at all, in which
// case the payout line is correctly omitted (never fabricated).
const PAYOUT_COST_TYPES: Record<TelegramOpsRole, string[]> = {
  translator: ['translator_payout', 'translator_reserved_cost'],
  notary: ['notary_payout'],
};

function chatIdForRole(role: TelegramOpsRole): string | undefined {
  return role === 'translator'
    ? process.env.TELEGRAM_TRANSLATOR_CHAT_ID
    : process.env.TELEGRAM_NOTARY_CHAT_ID;
}

/**
 * Authoritative page count + payout amount for the Telegram broadcast message.
 * physical_page_count (price_quotes) is WPO's pricing engine's own page count, always
 * populated for a paid quote. Payout amount comes from cost_reservations, which the
 * migration 0056 column comment explicitly documents as the real translator/notary
 * payout (not a guess) — see src/lib/pricing/service.ts's addReservation() call sites.
 * Both are null (never fabricated) when no matching row exists.
 */
async function getOrderExtras(
  jobId: string,
  role: TelegramOpsRole,
): Promise<{ pageCount: number | null; payoutKzt: number | null }> {
  // price_quotes / cost_reservations are not in the generated Database type (see
  // src/types/supabase.ts header) — same untyped-client convention as
  // src/lib/pricing/service.ts's `const db = supabaseServer as any`.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabaseServer as any;

  const { data: quote } = await db
    .from('price_quotes')
    .select('physical_page_count')
    .eq('job_id', jobId)
    .eq('status', 'paid')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: reservation } = await db
    .from('cost_reservations')
    .select('amount_kzt')
    .eq('job_id', jobId)
    .in('cost_type', PAYOUT_COST_TYPES[role])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return {
    pageCount: quote?.physical_page_count ?? null,
    payoutKzt: reservation?.amount_kzt ?? null,
  };
}

// ─── translator_order_created / notary_required ────────────────────────────────

async function handleBroadcast(issueKey: string, role: TelegramOpsRole): Promise<NextResponse> {
  // Idempotency — Automation retries must never post a second broadcast for the same issue+role.
  const { data: existing } = await supabaseServer
    .from('telegram_assignments')
    .select('id')
    .eq('jira_issue_key', issueKey)
    .eq('role', role)
    .maybeSingle();
  if (existing) {
    return NextResponse.json({ ok: true, skipped: 'already_broadcast' });
  }

  const chatId = chatIdForRole(role);
  if (!chatId) {
    console.log(`[telegram-jira-event] chat id not configured for role=${role} — skipping`);
    return NextResponse.json({ ok: true, skipped: 'chat_not_configured' });
  }

  const issue = await getJiraIssue(issueKey, [
    JIRA_FIELDS.orderId,
    JIRA_FIELDS.translationType,
    JIRA_FIELDS.languagePair,
    JIRA_FIELDS.documentType,
    JIRA_FIELDS.documentsLink,
  ]);
  if (!issue) {
    return NextResponse.json({ error: 'Jira issue not found or Jira not configured' }, { status: 404 });
  }

  const jobId = extractJobId(issue);
  if (!jobId) {
    return NextResponse.json({ error: 'Jira issue missing orderId (customfield_10073)' }, { status: 422 });
  }

  const extras = await getOrderExtras(jobId, role);
  const data = buildOrderBroadcastData(issue, role, extras);
  const { text, buttons } = buildOrderBroadcastMessage(data);

  const sendResult = await sendMessageWithCallbackButtons(chatId, text, buttons);
  if (!sendResult.ok || !sendResult.messageId) {
    return NextResponse.json({ error: `Telegram send failed: ${sendResult.error}` }, { status: 502 });
  }

  const { error: insertError } = await supabaseServer.from('telegram_assignments').insert({
    job_id: jobId,
    jira_issue_key: issueKey,
    role,
    status: 'open',
    telegram_chat_id: Number(chatId),
    telegram_message_id: Number(sendResult.messageId),
  });
  if (insertError && insertError.code !== '23505') {
    // 23505 = unique_violation on (jira_issue_key, role) — a concurrent retry already
    // won the insert; the message it recorded is the one users will interact with, so
    // this is a harmless duplicate-send, not a failure to surface.
    console.error('[telegram-jira-event] telegram_assignments insert failed:', insertError.message);
  }

  await supabaseServer.from('job_audit_log').insert({
    job_id: jobId,
    actor: 'system',
    source: 'telegram_jira_event',
    action: `telegram_broadcast_${role}`,
    jira_issue_key: issueKey,
    metadata: { chatId, messageId: sendResult.messageId },
  });

  return NextResponse.json({ ok: true, action: 'broadcast_sent' });
}

// ─── status_changed ─────────────────────────────────────────────────────────────

async function handleStatusChanged(issueKey: string, jiraStatus: string): Promise<NextResponse> {
  const mapping = resolveStatusMapping(jiraStatus);
  if (!mapping) {
    // Issues pass through many other statuses (delivery, pickup, etc.) unrelated to
    // this Telegram sub-flow — silently ignore rather than treat as an error.
    return NextResponse.json({ ok: true, action: 'no_op' });
  }

  const { data: assignment } = await supabaseServer
    .from('telegram_assignments')
    .select('id, job_id, telegram_chat_id, telegram_message_id, telegram_display_name')
    .eq('jira_issue_key', issueKey)
    .eq('role', mapping.role)
    .maybeSingle();

  if (!assignment) {
    console.warn(`[telegram-jira-event] status_changed for ${issueKey}/${mapping.role} but no telegram_assignments row found`);
    return NextResponse.json({ ok: true, action: 'no_assignment' });
  }

  const { text, buttons } = buildStatusUpdateMessage({
    issueKey,
    jiraStatus,
    entry: mapping.entry,
    executorName: assignment.telegram_display_name,
  });

  const editResult = await editMessageWithCallbackButtons(
    assignment.telegram_chat_id,
    assignment.telegram_message_id,
    text,
    buttons,
  );

  const now = new Date().toISOString();
  const statusFieldUpdate: {
    status: 'claimed' | 'in_progress' | 'completed';
    claimed_at?: string;
    started_at?: string;
    completed_at?: string;
  } = { status: mapping.entry.internalStatus };
  if (mapping.entry.internalStatus === 'claimed') statusFieldUpdate.claimed_at = now;
  if (mapping.entry.internalStatus === 'in_progress') statusFieldUpdate.started_at = now;
  if (mapping.entry.internalStatus === 'completed') statusFieldUpdate.completed_at = now;

  await supabaseServer.from('telegram_assignments').update(statusFieldUpdate).eq('id', assignment.id);

  await supabaseServer.from('job_audit_log').insert({
    job_id: assignment.job_id,
    actor: 'system',
    source: 'telegram_jira_event',
    action: `telegram_status_synced_${mapping.role}`,
    jira_issue_key: issueKey,
    new_status: jiraStatus,
    metadata: { telegramEditOk: editResult.ok },
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
