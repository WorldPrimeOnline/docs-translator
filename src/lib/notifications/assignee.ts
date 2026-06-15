// Handles ASSIGNEE_CHANGED Jira webhook events.
// Looks up the assignee's staff_profile by jira_account_id, builds a role-specific
// Telegram message with inline URL buttons, sends it, and logs the delivery attempt.
//
// This module is the only place that touches telegram_chat_id at runtime.
// It runs server-side only, accessed via service role — never in browser context.

import { supabaseServer } from '@/lib/supabase/server';
import { sendDirectMessageWithButtons, type TelegramButton } from '@/lib/telegram/client';

export interface AssigneeChangedParams {
  jobId: string;
  issueKey: string;
  eventId: string;
  jiraStatus: string | undefined;
  assigneeAccountId: string;
  assigneeDisplayName: string | undefined;
  driveUrl: string | null | undefined;
  notaryCity: string | null | undefined;
  fulfillmentMethod: string | null | undefined;
  sourceLang: string;
  targetLang: string;
  documentType: string;
  serviceLevel: string | null | undefined;
  deadline?: string | null;
}

type StaffRole = 'operator' | 'translator' | 'notary_partner' | 'admin';

function buildJiraUrl(issueKey: string): string | null {
  const base = process.env.JIRA_BASE_URL;
  if (!base) return null;
  return `${base}/browse/${issueKey}`;
}

function buildTranslatorMessage(params: AssigneeChangedParams): {
  text: string;
  buttons: TelegramButton[];
} {
  const langPair = `${params.sourceLang.toUpperCase()} → ${params.targetLang.toUpperCase()}`;
  const docType = params.documentType.split('|')[0];

  const lines = [
    '🔔 <b>Вам назначен новый заказ</b>',
    '',
    `Заказ: <code>${params.jobId.slice(0, 8)}</code>`,
    `Jira: ${params.issueKey}`,
    `Тип: ${docType}`,
    `Языковая пара: ${langPair}`,
    'Статус: Назначен переводчик',
    params.deadline ? `Срок: ${params.deadline}` : null,
  ].filter((l) => l !== null).join('\n');

  const buttons: TelegramButton[] = [];
  const jiraUrl = buildJiraUrl(params.issueKey);
  if (jiraUrl) buttons.push({ text: 'Открыть задачу в Jira', url: jiraUrl });
  if (params.driveUrl) buttons.push({ text: 'Открыть документы', url: params.driveUrl });

  return { text: lines, buttons };
}

function buildNotaryMessage(params: AssigneeChangedParams): {
  text: string;
  buttons: TelegramButton[];
} {
  const langPair = `${params.sourceLang.toUpperCase()} → ${params.targetLang.toUpperCase()}`;

  const lines = [
    '🔔 <b>Вам назначен заказ на нотариальное удостоверение</b>',
    '',
    `Заказ: <code>${params.jobId.slice(0, 8)}</code>`,
    `Jira: ${params.issueKey}`,
    `Языковая пара: ${langPair}`,
    params.notaryCity ? `Город: ${params.notaryCity}` : null,
    params.fulfillmentMethod ? `Способ получения: ${params.fulfillmentMethod}` : null,
    params.deadline ? `Срок: ${params.deadline}` : null,
  ].filter((l) => l !== null).join('\n');

  const buttons: TelegramButton[] = [];
  const jiraUrl = buildJiraUrl(params.issueKey);
  if (jiraUrl) buttons.push({ text: 'Открыть задачу в Jira', url: jiraUrl });
  if (params.driveUrl) buttons.push({ text: 'Открыть документы', url: params.driveUrl });

  return { text: lines, buttons };
}

function buildOperatorMessage(params: AssigneeChangedParams): {
  text: string;
  buttons: TelegramButton[];
} {
  const lines = [
    '🔔 <b>Вам назначен заказ WPO</b>',
    '',
    `Заказ: <code>${params.jobId.slice(0, 8)}</code>`,
    `Jira: ${params.issueKey}`,
    params.jiraStatus ? `Текущий этап: ${params.jiraStatus}` : null,
  ].filter((l) => l !== null).join('\n');

  const buttons: TelegramButton[] = [];
  const jiraUrl = buildJiraUrl(params.issueKey);
  if (jiraUrl) buttons.push({ text: 'Открыть задачу в Jira', url: jiraUrl });

  return { text: lines, buttons };
}

function buildMessage(
  role: StaffRole,
  params: AssigneeChangedParams,
): { text: string; buttons: TelegramButton[] } {
  switch (role) {
    case 'translator':
      return buildTranslatorMessage(params);
    case 'notary_partner':
      return buildNotaryMessage(params);
    case 'operator':
    case 'admin':
      return buildOperatorMessage(params);
  }
}

function templateName(role: StaffRole): string {
  switch (role) {
    case 'translator':    return 'translator_assignment';
    case 'notary_partner': return 'notary_assignment';
    case 'operator':      return 'operator_assignment';
    case 'admin':         return 'operator_assignment';
  }
}

/**
 * Main entry point called by the Jira webhook for ASSIGNEE_CHANGED events.
 * Never throws — errors are caught and logged to notification_log.
 */
export async function handleAssigneeChanged(params: AssigneeChangedParams): Promise<void> {
  const { jobId, issueKey, eventId, assigneeAccountId } = params;

  // ── 1. Lookup staff profile by Jira account ID ─────────────────────────────
  const { data: profile, error: profileErr } = await supabaseServer
    .from('staff_profiles')
    .select('id, telegram_chat_id, telegram_notifications_enabled, role')
    .eq('jira_account_id', assigneeAccountId)
    .eq('is_active', true)
    .maybeSingle();

  if (profileErr) {
    console.error('[assignee-notify] profile lookup error:', profileErr.message);
  }

  if (!profile) {
    // No matching profile — log as skipped, do not error
    await supabaseServer.from('notification_log').insert({
      event_id: eventId,
      order_id: jobId,
      jira_issue_key: issueKey,
      recipient_profile_id: null,
      channel: 'telegram',
      template: 'assignee_changed_no_profile',
      status: 'skipped',
      error: `No active staff_profile for jira_account_id=${assigneeAccountId}`,
    });
    return;
  }

  // ── 2. Check notifications enabled ─────────────────────────────────────────
  if (!profile.telegram_notifications_enabled) {
    await supabaseServer.from('notification_log').insert({
      event_id: eventId,
      order_id: jobId,
      jira_issue_key: issueKey,
      recipient_profile_id: profile.id,
      channel: 'telegram',
      template: templateName(profile.role as StaffRole),
      status: 'skipped',
      error: 'telegram_notifications_enabled=false',
    });
    return;
  }

  // ── 3. Idempotency check — avoid re-sending the same event ─────────────────
  const { data: existing } = await supabaseServer
    .from('notification_log')
    .select('id, status')
    .eq('event_id', eventId)
    .eq('recipient_profile_id', profile.id)
    .in('status', ['sent', 'pending'])
    .maybeSingle();

  if (existing) {
    return; // already dispatched for this event+recipient
  }

  const tmpl = templateName(profile.role as StaffRole);

  // ── 4. Insert pending record ────────────────────────────────────────────────
  const { data: logRow } = await supabaseServer
    .from('notification_log')
    .insert({
      event_id: eventId,
      order_id: jobId,
      jira_issue_key: issueKey,
      recipient_profile_id: profile.id,
      channel: 'telegram',
      template: tmpl,
      status: 'pending',
    })
    .select('id')
    .single();

  // ── 5. Build and send ───────────────────────────────────────────────────────
  const { text, buttons } = buildMessage(profile.role as StaffRole, params);
  const result = await sendDirectMessageWithButtons(profile.telegram_chat_id, text, buttons);

  // ── 6. Update log with outcome ──────────────────────────────────────────────
  if (logRow?.id) {
    await supabaseServer
      .from('notification_log')
      .update({
        status: result.ok ? 'sent' : 'failed',
        provider_message_id: result.messageId ?? null,
        error: result.error ?? null,
        sent_at: result.ok ? new Date().toISOString() : null,
      })
      .eq('id', logRow.id);
  }
}
