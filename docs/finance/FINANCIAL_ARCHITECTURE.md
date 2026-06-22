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
