# Payments, Finance, and Fiscalization

## Current payment state

**Halyk ePay card payments are live; subscriptions remain gated off.**
- `src/lib/stripe/` and `src/lib/polar/` are empty placeholder directories.
- `POST /api/subscriptions/create` returns HTTP 503 ("temporarily unavailable").
- The subscription modal shows a "coming soon" message.
- `jobs.payment_source` column: `'card_payment' | 'subscription'` — TON cryptocurrency payments are fully removed.

## Halyk Bank ePay (card payments in KZT)

The integration is fully implemented in `src/lib/payments/halyk/` (client, config, invoice, pricing, security, status-map, locale, types).

**Live** — `BUSINESS_PROFILE.cardPaymentsActive` in `src/lib/business-profile.ts` is `true` (2026-07-08): Halyk credentials are in env and the integration processes real payments. This only switches the "processed by" wording in `PaymentComplianceBlock`; it does not gate the payment API routes themselves.

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

## Public pre-checkout draft flow (anonymous pricing before login)

A third, pre-authentication entry point sits ahead of the two job-creation routes above: the public wizard at `/[locale]/start` computes a real KZT price via `computeQuoteForJob()` for an anonymous visitor, but does **not** insert into `price_quotes`/`jobs` at that stage — the result is cached only as a `pricing_snapshot` JSON column on a new `order_drafts` row (migration `0044`).

The draft becomes a real order only at `/[locale]/checkout` — i.e. after login, still before payment — via `convertDraftToOrder()` (`src/lib/order-drafts/service.ts`), which reuses the identical `documents` → `jobs` → `saveQuote()` insert sequence `upload-card/route.ts` already uses for logged-in orders. **`src/app/api/payments/halyk/initiate` and `/callback` are completely unmodified** — checkout renders the existing `HalykPayButton` against the resulting `jobId`/`quoteId`, exactly as the dashboard does today.

Because the job is created with `status='payment_pending'` (never `queued`), the worker's `isEligible()`/`claimNextJob()` gate cannot pick it up until the Halyk callback flips it to `queued` on real payment — so Jira/Drive/OCR/translation/notary work starts exactly when it always has, never before a paid `payment_transactions` row exists. Conversion is idempotent: `order_drafts.converted_job_id` is set via an atomic `UPDATE ... WHERE status='price_calculated'` claim, so a double-click cannot create two orders.

Anonymous draft uploads land in a temporary `draft-uploads/{draftId}/` R2 prefix (not `documents/`), capped at 20 MB total (vs. 50 MB authenticated) with a magic-byte check (`src/lib/file-validation/signature.ts`) added on top of the existing MIME/extension check. Anonymous price-calculation attempts are rate-limited at 5/hour and 20/day per session-cookie-or-IP (`anonymous_rate_limit_events` table) — see `docs/ai-context/30_ARCHITECTURE_OVERVIEW.md` Rate limiting section. Expired, unconverted drafts are swept by the existing daily `/api/cron/cleanup` route (no new Vercel cron added).

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

**Margin floor, layered model with pooled notary coordination fee (2026-07-04, final; supersedes both the 2026-07-03 whole-order version and the first layered-model correction)**: the **WPO marginable revenue pool** — translation/service layer price + `notary_coordination_fee` (both WPO-controlled revenue) — must clear `wpoServiceMarginRate >= 50%` after the pool's own costs (translator, AI/IT, notary coordination internal cost, owner reserve, marketing/CAC). `notary_official_fee`, printing, and courier are separate pass-through add-ons **never** grossed up by this floor. `notary_coordination_fee` is a fixed 5 000 KZT WPO commercial fee (`NOTARY_CONFIG.notaryCoordinationFeeDefault`) — WPO **revenue**, not a pass-through cost; its internal cost is config-driven (`NOTARY_CONFIG.notaryCoordinationInternalCostKzt`, currently 0), and because it's fixed and never itself adjusted, folding it into the pool means the translation layer usually needs little or no floor adjustment. `BASE_MINIMUM_KZT[group].notarization_through_partners` is derived from the official tier for the same group — notarization is not a separate, independently-priced translation base. Payment-wide fees (tax, acquiring, risk, referral partner commission) apply once to the whole final client price, recomputed against the true final rounded price. Blended (whole-order) margin is reported but **not** floor-guaranteed for notarized orders — expected to sit below the WPO marginable margin due to real pass-through dilution. `notary_official_fee = notary_mrp_value_kzt × notary_mrp_coefficient` (currently 4 325 × 0.53 = 2 292.25 → 2 292 KZT); the MRP fallback (`NOTARY_CONFIG.mrpValueFallbackKzt`) is 4 325 KZT, but the live `pricing_versions.mrp_value` DB column may still be stale — see `docs/ai-context/DECISIONS.md` (2026-07-04 entries) for verification SQL and `scripts/staging/verify-notary-mrp-value.ts` for a guarded check script. Current fixture baseline: electronic 1 500 KZT, official (passport) 6 200 KZT, official (employment_document) 22 200 KZT, notarized pickup 15 000 KZT, notarized delivery 21 000 KZT — pricing-engine fixture outputs, not a public price list. See `docs/finance/UNIT_ECONOMICS.md` and `docs/finance/PRICING_ENGINE.md` §§7–11.

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
