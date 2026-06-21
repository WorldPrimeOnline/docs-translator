# Fiscalization — Fiscal Receipt Architecture

## Overview

Kazakhstan law requires fiscal receipts for card payments. WPO uses a provider-abstracted
fiscal receipt system. Currently only `manual` mode is implemented — the operator issues
receipts via the OFD provider's web cabinet.

## When a Fiscal Receipt Is Created

1. Halyk ePay callback receives CHARGE status.
2. `finalize_halyk_payment` RPC atomically marks payment as `paid` and job as `queued`.
3. `createSaleReceiptForPayment()` is called non-blocking (in `void`).
4. A `fiscal_receipts` row is inserted with `status = 'pending'`.
5. The configured provider adapter is called:
   - **`manual`**: no API call. Status set to `pending_manual`.
   - **Real provider** (future): API called; status set to `issued` or `failed`.
6. Fiscal failure does **not** block job processing. Job proceeds to worker queue.

The same hook fires from `GET /api/cron/reconcile-payments` for payments confirmed via
reconciliation (e.g., if the postLink callback failed).

## Sale Receipt Flow

```
Payment CHARGE confirmed
  → createSaleReceiptForPayment(paymentTransactionId)
      ├─ Check existing receipt (idempotency: unique constraint on payment_transaction_id + operation_type=sale)
      ├─ Load payment transaction (amount, customer email)
      ├─ INSERT fiscal_receipts (status='pending')
      ├─ Call provider.createSaleReceipt()
      │     └─ manual: returns status='pending_manual'
      └─ UPDATE fiscal_receipts with provider result
```

## Refund Receipt Flow

```
Refund confirmed (status='succeeded')
  → createRefundReceiptForRefund(refundTransactionId, ...)
      ├─ INSERT fiscal_receipts (operation_type='refund', status='pending')
      ├─ Call provider.createRefundReceipt()
      │     └─ manual: returns status='pending_manual'
      └─ UPDATE fiscal_receipts + refund_transactions.fiscal_refund_receipt_id
```

## pending_manual Mode

When `FISCALIZATION_ENABLED=false` or `FISCAL_PROVIDER=manual`:

- Every receipt is created with `status = 'pending_manual'`.
- No external API is called.
- The operator sees items in `fiscal_receipts WHERE status = 'pending_manual'`.
- The customer sees: "Payment confirmed. A receipt will be sent separately." (not a fake receipt).
- Operator issues the receipt manually via the OFD provider's web cabinet.
- After issuing manually: update `fiscal_receipts SET status='issued', fiscal_url=..., issued_at=NOW()`.

## Provider Abstraction

`src/lib/fiscal/` structure:
- `types.ts` — `FiscalProvider` interface, `FiscalSaleInput`, `FiscalRefundInput`, `FiscalReceiptResult`
- `config.ts` — reads `FISCAL_PROVIDER`, `FISCALIZATION_ENABLED`, `FISCAL_PROVIDER_ENV`
- `provider.ts` — factory: returns configured provider instance
- `manual-provider.ts` — `ManualFiscalProvider` implementation
- `service.ts` — `createSaleReceiptForPayment()` and `createRefundReceiptForRefund()` (idempotent orchestrators)

## Adding a Real Provider

When the fiscal provider is confirmed (ReKassa, Webkassa, or other OFD):

1. Create `src/lib/fiscal/rekassa-provider.ts` implementing `FiscalProvider`.
2. Add `'rekassa'` to `FiscalProviderName` in `config.ts`.
3. Add branch in `provider.ts` factory.
4. Set env: `FISCALIZATION_ENABLED=true`, `FISCAL_PROVIDER=rekassa`, and provider credentials.
5. Confirm with accountant: OFD registration, cashbox serial, BIN.

Required env vars per provider (add to `.env.example` when provider is known):

```
FISCAL_API_BASE_URL=
FISCAL_CLIENT_ID=            # or FISCAL_API_KEY, FISCAL_LOGIN — depends on provider
FISCAL_API_KEY=
FISCAL_CASHBOX_ID=           # KKM serial number
FISCAL_OFD_ID=               # OFD operator identifier
FISCAL_TAXPAYER_ID=          # ИИН/БИН of the legal entity
FISCAL_BUSINESS_ID=          # provider-specific
```

## What Is Stored

`fiscal_receipts` table (migration `0017_fiscal_receipts.sql`):

| Column | Description |
|---|---|
| `payment_transaction_id` | FK to `payment_transactions.id` |
| `operation_type` | `sale` / `refund` / `correction` |
| `status` | `pending_manual` / `issued` / `failed` / etc. |
| `amount_kzt` | Positive integer (whole tenge) |
| `fiscal_url` | Public URL to receipt (null for pending_manual) |
| `provider_receipt_id` | Provider-assigned ID (null for pending_manual) |
| `receipt_payload_sanitized` | Request sent to provider (no card data) |
| `provider_response_sanitized` | Provider response (no card data) |
| `customer_email` | For receipt delivery |

**Not stored**: card number (PAN), CVV, full card name. Only `card_mask` is in `payment_transactions`.

## Idempotency

One sale receipt per `payment_transaction_id` (UNIQUE index on `(payment_transaction_id)
WHERE operation_type = 'sale'`).

If `createSaleReceiptForPayment` is called twice (e.g., duplicate callback), the second
call finds the existing receipt and returns it immediately without creating a duplicate.

## Reconciliation

The Railway worker runs `reconcileFiscalAndRefunds()` every 5 minutes.
- Finds `fiscal_receipts` with `status IN ('pending', 'failed', 'retry_required')` not
  updated in the last 5 minutes.
- Logs them for operator attention.
- With a real provider: would retry the API call.
- Increments `retry_count` and updates `updated_at` to throttle repeat logging.

## Operator Queries

```sql
-- All receipts needing manual issuance
SELECT fr.id, fr.amount_kzt, fr.operation_type, fr.created_at,
       pt.provider_transaction_id, j.id AS job_id
FROM fiscal_receipts fr
JOIN payment_transactions pt ON pt.id = fr.payment_transaction_id
JOIN jobs j ON j.id = fr.job_id
WHERE fr.status = 'pending_manual'
ORDER BY fr.created_at;

-- Recently issued receipts
SELECT id, fiscal_url, amount_kzt, issued_at
FROM fiscal_receipts
WHERE status = 'issued'
ORDER BY issued_at DESC
LIMIT 20;
```

## What to Confirm with Accountant

Before enabling a real provider:

1. Which OFD is registered and licensed for the entity ИИН/БИН `840324300155`.
2. Whether electronic card payments require KKM registration (yes, per KZ tax law).
3. Correct receipt format: item name, quantity, price, tax category.
4. Refund/correction receipt requirements.
5. OFD fiscal data transmission frequency (usually daily).
6. Physical or virtual KKM registration.
