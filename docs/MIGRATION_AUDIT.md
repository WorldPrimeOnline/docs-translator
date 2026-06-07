# Migration Audit — WPO Translations

Audit date: 2026-06-07  
Auditor: automated code inspection + manual review

---

## Summary

The migration history contains TON/crypto-era files that are no longer needed by the current MVP.
These have been archived. A clean single-file init (`STAGING_INIT_ALL.sql`) now covers staging.

---

## Migration Status

| File | Status | Reason |
|---|---|---|
| `0001_initial_schema.sql` | ✅ **Required** (production history) | Base tables. Note: creates dead `payments` (Stripe-era) table — not reproduced in STAGING_INIT_ALL.sql |
| `0002_auth_user_trigger.sql` | ✅ **Required** (production history) | Auth → public.users sync trigger |
| `0003_ton_payments.sql` | 🗄️ **Archived** | Creates `ton_payments` — renamed/dropped by 0008. Never needed in clean install |
| `0004_wallet_links.sql` | 🗄️ **Archived** | Creates `wallet_links` — dropped by 0008. No code references it |
| `0005_subscriptions.sql` | ✅ **Required** (production history) | Creates `subscriptions` table (actively used). TON columns replaced in STAGING_INIT_ALL |
| `0006_jobs_notarized.sql` | ✅ **Required** | Adds `jobs.notarized` — used by worker and upload route |
| `0007_documents_detected_source_language.sql` | ✅ **Required** | Adds `documents.detected_source_language` |
| `0008_rename_payments.sql` | ✅ **Required** (production history) | Renames `ton_payments` → `payment_transactions`; superseded in production by `APPLY_TO_SUPABASE.sql` |
| `0009_add_ip_capture.sql` | ✅ **Required** | Adds `ip_address` to `documents` and `payment_transactions` |
| `0010_users_terms_accepted_at.sql` | ✅ **Required** | Adds `users.terms_accepted_at` — checked by upload route |
| `0011_official_workflow_fields.sql` | ✅ **Required** | Adds `workflow_status`, `translated_docx_key`, `translated_preview_pdf_key`, `qa_report` |
| `add_official_workflow_fields.sql` | 🗄️ **Archived** | Duplicate of 0011 — unnumbered, applied manually before 0011 existed |
| `APPLY_TO_SUPABASE.sql` | 🗄️ **Archived** | One-time production consolidation script. Not repeatable on a fresh DB. Superseded by `STAGING_INIT_ALL.sql` |

---

## TON / Wallet code references

Search performed across `src/` and `worker/src/` for all crypto/wallet identifiers:

| Identifier | Found in source? | Details |
|---|---|---|
| `ton_payments` | ❌ No | Only in `supabase.ts` comments (updated) and archive files |
| `wallet_links` | ❌ No | Only in `supabase.ts` comments (updated) and archive files |
| `TonConnect` / `tonconnect` | ❌ No | — |
| `wallet_address` | ❌ No | — |
| `amount_nanoton` | ❌ No | — |
| `ton_price_usd` | ❌ No | — |
| `amount_raw` / `exchange_rate_usd` | ❌ No | — |
| `legacy_wallet_address` | ❌ No | — |
| `payment_transactions` | ✅ Yes | `worker/src/index.ts` — used to check card_payment eligibility |
| `subscriptions` | ✅ Yes | Upload route, use-document route, current route |
| `payment_source` | ✅ Yes | `'subscription'` and `'card_payment'` only — `'ton_payment'` is gone |

**Conclusion:** Zero TON/crypto references remain in the application code.

---

## Dead tables

| Table | Status | Code references? |
|---|---|---|
| `payments` | Dead — Stripe-era, never became active | ❌ None found |
| `ton_payments` | Renamed to `payment_transactions` in production | ❌ None found |
| `wallet_links` | Dropped in 0008 | ❌ None found |

The `payments` table (from `0001_initial_schema.sql`) was the original Stripe integration plan.
It was never used — TON was adopted instead. Both are now obsolete.
`payments` still exists in production but is empty and not queried anywhere.
It is NOT included in `STAGING_INIT_ALL.sql`.

---

## Files moved/archived

```
supabase/migrations/0003_ton_payments.sql     → supabase/archive/legacy-ton/0003_ton_payments.sql
supabase/migrations/0004_wallet_links.sql     → supabase/archive/legacy-ton/0004_wallet_links.sql
supabase/migrations/add_official_workflow_fields.sql → supabase/archive/add_official_workflow_fields.sql
supabase/APPLY_TO_SUPABASE.sql               → supabase/archive/APPLY_TO_SUPABASE.sql
```

---

## What to run for staging (clean Supabase project)

**Single file:**
```
supabase/STAGING_INIT_ALL.sql
```

Paste the entire file into: **Supabase Dashboard → SQL Editor → Run**

This creates in one transaction:
- `users` + auth trigger
- `documents` (with `detected_source_language`, `ip_address`)
- `jobs` (with `priority`, `payment_source`, `notarized`, `workflow_status`)
- `ocr_results`
- `translations` (with `translated_docx_key`, `translated_preview_pdf_key`, `qa_report`)
- `payment_transactions` (provider-neutral: `amount`, `currency`, `payment_provider`, `raw_payload`)
- `subscriptions` (no TON columns)
- All RLS policies
- All indexes
- Auth trigger

**Verification query** (run separately after init):
```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;
```
Expected result: `documents, jobs, ocr_results, payment_transactions, subscriptions, translations, users`  
NOT expected: `payments, ton_payments, wallet_links`

---

## Production cleanup recommendations

| Action | Priority | Risk |
|---|---|---|
| Drop `payments` table from production | Low | None — table is empty and unused |
| Verify `ton_payments` is fully gone from production | ✅ Done — renamed by 0008/APPLY_TO_SUPABASE | — |
| Verify `wallet_links` is fully gone from production | ✅ Done — dropped by 0008 | — |
| Remove legacy FK constraint names (`ton_payments_*`) from production | Low | Cosmetic — constraint names don't affect queries |
| Run `supabase gen types` after production cleanup | Recommended | Updates supabase.ts to match actual production schema |

To drop the dead `payments` table on **production** (run in SQL Editor, verify empty first):
```sql
-- Safety check first:
SELECT COUNT(*) FROM public.payments;
-- If 0, safe to drop:
DROP TABLE IF EXISTS public.payments;
```

---

## supabase.ts changes

The `src/types/supabase.ts` file was manually updated:
- Removed `payments` table type (dead Stripe-era table, no code references it)
- Fixed `payment_transactions.Relationships` FK names: `ton_payments_*_fkey` → `payment_transactions_*_fkey`
- Added `raw_payload: Json | null` and `updated_at: string` to `payment_transactions` (added to STAGING_INIT_ALL)
- Updated header comment to reference `STAGING_INIT_ALL.sql`
