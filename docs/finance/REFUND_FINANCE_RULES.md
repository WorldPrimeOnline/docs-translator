# Refund Finance Rules

Refunds are operator-initiated only. Customers have no self-serve refund endpoint.

## Policy Cases

| Case | Trigger condition | Refundable % | Operator approval required |
|---|---|---|---|
| `duplicate_charge` | `isDuplicateCharge = true` | 100% | No |
| `payment_failed` | `payment.status = 'failed'` | 100% | No |
| `before_payment` | `payment.status = 'payment_pending'` | 100% | No |
| `paid_before_processing` | job status = `queued` or `payment_pending` | 100% | No |
| `processing_started` | job status = `ocr_in_progress`, `ocr_completed`, `translation_in_progress`, `pdf_rendering` | 80% | Yes |
| `translator_assigned` | `workflow_status` in `awaiting_translator_review`, `translator_approved`, `awaiting_signature_stamp` | 50% | Yes |
| `notary_started` | `workflow_status` in `notarization_in_progress`, `assigned_to_notary` | 0% (exception only) | Yes |
| `delivered` | `workflow_status` in `delivered`, `picked_up`, `out_for_delivery`, `ready_for_delivery`, `ready_for_pickup`, `notarized` | 0% | — |
| `exception_only` | job `completed` or `failed`, or subscription payment source | 0% | — |

## Amount Calculation

```
grossRefundable = paymentAmount × refundPercentage
netRefundable = grossRefundable - existingRefundsTotalKzt
finalRefundable = max(0, netRefundable)
```

If `finalRefundable = 0`, `isRefundable = false`.

## Code Location

- `src/lib/pricing/refund-policy.ts` — `calculateRefundEligibility(input)`
- `src/lib/refunds/service.ts` — `initiateRefund(request)`
- `supabase/migrations/0023_extend_payment_refund.sql` — `refund_policy_case` column, `approval_status`
- Admin API: `POST /api/admin/payments/refund`

## Operator Workflow

1. Run `npx tsx scripts/finance/list-refundable-payments.ts` to find eligible payments.
2. Call `POST /api/admin/payments/refund` with `{ paymentTransactionId, refundAmountKzt, reason }`.
3. Service creates a `refund_transactions` row with `status = pending_manual`.
4. Operator processes manually in Halyk merchant cabinet.
5. Update row status to `succeeded` or `failed` once confirmed.
