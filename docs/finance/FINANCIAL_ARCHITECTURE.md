# Financial Architecture

## Overview

WPO uses an immutable quote-based pricing system. Every order starts with a price quote that is locked before payment begins. The system enforces that the charged amount always matches the quoted amount.

## Flow

```
Upload request
  → computeQuoteForJob()     — dynamic pricing engine
  → saveQuote()              — insert price_quotes, price_quote_items, cost_reservations
  → job created with price_kzt = quote.amount_kzt
  → return { quoteId, amountKzt }

Payment initiation
  → verifyQuotePayable()     — verify quote belongs to user/job, not expired, status=quoted
  → insert payment_transactions (amount = quote amount, amount_source='quote', quote_id=...)
  → markQuotePaymentPending()

Payment confirmation (Halyk callback)
  → markQuotePaid()          — status=paid, commits cost_reservations
  → ensureSaleFiscalReceiptForPaidPayment()

Refund (operator only)
  → calculateRefundEligibility() — determines policy case and refundable amount
  → initiateRefund()
  → createRefundReceiptForRefund()
```

## Key Rules

1. **Amount immutability**: The payment amount is always read from `price_quotes.amount_kzt`. Client-provided amounts are never used.
2. **Quote expiry**: Quotes expire in 24 hours. Expired quotes must be re-computed via a new upload.
3. **Amount source tracking**: `payment_transactions.amount_source` must be `'quote'` for all non-legacy payments.
4. **Fiscal consistency**: Before issuing a fiscal receipt, the system compares `payment_transactions.amount` against `price_quotes.amount_kzt`. Mismatches are logged as CRITICAL but do not block the fiscal receipt.
5. **Cost reservations**: Created atomically when the quote is saved; committed to `paid` status when payment confirms.

## Database Tables

| Table | Purpose |
|---|---|
| `pricing_versions` | Versioned rate table (tax, acquiring, reserves) — one active row |
| `price_quotes` | Immutable price snapshot per order |
| `price_quote_items` | Line-item breakdown (client-visible and internal) |
| `cost_reservations` | Per-job internal cost buckets (translator, notary, AI/IT, etc.) |

See `docs/finance/PRICING_ENGINE.md` for the calculation algorithm.
See `docs/finance/REFUND_FINANCE_RULES.md` for the refund policy.
See `docs/finance/UNIT_ECONOMICS.md` for target margins.

## Finance Report Jira Issue

For each order that has a Jira issue, a separate Finance Report Story is created after
job completion. It is linked to the main order issue (`WO-123 relates to WO-124`).

**The main order issue (Заказ) must NEVER contain:**
- `translator_reserved_cost`, `tax_reserve`, `acquiring_reserve`, `risk_reserve`
- `marketing_reserve`, `owner_reserve`, `target_profit`, `ai_it_reserve`
- `estimated_margin`, `internal_cost`, `partner_commission`

**MVP mode:** If `JIRA_FINANCE_SECURITY_LEVEL_ID` is not configured, the finance issue is
created without a Jira security level. Labels (`wpo-finance`, `confidential`, `internal-finance`)
provide fallback access control.

**Production recommendation:** Configure a Jira Issue Security Scheme and set
`JIRA_FINANCE_SECURITY_LEVEL_ID` before granting translators broad Jira project access.

### Finance issue DB fields (on `jobs` table, migration 0025)

| Column | Description |
|---|---|
| `finance_jira_issue_id` | Jira internal issue ID |
| `finance_jira_issue_key` | e.g. `WO-124` |
| `finance_jira_issue_url` | browse URL |
| `finance_jira_sync_status` | `pending` \| `synced` \| `failed` |
| `finance_jira_last_error` | error message on failure |
| `finance_jira_synced_at` | timestamp of successful sync |

### Env vars (all optional — read via `process.env` in `finance-report.ts`)

| Var | Default | Notes |
|---|---|---|
| `JIRA_FINANCE_PROJECT_KEY` | `WO` | |
| `JIRA_FINANCE_ISSUE_TYPE` | `Story` | |
| `JIRA_FINANCE_SECURITY_LEVEL_ID` | (none) | omit `security` field if absent |
| `JIRA_FINANCE_LABELS` | `wpo-finance,confidential,internal-finance` | comma-separated |

### Code

- `worker/src/lib/jira/finance-report.ts` — payload builder (`buildFinanceIssuePayload`, `getFinanceConfig`)
- `worker/src/lib/integrations.ts` — `createFinanceReportIssue()` and `createJiraIssueLink()`
- `worker/src/processor.ts` — non-blocking call after job completion
