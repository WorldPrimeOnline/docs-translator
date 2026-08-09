// Env-configured Jira custom field IDs for Telegram Operations metadata.
//
// Unlike src/lib/jira/client.ts's JIRA_FIELDS (hardcoded customfield_100XX IDs for
// fields that already existed when that code shipped), these are new fields you
// create yourself in Jira admin (project WO, issue type "Заказ") — env vars so the
// real field IDs can be filled in once created, with no further code change.
//
// Telegram Operations is entirely Jira-driven: these fields are the ONLY
// persistence this feature uses. No Supabase table backs any of it.
//
// See docs/TELEGRAM_OPERATIONS_SETUP.md for the exact field list, types, and who
// writes each one (Railway directly for message-id; Jira Automation only, as part
// of its claim-transition rule, for user-id/display-name).

import type { TelegramOpsRole } from './order-message';

export interface TelegramRoleFieldIds {
  /** Text field — Telegram message_id of the broadcast, written directly by
   * Railway right after sending (deterministic integration metadata, not part of
   * the Jira workflow/ownership state machine). */
  messageId: string | undefined;
  /** Text field — Telegram user.id of the claimant. Written ONLY by Jira
   * Automation, as part of the same execution that validates the claim
   * precondition and performs the transition. Railway never pre-writes this. */
  userId: string | undefined;
  /** Text field — display name of the claimant, for the "Исполнитель: X" line.
   * Written ONLY by Jira Automation, alongside userId. */
  displayName: string | undefined;
}

export function telegramRoleFieldIds(role: TelegramOpsRole): TelegramRoleFieldIds {
  return role === 'translator'
    ? {
        messageId: process.env.JIRA_FIELD_TG_TRANSLATOR_MESSAGE_ID,
        userId: process.env.JIRA_FIELD_TG_TRANSLATOR_USER_ID,
        displayName: process.env.JIRA_FIELD_TG_TRANSLATOR_NAME,
      }
    : {
        messageId: process.env.JIRA_FIELD_TG_NOTARY_MESSAGE_ID,
        userId: process.env.JIRA_FIELD_TG_NOTARY_USER_ID,
        displayName: process.env.JIRA_FIELD_TG_NOTARY_NAME,
      };
}

/** Shared (not per-role) Number fields — whichever role's broadcast is current
 * reads whatever is currently populated on the issue. Never fabricated when unset
 * or when the env var itself isn't configured. */
export function pageCountFieldId(): string | undefined {
  return process.env.JIRA_FIELD_TG_PAGE_COUNT;
}
export function payoutFieldId(): string | undefined {
  return process.env.JIRA_FIELD_TG_PAYOUT_AMOUNT_KZT;
}
