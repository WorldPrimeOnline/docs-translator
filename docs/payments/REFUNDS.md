# Refunds — Operator Process

## Current Status

**No automatic refund API is integrated.** All refunds are processed manually by the operator
via the Halyk merchant cabinet. The Halyk refund API (`POST /operation/{transactionId}/refund`)
exists but is not yet implemented in code.

The `admin` API endpoint (`POST /api/admin/payments/refund`) returns **501** until
admin authentication is implemented.

## Refund Policy (Legal)

See `src/lib/legal/content/en.ts` (refund-policy section) for the customer-facing policy.

Summary:
- Full refund if cancellation requested before processing begins.
- No refund once OCR/translation/PDF generation or translator handoff has started.
- Refund for demonstrable technical errors (delivery failure, corruption).
- No refund for poor source document quality or dissatisfaction with style.

## Manual Operator Refund Process

### Step 1: Identify and validate

```sql
-- Find payment
SELECT pt.id, pt.amount, pt.status, pt.provider_transaction_id,
       pt.card_mask, pt.paid_at, j.id AS job_id, j.status AS job_status
FROM payment_transactions pt
JOIN jobs j ON j.id = pt.job_id
WHERE pt.id = '<payment_transaction_id>';

-- Check refundable amount
SELECT * FROM get_refundable_amount('<payment_transaction_id>');
```

Must confirm:
- `payment_transactions.status = 'paid'`
- `provider_transaction_id` is set (needed for Halyk cabinet)
- Refundable amount ≥ requested amount

### Step 2: Create refund record

```sql
INSERT INTO refund_transactions (
  job_id,
  payment_transaction_id,
  provider,
  provider_environment,
  refund_amount_kzt,
  currency,
  status,
  reason,
  operator_id,
  idempotency_key
) VALUES (
  '<job_id>',
  '<payment_transaction_id>',
  'halyk_epay',
  'production',            -- or 'test' on staging
  <amount>,
  'KZT',
  'pending_manual',
  '<reason>',
  '<operator_email>',
  gen_random_uuid()
);
```

### Step 3: Process via Halyk merchant cabinet

1. Log into [Halyk merchant cabinet](https://epay.homebank.kz) (production) or
   [test cabinet](https://test-epay.epayment.kz).
2. Find transaction by `provider_transaction_id`.
3. Initiate refund. Minimum: 10 KZT. Partial refunds allowed.
4. Note the Halyk refund transaction ID returned by the cabinet.

### Step 4: Update refund record

```sql
UPDATE refund_transactions
SET
  status = 'succeeded',
  provider_refund_id = '<halyk_refund_transaction_id>',
  processed_at = NOW(),
  provider_response_sanitized = '{"source": "manual_cabinet", "confirmed": true}',
  updated_at = NOW()
WHERE id = '<refund_transaction_id>';

-- Mark payment as refunded
UPDATE payment_transactions
SET
  status = 'refunded',
  refunded_at = NOW(),
  updated_at = NOW()
WHERE id = '<payment_transaction_id>';
```

### Step 5: Fiscal correction receipt

Issue a correction/refund receipt via the OFD cabinet (when fiscal provider is configured).
Until then, issue manually via provider's web interface.

```sql
-- After issuing fiscal correction:
UPDATE fiscal_receipts
SET
  status = 'issued',
  fiscal_url = '<correction_receipt_url>',
  issued_at = NOW(),
  updated_at = NOW()
WHERE payment_transaction_id = '<payment_transaction_id>'
  AND operation_type = 'refund';
```

### Step 6: Notify customer

Send refund confirmation to customer via `worldprimeonline@gmail.com` or Telegram.
Include:
- Amount refunded
- Original payment date
- Reason
- Bank processing time (typically 3–10 business days)

## DB Status Reference

### refund_transactions.status

| Status | Meaning |
|---|---|
| `requested` | Operator created the request; not yet sent |
| `pending` | Sent to Halyk API; awaiting confirmation |
| `succeeded` | Halyk confirmed refund |
| `failed` | Halyk returned error |
| `requires_review` | Ambiguous response; needs investigation |
| `pending_manual` | No Halyk API; operator must process via cabinet |
| `canceled` | Operator canceled before processing |

### payment_transactions.status (after refund)

| Status | Meaning |
|---|---|
| `refund_pending` | Refund initiated but not yet confirmed |
| `refunded` | Refund fully confirmed |

## Audit Log Queries

```sql
-- All refund transactions
SELECT rt.id, rt.refund_amount_kzt, rt.status, rt.reason,
       rt.operator_id, rt.created_at, rt.processed_at
FROM refund_transactions rt
WHERE rt.payment_transaction_id = '<id>'
ORDER BY rt.created_at;

-- Pending manual refunds
SELECT rt.id, rt.refund_amount_kzt, rt.reason, rt.created_at,
       pt.provider_transaction_id
FROM refund_transactions rt
JOIN payment_transactions pt ON pt.id = rt.payment_transaction_id
WHERE rt.status = 'pending_manual'
ORDER BY rt.created_at;
```

## Implementing Halyk Refund API (Future)

When ready to implement the Halyk refund API:

1. Create `src/lib/payments/halyk/refund-client.ts`:
   - `POST /operation/{transactionId}/refund`
   - Requires OAuth token (same as payment flow)
   - Body: `{ amount, currency, reason }` (partial refund supported)
   - Minimum refund: 10 KZT
   - Only CHARGE transactions are refundable

2. Add `initiateHalykRefund(providerTransactionId, amountKzt)` function.

3. Update `src/lib/refunds/service.ts` to call the real adapter.

4. Enable `POST /api/admin/payments/refund` with proper admin auth:
   - Check `staff_profiles.role IN ('operator', 'admin')`
   - Validate session ownership
   - Write to `job_audit_log`

5. Test with minimum refund (10 KZT) on staging before production.

## What NOT to Do

- Do not expose a public customer-facing refund button without operator approval.
- Do not automatically refund on job failure — only after operator review.
- Do not call the Halyk refund API before the payment `provider_transaction_id` is confirmed.
- Do not mark `refund_transactions.status='succeeded'` without Halyk confirmation.
- Do not issue a fiscal refund receipt before the financial refund is confirmed.
