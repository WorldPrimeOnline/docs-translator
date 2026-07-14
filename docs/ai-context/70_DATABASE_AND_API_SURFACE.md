# Database and API Surface

## Supabase tables

Generated types at `src/types/supabase.ts`, re-exported from `src/types/index.ts`. Use `Tables<'tablename'>`, `TablesInsert<'tablename'>`, `TablesUpdate<'tablename'>` for typed DB access — do not inline raw object types.

| Table | Key columns |
|---|---|
| `users` | auth users; `terms_accepted_at` — set by `POST /api/users/accept-terms` (dashboard shows acceptance gate until populated) |
| `documents` | `file_key`, `source_language`, `target_language`, `document_type`, `output_format`, `status`, `word_count`, `price_usd` |
| `jobs` | `status`, `progress_percent`, `priority`, `payment_source` (`'card_payment' \| 'subscription'`), `country`, `notarized`, `bureau_stamp`, `workflow_status`, `service_level`, `fulfillment_method` (`'pickup' \| 'delivery'`), `jira_issue_key`, `last_synced_at`, `customer_comment`, `finance_jira_issue_key`, `finance_jira_sync_status`, `price_kzt` (final post-discount), `price_before_discount_kzt` (null if no discount), `discount_applied_kzt` (null if no discount), `discount_code` (partner ref code that generated discount) — migration `0033`. |
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
| `partner_applications` | `partner_type`, `name`, `email`, `phone`, `organization`, `message`, `ref_code`, `utm_*`, `status` (`pending\|reviewing\|approved\|rejected`), `jira_issue_key`, `jira_issue_url`, `jira_sync_status` (`pending\|synced\|failed`), `jira_error`, `jira_created_at`, `approved_partner_id` (FK → partners.id), `approved_at`, `approved_by`, `canceled_at`, `canceled_by`, `cancellation_reason` — public partner program form submissions. RLS enabled, no browser policies. Migrations `0029`, `0030`, `0033`, `0034`. |
| `partners` | `referral_code` (unique), `partner_type`, `email` (unique), `commission_rate`, `is_active`, `application_id`, `client_discount_enabled` (bool), `client_discount_type` (`percent\|fixed`), `client_discount_value`, `client_discount_min_order_amount`, `client_discount_max_amount`, `deactivated_at`, `deactivation_reason`, `partner_link` (canonical referral URL), `qr_code_url` (QR endpoint URL), `activation_comment_added_at`, `activation_comment_error` — approved partner accounts. RLS enabled, service-role only. Migrations `0029`, `0032`, `0033`, `0034`, `0035`. |
| `partner_referrals` | `partner_id`, `job_id` (unique where not null), `user_id`, `ref_code`, `utm_*`, `order_amount_kzt`, `client_discount_applied_kzt`, `commission_rate`, `commission_base_kzt` (excl. discount + pass-throughs), `commission_kzt`, `status` (`pending\|confirmed\|in_payout\|paid\|refunded\|canceled\|excluded`), `payout_id` (FK → partner_payouts), `confirmed_at` (when moved to confirmed — used for payout period filter), `included_in_payout_at`, `paid_at` — per-order commission tracking. Migrations `0029`, `0031`, `0032`, `0039`. |
| `partner_payouts` | `partner_id`, `period_start`, `period_end`, `referral_count`, `gross_order_amount_kzt`, `total_client_discount_kzt`, `total_commission_base_kzt`, `total_commission_amount_kzt`, `currency` (`KZT`), `status` (`pending_approval\|approved\|paid\|rejected\|cancelled`), `jira_issue_key`, `jira_issue_url`, `jira_error`, `generated_at`, `approved_at`, `paid_at`, `payment_reference` — monthly payout batches. Generated by `npm run partners:payouts`. Migrations `0029`, `0039`. |
| `order_drafts` | `user_id` (nullable), `anonymous_session_id`, `status` (`draft_created\|price_calculated\|checkout_started\|expired\|converted`), wizard input fields (source/target language, document_type, service_level, notary/delivery fields), `file_keys` (jsonb — temp `draft-uploads/` R2 keys), `pricing_snapshot` (jsonb — cached `computeQuoteForJob()` result, NOT a real `price_quotes` row), `converted_job_id`/`converted_document_id`/`converted_quote_id`/`converted_price_kzt` (idempotency), `expires_at` — public pre-checkout wizard drafts (`[locale]/start` → `[locale]/checkout`). RLS enabled, no policies (service-role only, same pattern as `cost_reservations`). Migration `0044`. |
| `anonymous_rate_limit_events` | `session_token`, `ip_address`, `event_type`, `created_at` — durable rate-limit log for anonymous wizard price calculations (5/hour, 20/day). RLS enabled, no policies. Migration `0044`. |

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
| POST | `/api/documents/upload-card/init` | Dashboard direct-to-R2 upload step 1: business fields + file metadata JSON → one presigned R2 PUT URL per file at `card-upload-raw/{userId}/{uploadAttemptId}/{uuid}`, 10-min TTL. No file bytes in the request. |
| POST | `/api/documents/upload-card/complete` | Step 2: browser has already PUT each file to R2; HeadObject-verifies, downloads, magic-byte checks, converts+merges to PDF, uploads to `documents/{userId}/{uploadAttemptId}/original.pdf`, then creates document+job+quote (`createCardOrder()`, `src/lib/documents/upload-card-shared.ts`) — same business logic as the legacy route's tail. Idempotent on `uploadAttemptId` (used as `documents.id`). |
| POST | `/api/documents/upload-card` | **Legacy** — single multipart request carrying file bytes through this Vercel Function; kept only for cached old frontend bundles (gated by `cardPaymentsActive`). Hits Vercel's ~4.5 MB function payload limit (413) for larger files — the current dashboard frontend uses `/upload-card/init` + `/upload-card/complete` instead. |
| POST | `/api/payments/halyk/initiate` | Initiate Halyk ePay payment, returns redirect URL |
| POST | `/api/payments/halyk/callback` | Halyk ePay payment result callback — updates job payment status |
| GET | `/api/cron/cleanup` | Daily 02:00 UTC — deletes files older than 30 days, expired `order_drafts`, and orphaned `draft-upload-raw/` R2 objects older than 24h (secured via `CRON_SECRET`) |
| GET | `/api/cron/reconcile-payments` | Scheduled reconciliation of Halyk ePay payment statuses |
| POST | `/api/admin/payments/refund` | Operator-initiated refund — creates `refund_transactions` row (pending_manual) |
| POST | `/api/admin/payments/[paymentId]/refunds` | Same as above, payment-scoped path |
| POST | `/api/users/accept-terms` | Records `terms_accepted_at` timestamp in users table |
| POST | `/api/webhooks/jira` | Inbound Jira Automation callbacks — updates Supabase + fires Telegram/email. `ASSIGNEE_CHANGED` → `handleAssigneeChanged()`. Does NOT create Jira issues or call Jira API. |
| POST | `/api/webhooks/stripe` | Placeholder — no route file exists; `src/lib/stripe/` is an empty directory |
| POST | `/api/webhooks/polar` | Placeholder — no route file exists; `src/lib/polar/` is an empty directory |
| GET | `/api/debug/env` | Dev-only env sanity check — not part of user-facing flows |
| POST | `/api/partners/apply` | Public — saves partner application to `partner_applications`, creates Jira issue best-effort (non-fatal failure). No auth required. |
| POST | `/api/partners/validate-code` | Auth required — validates a referral code; returns `{ valid, partnerName, discountEnabled, discountType, discountValue, discountMinOrderKzt, discountMaxKzt }`. Never exposes `commission_rate` or internal IDs. |
| POST | `/api/webhooks/jira/partnership` | Jira Automation → WPO partner lifecycle. `АКТИВНОЕ ПАРТНЁРСТВО` creates/reactivates partner. `ПАРТНЁРСТВО ОТМЕНЕНО` deactivates. After activation, posts a Jira comment with partner code, referral link, QR URL, client message, and discount/commission info. Auth: `x-wpo-webhook-secret`. See `docs/JIRA_AUTOMATION_SETUP.md`. |
| GET | `/api/partners/qr/[code]` | Public — returns a PNG QR code for the partner's referral link. 404 for inactive/unknown codes. Cache-Control: public, max-age=86400. No auth. |
| POST | `/api/order-drafts` | Public — creates a pre-checkout draft (no auth); sets the anonymous session cookie |
| GET, PATCH | `/api/order-drafts/[draftId]` | Read/update draft fields — owner check via session cookie or `user_id`; editing after a price was shown invalidates the cached snapshot |
| POST | `/api/order-drafts/[draftId]/upload/init` | Batch JSON metadata (filename/MIME/size per file) → one presigned R2 PUT URL per file at `draft-upload-raw/{draftId}/{uuid}`, 10-min TTL. No file bytes in the request. |
| POST | `/api/order-drafts/[draftId]/upload/complete` | Browser has already PUT each file straight to R2; this HeadObject-verifies actual size/type, downloads, magic-byte checks, converts+merges to PDF, writes the final `draft-uploads/{draftId}/original.pdf` key, calls `setDraftFile()`, deletes the raw objects. Idempotent — safe to retry. |
| POST | `/api/order-drafts/[draftId]/upload` | **Legacy** — single multipart request carrying file bytes through this Vercel Function; kept only for cached old frontend bundles. Hits Vercel's ~4.5 MB function payload limit (413) for larger files — the current frontend uses `/upload/init` + `/upload/complete` instead. |
| POST | `/api/order-drafts/[draftId]/calculate` | Computes a real KZT price via the existing pricing engine; rate-limited for anonymous callers (5/hour, 20/day) |
| POST | `/api/order-drafts/[draftId]/attach` | Auth required — attaches an anonymous draft to the logged-in user after the auth detour |
| POST | `/api/order-drafts/[draftId]/convert` | Auth required — materializes the draft into a real `documents`/`jobs` (`payment_pending`)/`price_quotes` row; idempotent |
