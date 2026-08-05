-- ============================================================================
-- inspect-customer-order.sql
--
-- Read-only support tool. Run manually in the Supabase SQL Editor.
-- Find-and-replace 'REPLACE_JOB_ID' (the literal string, including quotes) with the
-- real jobs.id (uuid) you're investigating, then run all sections — or select and run
-- one section at a time if your SQL Editor only shows the last statement's result.
--
-- NEVER writes anything — every statement here is a SELECT. No UPDATE/DELETE/INSERT.
--
-- Companion tooling: scripts/support/inspect-customer-order.ts (same job_id, human/
-- JSON/markdown report, reuses the real customer-dashboard selector — see
-- docs/operations/customer-order-inspection.md for how to read the output of both).
--
-- Schema notes baked into this file (see the audit in the same PR for full detail):
--   - One documents row per order; `file_key` is the ALREADY-MERGED source PDF — if the
--     customer uploaded multiple files, they were combined into this ONE object at
--     intake (src/lib/convert-to-pdf.ts mergePdfs()). documents/document_analysis/
--     translations remain whole-merged-document only — they never gained per-source
--     tracking.
--   - Per-original-file tracking DOES now exist at the jobs level, added by migration
--     0063 (2026-07-31): job_source_files (one row per original upload, stable sequence,
--     r2_key, physical_page_count) and job_result_files (one row per produced artifact,
--     mapping to one or more source sequences, status='ready' gating customer
--     deliverability). See Section 4B and Section 6B — this is the CANONICAL post-
--     conversion per-source record.
--   - order_drafts.file_keys[0]/analysis_snapshot (Section 4) is the PRE-conversion
--     record — only populated for orders that went through the public /start draft
--     flow, and only since the 2026-07-29 dedup fix. job_source_files rows are
--     populated FROM this data at convertDraftToOrder() time, but the draft row is not
--     itself updated afterward — query both if reconciling upload-time vs. current state.
--   - There is no separate "final artifact" or "notary scan" table/column outside of
--     job_result_files. The single translations row (translated_pdf_key/
--     translated_docx_key) remains the whole-merged-document Electronic/legacy path;
--     Official/Notary's human signature/stamp/notarization steps are tracked via
--     jobs.workflow_status plus job_result_files rows for stages
--     translator_result/signature_stamp/notary/final (and Google Drive subfolders
--     04_SIGNATURE_AND_STAMP/05_NOTARY/06_FINAL, manual staff folders with no other DB
--     row of their own).
-- ============================================================================


-- ============================================================================
-- SECTION 1: Job / Order
-- ============================================================================
with params as (
  select 'REPLACE_JOB_ID'::uuid as job_id
)
select
  j.id                          as job_id,
  j.document_id,
  j.status                      as job_status,
  j.workflow_status,
  j.service_level,
  j.notarized,
  j.notary_city,
  j.fulfillment_method,
  j.delivery_phone,
  j.delivery_address,
  j.applicant_type,
  j.notary_urgency_level,
  j.notary_urgency_window,
  j.notary_urgency_multiplier,
  j.notary_urgency_cutoff_at,
  j.notary_urgency_fee_kzt,
  j.progress_percent,
  j.error_message,
  j.priority,
  j.payment_source,
  j.price_kzt,
  j.price_before_discount_kzt,
  j.discount_applied_kzt,
  j.discount_code,
  j.manual_adjustment_kzt,
  j.manual_adjustment_reason,
  j.manual_adjustment_actor,
  j.manual_adjustment_at,
  j.customer_comment,
  j.started_at,
  j.completed_at,
  j.created_at                  as job_created_at,
  d.user_id,
  d.filename,
  d.original_file_size,
  d.file_key,
  d.source_language,
  d.target_language,
  d.document_type,
  d.status                      as document_status,
  d.detected_source_language,
  d.ip_address,
  d.created_at                  as document_created_at,
  d.updated_at                  as document_updated_at
from public.jobs j
join public.documents d on d.id = j.document_id
where j.id = (select job_id from params);


-- ============================================================================
-- SECTION 2: Price quote / payment
-- ============================================================================
with params as (
  select 'REPLACE_JOB_ID'::uuid as job_id
)
select
  q.id                                    as quote_id,
  q.status                                as quote_status,
  q.amount_kzt,
  q.currency,
  q.service_level,
  q.source_language,
  q.target_language,
  q.language_pair,
  q.source_character_count_with_spaces,
  q.physical_page_count,
  q.translation_page_count_exact,
  q.formula_version,
  q.pricing_version_id,
  q.language_rate_id,
  q.analysis_id,
  q.manual_adjustment_kzt,
  q.delivery_required,
  q.fulfillment_method,
  q.urgency_level,
  q.sales_channel,
  q.partner_id,
  q.quoted_at,
  q.expires_at,
  q.accepted_at,
  q.price_locked_at,
  q.paid_at,
  q.created_at                            as quote_created_at
from public.price_quotes q
where q.job_id = (select job_id from params)
order by q.created_at desc;

with params as (
  select 'REPLACE_JOB_ID'::uuid as job_id
)
select
  p.id                          as payment_id,
  p.status                      as payment_status,
  p.amount,
  p.currency,
  p.payment_provider,
  p.provider_transaction_id,
  p.provider_invoice_id,
  p.provider_status,
  p.provider_reason,
  p.provider_reason_code,
  p.provider_environment,
  p.card_mask,
  p.card_type,
  p.issuer,
  p.approval_code,
  p.reference,
  p.attempt_number,
  p.quote_id,
  p.amount_source,
  p.callback_received_at,
  p.status_checked_at,
  p.paid_at,
  p.failed_at,
  p.refunded_at,
  p.created_at                  as payment_created_at
from public.payment_transactions p
where p.job_id = (select job_id from params)
order by p.created_at desc;


-- ============================================================================
-- SECTION 3: Source document and file_key
-- ============================================================================
with params as (
  select 'REPLACE_JOB_ID'::uuid as job_id
)
select
  d.id                  as document_id,
  d.filename,
  d.original_file_size,
  d.file_key,
  d.source_language,
  d.target_language,
  d.document_type,
  d.status               as document_status,
  d.detected_source_language,
  d.ip_address,
  d.created_at,
  d.updated_at
from public.documents d
join public.jobs j on j.document_id = d.id
where j.id = (select job_id from params);


-- ============================================================================
-- SECTION 4: All source uploads (pre-merge) with filename/hash/page count
--
-- ONLY populated for orders created via the public /start draft flow (order_drafts),
-- and only since the 2026-07-29 dedup fix. Empty result = either a dashboard
-- upload-card order (never had a draft at all) or a draft created before that fix.
-- file_keys / analysis_snapshot are JSONB — see src/lib/order-drafts/types.ts
-- (DraftFileKey / DraftAnalysisSnapshot) for the exact shape:
--   file_keys[0]: { key, originalName, mimeType, sizeBytes, sourceUploadCount,
--                   sourceUploadIds, sourceContentHashes }
--   analysis_snapshot: { method, characterCount, physicalPageCount,
--                        sourceUploadCount, sourceUploadIds, ... }
-- sourceUploadCount/sourceUploadIds/sourceContentHashes are the per-original-file
-- provenance — sourceUploadCount = 1 means no dedup ever kicked in (or a single-file
-- order); sourceUploadIds lists the deduped raw R2 keys that were actually merged.
-- ============================================================================
with params as (
  select 'REPLACE_JOB_ID'::uuid as job_id
)
select
  od.id                          as draft_id,
  od.status                      as draft_status,
  od.file_keys,
  od.file_keys -> 0 ->> 'originalName'      as merged_display_name,
  (od.file_keys -> 0 ->> 'sourceUploadCount')::int as source_upload_count,
  od.file_keys -> 0 -> 'sourceUploadIds'    as source_upload_ids,
  od.file_keys -> 0 -> 'sourceContentHashes' as source_content_hashes,
  od.analysis_snapshot,
  od.converted_job_id,
  od.converted_document_id,
  od.created_at                  as draft_created_at,
  od.updated_at                  as draft_updated_at
from public.order_drafts od
where od.converted_job_id = (select job_id from params);


-- ============================================================================
-- SECTION 4B: job_source_files (2026-07-31 pipeline, migration 0063) — one row per
-- ORIGINAL uploaded file, post-conversion, in stable upload sequence order. This is
-- the CANONICAL per-source record once a job exists (unlike Section 4's order_drafts
-- snapshot, which is pre-conversion and draft-flow-only). Populated for every job
-- created after 0063 shipped, regardless of draft vs. dashboard upload-card origin.
--
-- aggregate_physical_pages mirrors aggregateReliablePhysicalPageCount()
-- (src/lib/document-analysis/physical-pages.ts) exactly: sum of physical_page_count
-- across all sequences for the job, or NULL ("unreliable") if ANY row has a null
-- count — never a partial/guessed sum. This is the figure that must equal the
-- billable-pages input to calculateElectronicPrice() (2026-08-02 incident:
-- job 29b5fa37-24ac-4269-b965-c024429560da had sourcePageCounts [2,1] -> this column
-- must read 3, not 1).
-- ============================================================================
with params as (
  select 'REPLACE_JOB_ID'::uuid as job_id
)
select
  jsf.id                    as source_file_id,
  jsf.sequence,
  jsf.original_filename,
  jsf.r2_key,
  jsf.content_sha256,
  jsf.mime_type,
  jsf.physical_page_count,
  jsf.converted_pdf_r2_key,
  jsf.created_at
from public.job_source_files jsf
where jsf.job_id = (select job_id from params)
order by jsf.sequence asc;

with params as (
  select 'REPLACE_JOB_ID'::uuid as job_id
)
select
  count(*)                                                  as source_file_count,
  array_agg(jsf.physical_page_count order by jsf.sequence)  as per_source_physical_page_counts,
  case
    when bool_or(jsf.physical_page_count is null) then null
    else sum(jsf.physical_page_count)
  end                                                        as aggregate_physical_pages,
  bool_or(jsf.physical_page_count is null)                   as has_unreliable_source_count
from public.job_source_files jsf
where jsf.job_id = (select job_id from params);


-- ============================================================================
-- SECTION 5: Document analysis (all revisions)
-- ============================================================================
with params as (
  select 'REPLACE_JOB_ID'::uuid as job_id
)
select
  da.id                                  as analysis_id,
  da.revision,
  da.supersedes_analysis_id,
  da.status                              as analysis_status,
  da.method,
  da.source_character_count_with_spaces,
  da.translation_page_count_exact,
  da.physical_page_count,
  da.page_count_method,
  da.content_sha256,
  da.analysis_quality_signals,
  da.operator_note,
  da.operator_actor,
  da.attempt_count,
  da.started_at,
  da.completed_at,
  da.failure_reason,
  da.created_at
from public.document_analysis da
join public.jobs j on j.document_id = da.document_id
where j.id = (select job_id from params)
order by da.revision desc;


-- ============================================================================
-- SECTION 6: AI drafts (translations + OCR) — ONE row per job, covers the whole
-- merged source document, not per original file (see header note).
-- ============================================================================
with params as (
  select 'REPLACE_JOB_ID'::uuid as job_id
)
select
  t.id                                    as translation_id,
  t.job_id,
  (t.translated_markdown is not null)      as has_translated_markdown,
  length(t.translated_markdown)            as translated_markdown_length,
  (t.translated_ast is not null)           as has_translated_ast,
  t.translated_pdf_key,
  t.translated_docx_key,
  t.translated_preview_pdf_key,
  t.qa_report,
  t.created_at                             as translation_created_at
from public.translations t
where t.job_id = (select job_id from params);

with params as (
  select 'REPLACE_JOB_ID'::uuid as job_id
)
select
  o.id,
  o.job_id,
  o.page_count,
  o.detected_language,
  o.provider,
  length(o.markdown)   as markdown_length,
  o.created_at
from public.ocr_results o
where o.job_id = (select job_id from params);


-- ============================================================================
-- SECTION 6B: job_result_files (2026-07-31 pipeline, migration 0063) — one row per
-- PRODUCED artifact at any stage, covering one or more job_source_files.sequence
-- values (many-to-one). status='ready' is the ONLY status the customer download
-- route/job-completion logic may act on — 'pending'/'failed' rows are not yet (or
-- never) deliverable. This is what makes a multi-source order's actual delivered
-- file(s) visible — without this section, a multi-file order's result state is
-- invisible to this tool (2026-08-02 user note: "без этого новый pipeline неудобно
-- проверять командой").
-- ============================================================================
with params as (
  select 'REPLACE_JOB_ID'::uuid as job_id
)
select
  jrf.id                  as result_file_id,
  jrf.stage,
  jrf.source_sequences,
  jrf.filename,
  jrf.status               as result_status,
  jrf.drive_file_id,
  jrf.r2_key,
  jrf.last_error,
  jrf.created_at,
  jrf.updated_at
from public.job_result_files jrf
where jrf.job_id = (select job_id from params)
order by jrf.stage, jrf.source_sequences;


-- ============================================================================
-- SECTION 7: Official final artifacts
--
-- No separate "final" object exists — translated_pdf_key/translated_docx_key are the
-- SAME files the worker rendered originally. "Final" for Official is purely
-- workflow_status reaching ready_for_delivery/delivered (human signature + stamp is
-- an OFFLINE/physical step tracked only via status + Google Drive subfolders, never
-- re-uploaded back into this table).
-- ============================================================================
with params as (
  select 'REPLACE_JOB_ID'::uuid as job_id
)
select
  j.service_level,
  j.workflow_status,
  t.translated_pdf_key,
  t.translated_docx_key,
  t.translated_preview_pdf_key,
  (
    j.service_level = 'official_with_translator_signature_and_provider_stamp'
    and j.workflow_status in ('ready_for_delivery', 'delivered')
  ) as official_download_should_be_available
from public.jobs j
left join public.translations t on t.job_id = j.id
where j.id = (select job_id from params);


-- ============================================================================
-- SECTION 8: Notarized artifacts / scans
--
-- No digital scan is ever stored in this system — notarization is a fully offline/
-- physical process. This section surfaces the workflow-status trail (job_audit_log)
-- as the only record of what happened and when.
-- ============================================================================
with params as (
  select 'REPLACE_JOB_ID'::uuid as job_id
)
select
  j.notarized,
  j.workflow_status,
  j.notary_city,
  j.fulfillment_method,
  j.delivery_phone,
  j.delivery_address,
  j.notary_urgency_level,
  j.notary_urgency_window,
  j.notary_urgency_multiplier,
  j.notary_urgency_cutoff_at,
  j.notary_urgency_fee_kzt
from public.jobs j
where j.id = (select job_id from params);

with params as (
  select 'REPLACE_JOB_ID'::uuid as job_id
)
select
  actor, source, action, previous_status, new_status, jira_issue_key, correlation_id, metadata, created_at
from public.job_audit_log
where job_id = (select job_id from params)
order by created_at asc;


-- ============================================================================
-- SECTION 9: Customer-download artifacts
--
-- can_customer_download mirrors src/lib/translation-workflow/customer-order-state.ts's
-- canCustomerDownload() exactly — keep this in sync manually if that logic changes.
-- There is no "download individually vs download-all" distinction in this system:
-- exactly one downloadable object exists per job (translated_pdf_key, served by
-- GET /api/documents/:documentId/download), or zero for notarized orders.
-- ============================================================================
with params as (
  select 'REPLACE_JOB_ID'::uuid as job_id
)
select
  j.service_level,
  j.workflow_status,
  j.status                       as job_status,
  case
    when j.service_level = 'notarization_through_partners' then false
    when j.service_level = 'official_with_translator_signature_and_provider_stamp'
      then j.workflow_status in ('ready_for_delivery', 'delivered')
    else j.status = 'completed'
  end                             as can_customer_download,
  t.translated_pdf_key,
  t.translated_docx_key
from public.jobs j
left join public.translations t on t.job_id = j.id
where j.id = (select job_id from params);


-- ============================================================================
-- SECTION 10: Google Drive folder / sync fields
--
-- Only the TOP-LEVEL folder is persisted. Subfolder ids (01_SOURCE, 02_AI_DRAFT,
-- 03_TRANSLATOR_RESULT, 04_SIGNATURE_AND_STAMP, 05_NOTARY, 06_FINAL — see
-- worker/src/lib/google-drive.ts DRIVE_SUBFOLDER_NAMES) are resolved live against the
-- Drive API when needed and are never stored in this database.
-- ============================================================================
with params as (
  select 'REPLACE_JOB_ID'::uuid as job_id
)
select
  google_drive_folder_id,
  google_drive_folder_url,
  drive_sync_status,
  jira_issue_id,
  jira_issue_key,
  jira_issue_url,
  jira_sync_status,
  last_integration_error,
  last_synced_at
from public.jobs
where id = (select job_id from params);


-- ============================================================================
-- SECTION 11: Integration errors (Jira main issue, price breakdown, finance report)
-- ============================================================================
with params as (
  select 'REPLACE_JOB_ID'::uuid as job_id
)
select
  last_integration_error,
  jira_sync_status,
  drive_sync_status,
  price_jira_sync_status,
  price_jira_last_error,
  finance_jira_sync_status,
  finance_jira_last_error
from public.jobs
where id = (select job_id from params);

with params as (
  select 'REPLACE_JOB_ID'::uuid as job_id
)
select actor, source, action, previous_status, new_status, jira_issue_key, correlation_id, metadata, created_at
from public.job_audit_log
where job_id = (select job_id from params)
  and (
    action ilike '%error%' or action ilike '%fail%' or
    metadata::text ilike '%error%'
  )
order by created_at asc;
