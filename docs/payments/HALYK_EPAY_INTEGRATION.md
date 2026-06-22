# Halyk ePay Integration

## Architecture

1-step card payment via Halyk hosted payment page (`halyk.pay()`).  
WPO never handles card data. All card entry happens on Halyk's domain.

### Sequence

```
User clicks Pay
  → POST /api/documents/upload-card (creates job in payment_pending)
  → User sees price, clicks "Pay by card"
  → POST /api/payments/halyk/initiate
      ├─ verifies session + order ownership
      ├─ reads amount from jobs.price_kzt (DB-authoritative)
      ├─ generates invoiceID (15 digits, crypto-secure)
      ├─ generates secret_hash (32 random bytes, stores SHA-256 digest only)
      ├─ creates payment_transactions row (status=payment_pending)
      ├─ calls Halyk OAuth to get payment token
      └─ returns HalykPayBootstrap (no client_secret)
  → Frontend calls window.halyk.pay(paymentObject)
  → User completes payment on Halyk hosted page
  → Halyk calls POST /api/payments/halyk/callback (postLink)
      ├─ parses body (json or form-encoded)
      ├─ finds payment by invoiceId
      ├─ verifies secret_hash digest (constant-time)
      ├─ verifies terminal, amount, currency
      ├─ calls Halyk Status API (authoritative)
      ├─ on CHARGE: calls finalize_halyk_payment RPC (atomic row-lock)
      │     ├─ marks payment paid
      │     ├─ moves job from payment_pending → queued
      │     └─ detects duplicate charges (sets duplicate_charge_review)
      └─ returns 200 to Halyk
  → User redirected to /[locale]/payment/result?payment={paymentId}
      ├─ polls GET /api/payments/halyk/status/{paymentId}
      └─ shows paid/failed/processing UI
  → Railway worker picks up queued job and processes it
  → Every 15 min: GET /api/cron/reconcile-payments checks pending transactions
```

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `HALYK_EPAY_ENABLED` | yes | `true` to enable card payments |
| `HALYK_EPAY_MODE` | yes | `test` or `production` |
| `HALYK_EPAY_CLIENT_ID` | yes | OAuth client ID from Halyk |
| `HALYK_EPAY_CLIENT_SECRET` | yes | OAuth client secret (never exposed to browser) |
| `HALYK_EPAY_TERMINAL_ID` | yes | Terminal ID from Halyk |
| `APP_BASE_URL` | yes | HTTPS base URL for building callback URLs |
| `CRON_SECRET` | yes | Shared secret for Vercel Cron auth |

## Endpoints (Test)

| Purpose | URL |
|---|---|
| OAuth token | `https://test-epay-oauth.epayment.kz/oauth2/token` |
| Status API | `https://test-epay-api.epayment.kz/check-status/payment/transaction/{invoiceId}` |
| Payment script | `https://test-epay.epayment.kz/payform/payment-api.js` |

## Endpoints (Production)

| Purpose | URL |
|---|---|
| OAuth token | `https://epay-oauth.homebank.kz/oauth2/token` |
| Status API | `https://epay-api.homebank.kz/check-status/payment/transaction/{invoiceId}` |
| Payment script | `https://epay.homebank.kz/payform/payment-api.js` |

All endpoints selected centrally in `src/lib/payments/halyk/config.ts`.

## Routes

| Method | Path | Description |
|---|---|---|
| POST | `/api/documents/upload-card` | Upload document for card payment (creates payment_pending job) |
| POST | `/api/payments/halyk/initiate` | Initiate payment (auth required) |
| POST | `/api/payments/halyk/callback` | Halyk postLink (public, no session) |
| GET | `/api/payments/halyk/status/{paymentId}` | Internal status check (auth required) |
| GET | `/api/cron/reconcile-payments` | Reconciliation cron (CRON_SECRET) |

## Database Fields

### jobs (new)
- `status = 'payment_pending'` — new status before card payment is confirmed
- `price_kzt INTEGER` — authoritative price in KZT

### payment_transactions (extended)
- `payment_source` — `card_payment`
- `provider_invoice_id` — Halyk invoiceID (15 digits, UNIQUE)
- `provider_invoice_suffix6` — last 6 digits (UNIQUE)
- `secret_hash_digest` — SHA-256(secret_hash). Raw secret never stored.
- `provider_environment` — `test` or `production`
- `card_mask`, `card_type`, `issuer`, `approval_code`, `reference`, `secure` — for dispute handling
- `paid_at`, `failed_at`, `callback_received_at`, `status_checked_at`
- `provider_payload` — sanitised Halyk response fields (no PAN, no CVV)

### Supabase RPC
`finalize_halyk_payment(p_invoice_id, ...)` — atomic row-locked finalization.  
SECURITY DEFINER, search_path=public. EXECUTE granted only to service_role.

## Status Mapping

| Halyk resultCode | statusName | Internal status |
|---|---|---|
| 100 | CHARGE | `paid` |
| 100 | REFUND | `refunded` |
| 100 | CANCEL / CANCEL_OLD | `canceled` |
| 100 | FAILED / REJECT / 3D | `failed` |
| 100 | NEW / FINGERPRINT | `payment_pending` |
| 100 | AUTH | `requires_review` (unexpected in 1-step) |
| 100 | unknown | `requires_review` |
| 107 | any | `payment_pending` |
| 102 | any | `payment_pending` |
| 103 | any | `requires_review` |
| other | any | `requires_review` |

**Only `CHARGE` → `paid` triggers job activation.**

## Security Controls

- `client_secret` — never sent to browser, never logged, not in Sentry payloads
- `secret_hash` — passed to Halyk once; only SHA-256 digest stored
- Amount — read exclusively from `jobs.price_kzt`; client amount ignored
- Callback — protected by secret_hash verification (constant-time) + Halyk Status API
- Redirect result — never used to mark payment paid
- Duplicate CHARGE — stored as `duplicate_charge_review`; operator alerted
- Atomic finalization — PostgreSQL row lock via RPC
- RLS — no browser INSERT into `payment_transactions`
- Rate limiting — inherits middleware 10 req/min per IP

## Pricing (KZT)

| Service level | Price |
|---|---|
| `electronic` | 1 999 KZT |
| `official_with_translator_signature_and_provider_stamp` | 3 999 KZT |
| `notarization_through_partners` | 6 999 KZT |

Defined in `src/lib/payments/halyk/pricing.ts`.

## Staging Test Procedure

1. Set env vars in Vercel Preview:
   - `HALYK_EPAY_ENABLED=true`
   - `HALYK_EPAY_MODE=test`
   - `HALYK_EPAY_CLIENT_ID=<test client id from Halyk manager>`
   - `HALYK_EPAY_CLIENT_SECRET=<test client secret>`
   - `HALYK_EPAY_TERMINAL_ID=<test terminal id>`
   - `APP_BASE_URL=https://<staging-preview-url>`
2. Upload a test document via `/api/documents/upload-card`
3. Confirm `price_kzt` is set on the job
4. Click "Pay by card" → confirm Halyk payment page opens
5. Use test card from https://epayment.kz/docs/Test-credentials
6. Confirm redirect to `/payment/result`
7. Confirm `payment_transactions.status = 'paid'` and `jobs.status = 'queued'`
8. Confirm callback was received (`callback_received_at` set)
9. Send duplicate callback — confirm idempotent (no double processing)
10. Use a decline test card — confirm `payment_transactions.status = 'failed'`
11. Check browser network — confirm no `client_secret` in any response
12. Check Sentry — confirm no secrets in error payloads

## Production Checklist (Prerequisites from Halyk Bank)

Before switching `HALYK_EPAY_MODE=production`:

- [ ] Production ClientID from Halyk
- [ ] Production ClientSecret from Halyk
- [ ] Production TerminalID from Halyk — confirm 1-step (not 2-step DMS)
- [ ] Callback URL allowlisted at Halyk (`https://wpotranslations.org/api/payments/halyk/callback`)
- [ ] Production domain allowlisted at Halyk
- [ ] Payment page branding/logo approved by Halyk
- [ ] Halyk / Visa / Mastercard logos on checkout page
- [ ] 3D Secure tested end-to-end
- [ ] Legal: merchant address, BIN/IIN visible on site
- [ ] Refund/support contact defined
- [ ] Successful staging QA completed
- [ ] Monitoring alerts configured
- [ ] Operator Telegram channel for `duplicate_charge_review` alerts configured
- [ ] Accountant/operator confirmed refund workflow
- [ ] Reconciliation cron verified on staging

## Rollback / Disable

To immediately disable card payments without code change:

```
HALYK_EPAY_ENABLED=false
```

The initiation route returns HTTP 503. Existing paid jobs are unaffected.

## Known Halyk Documentation Inconsistencies

- `invoiceId` vs `invoiceID` — both field name casings appear; our parser normalises
- `accountId` vs `acountId` — documented with typo; we use `accountId`
- Basic auth example in Status API docs is wrong — real access_token Bearer must be used
- `reasonCode` can be string or number — normalised to string
- `code=ok` in postLink does NOT confirm payment — Status API is authoritative
- Some Halyk environments omit optional fields in status response — all optional fields parsed with `.optional()`

## Future: Refund API

Halyk supports partial/full refund via `POST /operation/{transactionId}/refund`.  
Minimum refund: 10 KZT. Only available for `CHARGE` status.

When ready to implement:
1. Create admin-only route protected by staff_profiles + service role
2. Read `provider_transaction_id` from `payment_transactions`
3. Track `refunded_at` and partial amounts
4. Never trigger refund automatically from user-facing code

## What to Get from Halyk Manager

- Production ClientID + ClientSecret + TerminalID
- Confirm: terminal is configured for 1-step (not DMS/2-step)
- Confirm: callback URL allowlist updated for production domain
- Confirm: test credentials for staging (separate from production)
- Confirm: which 3DS version is configured
- Signed merchant agreement
