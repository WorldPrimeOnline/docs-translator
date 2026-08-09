# Integrations: Jira, Google Drive, Telegram

## Architecture principle

WPO creates **ONE Jira issue per order** and then hands off — Jira Automation handles all internal transitions (assignee, security level, status, notifications). WPO never calls Jira API for transitions.

Two additional issues are linked to the main Заказ:

| Issue | When created | Content | DB column |
|---|---|---|---|
| **Price Breakdown Story** | At order init (before OCR) | Operator audit view: ALL line items (client-visible + internal costs), cost reservations, margin summary, reconciliation, debug JSON | `jobs.price_jira_issue_key` |
| **Finance Report Story** | After order completion | Actual payment/fiscal/payout data post-completion | `jobs.finance_jira_issue_key` |

Both are linked to the main issue via `relates to`. Never put internal cost fields (margins, reserves) into the **main order issue** description. The Price Breakdown Story is intentionally an operator-only full-audit view — it DOES include internal costs and margin.

Jira Automation sends callbacks to `/api/webhooks/jira` when statuses change; that route only updates Supabase and fires Telegram/email notifications — it does NOT create Jira issues or call Jira API.

**`ORDER_CLOSED`** (2026-08-05 WO-112 fix) — Jira Automation must send this, not `TRANSLATOR_COMPLETED`, when an issue moves to the terminal Jira status **"Закрыто"**. It means the order is fully done for every service level regardless of physical delivery/pickup progress. Handled by `syncOrderClosed()` (`src/lib/integrations/workflow.ts`): sets `jobs.status='completed'` + `jobs.jira_closed_at` (migration `0067`) — **never** `workflow_status`, and **never** routed through the monotonic rank guard (`safeUpdateWorkflowStatus`/`WORKFLOW_RANK`), since the whole point is to close the order from whatever `workflow_status` it is currently at without disturbing that historical record. `getCustomerOrderState()` treats `jira_closed_at` as the sole "closed" signal: 100% progress, "Готово" badge, moves to history, download stays available if the result file is ready. Required Jira Automation rule: on transition to "Закрыто", POST `{ eventId, eventType: "ORDER_CLOSED", issueKey, orderId, jiraStatus: "Закрыто", occurredAt }` to `/api/webhooks/jira`.

## Web app integration (`src/lib/integrations/workflow.ts`)

`initializeOrderIntegrations(job)`:
- Creates Google Drive order folder (if Drive is configured)
- Creates one Jira issue via `src/lib/jira/client.ts` — issue type is hardcoded as `Заказ`
- Sends Telegram operator notification
- All steps are optional/no-op if their env vars are absent

## Worker integration (`worker/src/lib/integrations.ts`)

Three phases:
- `initializeOrderIntegrations()` — runs BEFORE OCR: creates Drive folder + Jira issue + Price Breakdown Story (if `JIRA_PRICE_BREAKDOWN_ISSUE_ENABLED=true`)
- `triggerTranslatorReview()` — runs AFTER AI draft: uploads draft PDF to Drive `02_AI_DRAFT` subfolder
- `createFinanceReportIssue()` — called AFTER order completion: creates Finance Report Story with payment, fiscal, margin data

## Jira

**Credentials** (all optional — integration silently skips if absent):
- `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`, `JIRA_WEBHOOK_SECRET`

Project configuration (project key, issue type name, field IDs) lives in `worker/src/lib/jira/` (not env vars).

### Price Breakdown Story env vars

- `JIRA_PRICE_BREAKDOWN_ISSUE_ENABLED` — `"true"` to enable (default: disabled). Opt-in per environment.
- `JIRA_PRICE_BREAKDOWN_PROJECT_KEY` — Jira project (default: `JIRA_FINANCE_PROJECT_KEY` → `WO`)
- `JIRA_PRICE_BREAKDOWN_ISSUE_TYPE` — issue type name (default: `Story`)
- `JIRA_PRICE_BREAKDOWN_LABELS` — comma-separated labels (default: `wpo-price-breakdown`)

Builder: `worker/src/lib/jira/price-breakdown.ts`. Description format: ADF (headings, tables, codeBlock — no plain-text pseudo-tables).

**Idempotency**: checks `jobs.price_jira_issue_key` first; if null, falls back to Jira search by `labels=wpo-price-breakdown AND summary="Price Breakdown for WO-XXX"`. Never creates duplicates if an existing issue is found.

**Rebuild script**: `scripts/staging/rebuild-jira-price-breakdown.ts` — supports `--quote-id`, `--job-id`, `--main-issue-key`, `--dry-run`, `--dedupe`. Searches Jira before creating, adopts existing issue if found, links to main order issue.

### Finance Report Story env vars

- `JIRA_FINANCE_PROJECT_KEY` — Jira project (default: `WO`)
- `JIRA_FINANCE_ISSUE_TYPE` — issue type name (default: `Story`)
- `JIRA_FINANCE_SECURITY_LEVEL_ID` — optional Jira security level ID
- `JIRA_FINANCE_LABELS` — comma-separated labels (default: `wpo-finance,confidential,internal-finance`)

Builder: `worker/src/lib/jira/finance-report.ts`. Idempotent via `jobs.finance_jira_issue_key`.

### Jira field security — critical

**Never populate Jira fields with:**
- Document content
- AI draft text
- IIN/BIN or document numbers
- Payment credentials
- File attachments

Delivery address and phone go only into `customfield_10076` / `customfield_10075` — **never** in the issue summary or description.

See `worker/src/lib/jira/order-fields.ts` for all field IDs.

### Partner referral attribution on the main order issue

`customfield_10121` (`Partner ID`) — set on the main order issue (`WO`/`Заказ`) at issue-create time only, to the referring partner's `partner_applications.id` (the same UUID Jira Automation already knows as the Partnership issue's Application ID). Populated by `getPartnerApplicationId(jobId)` in `worker/src/lib/integrations.ts`, which does a best-effort lookup: `partner_referrals.job_id → partner_referrals.partner_id → partners.application_id`. Omitted entirely (never a placeholder) when the order has no referral, the referral row hasn't landed yet, or the partner has no `application_id` on file — matches the rest of the referral pipeline's best-effort, non-blocking convention (`src/lib/referral/server.ts`). Not backfilled after issue creation, same as the other order-creation-time-only fields (delivery address/phone). This is the only wiring between the referral system and Jira on the order side — no admin pages, no separate payout UI; Jira remains the back-office for partner reporting.

## Google Drive

**Credentials** (all optional):
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, `GOOGLE_DRIVE_ROOT_FOLDER_ID`

Logic in `src/lib/google-drive/client.ts` (web) and `worker/src/lib/google-drive.ts` (worker).

Drive subfolders per order:
- `01_ORIGINAL`
- `02_AI_DRAFT`
- `03_TRANSLATED`
- `04_NOTARY`

## Telegram

**Credentials** (all optional):
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_OPERATOR_CHAT_ID`, `TELEGRAM_TRANSLATOR_CHAT_ID`, `TELEGRAM_NOTARY_CHAT_ID`

Logic in `src/lib/telegram/client.ts` (web) and within `worker/src/lib/integrations.ts` (worker).

Broadcast functions: `notifyOperatorNewOrder`, `notifyTranslatorNewAssignment`, `notifyNotaryNewAssignment`, `notifyOperatorTranslatorDone`, `notifyOperatorNotaryDone`, `notifyOperatorError`.

## Personal Telegram notifications

`handleAssigneeChanged(params)` in `src/lib/notifications/assignee.ts` handles `ASSIGNEE_CHANGED` Jira webhook events.

Flow:
1. Look up assignee in `staff_profiles` by `jira_account_id`
2. Build role-specific message (translator / notary_partner / operator)
3. Call `sendDirectMessageWithButtons(chatId, text, buttons)`
4. Record every attempt in `notification_log`

**Idempotent**: skips if a `sent`/`pending` row already exists for the same `event_id` + `recipient_profile_id`.

The `TELEGRAM_OPERATOR_CHAT_ID` / `TELEGRAM_TRANSLATOR_CHAT_ID` env vars are for broadcast fallbacks only — personal routing uses `staff_profiles.telegram_chat_id` instead.

## Staff profiles (`staff_profiles` table)

Columns: `display_name`, `jira_account_id`, `telegram_chat_id`, `telegram_username`, `telegram_notifications_enabled`, `role` (`operator|translator|notary_partner|admin`), `is_active`.

Service role only (RLS blocks browser). Unique constraint on `jira_account_id WHERE is_active=true`.

## Notification log (`notification_log` table)

Delivery audit for every Telegram notification attempt.

Columns: `event_id`, `order_id`, `jira_issue_key`, `recipient_profile_id`, `channel`, `template`, `status` (`pending|sent|failed|skipped`), `provider_message_id`, `error`, `sent_at`.

Unique index on `(event_id, recipient_profile_id) WHERE status IN ('sent','pending')` for idempotency.

## Notary cities

`src/lib/notary/cities.ts` — static registry of KZ cities where notarized-translation pickup/delivery is offered. Referenced by the notarized-translation landing page and job creation flow.

## Telegram operations integration (translators / notary partners without a Jira license)

2026-08-08: `src/app/api/telegram/jira-event/route.ts` + `src/app/api/telegram/webhook/route.ts` +
`src/lib/telegram-ops/` + table `telegram_assignments` (migration `0068`). Lets translators and
notary partners claim/start/complete orders from Telegram, since they have no Jira license.

**This does NOT create an exception to "WPO never calls Jira transitions."** The forward path is
Telegram button → `/api/telegram/webhook` (validates chat/user/ownership, atomically arbitrates
simultaneous claims via `telegram_assignments.status` `open→claim_pending`, writes `job_audit_log`)
→ a single Jira Automation "incoming webhook" rule (`JIRA_AUTOMATION_TELEGRAM_ACTION_WEBHOOK_URL`)
that validates the current Jira status and performs the actual transition + audit comment — Jira
Automation remains the only thing that ever writes a Jira transition. The reverse path is the
normal Jira status-changed event (one Automation rule watching 6 statuses) → `/api/telegram/jira-event`
(`event=status_changed`) → edits the existing Telegram message in place. Telegram is a pure
projection of Jira state — never edited optimistically by a button tap.

`telegram_assignments` status lifecycle: `open → claim_pending → claimed → in_progress → completed`.
Only the `status_changed` handler advances past `claim_pending` — a button tap only ever moves
`open→claim_pending` (the atomic race arbitrator) and forwards a request onward. `claim_pending`
has a 3-minute staleness window so a lost/failed Automation execution can't permanently lock an
order. Broadcast messages include `price_quotes.physical_page_count` and
`cost_reservations.amount_kzt` (`cost_type=translator_payout`/`translator_reserved_cost`/
`notary_payout`) when present — never fabricated when absent.

Full env vars, Jira Automation rule configs, and exact payloads: `docs/TELEGRAM_OPERATIONS_SETUP.md`.

## Reference docs

- `docs/TELEGRAM_NOTIFICATIONS_SETUP.md`
- `docs/TELEGRAM_OPERATIONS_SETUP.md`
- `docs/JIRA_AUTOMATION_SETUP.md`
