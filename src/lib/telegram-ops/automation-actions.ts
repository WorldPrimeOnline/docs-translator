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
}

export async function forwardActionToJiraAutomation(
  params: ForwardActionParams,
): Promise<ForwardActionResult> {
  const url = process.env.JIRA_AUTOMATION_TELEGRAM_ACTION_WEBHOOK_URL;
  if (!url) {
    console.error('[telegram-ops] JIRA_AUTOMATION_TELEGRAM_ACTION_WEBHOOK_URL not set — cannot forward action');
    return { ok: false, error: 'JIRA_AUTOMATION_TELEGRAM_ACTION_WEBHOOK_URL not set' };
  }

  const secret = process.env.JIRA_AUTOMATION_ACTION_WEBHOOK_SECRET;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(secret ? { 'X-WPO-Action-Secret': secret } : {}),
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
      const error = `HTTP ${res.status}: ${text.slice(0, 200)}`;
      console.error(`[telegram-ops] forwardActionToJiraAutomation failed: ${error}`);
      return { ok: false, error };
    }

    return { ok: true, error: null };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`[telegram-ops] forwardActionToJiraAutomation threw: ${error}`);
    return { ok: false, error };
  }
}
