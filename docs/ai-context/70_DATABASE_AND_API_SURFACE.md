# Database and API Surface

## Supabase tables

Generated types at `src/types/supabase.ts`, re-exported from `src/types/index.ts`. Use `Tables<'tablename'>`, `TablesInsert<'tablename'>`, `TablesUpdate<'tablename'>` for typed DB access — do not inline raw object types.

| Table | Key columns |
|---|---|
| `users` | auth users; `terms_accepted_at` — set by `POST /api/users/accept-terms` (dashboard shows acceptance gate until populated) |
| `documents` | `file_key`, `source_language`, `target_language`, `document_type`, `output_format`, `status`, `word_count`, `price_usd` |
| `jobs` | `status`, `progress_percent`, `priority`, `payment_source` (`'card_payment' \| 'subscription'`), `country`, `notarized`, `bureau_stamp`, `workflow_status`, `service_level`, `fulfillment_method` (`'pickup' \| 'delivery'`), `jira_issue_key`, `last_synced_at`, `customer_comment`, `finance_jira_issue_key`, `finance_jira_sync_status` |
| `ocr_results` | `job_id`, `markdown`, `page_count`, `provider` |
| `translations` | `job_id`, `translated_markdown`, `translated_pdf_key`, `translated_docx_key`, `translated_preview_pdf_key`, `qa_report`, `translated_ast` (background AST enrichment — non-blocking, never gates delivery) |
| `subscriptions` | `plan`, `status`, `documents_used`, `documents_limit`, `expires_at` |
| `job_audit_log` | `job_id`, `actor`, `source`, `action`, `previous_status`, `new_status`, `jira_issue_key`, `correlation_id`, `metadata` — append-only log of all status transitions and integration events |
| `staff_profiles` | `display_name`, `jira_account_id`, `telegram_chat_id`, `telegram_username`, `telegram_notifications_enabled`, `role` (`operator\|translator\|notary_partner\|admin`), `is_active` — service role only (RLS blocks browser). Unique constraint on `jira_account_id WHERE is_active=true`. |
| `notification_log` | `event_id`, `order_id`, `jira_issue_key`, `recipient_profile_id`, `channel`, `template`, `status` (`pending\|sent\|failed\|skipped`), `provider_message_id`, `error`, `sent_at` — delivery audit for every Telegram notification attempt. Unique index on `(event_id, recipient_profile_id) WHERE status IN ('sent','pending')` for idempotency. |
| `payment_transactions` | `job_id`, `document_id`, `amount`, `currency`, `status` (`pending\|paid\|failed\|expired`), `provider` (`halyk_epay`), `provider_environment` (`test\|production`), `provider_transaction_id`, `card_mask` — one row per Halyk ePay payment attempt. |
| `fiscal_receipts` | `payment_transaction_id`, `operation_type` (`sale\|refund\|correction`), `status` (`pending\|pending_manual\|issued\|failed\|retry_required`), `amount_kzt`, `provider` (`manual\|webkassa`), `fiscal_url`, `provider_receipt_id`, `receipt_payload_sanitized`, `customer_email` — migration `0017_fiscal_receipts.sql`. |
| `refund_transactions` | `payment_transaction_id`, `refund_amount_kzt`, `status` (`pending_manual\|pending\|succeeded\|failed\|requires_review`), `provider` (`halyk_epay`), `reason`, `operator_id`, `idempotency_key`, `fiscal_refund_receipt_id`, `refund_policy_case`, `approval_status` — migration `0018` + `0023`. |
| `pricing_versions` | `code`, `status` (`draft\|active\|archived`), rate columns (all numeric fractions) — one `active` row at a time. Migration `0019`. |
| `price_quotes` | `job_id`, `user_id`, `status` (`draft\|quoted\|expired\|payment_pending\|paid\|canceled\|refunded\|requires_operator_review`), `amount_kzt`, `expires_at`, `pricing_version_id` — immutable once `quoted`. Migration `0020`. |
| `price_quote_items` | `quote_id`, `item_type`, `label_key`, `amount_kzt`, `is_internal` — line-item breakdown. Migration `0021`. |
| `cost_reservations` | `quote_id`, `job_id`, `bucket` (translator/notary/ai_it/tax/etc.), `amount_kzt`, `status` (`reserved\|committed\|released`) — internal cost buckets, committed on payment. Migration `0022`. |
| `partner_applications` | `partner_type`, `name`, `email`, `phone`, `organization`, `message`, `ref_code`, `utm_*`, `status` (`pending\|reviewing\|approved\|rejected`), `jira_issue_key`, `jira_issue_url`, `jira_sync_status` (`pending\|synced\|failed`), `jira_error`, `jira_created_at` — public partner program form submissions. RLS enabled, no browser policies. Migrations `0029`, `0030`. Column `jira_last_error` was renamed to `jira_error` in `0030`. |
| `partners` | `referral_code` (unique), `partner_type`, `email` (unique), `commission_rate`, `is_active`, `application_id` — approved partner accounts. RLS enabled, service-role only. Migration `0029`. |
| `partner_referrals` | `partner_id`, `job_id` (unique where not null), `user_id`, `ref_code`, `utm_source/medium/campaign/content/term`, `order_amount_kzt` (raw order price at creation), `commission_rate` (snapshot), `commission_base_kzt` (excl. pass-throughs), `commission_kzt`, `status` (`pending\|confirmed\|refunded\|canceled\|paid\|excluded`), `payout_id` — tracks referral code attribution to orders. Migrations `0029`, `0031`. Pass-through exclusions: `notary_official_fee`, `delivery_fee` from `price_quote_items`. |
| `partner_payouts` | `partner_id`, `period_start`, `period_end`, `gross_kzt`, `net_kzt`, `referral_count`, `status` (`pending\|approved\|paid\|cancelled`) — monthly payout records. Migration `0029`. |

## API routes

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/documents/upload` | Upload + (for subscription html jobs) kick off web processor |
| POST | `/api/documents/estimate` | OCR + word-count pricing ($0.01/word), not cached |
| GET | `/api/documents/[documentId]/download` | Presigned R2 URL for the translated file |
| GET | `/api/jobs` | All orders for the current user — enriched with `getCustomerOrderState()` |
| GET | `/api/jobs/[jobId]` | Single job status polling |
| POST | `/api/subscriptions/create` | 503 placeholder — payment gateway not yet active |
| GET | `/api/subscriptions/current` | Active subscription for the current user |
| POST | `/api/subscriptions/use-document` | Check quota and decrement by 1 |
| POST | `/api/documents/upload-card` | Card-payment upload path (Halyk ePay) — gated by `cardPaymentsActive` |
| POST | `/api/payments/halyk/initiate` | Initiate Halyk ePay payment, returns redirect URL |
| POST | `/api/payments/halyk/callback` | Halyk ePay payment result callback — updates job payment status |
| GET | `/api/cron/cleanup` | Daily 02:00 UTC — deletes files older than 30 days (secured via `CRON_SECRET`) |
| GET | `/api/cron/reconcile-payments` | Scheduled reconciliation of Halyk ePay payment statuses |
| POST | `/api/admin/payments/refund` | Operator-initiated refund — creates `refund_transactions` row (pending_manual) |
| POST | `/api/admin/payments/[paymentId]/refunds` | Same as above, payment-scoped path |
| POST | `/api/users/accept-terms` | Records `terms_accepted_at` timestamp in users table |
| POST | `/api/webhooks/jira` | Inbound Jira Automation callbacks — updates Supabase + fires Telegram/email. `ASSIGNEE_CHANGED` → `handleAssigneeChanged()`. Does NOT create Jira issues or call Jira API. |
| POST | `/api/webhooks/stripe` | Placeholder — no route file exists; `src/lib/stripe/` is an empty directory |
| POST | `/api/webhooks/polar` | Placeholder — no route file exists; `src/lib/polar/` is an empty directory |
| GET | `/api/debug/env` | Dev-only env sanity check — not part of user-facing flows |
| POST | `/api/partners/apply` | Public — saves partner application to `partner_applications`, creates Jira issue best-effort (non-fatal failure). No auth required. |
