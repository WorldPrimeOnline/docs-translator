// Forwards a confirmed Telegram button action to the single Jira Automation
// "incoming webhook" rule that owns validation + the actual Jira transition.
//
// WPO never calls a Jira transition here or anywhere else in this module — see
// docs/ai-context/60_INTEGRATIONS_JIRA_DRIVE_TELEGRAM.md. This is fire-and-forget
// from the caller's perspective: the UI only updates later, when Jira's normal
// status_changed event reaches /api/telegram/jira-event.

import type { TelegramOpsAction, TelegramOpsRole } from './order-message';

export interface ForwardActionParams {
  issueKey: string;
  action: TelegramOpsAction;
  telegramUserId: string;
  executorName: string;
  role: TelegramOpsRole;
}

export interface ForwardActionResult {
  ok: boolean;
  error: string | null;
  /** The Jira Automation incoming-webhook's raw HTTP response status, for the
   * caller's explicit per-callback logging. Null when no response was ever
   * received (URL not configured, or the request itself threw — DNS/network). */
  httpStatus: number | null;
}

export async function forwardActionToJiraAutomation(
  params: ForwardActionParams,
): Promise<ForwardActionResult> {
  const url = process.env.JIRA_AUTOMATION_TELEGRAM_ACTION_WEBHOOK_URL;
  if (!url) {
    console.error('[telegram-ops] JIRA_AUTOMATION_TELEGRAM_ACTION_WEBHOOK_URL not set — cannot forward action');
    return { ok: false, error: 'JIRA_AUTOMATION_TELEGRAM_ACTION_WEBHOOK_URL not set', httpStatus: null };
  }

  const secret = process.env.JIRA_AUTOMATION_ACTION_WEBHOOK_SECRET;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(secret ? { 'X-Automation-Webhook-Token': secret } : {}),
      },
      body: JSON.stringify({
        issueKey: params.issueKey,
        action: params.action,
        telegramUserId: params.telegramUserId,
        executorName: params.executorName,
        role: params.role,
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      // Full body (never contains our own secret — that's a request header, not
      // anything Jira echoes back) so a 400's actual Automation validation error
      // is visible, not silently cut at 200 chars.
      console.error(`[telegram-ops] Jira Automation rejected the action — issueKey=${params.issueKey} action=${params.action} status=${res.status} body=${text}`);
      const error = `HTTP ${res.status}: ${text.slice(0, 200)}`;
      console.error(`[telegram-ops] forwardActionToJiraAutomation failed: ${error}`);
      return { ok: false, error, httpStatus: res.status };
    }

    return { ok: true, error: null, httpStatus: res.status };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`[telegram-ops] forwardActionToJiraAutomation threw: ${error}`);
    return { ok: false, error, httpStatus: null };
  }
}
