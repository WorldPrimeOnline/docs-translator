# Production Deploy Runbook

## Pre-deploy checklist

Before merging `staging → main`, verify ALL items:

### 1. Supabase migrations
- [ ] Run `ls supabase/migrations/` and compare with production schema
- [ ] For every new `supabase/migrations/XXXX_*.sql` file: apply it to production Supabase **before** the code deploy
- [ ] Verify additive-only changes (no DROP TABLE, no TRUNCATE, no destructive ALTER)
- [ ] After applying, run schema verification SQL (see below)
- [ ] Run `NOTIFY pgrst, 'reload schema';` to flush PostgREST schema cache

### 2. Environment variables
- [ ] Confirm production Vercel env has all new variables (names only — no values in docs)
- [ ] Confirm Railway production worker env matches the **same** Supabase project URL as Vercel production
- [ ] Never point staging env at production Supabase or production R2

### 3. Pricing configuration
- [ ] If `pricing_versions` table was just created: verify `SELECT count(*) FROM pricing_versions WHERE status = 'active'` returns ≥ 1
- [ ] If count = 0: run the seed INSERT from `0019_pricing_versions.sql`

### 4. Code gate checks
- [ ] `JIRA_WEBHOOK_SECRET` set in Vercel production (absent → all Jira callbacks return 500)
- [ ] `cardPaymentsActive` flag in `src/lib/business-profile.ts` — confirm whether card payments should be active
- [ ] `HALYK_EPAY_ENABLED=true` only if Halyk production credentials are fully configured

### 5. Post-deploy smoke tests

| Test | Expected result |
|------|----------------|
| Upload document (subscription) | Job created, `documents_used` incremented, no 500 |
| Upload document (card) | Quote created, `PRICING_NOT_CONFIGURED` not returned |
| `POST /api/payments/halyk/initiate` | `payment_transactions` row created, Halyk token returned |
| Worker logs | No `Could not find table` errors |
| Fiscal reconcile worker | No schema cache errors |
| `POST /api/webhooks/jira` without secret | Returns 500 (fail-closed) |

---

## Incident: 2026-06-23 — Missing migrations 0017–0026

### Symptoms
```
POST /api/payments/halyk/initiate → 500
[halyk/initiate] failed to create payment_transaction

[fiscal-reconcile] DB error: Could not find table 'public.fiscal_receipts'
[fiscal-reconcile] DB error: Could not find table 'public.refund_transactions'

[upload-card] pricing not configured: PRICING_NOT_CONFIGURED
```

### Root cause
13 commits + 8 migrations deployed to production Vercel/Railway via `staging → main` merge on 2026-06-23. Migrations were **not applied** to production Supabase before the deploy. The new code referenced tables and columns that didn't exist.

Specific failures:
| Error | Missing migration |
|-------|------------------|
| `fiscal_receipts` not found | 0017 |
| `refund_transactions` not found | 0018 |
| `PRICING_NOT_CONFIGURED` | 0019 (table + seed) |
| `payment_transaction` INSERT 500 | 0023 (`quote_id`, `price_locked_at`, `amount_source`, `pricing_snapshot_json` columns) |

### Fix applied
Applied `scripts/prod/2026-06-23_apply_missing_finance_payment_migrations.sql` to production Supabase SQL Editor (migrations 0017–0026, all idempotent/additive).

---

## Schema verification SQL

Run in Supabase SQL Editor to verify all required objects exist:

```sql
-- Tables
SELECT
  to_regclass('public.fiscal_receipts')      AS fiscal_receipts,
  to_regclass('public.refund_transactions')  AS refund_transactions,
  to_regclass('public.pricing_versions')     AS pricing_versions,
  to_regclass('public.price_quotes')         AS price_quotes,
  to_regclass('public.price_quote_items')    AS price_quote_items,
  to_regclass('public.cost_reservations')    AS cost_reservations,
  to_regclass('public.payment_transactions') AS payment_transactions,
  to_regclass('public.jobs')                 AS jobs;

-- payment_transactions columns from 0023
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'payment_transactions'
  AND column_name IN ('quote_id', 'price_locked_at', 'amount_source', 'pricing_snapshot_json');

-- jobs columns from 0024/0025
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'jobs'
  AND column_name IN (
    'customer_comment', 'finance_jira_issue_id', 'finance_jira_issue_key',
    'finance_jira_issue_url', 'finance_jira_sync_status',
    'finance_jira_last_error', 'finance_jira_synced_at'
  );

-- Pricing seed
SELECT count(*) AS active_pricing_versions
FROM public.pricing_versions WHERE status = 'active';

-- RPC functions
SELECT proname FROM pg_proc
WHERE proname IN ('get_refundable_amount', 'create_subscription_job', 'finalize_halyk_payment');
```

## Schema cache reload

After applying any migration, run:

```sql
NOTIFY pgrst, 'reload schema';
```

Then restart Railway worker (Railway dashboard → Redeploy) to clear its Supabase client cache.

---

## Worker env verification (run in Railway terminal or logs)

Check that worker `SUPABASE_URL` hostname matches Vercel production `NEXT_PUBLIC_SUPABASE_URL` hostname. If they differ, worker is pointed at a different Supabase project — critical bug.

Expected: both should end in `.supabase.co` with the **same project ref**.

---

## Known production state (as of 2026-06-23)

- `cardPaymentsActive = false` — card payment UI is hidden
- `FISCAL_PROVIDER = manual` — fiscal receipts require manual issuance via OFD cabinet
- `OFFICIAL_WORKFLOW_ENABLED` — check Railway worker env
- Pricing rates in `pricing_versions` are preliminary — accountant/notary confirmation pending before notarized orders go live
