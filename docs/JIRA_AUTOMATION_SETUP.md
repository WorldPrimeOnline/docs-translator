# JIRA_AUTOMATION_SETUP.md

Jira Automation rules for WPO order reverse-sync.

## Architecture

WPO creates one Jira issue per order (via Railway worker). Jira Automation handles all Jira-side transitions. This document describes the rules that send callbacks to WPO so Supabase `workflow_status` stays in sync.

### Environment routing via labels

Every Jira issue created by WPO is automatically tagged with an environment label:

| `APP_ENV` (Railway worker) | Label added to issue |
|---|---|
| `staging` | `wpo-staging` |
| `production` (default) | `wpo-production` |

Each Automation rule must add a **JQL condition** on the label so staging and production events are routed to the correct endpoint. **Never mix staging and production callbacks in the same rule.**

---

## Staging rules

**Condition** (add to every staging rule):

```
labels = wpo-staging
```

**Callback URL**:

```
https://docs-translator-git-staging-world-prime-online-s-projects.vercel.app/api/webhooks/jira
```

**Auth headers**:

```
x-wpo-webhook-secret: <staging JIRA_WEBHOOK_SECRET>
x-vercel-protection-bypass: <Vercel Deployment Protection bypass secret>
```

---

## Production rules

**Condition** (add to every production rule):

```
labels = wpo-production
```

**Callback URL**:

```
https://www.wpotranslations.org/api/webhooks/jira
```

**Auth header**:

```
x-wpo-webhook-secret: <production JIRA_WEBHOOK_SECRET>
```

---

## Payload contract

Every rule sends this JSON body (all fields required unless noted):

```json
{
  "eventId": "{{webhookId}}-{{issue.key}}-{{now.epochSeconds}}",
  "eventType": "<EVENT_TYPE>",
  "issueKey": "{{issue.key}}",
  "orderId": "{{issue.fields.customfield_10073}}",
  "jiraStatus": "{{issue.fields.status.name}}",
  "occurredAt": "{{now}}"
}
```

`orderId` maps to `customfield_10073` (Order ID = Supabase job UUID).

---

## Rules

Create each rule in **two copies** — one for staging (condition: `labels = wpo-staging`) and one for production (condition: `labels = wpo-production`). Keep staging rules enabled; enable production rules only after production deployment is confirmed.

### 1. TRANSLATOR_ACCEPTED

**Trigger**: Issue transitioned to status `In Progress` by a user in the Translators group  
**eventType**: `TRANSLATOR_ACCEPTED`  
**Effect in WPO**: audit log only, no `workflow_status` change

---

### 2. TRANSLATOR_IN_PROGRESS

**Trigger**: Issue transitioned to status `Translation In Progress`  
**eventType**: `TRANSLATOR_IN_PROGRESS`  
**Effect in WPO**: audit log only

---

### 3. TRANSLATOR_COMPLETED

**Trigger**: Issue transitioned to status `Translation Done`  
**eventType**: `TRANSLATOR_COMPLETED`  
**Effect in WPO**:
- Certified jobs (`service_level = official_with_translator_signature_and_provider_stamp`): `workflow_status → translator_approved`
- Notarized jobs (`service_level = notarization_through_partners`): `workflow_status → assigned_to_notary`

---

### 4. TRANSLATOR_DECLINED

**Trigger**: Issue transitioned to status `Translation Declined`  
**eventType**: `TRANSLATOR_DECLINED`  
**Effect in WPO**: `workflow_status → translator_declined`

---

### 5. NOTARY_ACCEPTED

**Trigger**: Issue transitioned to status `With Notary`  
**eventType**: `NOTARY_ACCEPTED`  
**Effect in WPO**: audit log only

---

### 6. NOTARY_IN_PROGRESS

**Trigger**: Issue transitioned to status `Notarization In Progress`  
**eventType**: `NOTARY_IN_PROGRESS`  
**Effect in WPO**: `workflow_status → notarization_in_progress`

---

### 7. NOTARY_COMPLETED

**Trigger**: Issue transitioned to status `Notarized`  
**eventType**: `NOTARY_COMPLETED`  
**Effect in WPO**: `workflow_status → notarized`

---

### 8. NOTARY_DECLINED

**Trigger**: Issue transitioned to status `Notarization Declined`  
**eventType**: `NOTARY_DECLINED`  
**Effect in WPO**: `workflow_status → notary_declined`

---

### 9. ORDER_READY

**Trigger**: Issue transitioned to status `Ready`  
**eventType**: `ORDER_READY`  
**Effect in WPO**:
- `fulfillment_method = delivery`: `workflow_status → ready_for_delivery`
- `fulfillment_method = pickup`: `workflow_status → ready_for_pickup`

---

### 10. OUT_FOR_DELIVERY

**Trigger**: Issue transitioned to status `Out For Delivery`  
**eventType**: `OUT_FOR_DELIVERY`  
**Effect in WPO**: `workflow_status → out_for_delivery` (not terminal — customer sees active status)

---

### 11. DELIVERED

**Trigger**: Issue transitioned to status `Delivered`  
**eventType**: `DELIVERED`  
**Effect in WPO**: `workflow_status → delivered` (terminal)

---

### 12. PICKED_UP

**Trigger**: Issue transitioned to status `Picked Up`  
**eventType**: `PICKED_UP`  
**Effect in WPO**: `workflow_status → picked_up` (terminal, pickup path)

---

### 13. JOB_FAILED

**Trigger**: Issue transitioned to status `Failed`  
**eventType**: `JOB_FAILED`  
**Effect in WPO**: `status → failed`

---

### 14. JOB_CANCELED

**Trigger**: Issue transitioned to status `Canceled`  
**eventType**: `JOB_CANCELED`  
**Effect in WPO**: `status → failed`, reason `canceled`

---

## Security notes

- The webhook secret is in `JIRA_WEBHOOK_SECRET` (Vercel env var). Never commit the value.
- WPO verifies `x-wpo-webhook-secret` on every request; requests without a matching header return 401.
- Staging Preview URL also requires `x-vercel-protection-bypass` (Vercel Deployment Protection bypass secret — set in Vercel → Settings → Deployment Protection).
- Delivery phone (`customfield_10075`) and address (`customfield_10076`) are never included in `summary` or `description` — they are restricted Jira fields visible only to operators.
- Do not include document content, IIN, passport numbers, or payment credentials in any Jira field or Automation rule payload.

## Idempotency

WPO deduplicates by `eventId` — both in-memory (per instance) and via `job_audit_log` (Supabase). Retries from Jira Automation are safe; duplicate events return `{ ok: true, skipped: "already_processed" }`.

## Custom field reference

| Field ID | Label | Type |
|---|---|---|
| customfield_10073 | Order ID | Text |
| customfield_10074 | Customer ID | Text |
| customfield_10075 | Delivery Phone | Text (delivery only) |
| customfield_10076 | Delivery Address | Text (delivery only) |
| customfield_10077 | Total Cost (KZT) | Number |
| customfield_10078 | Internal Cost | Number |
| customfield_10079 | Documents Link | Text (Drive URL) |
| customfield_10080 | Payment Method | Single-select |
| customfield_10082 | Document Type | Single-select |
| customfield_10083 | Translation Type | Single-select |
| customfield_10087 | Fulfillment Method | Single-select |
| customfield_10088 | Language Pair | Text |
