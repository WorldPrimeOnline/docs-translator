# TELEGRAM_NOTIFICATIONS_SETUP.md

Personal Telegram notifications for operators, translators, and notary partners.

## Architecture overview

```
Jira Assignee changed
→ Jira Automation "Send web request"
→ POST /api/webhooks/jira  { eventType: "ASSIGNEE_CHANGED", assigneeAccountId: "..." }
→ lookup staff_profiles by jira_account_id
→ Telegram sendMessage to telegram_chat_id
→ notification_log (delivery audit)
```

- **Jira is the only interface for managing workflow.** Telegram is notifications-only.
- Chat IDs are stored server-side in `staff_profiles`. Never in env vars, never in the browser.
- The bot token (`TELEGRAM_BOT_TOKEN`) is needed in both Vercel (web webhook) and Railway (worker alerts).

---

## Required environment variable

| Variable | Required in | Purpose |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | Vercel (Preview + Production), Railway (staging + production) | Bot API token for all Telegram calls |

Add via Vercel dashboard → Settings → Environment Variables and Railway → Variables.

**Never commit the token.**

---

## Step 1 — Create a Telegram bot

1. Open Telegram, search **@BotFather**.
2. Send `/newbot`, follow prompts.
3. Copy the token (format: `1234567890:AABBccdd...`).
4. Set `TELEGRAM_BOT_TOKEN` in Vercel and Railway.

---

## Step 2 — Staff members link their Telegram

1. Each operator / translator / notary opens the bot and sends `/start`.
2. Run the helper script to retrieve their chat IDs:

```bash
TELEGRAM_BOT_TOKEN=<token> npx tsx scripts/telegram-list-updates.ts
```

Output example:

```
Chat ID (telegram_chat_id) : 987654321
User ID                    : 987654321
Username (telegram_username): @translator_anna
First name                 : Anna
```

3. Note each person's **Chat ID** — that is the value you insert as `telegram_chat_id`.

---

## Step 3 — Insert staff profiles

Use the Supabase SQL editor (service role) or Supabase MCP. Run against the **staging** database first, then production after verifying.

```sql
INSERT INTO public.staff_profiles
  (display_name, jira_account_id, telegram_chat_id, telegram_username, role)
VALUES
  ('Anna Ivanova',  'jira-account-id-translator',   '987654321', '@translator_anna', 'translator'),
  ('Dauren Bekow',  'jira-account-id-notary',        '123456789', '@notary_dauren',   'notary_partner'),
  ('Operator Ivan', 'jira-account-id-operator',      '555000111', '@operator_ivan',   'operator');
```

**Finding a Jira account ID**: Open the staff member's Jira profile URL:
`https://<your-domain>.atlassian.net/jira/people/<accountId>` — the UUID in the URL is their `jira_account_id`.

### Roles

| Role | When notified |
|---|---|
| `translator` | ASSIGNEE_CHANGED when they are assigned to a translation order |
| `notary_partner` | ASSIGNEE_CHANGED when they are assigned to a notarization order |
| `operator` | ASSIGNEE_CHANGED when they are assigned to any order |
| `admin` | Same template as operator |

### Disabling notifications

Set `telegram_notifications_enabled = false` to silence notifications for a specific staff member without removing their record.

---

## Step 4 — Configure Jira Automation

See **`docs/JIRA_AUTOMATION_SETUP.md` → Rule 0. ASSIGNEE_CHANGED** for the full rule setup.

Summary:
- Trigger: Field value changed → Assignee
- Condition: `labels = wpo-staging` (staging rule) or `labels = wpo-production` (production rule)
- Action: Send web request to `/api/webhooks/jira` with the ASSIGNEE_CHANGED payload
- Headers: `Content-Type: application/json`, `X-WPO-Webhook-Secret: <JIRA_WEBHOOK_SECRET>`

---

## Notification templates

### Translator

```
🔔 Вам назначен новый заказ

Заказ: <job-id-prefix>
Jira: WO-42
Тип: passport_id
Языковая пара: KK → RU
Статус: Назначен переводчик
```

Buttons: **[Открыть задачу в Jira]** · **[Открыть документы]** (only if Drive URL exists)

### Notary partner

```
🔔 Вам назначен заказ на нотариальное удостоверение

Заказ: <job-id-prefix>
Jira: WO-42
Языковая пара: KK → RU
Город: Almaty
Способ получения: pickup
```

Buttons: **[Открыть задачу в Jira]** · **[Открыть документы]** (only if Drive URL exists)

### Operator / Admin

```
🔔 Вам назначен заказ WPO

Заказ: <job-id-prefix>
Jira: WO-42
Текущий этап: In Review
```

Button: **[Открыть задачу в Jira]**

---

## Delivery audit — notification_log

Every notification attempt is recorded in `notification_log`:

| Column | Description |
|---|---|
| `event_id` | Jira eventId — used for idempotency |
| `order_id` | Job UUID |
| `jira_issue_key` | e.g. WO-42 |
| `recipient_profile_id` | References `staff_profiles.id` |
| `channel` | `telegram` |
| `template` | `translator_assignment`, `notary_assignment`, `operator_assignment`, or `assignee_changed_no_profile` |
| `status` | `pending` → `sent` / `failed` / `skipped` |
| `provider_message_id` | Telegram `message_id` on success |
| `error` | Error text on failure |
| `sent_at` | Timestamp on success |

### Idempotency

A unique index `notification_log_event_profile_dedup_uidx` on `(event_id, recipient_profile_id)` WHERE `status IN ('sent', 'pending')` prevents the same event being delivered twice to the same recipient, even if Jira Automation retries.

---

## PII rules

The Telegram message **must not** contain:
- Customer full name, email, phone, or address
- IIN or passport number
- Document content or AI draft text
- Jira API credentials or Google tokens
- File names that could encode document owner identity

The message **may** contain:
- Order ID (job UUID prefix)
- Jira issue key
- Translation type / document type
- Language pair
- Notary city
- Pickup / delivery method
- Jira URL
- Google Drive folder URL (not a file URL)

---

## Manual retry

If a notification shows `status = failed` in `notification_log`, fix the underlying issue (bad token, wrong chat_id) and re-trigger by:
1. Updating the failing row: `UPDATE notification_log SET status = 'skipped' WHERE id = '<id>';`
2. Sending a new Jira Automation test trigger for the issue (which will generate a new `eventId`).

---

## Backlog (not implemented in this MVP)

- Telegram one-time account linking (user sends `/start` → bot saves chat_id automatically)
- Telegram callback buttons for Jira transitions (requires role verification)
- Notification preferences (quiet hours, per-event toggles)
- Escalation if assignment is not accepted within N hours
- API/webhooks for partner agencies
