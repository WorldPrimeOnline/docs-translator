# TELEGRAM_OPERATIONS_SETUP.md

Telegram operations integration for translators and notary partners who have no
Jira license. **Jira is the sole source of truth and `jira_issue_key` + role is the
sole operational identity — no Supabase table backs any part of this feature.** A
Jira issue with no corresponding WPO order at all (e.g. one created manually,
normal fields populated, `wpo-production` label added, purely to test this
integration end-to-end) is a fully valid Telegram Operations issue.

Jira Automation remains the sole owner of every workflow transition — this
integration only ever *forwards a validated request* to Automation; Railway/Vercel
never calls a Jira transition. See
[docs/ai-context/60_INTEGRATIONS_JIRA_DRIVE_TELEGRAM.md](ai-context/60_INTEGRATIONS_JIRA_DRIVE_TELEGRAM.md)
for the architecture summary.

## Architecture

```
Jira issue created ──────────────────────────────► /api/telegram/jira-event
  (Automation rule "Broadcast: translator")          event=translator_order_created
                                                        → GET issue, build message from
                                                          Jira fields only
                                                        → send Telegram message
                                                        → PUT Translator Message ID
                                                          field directly (Railway)

Jira issue reaches "ПЕРЕВОД ЗАВЕРШЕН" + your ────► /api/telegram/jira-event
  own service-level condition                        event=notary_required
  (Automation rule "Broadcast: notary")               → same, using the Notary
                                                          Message ID field

Telegram button tap (claim) ──────────────────────► /api/telegram/webhook
                                                        → validates chat + Jira
                                                          issue status (read-only
                                                          fast-fail precheck)
                                                        → forwards {issueKey, action,
                                                          telegramUserId, executorName,
                                                          role} to the ONE Automation
                                                          incoming-webhook rule below
                                                        → NEVER writes any Jira field

Jira Automation incoming-webhook rule ────────────► For *_claim: validates status,
  (triggered by the POST above)                       SETS User ID + Display Name
                                                        fields, transitions, comments.
                                                       For *_start/*_done: validates
                                                        status, transitions, comments
                                                        (no field writes needed).

Telegram button tap (start/done) ─────────────────► /api/telegram/webhook
                                                        → GET issue, read stored User ID
                                                          field, compare to caller
                                                        → forwards action (as above)

Jira status actually changes ─────────────────────► Jira Automation rule
  (any of the 6 statuses below)                       "Status sync" fires
                                                        → POST /api/telegram/jira-event
                                                          event=status_changed
                                                        → GET issue, read Message ID +
                                                          Display Name fields
                                                        → Railway edits the existing
                                                          Telegram message in place
```

Telegram is a pure projection of Jira state. It is **never** edited as a direct
result of a button tap — only ever as a result of the `status_changed` event above.

## Persistence: Jira custom fields, not Supabase

Removed entirely: `telegram_assignments`, `jobs`, `job_id`, `job_audit_log`, any
lookup by `jobs.jira_issue_key` or `customfield_10073` — none of that is read or
written anywhere in this feature. All Telegram-specific state lives in 8 new Jira
custom fields you create yourself (project **WO**, issue type **Заказ**), whose
real `customfield_XXXXX` IDs you provide via env vars — the code never hardcodes a
guessed ID for these (unlike the pre-existing `customfield_100XX` fields in
`src/lib/jira/client.ts`, which were baked in because they already existed).

| Field (create in Jira admin) | Type | Env var | Written by |
|---|---|---|---|
| Telegram Translator Message ID | Text | `JIRA_FIELD_TG_TRANSLATOR_MESSAGE_ID` | Railway, directly, right after the Telegram send succeeds |
| Telegram Translator User ID | Text | `JIRA_FIELD_TG_TRANSLATOR_USER_ID` | **Jira Automation only** — set as part of the `translator_claim` rule execution |
| Telegram Translator Display Name | Text | `JIRA_FIELD_TG_TRANSLATOR_NAME` | **Jira Automation only** — same rule execution |
| Telegram Notary Message ID | Text | `JIRA_FIELD_TG_NOTARY_MESSAGE_ID` | Railway, directly |
| Telegram Notary User ID | Text | `JIRA_FIELD_TG_NOTARY_USER_ID` | **Jira Automation only** — `notary_claim` rule |
| Telegram Notary Display Name | Text | `JIRA_FIELD_TG_NOTARY_NAME` | **Jira Automation only** — same rule |
| (shared) Page count | Number | `JIRA_FIELD_TG_PAGE_COUNT` | Not written by this integration — populate on the issue however you already do |
| (shared) Payout amount (KZT) | Number | `JIRA_FIELD_TG_PAYOUT_AMOUNT_KZT` | Same — whichever role's broadcast is current reads whatever is populated |

**Why message-id is written directly but user-id/display-name are not:** message-id
is deterministic integration metadata (which Telegram message corresponds to this
issue) — not part of the ownership/workflow state machine, so a direct field PUT via
the existing `updateJiraIssue()` (same mechanism the Drive-URL backfill already
uses) is fine. Ownership (who claimed) is different: writing it must happen
*atomically with* the status-precondition check and the transition, or two
near-simultaneous claims could both write the field before either transition lands.
Jira Automation's own rule execution — validate status, set fields, transition, all
in one run — is the only thing that can offer that; Railway performing a separate
pre-write could race. **Railway/Vercel must never pre-write the User ID/Display Name
fields before Jira Automation accepts the claim.**

Chat IDs (`TELEGRAM_TRANSLATOR_CHAT_ID`, `TELEGRAM_NOTARY_CHAT_ID`) stay
environment configuration — role implies chat, no Jira field needed for them.

Leftover from an earlier iteration of this feature: the `telegram_assignments`
Supabase table (migrations `0068`/`0069`) is no longer read or written by any
runtime code. It is left in place, unused, rather than dropped — see
`docs/ai-context/DECISIONS.md` for why.

## Env vars

| Var | Where | Notes |
|---|---|---|
| `TELEGRAM_WEBHOOK_SECRET` | Vercel (web) | Value you choose; passed to `setWebhook` as `secret_token` (see below) and checked against the `X-Telegram-Bot-Api-Secret-Token` header on every `/api/telegram/webhook` call. |
| `JIRA_AUTOMATION_TELEGRAM_ACTION_WEBHOOK_URL` | Vercel (web) | The single Jira Automation "Incoming webhook" trigger URL (see Rule 4 below). |
| `JIRA_AUTOMATION_ACTION_WEBHOOK_SECRET` | Vercel (web) | Sent as `X-WPO-Action-Secret` on every forwarded action; check it in the Automation rule's first condition. |
| `JIRA_FIELD_TG_TRANSLATOR_MESSAGE_ID` / `_USER_ID` / `_NAME` | Vercel (web) | The real `customfield_XXXXX` IDs of the 3 translator fields above, once created. |
| `JIRA_FIELD_TG_NOTARY_MESSAGE_ID` / `_USER_ID` / `_NAME` | Vercel (web) | Same, for the 3 notary fields. |
| `JIRA_FIELD_TG_PAGE_COUNT` / `JIRA_FIELD_TG_PAYOUT_AMOUNT_KZT` | Vercel (web) | Optional — the message simply omits the corresponding line if unset or empty on the issue. |

Reused, unchanged:

| Var | Purpose |
|---|---|
| `JIRA_WEBHOOK_SECRET` | Also authenticates `/api/telegram/jira-event` (`X-WPO-Webhook-Secret` header) — same trust boundary as `/api/webhooks/jira`. |
| `TELEGRAM_BOT_TOKEN` | Sends/edits messages, answers callback queries. |
| `TELEGRAM_TRANSLATOR_CHAT_ID` | Destination for translator broadcasts; also the only chat `translator_*` callbacks are accepted from. |
| `TELEGRAM_NOTARY_CHAT_ID` | Same, for the notary chat. |
| `JIRA_BASE_URL` / `JIRA_EMAIL` / `JIRA_API_TOKEN` | `GET /issue/{key}` (read) for both routes, plus `PUT /issue/{key}` (write) for the message-id fields only — `src/lib/jira/client.ts`'s `getJiraIssue()` / `updateJiraIssue()`. |

## One-time Telegram setup

Register the webhook (replace `<domain>` and secrets):

```bash
curl -X POST "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://<domain>/api/telegram/webhook",
    "secret_token": "<TELEGRAM_WEBHOOK_SECRET>",
    "allowed_updates": ["callback_query"]
  }'
```

Run once per environment (staging domain / production domain), whenever the bot
token or webhook secret changes.

## Jira Automation rules to configure

Every "Send web request" rule below (Rules 1–3) needs, in addition to its
trigger/condition:

- Header `Content-Type: application/json`
- Header `x-wpo-webhook-secret: <JIRA_WEBHOOK_SECRET>` (same value as `/api/webhooks/jira`'s rules — see [docs/JIRA_AUTOMATION_SETUP.md](JIRA_AUTOMATION_SETUP.md) for the staging/production URL + `x-vercel-protection-bypass` pattern on Preview deployments)
- URL: `https://<domain>/api/telegram/jira-event`

### Rule 1 — Broadcast: translator order created

**Trigger**: Issue created (Project = WO, Issue type = Заказ), plus your existing env-label condition (`labels = wpo-staging` / `wpo-production`).

```json
{ "event": "translator_order_created", "issueKey": "{{issue.key}}" }
```

### Rule 2 — Broadcast: notary required

**Trigger**: Issue transitioned to status `ПЕРЕВОД ЗАВЕРШЕН`, **plus your own service-level condition** (you configure this — e.g. only when `Тип перевода` = "Нотариально заверенный"). WPO does not gate this by service level itself.

```json
{ "event": "notary_required", "issueKey": "{{issue.key}}" }
```

### Rule 3 — Status sync (drives every Telegram message edit)

**Trigger**: Field value changed → Field: **Status**.
**Condition**: Status changed to one of:

```
НАЗНАЧЕН ПЕРЕВОДЧИК, ПЕРЕВОД В РАБОТЕ, ПЕРЕВОД ЗАВЕРШЕН,
НАЗНАЧЕН НОТАРИУС, В РАБОТЕ У НОТАРИУСА, ПЕРЕВОД ЗАВЕРЕН
```

```json
{ "event": "status_changed", "issueKey": "{{issue.key}}", "jiraStatus": "{{issue.status.name}}" }
```

One rule covers all 6 — `jiraStatus` carries the live value, and
`resolveStatusMapping()` (`src/lib/telegram-ops/order-message.ts`) maps it to the
right role + button state. Any other status this issue passes through later
(delivery, pickup, etc.) is silently ignored by this endpoint.

### Rule 4 — Incoming webhook: perform the action

**This is the one rule Railway calls into** (`JIRA_AUTOMATION_TELEGRAM_ACTION_WEBHOOK_URL`).

**Trigger**: Incoming webhook.

**First step — validate the secret**: Condition on the request header `X-WPO-Action-Secret` equals `<JIRA_AUTOMATION_ACTION_WEBHOOK_SECRET>` (reject/stop otherwise).

**Payload received**:

```json
{
  "issueKey": "WO-123",
  "action": "translator_start",
  "telegramUserId": "123456789",
  "executorName": "Aigerim",
  "role": "translator"
}
```

**Branch on `{{webhookData.action}}`**, one branch per value:

| `action` | Precondition (validate current status) | Also sets these fields | Transition | Comment |
|---|---|---|---|---|
| `translator_claim` | `status = OPEN` | **Telegram Translator User ID** = `{{webhookData.telegramUserId}}`, **Telegram Translator Display Name** = `{{webhookData.executorName}}` | → `НАЗНАЧЕН ПЕРЕВОДЧИК` | `Translator claimed order via Telegram: {{webhookData.executorName}}` |
| `translator_start` | `status = НАЗНАЧЕН ПЕРЕВОДЧИК` | — | → `ПЕРЕВОД В РАБОТЕ` | `Translator started work via Telegram: {{webhookData.executorName}}` |
| `translator_done` | `status = ПЕРЕВОД В РАБОТЕ` | — | → `ПЕРЕВОД ЗАВЕРШЕН` | `Translator completed work via Telegram: {{webhookData.executorName}}` |
| `notary_claim` | `status = ПЕРЕВОД ЗАВЕРШЕН` (the state the issue is in when the notary broadcast goes out) | **Telegram Notary User ID** = `{{webhookData.telegramUserId}}`, **Telegram Notary Display Name** = `{{webhookData.executorName}}` | → `НАЗНАЧЕН НОТАРИУС` | `Notary claimed order via Telegram: {{webhookData.executorName}}` |
| `notary_start` | `status = НАЗНАЧЕН НОТАРИУС` | — | → `В РАБОТЕ У НОТАРИУСА` | `Notary started work via Telegram: {{webhookData.executorName}}` |
| `notary_done` | `status = В РАБОТЕ У НОТАРИУСА` | — | → `ПЕРЕВОД ЗАВЕРЕН` | `Notary certified document via Telegram: {{webhookData.executorName}}` |

For `translator_claim`/`notary_claim`, the field-set and the transition must be
**one rule execution** (the "Edit issue fields" action followed by the transition
action, both gated by the same status condition, no separate rule/trigger) — this
is what gives ownership assignment its only real atomicity guarantee, since Railway
deliberately never writes these two fields itself.

If the precondition fails (someone else already advanced the status, or a
duplicate Telegram tap arrived), **do not transition and do not set the fields** —
this rule's own status check is the authoritative concurrency guard; Railway's own
precheck (in `/api/telegram/webhook`) is a fast, non-authoritative UX nicety only.
Failing silently (no web response needed) is fine: Telegram never waits on this
rule's result, it only waits on the later `status_changed` event.

Use "determine transition dynamically by name" (Jira Automation's built-in
transition-by-name action) rather than a hardcoded numeric transition ID, so a
workflow screen change doesn't silently break this rule.

## Data sourced for the broadcast message

`buildOrderBroadcastData()` (`src/lib/telegram-ops/order-message.ts`) reads
everything straight from the Jira issue via `getJiraIssue()` — no Supabase call of
any kind:

- `customfield_10083` (translation type), `customfield_10088` (language pair),
  `customfield_10082` (document type), `customfield_10079` (Drive link) — the
  pre-existing order fields, same ones the main issue is created with.
- Page count / payout amount — read from `JIRA_FIELD_TG_PAGE_COUNT` /
  `JIRA_FIELD_TG_PAYOUT_AMOUNT_KZT` if configured and populated on the issue;
  omitted from the message entirely (never fabricated) when either the env var
  isn't set or the field is empty on that issue.

## Concurrency & recovery

- **Claim** (`translator_claim`/`notary_claim`): Railway does a read-only status
  precheck (fast "already claimed" feedback) but never writes anything. The real
  gate is Jira Automation's own status-precondition check, executed atomically
  alongside the User ID/Display Name field writes and the transition (Rule 4
  above). Accepted trade-off versus the previous Supabase-backed design: there is
  no database-level compare-and-swap on the field write itself, so in a very tight
  simultaneous-tap race the two Automation executions could both attempt to set
  the ownership fields before either's status check re-runs — but Jira's own
  transition locking still ensures only one execution actually transitions the
  issue, so the workflow state is always correct; at worst the displayed executor
  name could be briefly wrong until corrected by a subsequent action.
- **Start/done**: gated by the issue's current status (must already equal the
  action's precondition — see `REQUIRED_STATUS_FOR_ACTION` in
  `src/lib/telegram-ops/order-message.ts`) *and* by the caller's Telegram user id
  matching the stored User ID field. Both checks are plain reads (`GET /issue`),
  no write, no race.
- **No stale-lock recovery mechanism is needed anymore**: since Railway never
  reserves anything, there is nothing to time out or clean up. If a claim's
  Automation execution fails outright (rule error, Jira down), the issue simply
  stays at its precondition status and the next tap of the same button retries
  cleanly — no orphaned "pending" state possible.
