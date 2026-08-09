# TELEGRAM_OPERATIONS_SETUP.md

Telegram operations integration for translators and notary partners who have no
Jira license. Jira Automation remains the sole owner of every workflow transition —
this integration only ever *forwards a validated request* to Automation and
*projects Automation's confirmed result* onto a Telegram message. See
[docs/ai-context/60_INTEGRATIONS_JIRA_DRIVE_TELEGRAM.md](ai-context/60_INTEGRATIONS_JIRA_DRIVE_TELEGRAM.md)
for the architecture summary.

## Architecture

```
Jira issue created ──────────────────────────────► /api/telegram/jira-event
  (Automation rule "Broadcast: translator")          event=translator_order_created
                                                        → posts message + [🙋 Назначить себя]
                                                          to TELEGRAM_TRANSLATOR_CHAT_ID

Jira issue reaches "ПЕРЕВОД ЗАВЕРШЕН" + your ────► /api/telegram/jira-event
  own service-level condition                        event=notary_required
  (Automation rule "Broadcast: notary")               → posts message + [⚖️ Назначить себя]
                                                          to TELEGRAM_NOTARY_CHAT_ID

Telegram button tap ──────────────────────────────► /api/telegram/webhook
                                                        → validates chat/user/ownership
                                                        → atomic claim arbitration
                                                        → forwards {issueKey, action,
                                                          telegramUserId, executorName, role}
                                                          to the ONE Automation incoming-
                                                          webhook rule below

Jira Automation incoming-webhook rule ────────────► validates current Jira status,
  (triggered by the POST above)                       performs the transition,
                                                        adds the audit comment

Jira status actually changes ─────────────────────► Jira Automation rule
  (any of the 6 statuses below)                       "Status sync" fires
                                                        → POST /api/telegram/jira-event
                                                          event=status_changed
                                                        → Railway edits the existing
                                                          Telegram message in place
```

Telegram is a pure projection of Jira state. It is **never** edited as a direct
result of a button tap — only ever as a result of the `status_changed` event above.

## Env vars

| Var | Where | Notes |
|---|---|---|
| `TELEGRAM_WEBHOOK_SECRET` | Vercel (web) | New. Value you choose; passed to `setWebhook` as `secret_token` (see below) and checked against the `X-Telegram-Bot-Api-Secret-Token` header on every `/api/telegram/webhook` call. |
| `JIRA_AUTOMATION_TELEGRAM_ACTION_WEBHOOK_URL` | Vercel (web) | New. The single Jira Automation "Incoming webhook" trigger URL (see Rule 3 below). |
| `JIRA_AUTOMATION_ACTION_WEBHOOK_SECRET` | Vercel (web) | New. Sent as `X-WPO-Action-Secret` on every forwarded action; check it in the Automation rule's first condition. |

Reused, unchanged:

| Var | Purpose |
|---|---|
| `JIRA_WEBHOOK_SECRET` | Also authenticates `/api/telegram/jira-event` (`X-WPO-Webhook-Secret` header) — same trust boundary as `/api/webhooks/jira`. |
| `TELEGRAM_BOT_TOKEN` | Sends/edits messages, answers callback queries. |
| `TELEGRAM_TRANSLATOR_CHAT_ID` | Destination for translator broadcasts; also the only chat `translator_*` callbacks are accepted from. |
| `TELEGRAM_NOTARY_CHAT_ID` | Same, for the notary chat. |
| `JIRA_BASE_URL` / `JIRA_EMAIL` / `JIRA_API_TOKEN` | Read-only `GET /issue/{key}` only — this integration never writes to Jira directly. |

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

Every "Send web request" rule below needs, in addition to its trigger/condition:

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

**Branch on `{{webhookData.action}}`**, one branch per value, each doing:

| `action` | Precondition (validate current status) | Transition | Comment |
|---|---|---|---|
| `translator_claim` | `status = OPEN` | → `НАЗНАЧЕН ПЕРЕВОДЧИК` | `Translator claimed order via Telegram: {{webhookData.executorName}}` |
| `translator_start` | `status = НАЗНАЧЕН ПЕРЕВОДЧИК` | → `ПЕРЕВОД В РАБОТЕ` | `Translator started work via Telegram: {{webhookData.executorName}}` |
| `translator_done` | `status = ПЕРЕВОД В РАБОТЕ` | → `ПЕРЕВОД ЗАВЕРШЕН` | `Translator completed work via Telegram: {{webhookData.executorName}}` |
| `notary_claim` | `status = ПЕРЕВОД ЗАВЕРШЕН` (the state the issue is in when the notary broadcast goes out) | → `НАЗНАЧЕН НОТАРИУС` | `Notary claimed order via Telegram: {{webhookData.executorName}}` |
| `notary_start` | `status = НАЗНАЧЕН НОТАРИУС` | → `В РАБОТЕ У НОТАРИУСА` | `Notary started work via Telegram: {{webhookData.executorName}}` |
| `notary_done` | `status = В РАБОТЕ У НОТАРИУСА` | → `ПЕРЕВОД ЗАВЕРЕН` | `Notary certified document via Telegram: {{webhookData.executorName}}` |

If the precondition fails (someone else already advanced the status, or a duplicate
Telegram tap arrived), **do not transition** — this rule's own status check is the
second, authoritative concurrency guard behind Railway's `telegram_assignments`
arbitration. Failing silently (no web response needed) is fine: Telegram never waits
on this rule's result, it only waits on the later `status_changed` event.

Use "determine transition dynamically by name" (Jira Automation's built-in
transition-by-name action) rather than a hardcoded numeric transition ID, so a
workflow screen change doesn't silently break this rule.

## Data sourced for the broadcast message

`buildOrderBroadcastData()` (`src/lib/telegram-ops/order-message.ts`) reads, per
order:

- `customfield_10083` (translation type), `customfield_10088` (language pair),
  `customfield_10082` (document type), `customfield_10079` (Drive link) — read
  directly from the Jira issue via `getJiraIssue()`.
- **Page count**: `price_quotes.physical_page_count` for the job's `paid` quote —
  the same page count WPO's own pricing engine bills from. Omitted if no paid quote
  is found (never fabricated).
- **Payout amount**: `cost_reservations.amount_kzt` where `cost_type` is
  `translator_payout` / `translator_reserved_cost` (translator role) or
  `notary_payout` (notary role) — confirmed by migration `0056`'s column comment
  and `src/lib/pricing/service.ts`'s `addReservation()` call sites to be the real
  external payout, not a general internal-cost figure. Omitted when no such
  reservation row exists (e.g. some legacy notarized quotes never got one).

## Concurrency & recovery

- `telegram_assignments.status` lifecycle: `open → claim_pending → claimed → in_progress → completed`.
- `open → claim_pending` is a single atomic `UPDATE ... WHERE status = 'open' OR (status = 'claim_pending' AND claim_pending_at < now() - 3min)` — the first Telegram tap to win this update is the only one whose action gets forwarded to Automation; every other simultaneous tap gets *"Заказ уже назначен другому переводчику/нотариусу."*
- The `claim_pending_at < now() - 3min` clause is the stale-pending recovery: if Automation's rule never runs (down, misconfigured, network drop), a later claim attempt is allowed to re-arbitrate instead of the order being locked forever.
- `claimed`/`in_progress`/`completed` are set **only** by the `status_changed` handler — never optimistically by a button tap — so "start" can't be forwarded before Jira confirms the claim, and "done" can't be forwarded before Jira confirms work started.
