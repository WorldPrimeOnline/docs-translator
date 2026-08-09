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
import { getJiraIssue, JIRA_FIELDS, type JiraIssueSnapshot } from '@/lib/jira/client';
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

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface JobResolution {
  jobId: string;
  /** True when resolved via the customfield_10073 fallback — jobs.jira_issue_key should be backfilled. */
  backfillNeeded: boolean;
}

/**
 * Non-blocking data-integrity check: logs when customfield_10073 disagrees with an
 * already-resolved job_id (missing, non-UUID, or pointing at a different job) —
 * surfaces the WO-120 class of anomaly instead of staying silent. Pure comparison,
 * no extra query — only used when resolution already succeeded via another path.
 */
function logOrderIdFieldDrift(issueKey: string, resolvedJobId: string, issue: JiraIssueSnapshot): void {
  const rawOrderId = extractJobId(issue);
  if (rawOrderId == null) {
    console.warn(`[telegram-jira-event] customfield_10073 empty on ${issueKey} — resolved job_id ${resolvedJobId} via jobs.jira_issue_key instead`);
  } else if (!UUID_PATTERN.test(rawOrderId)) {
    console.warn(`[telegram-jira-event] customfield_10073 on ${issueKey} is not a UUID ("${rawOrderId}") — resolved job_id ${resolvedJobId} via jobs.jira_issue_key instead`);
  } else if (rawOrderId !== resolvedJobId) {
    console.warn(`[telegram-jira-event] customfield_10073 on ${issueKey} (${rawOrderId}) does not match jobs.jira_issue_key resolution (${resolvedJobId})`);
  }
}

/**
 * Resolves the real `jobs.id` UUID for a Jira issue key.
 *
 * Primary path: `jobs.jira_issue_key = issueKey` — the same reverse-lookup
 * mechanism `worker/src/lib/jira-order-recovery.ts`'s `resolveJobId()` already
 * uses in production. Reliable once WPO has persisted the issue key back onto the
 * job — but that write happens strictly AFTER Jira returns the newly-created issue
 * key, while Jira Automation's "issue created" trigger can fire immediately, before
 * that write lands (WO-122 production race, 2026-08-09).
 *
 * Fallback path: customfield_10073 (JIRA_FIELDS.orderId) holds the job UUID from
 * the moment the issue is created — available immediately, unlike jobs.jira_issue_key
 * — but is NEVER trusted blindly. WO-120 (2026-08-09) held the literal string "1" in
 * that field. It is only accepted when BOTH hold: (1) it is syntactically a valid
 * UUID, and (2) a real `jobs` row with that id actually exists. Anything else (empty,
 * malformed, or pointing at a UUID that isn't a real job) is rejected exactly like
 * before.
 */
async function resolveJobId(issueKey: string, issue: JiraIssueSnapshot): Promise<JobResolution | null> {
  const { data: byIssueKey, error: byIssueKeyError } = await supabaseServer
    .from('jobs')
    .select('id')
    .eq('jira_issue_key', issueKey)
    .maybeSingle();
  if (byIssueKeyError) {
    console.error(`[telegram-jira-event] jobs lookup by jira_issue_key=${issueKey} failed:`, byIssueKeyError.message);
  }
  if (byIssueKey?.id) {
    // Primary lookup succeeded — still worth a non-blocking cross-check against
    // customfield_10073 (no extra query, just compares the already-fetched issue's
    // field against the resolved id) so a WO-120-class anomaly stays visible in logs
    // even when it doesn't block resolution.
    logOrderIdFieldDrift(issueKey, byIssueKey.id, issue);
    return { jobId: byIssueKey.id, backfillNeeded: false };
  }

  const rawOrderId = extractJobId(issue);
  if (!rawOrderId) {
    console.warn(`[telegram-jira-event] customfield_10073 empty on ${issueKey} and no jobs row has jira_issue_key set yet`);
    return null;
  }
  if (!UUID_PATTERN.test(rawOrderId)) {
    console.warn(`[telegram-jira-event] customfield_10073 on ${issueKey} is not a UUID ("${rawOrderId}") — refusing fallback resolution`);
    return null;
  }

  const { data: byId, error: byIdError } = await supabaseServer
    .from('jobs')
    .select('id')
    .eq('id', rawOrderId)
    .maybeSingle();
  if (byIdError) {
    console.error(`[telegram-jira-event] jobs lookup by id=${rawOrderId} (customfield_10073 fallback) failed:`, byIdError.message);
    return null;
  }
  if (!byId?.id) {
    console.warn(`[telegram-jira-event] customfield_10073 on ${issueKey} (${rawOrderId}) is a syntactically valid UUID but no jobs row has that id`);
    return null;
  }

  console.warn(`[telegram-jira-event] resolved job_id for ${issueKey} via customfield_10073 fallback (${rawOrderId}) — jobs.jira_issue_key not yet persisted`);
  return { jobId: byId.id, backfillNeeded: true };
}

/**
 * Best-effort repair: once the customfield_10073 fallback verifies a real job, write
 * jobs.jira_issue_key back so the primary lookup succeeds on every subsequent event
 * for this issue (status_changed, later retries). Guarded with `.is('jira_issue_key',
 * null)` so it can never overwrite an already-set value. Non-fatal on failure — the
 * fallback will simply run again next time.
 */
async function backfillJiraIssueKey(jobId: string, issueKey: string): Promise<void> {
  const { error } = await supabaseServer
    .from('jobs')
    .update({ jira_issue_key: issueKey })
    .eq('id', jobId)
    .is('jira_issue_key', null);
  if (error) {
    console.error(`[telegram-jira-event] failed to backfill jobs.jira_issue_key for job=${jobId} issueKey=${issueKey}:`, error.message);
  }
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

  // Fetch the Jira issue FIRST — needed both for job_id resolution (the
  // customfield_10073 fallback below) and for the broadcast message content, so it
  // is fetched exactly once. A job we can't resolve means we must never send a
  // message at all (no valid assignment row could ever back it).
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

  const resolution = await resolveJobId(issueKey, issue);
  if (!resolution) {
    console.error(`[telegram-jira-event] could not resolve a job for ${issueKey} via jobs.jira_issue_key or customfield_10073 — refusing to broadcast`);
    return NextResponse.json({ error: `No job found for Jira issue ${issueKey} (jobs.jira_issue_key and customfield_10073 fallback both failed)` }, { status: 422 });
  }
  const { jobId, backfillNeeded } = resolution;
  if (backfillNeeded) {
    await backfillJiraIssueKey(jobId, issueKey);
  }

  // Reserve the (jira_issue_key, role) slot BEFORE sending the Telegram message —
  // telegram_message_id starts at the sentinel 0 and is filled in once the send
  // succeeds. This makes the reservation itself the idempotency gate: if anything
  // below fails, the row is deleted so a retry can cleanly re-attempt, but while a
  // send is in flight a concurrent retry's insert hits the unique constraint and
  // exits as "already broadcasting" instead of double-posting to Telegram.
  const { data: reserved, error: reserveError } = await supabaseServer
    .from('telegram_assignments')
    .insert({
      job_id: jobId,
      jira_issue_key: issueKey,
      role,
      status: 'open',
      telegram_chat_id: Number(chatId),
      telegram_message_id: 0,
    })
    .select('id')
    .single();

  if (reserveError) {
    if (reserveError.code === '23505') {
      // Unique violation on (jira_issue_key, role) — a concurrent retry already
      // reserved this slot; that attempt owns sending the message.
      return NextResponse.json({ ok: true, skipped: 'already_broadcast' });
    }
    console.error(`[telegram-jira-event] telegram_assignments reservation insert failed for ${issueKey}/${role}:`, reserveError.message);
    return NextResponse.json({ error: `Failed to reserve assignment row: ${reserveError.message}` }, { status: 500 });
  }

  const extras = await getOrderExtras(jobId, role);
  const data = buildOrderBroadcastData(issue, role, extras);
  const { text, buttons } = buildOrderBroadcastMessage(data);

  const sendResult = await sendMessageWithCallbackButtons(chatId, text, buttons);
  if (!sendResult.ok || !sendResult.messageId) {
    await supabaseServer.from('telegram_assignments').delete().eq('id', reserved.id);
    return NextResponse.json({ error: `Telegram send failed: ${sendResult.error}` }, { status: 502 });
  }

  const { error: updateError } = await supabaseServer
    .from('telegram_assignments')
    .update({ telegram_message_id: Number(sendResult.messageId) })
    .eq('id', reserved.id);
  if (updateError) {
    // The message IS live in Telegram at this point, so we can't just delete the row
    // (that would let a retry post a second message next to the one already sent).
    // This is a real, surfaced failure — status_changed edits later would silently
    // no-op against the wrong message_id (0) without this being loud.
    console.error(`[telegram-jira-event] failed to record real message_id for ${issueKey}/${role} (Telegram message ${sendResult.messageId} was sent):`, updateError.message);
    return NextResponse.json({ error: `Telegram message sent but assignment row update failed: ${updateError.message}` }, { status: 500 });
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
