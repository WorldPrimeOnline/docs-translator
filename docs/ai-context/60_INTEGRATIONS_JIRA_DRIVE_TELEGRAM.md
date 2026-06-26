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

## Reference docs

- `docs/TELEGRAM_NOTIFICATIONS_SETUP.md`
- `docs/JIRA_AUTOMATION_SETUP.md`
