// Role-aware access to the Telegram Operations Jira custom field IDs.
//
// Field IDs are hardcoded in src/lib/jira/client.ts's JIRA_FIELDS (mirrored in
// worker/src/lib/jira/order-fields.ts, kept in sync manually per the existing
// repository convention) — NOT env vars. This module is just the role-dispatch
// layer on top of those constants.

import { JIRA_FIELDS } from '@/lib/jira/client';
import type { TelegramOpsRole } from './order-message';

export interface TelegramRoleFieldIds {
  /** Text field — Telegram message_id of the broadcast, written directly by
   * Railway right after sending (deterministic integration metadata, not part of
   * the Jira workflow/ownership state machine). */
  messageId: string;
  /** Text field — Telegram user.id of the claimant. Written ONLY by Jira
   * Automation, as part of the same execution that validates the claim
   * precondition and performs the transition. Railway never pre-writes this. */
  userId: string;
  /** Text field ("Переводчик" / "Нотариус") — display name of the claimant, for
   * the "Исполнитель: X" line. Written ONLY by Jira Automation, alongside userId. */
  displayName: string;
}

export function telegramRoleFieldIds(role: TelegramOpsRole): TelegramRoleFieldIds {
  return role === 'translator'
    ? {
        messageId: JIRA_FIELDS.telegramTranslatorMessageId,
        userId: JIRA_FIELDS.telegramTranslatorUserId,
        displayName: JIRA_FIELDS.telegramTranslatorName,
      }
    : {
        messageId: JIRA_FIELDS.telegramNotaryMessageId,
        userId: JIRA_FIELDS.telegramNotaryUserId,
        displayName: JIRA_FIELDS.telegramNotaryName,
      };
}

/** Text field holding the authoritative payout for this role, serialized as text
 * (price_quotes/cost_reservations-derived, populated at issue-creation time by the
 * order-creation pipeline — never computed or written by Telegram Operations). */
export function payoutFieldForRole(role: TelegramOpsRole): string {
  return role === 'translator' ? JIRA_FIELDS.translatorPayout : JIRA_FIELDS.notaryPayout;
}

/** Text field holding the authoritative payable page count (shared — not role-specific), serialized as text. */
export const PAGE_COUNT_FIELD = JIRA_FIELDS.payablePageCount;
