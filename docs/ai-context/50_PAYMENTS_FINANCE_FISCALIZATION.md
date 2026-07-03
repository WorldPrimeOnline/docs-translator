# Payments, Finance, and Fiscalization

## Current payment state

**Subscription-only active; no active card payment gateway.**
- `src/lib/stripe/` and `src/lib/polar/` are empty placeholder directories.
- `POST /api/subscriptions/create` returns HTTP 503 ("temporarily unavailable").
- The subscription modal shows a "coming soon" message.
- `jobs.payment_source` column: `'card_payment' | 'subscription'` — TON cryptocurrency payments are fully removed.

## Halyk Bank ePay (card payments in KZT)

The integration is fully implemented in `src/lib/payments/halyk/` (client, config, invoice, pricing, security, status-map, locale, types).

**Currently gated** by `BUSINESS_PROFILE.cardPaymentsActive` in `src/lib/business-profile.ts` (currently `false` — set to `true` only after Halyk credentials are added to env and end-to-end tested).

API routes:
- `POST /api/payments/halyk/initiate` — initiate payment, returns redirect URL
- `POST /api/payments/halyk/callback` — payment result callback, updates job payment status
- `POST /api/documents/upload-card` — card-payment upload path
- `GET /api/cron/reconcile-payments` — reconciles payment_pending/requires_review → paid (triggered by Railway worker every 15 min, NOT by vercel.json — Hobby plan limit)
- `GET /api/cron/reconcile-refunds` — detects Halyk cabinet operator refunds on paid transactions (triggered by Railway worker every 30 min)

**Cron architecture note**: `vercel.json` only has one cron (`/api/cron/cleanup`, daily). Payment and refund cron endpoints are HTTP routes authenticated with `CRON_SECRET Bearer` token, triggered by the Railway worker on schedule. Worker must have `CRON_SECRET` and `SITE_URL` set.

**Known production incidents fixed (2026-07-01)**:
- `provider_transaction_id=null`: Halyk callback payload uses `id` field, not `transactionId`. Fixed with `transactionId ?? transaction?.id ?? null` in all three finalization paths (callback, status endpoint, reconcile-payments cron).
- `payment_transactions.updated_at` missing: `finalize_halyk_payment` RPC failed on production. Migration 0040 adds the column idempotently.
- `jobs.status` constraint missing `refunded`/`canceled`: Migration 0041 extends the constraint.

`src/components/payment/PaymentComplianceBlock.tsx` wording switches on `cardPaymentsActive`. Do not add code to the stripe/polar directories without being asked.

## Subscription plans (KZT pricing)

`SUBSCRIPTION_PLANS` in `src/lib/subscriptions/config.ts`:
- Basic: 4990 KZT/mo (10 docs)
- Pro: 12990 KZT/mo (40 docs)
- Duration: 30 days
- `documents_used` is incremented atomically in the upload route before creating the job.

Two job-creation entry points:
- `POST /api/documents/upload` — subscription path
- `POST /api/documents/upload-card` — card payment path

## Financial architecture (quote-based pricing)

**Key rule**: `payment_transactions.amount` is always read from `price_quotes.amount_kzt`. Client-provided amounts are **never** used. Quotes expire in 24 h.

### Payment flow

```
Upload request
  → computeQuoteForJob()     — src/lib/pricing/service.ts
  → saveQuote()              — inserts price_quotes, price_quote_items, cost_reservations
  → job.price_kzt = quote.amount_kzt

Payment initiation
  → verifyQuotePayable()     — quote belongs to user/job, not expired, status=quoted
  → payment_transactions row with amount_source='quote', quote_id=...
  → markQuotePaymentPending()

Payment confirmation (Halyk callback)
  → markQuotePaid()          — commits cost_reservations, status=paid
  → ensureSaleFiscalReceiptForPaidPayment()
```

### Pricing engine

`src/lib/pricing/calculator.ts`: language group → base minimum → extra words (beyond 250) → additional pages (beyond 1) → document type coefficient → urgency coefficient → notary components. All in KZT, rounded up to nearest 100 KZT. 17 language groups defined in `src/lib/pricing/config.ts`.

**Margin floor (added 2026-07-03)**: every standard quote must clear `estimated_margin_rate >= 50%` after ALL internal costs/reserves (translator, notary, courier, printing, AI/IT, tax, acquiring, risk, owner, marketing/partner commission — notary/courier/printing count as real costs, not excluded pass-throughs). If the raw price falls short, `calculatePrice()` automatically raises the price via a `margin_floor_adjustment` line item (never shown to the client, never blocks checkout). Given current unit-economics rates, this binds for most standard orders — see `docs/finance/UNIT_ECONOMICS.md` and `docs/ai-context/DECISIONS.md` (2026-07-03).

Reference docs: `docs/finance/FINANCIAL_ARCHITECTURE.md`, `docs/finance/PRICING_ENGINE.md`, `docs/finance/REFUND_FINANCE_RULES.md`, `docs/finance/UNIT_ECONOMICS.md`.

**Internal AI Translation Test Lab** (`tools/internal-ai-test-lab/`) exercises `computeQuoteForJob()` read-only for pricing testing — it never calls `saveQuote()` and never writes `price_quotes`/`cost_reservations`. It is not a payment bypass and is unrelated to `scripts/staging/confirm-payment-paid.ts`. See `docs/ai-context/DECISIONS.md` (2026-07-02) and `tools/internal-ai-test-lab/README.md`.

## Fiscalization (KZ tax law)

KZ tax law requires fiscal receipts for card payments. `src/lib/fiscal/` is a provider-abstracted system:
- `types.ts` — interface
- `config.ts` — reads env
- `provider.ts` — factory
- `manual-provider.ts`
- `webkassa-provider.ts` + `webkassa-client.ts`

### Service orchestration (`service.ts`)

- `createSaleReceiptForPayment(paymentTransactionId)` — called non-blocking after Halyk CHARGE confirms
- `createRefundReceiptForRefund(...)` — called after refund is logged

Both are **idempotent** (unique constraint on `(payment_transaction_id, operation_type)` in `fiscal_receipts`) and **non-blocking** (fiscal failure never throws to the caller).

### Current mode

`FISCAL_PROVIDER=manual` → every receipt gets `status = pending_manual`; operator issues manually via OFD web cabinet.

Webkassa provider is implemented but gated by `FISCALIZATION_ENABLED=true` + `FISCAL_PROVIDER=webkassa`.

Env vars: `FISCAL_PROVIDER` (`manual`|`webkassa`), `FISCALIZATION_ENABLED` (`true`/`false`), `FISCAL_PROVIDER_ENV` (`test`/`production`).

See `docs/payments/FISCALIZATION.md` for operator queries and provider onboarding steps.

## Refunds

Operator-initiated only; no customer-facing endpoint.

`src/lib/refunds/service.ts`: `initiateRefund(request)` validates the refundable amount (via Supabase RPC `get_refundable_amount`), creates a `refund_transactions` row with `status = pending_manual`, then calls `createRefundReceiptForRefund`. Halyk refund API not yet integrated — operator must process manually via Halyk merchant cabinet.

**Halyk cabinet refund reconciliation**: `GET /api/cron/reconcile-refunds` checks paid transactions via Halyk Status API, detects REFUND/CANCEL/CANCEL_OLD statusNames, marks payment/job as `refunded`, creates idempotent `refund_transactions` row, queues fiscal refund receipt (only if sale receipt exists). Triggered from Railway worker every 30 min.

**Refunded status in jobs**: `jobs.status` now includes `'refunded'` and `'canceled'` (migration 0041). `customer-order-state.ts` maps these to terminal, non-downloadable states. Dashboard shows a grey badge.

Admin API routes:
- `POST /api/admin/payments/refund`
- `POST /api/admin/payments/[paymentId]/refunds`

**Recovery script**: `scripts/recover-payments.ts` — DRY_RUN=true by default. Diagnoses broken paid payments (missing Jira, stuck jobs, Halyk cabinet refunds) and repairs them. Usage: `DRY_RUN=false INVOICE_ID=<id> RECONCILE_REFUND=true npx tsx scripts/recover-payments.ts`

See `docs/payments/REFUNDS.md`.

## Worker fiscal processing (Webkassa sequential queue)

**Architecture change (2026-07-01)**: Webkassa calls are no longer made from Vercel serverless.
Web app creates `fiscal_receipts` row with `status='pending'`; Railway worker processes it.

**Reason**: Webkassa requires sequential requests per cashbox ("запросы по кассе должны отправляться последовательно"). Multiple Vercel instances could send parallel requests; Railway worker is a single long-running process.

### Sequential guarantee (two-layer lock)

`worker/src/lib/fiscal-processor.ts`:
1. **In-process async queue** (`Map<cashboxId, Promise>`) — one request at a time within one Railway instance
2. **Postgres lock table** (`fiscal_cashbox_locks`) — prevents two Railway instances from running concurrently

`processPendingFiscalReceipts()` is called every 5 min from `reconcileFiscalAndRefunds()`.

### Webkassa API methods used

- `POST /api/v4/Authorize` — token acquisition (cached)
- `POST /api/v4/check` — sale (OperationType=2) and sale_return (OperationType=3)
- `POST /api/v4/ZReport` — Z-report / shift close (body uses **lowercase** `cashboxUniqueNumber`)

Error handling:
- Code 14 (DUPLICATE_EXTERNAL_NUMBER) → idempotent success (uses payment_transaction_id as ExternalCheckNumber)
- Code 12/13 (SHIFT_ALREADY_CLOSED / NO_OPEN_SHIFT) in Z-report → `already_closed` success
- Code 2 (session expired) → re-auth and retry once
- Codes 10, 18 → permanent failure (non-retryable)
- Network/timeout errors → `retry_required` (up to MAX_RETRY_COUNT=3)

### Z-report (shift close)

`worker/src/lib/fiscal-z-report.ts`:
- `maybeRunScheduledZReport()` — runs daily at `WEBKASSA_Z_REPORT_HOUR` (default 23) in `WEBKASSA_Z_REPORT_TIMEZONE` (default Asia/Almaty)
- **Guard**: skips if any `pending`/`retry_required` fiscal_receipts exist for the cashbox
- **Idempotency**: `UNIQUE(cashbox_id, business_date)` in `fiscal_z_reports` table
- Called from `reconcileFiscalAndRefunds()` AFTER `processPendingFiscalReceipts()`
- `forceRunZReport()` — force run regardless of scheduled hour (for manual operator triggers)

### DB tables (new)

- `fiscal_cashbox_locks` (migration 0042) — distributed per-cashbox lock
- `fiscal_z_reports` (migration 0043) — Z-report results, UNIQUE per cashbox/date

### Production env vars (Railway worker, Webkassa)

```
WEBKASSA_ENABLED=true
WEBKASSA_API_BASE_URL=https://api.webkassa.kz
WEBKASSA_API_KEY=<production API key>
WEBKASSA_LOGIN=<production login>
WEBKASSA_PASSWORD=<production password>
WEBKASSA_CASHBOX_SERIAL_NUMBER=<ZNK serial number>
WEBKASSA_ALLOW_REAL_RECEIPTS=true
FISCAL_PROVIDER_ENV=production
WEBKASSA_Z_REPORT_ENABLED=true
WEBKASSA_Z_REPORT_TIMEZONE=Asia/Almaty
WEBKASSA_Z_REPORT_HOUR=23
WORKER_INSTANCE_ID=railway-worker-prod-1
```

Test cashbox (devkkm): ZNK=SWK00035686, URL=https://devkkm.webkassa.kz

**Correction (2026-07-01):** production base URL is `https://api.webkassa.kz`, per WK Corp FAQ ("API-сервер: api.webkassa.kz/api/v4") — NOT `kkm.webkassa.kz`. The wrong host was briefly used as the production default and caused `ERR_SSL_WRONG_SIGNATURE_TYPE` (TLS handshake failure — the host doesn't serve a valid cert for that API). `worker/src/index.ts`, `fiscal-processor.ts`, and `fiscal-z-report.ts` all default to `api.webkassa.kz` when `FISCAL_PROVIDER_ENV=production` and `WEBKASSA_API_BASE_URL` is unset.

Integration test script: `npx tsx scripts/fiscal/test-devkkm.ts` (requires test credentials in env).

### Operator recovery

If fiscal_receipts stuck in `retry_required`: set `retry_count=0` and `status='pending'` to re-queue.
If `fiscal_cashbox_locks` row is stale (worker crashed): DELETE from `fiscal_cashbox_locks` WHERE `expires_at < NOW()`.

## Worker reconciliation (payment/refund crons)

`worker/src/lib/fiscal-reconciliation.ts`:
- `reconcileFiscalAndRefunds()` — every 5 min: processes pending fiscal receipts via sequential queue, then runs Z-report if scheduled, logs stale `failed`/`pending_manual` items for operator
- `triggerReconcilePayments()` — every 15 min: calls Next.js `/api/cron/reconcile-payments` via HTTP (CRON_SECRET auth)
- `triggerReconcileRefunds()` — every 30 min: calls Next.js `/api/cron/reconcile-refunds` via HTTP (CRON_SECRET auth)

All three are called from `worker/src/index.ts` on separate setInterval schedules. Requires `CRON_SECRET` env var in the Railway worker.

## Reference docs

- `docs/payments/HALYK_EPAY_INTEGRATION.md`
- `docs/payments/FISCALIZATION.md`
- `docs/payments/REFUNDS.md`
- `docs/payments/PRODUCTION_READINESS.md`
- `docs/finance/FINANCIAL_ARCHITECTURE.md`
- `docs/finance/PRICING_ENGINE.md`
- `docs/finance/REFUND_FINANCE_RULES.md`
- `docs/finance/UNIT_ECONOMICS.md`
