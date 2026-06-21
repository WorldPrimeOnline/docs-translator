# Production Readiness Checklist — Card Payments

This document must be completed before switching `HALYK_EPAY_MODE=production`.

## 1. Halyk Bank Credentials

- [ ] Production ClientID received from Halyk Bank manager
- [ ] Production ClientSecret received (never commit — set in Vercel env only)
- [ ] Production TerminalID received and confirmed for **1-step CHARGE** (not DMS/2-step)
- [ ] Callback URL allowlisted at Halyk: `https://wpotranslations.org/api/payments/halyk/callback`
- [ ] Production domain allowlisted at Halyk: `https://wpotranslations.org`
- [ ] Payment page branding/logo approved by Halyk
- [ ] Visa/Mastercard logos present on checkout page (Halyk requirement)
- [ ] Merchant agreement signed

## 2. Environment Variables

### Vercel Production

| Variable | Value |
|---|---|
| `HALYK_EPAY_ENABLED` | `true` |
| `NEXT_PUBLIC_HALYK_EPAY_ENABLED` | `true` |
| `HALYK_EPAY_MODE` | `production` |
| `HALYK_EPAY_CLIENT_ID` | From Halyk Bank |
| `HALYK_EPAY_CLIENT_SECRET` | From Halyk Bank (server-only, never public) |
| `HALYK_EPAY_TERMINAL_ID` | From Halyk Bank |
| `APP_BASE_URL` | `https://wpotranslations.org` |
| `CRON_SECRET` | Random secure secret (also set in Railway) |
| `FISCALIZATION_ENABLED` | `false` (pending_manual mode until provider confirmed) |
| `FISCAL_PROVIDER` | `manual` |
| `FISCAL_PROVIDER_ENV` | `production` |

### Railway Production Worker

No additional payment env vars needed in worker — the worker only polls job status and
does not call the Halyk payment API.

## 3. Supabase Production

- [ ] Migrations 0015, 0016, 0017, 0018 applied to production Supabase project
- [ ] `finalize_halyk_payment` RPC accessible to service_role
- [ ] `get_refundable_amount` RPC accessible to service_role
- [ ] RLS on `fiscal_receipts` and `refund_transactions` active
- [ ] `payment_transactions` index on pending reconciliation is present
- [ ] Supabase production URL in Vercel Production env (not staging URL)

## 4. R2 Storage

- [ ] Production R2 bucket name set in Vercel Production (not staging bucket)
- [ ] Railway production worker points to same production R2 bucket

## 5. Fiscalization

- [ ] Fiscal provider confirmed with accountant (ReKassa / Webkassa / other OFD)
- [ ] If `FISCALIZATION_ENABLED=false` is accepted for closed beta: operator process documented
- [ ] Operator knows to check `fiscal_receipts WHERE status='pending_manual'` after each payment
- [ ] If real provider: `FISCAL_PROVIDER_ENV=production` set to match `HALYK_EPAY_MODE`

See `docs/payments/FISCALIZATION.md` for provider setup.

## 6. Refunds

- [ ] Operator confirmed: refunds go through Halyk merchant cabinet (manual process)
- [ ] Operator knows to run `SELECT * FROM refund_transactions WHERE status='pending_manual'`
- [ ] Accounting confirmed refund fiscal correction process (OFD correction receipt)
- [ ] Customer refund contact is `worldprimeonline@gmail.com`

See `docs/payments/REFUNDS.md` for process details.

## 7. 3D Secure

- [ ] 3D Secure tested end-to-end with test card from Halyk test environment
- [ ] 3DS callback handled (Halyk redirects back to `backLink`; status checked on result page)
- [ ] Failed 3DS shows error to customer without marking payment as paid

## 8. Security Review

- [ ] `client_secret` confirmed absent from all API responses and Sentry payloads
- [ ] `secret_hash` not stored raw in database
- [ ] Amount read exclusively from `jobs.price_kzt` — client-provided amount ignored
- [ ] Duplicate CHARGE detection verified (sends to `duplicate_charge_review`)
- [ ] Rate limiting active on initiate and callback routes

## 9. First Real Payment Test

1. Set all production env vars in Vercel Production.
2. Log in as a test user.
3. Upload a real document via `/api/documents/upload-card` (use `service_level=electronic`).
4. Confirm `jobs.price_kzt = 1999` and job is `payment_pending`.
5. Click "Pay by card" → confirm redirect to Halyk production payment page.
6. Complete payment with a real card.
7. Confirm:
   - `payment_transactions.status = 'paid'`
   - `jobs.status = 'queued'`
   - `payment_transactions.callback_received_at` is set
   - `fiscal_receipts` row created with `status = 'pending_manual'` (if fiscal not yet configured)
   - Railway worker picks up the job and processes it
   - Customer receives email notification

## 10. First Real Refund Test

1. Use the payment from step 9 (after processing completes).
2. Open Halyk merchant cabinet → locate transaction by `provider_transaction_id`.
3. Initiate full refund via Halyk cabinet.
4. After Halyk confirms: manually update `refund_transactions` and `payment_transactions` statuses.
5. Issue fiscal correction receipt via OFD cabinet.
6. Confirm customer receives notification.

## 11. Monitoring and Alerts

- [ ] Sentry DSN configured in both Vercel and Railway
- [ ] `TELEGRAM_OPERATOR_CHAT_ID` set for `duplicate_charge_review` alerts
- [ ] Railway worker logs accessible in Railway dashboard
- [ ] Vercel function logs monitored for `[halyk/callback]` errors

## 12. Rollback Plan

To immediately disable card payments without code change:

```
HALYK_EPAY_ENABLED=false
NEXT_PUBLIC_HALYK_EPAY_ENABLED=false
```

The initiate route returns HTTP 503. Existing paid jobs continue processing.
Existing `payment_pending` jobs remain until manual cleanup or customer contact.

## 13. Production Gate Logic

`cardPaymentsActive` in `src/lib/business-profile.ts` controls compliance copy only.
The actual payment gate is `HALYK_EPAY_ENABLED=true` + valid credentials.

**Do not set `cardPaymentsActive=true` until:**
- Production Halyk credentials are set
- First real payment test is successful
- Fiscal receipt process confirmed with accountant

## 14. Chargeback / Dispute Handling

For chargebacks:

1. Customer disputes charge with their bank.
2. Halyk Bank contacts merchant via email/cabinet.
3. Required data (available in `payment_transactions`):
   - `card_mask` — last 4 digits of card
   - `approval_code` — bank authorization code
   - `reference` — Halyk internal reference
   - `provider_payload` — full sanitised response
   - `callback_received_at`, `paid_at` — payment timestamps
4. Also provide job data: document type, service level, status.
5. Consult legal policy in `src/lib/legal/content/en.ts` (refund-policy section).
