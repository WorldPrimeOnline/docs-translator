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

Reference docs: `docs/finance/FINANCIAL_ARCHITECTURE.md`, `docs/finance/PRICING_ENGINE.md`, `docs/finance/REFUND_FINANCE_RULES.md`, `docs/finance/UNIT_ECONOMICS.md`.

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

## Worker fiscal reconciliation

`worker/src/lib/fiscal-reconciliation.ts`:
- `reconcileFiscalAndRefunds()` — every 5 min: logs pending/failed fiscal_receipts and refund_transactions for operator attention
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
