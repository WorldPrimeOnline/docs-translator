-- Migration 0052: document_analysis
--
-- Versioned, revisable record of document text/character/page-count analysis, run
-- asynchronously BEFORE a quote can be created (2026-07-17 decision). Today the checkout flow
-- quotes on a hardcoded physicalPageCount=1 guess before any OCR/text-extraction happens
-- (src/lib/documents/upload-card-shared.ts, src/lib/order-drafts/service.ts) — this table
-- introduces real, measured character counts as a precondition for quote creation.
--
-- A document may have MANY rows (revisions) — this is never a single mutable row per
-- document. price_quotes.analysis_id (migration 0053) always references one SPECIFIC
-- completed revision, never "latest for this document" implicitly. DOCX analysis is
-- synchronous (method='docx_text', status='completed' immediately, no pending/processing
-- state) — PDF/image analysis goes through pending -> processing -> completed |
-- requires_operator_review | failed via the worker's claim/poll loop.
--
-- Dedup scope (2026-07-17 decision, corrected during planning): strictly within the same
-- document_id — NOT cross-document, even for the same owner (that broader dedup was
-- considered and explicitly rejected as an unnecessary privacy-engineering risk for a case
-- that doesn't actually occur in this task's flows). Cross-user dedup is categorically
-- forbidden and is structurally impossible here since the key never spans documents.
--
-- RLS: enabled with ZERO policies, matching order_drafts (migration 0044) and
-- cost_reservations (migration 0022) — NOT an auth.uid()-keyed policy, because this table
-- must also serve anonymous order-draft sessions, and this codebase's anonymous-ownership
-- model is enforced entirely in application code (see src/lib/order-drafts/service.ts
-- isOwner()), never via Postgres RLS — there is no precedent anywhere in this schema for an
-- RLS policy that understands a session cookie. All access goes through the service-role
-- client from the new GET /api/documents/:documentId/analysis-status endpoint, which performs
-- its own ownership check (authenticated auth.uid() match, or anonymous session-cookie match
-- joined back to the owning documents/order_drafts row) before returning anything.

CREATE TABLE IF NOT EXISTS public.document_analysis (
  id                                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id                        uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  owner_user_id                      uuid REFERENCES public.users(id) ON DELETE SET NULL,
  owner_session_id                   text,
  revision                           integer NOT NULL DEFAULT 1,
  supersedes_analysis_id             uuid REFERENCES public.document_analysis(id) ON DELETE SET NULL,
  status                             text NOT NULL CHECK (status IN (
                                        'pending', 'processing', 'completed',
                                        'requires_operator_review', 'failed'
                                      )),
  method                             text CHECK (method IN (
                                        'pdf_text_layer', 'ocr', 'docx_text', 'manual'
                                      )),
  source_character_count_with_spaces integer,
  translation_page_count_exact       numeric(12,6),
  physical_page_count                integer,
  page_count_method                  text CHECK (page_count_method IN (
                                        'pdf_lib_page_count', 'manual', 'ocr_page_count'
                                      )),
  content_sha256                     text,
  analysis_quality_signals           jsonb NOT NULL DEFAULT '{}'::jsonb,
  operator_note                      text,
  operator_actor                     text,
  attempt_count                      integer NOT NULL DEFAULT 0,
  started_at                         timestamptz,
  completed_at                       timestamptz,
  failure_reason                     text,
  created_at                         timestamptz NOT NULL DEFAULT now(),
  updated_at                         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, revision)
);

COMMENT ON TABLE public.document_analysis IS
  'Versioned, per-revision record of document text/character/page-count analysis. price_quotes.analysis_id always references one SPECIFIC row, never "latest for this document" implicitly. DOCX rows are created directly in status=completed (no pending/processing) — PDF/image rows go through the async worker pipeline.';
COMMENT ON COLUMN public.document_analysis.content_sha256 IS
  'Used ONLY for dedup within the same document_id (prevents re-running analysis for retries/re-polls of the SAME upload) — never compared across different document_id rows, even for the same owner. Cross-user dedup is structurally impossible: the dedup lookup never spans documents.';
COMMENT ON COLUMN public.document_analysis.analysis_quality_signals IS
  'Real signals only (empty_page_count, textless_page_fraction, ocr_error_count, handwritten_detected, method, attempts) — never a fabricated single "confidence" score. Deliberately not named ocr_confidence.';
COMMENT ON COLUMN public.document_analysis.status IS
  'pending -> processing -> completed | requires_operator_review | failed. requires_operator_review NEVER auto-creates a quote — an operator must supply method=manual fields (source_character_count_with_spaces, translation_page_count_exact, operator_note, operator_actor) and trigger quote creation explicitly.';
COMMENT ON COLUMN public.document_analysis.revision IS
  'Monotonically increasing per document_id. Multiple completed revisions for the same document_id (and even the same content_sha256) are expected and allowed — e.g. an operator-corrected re-analysis after requires_operator_review. See idx_document_analysis_one_active for the separate "only one in-flight analysis at a time" rule.';

CREATE INDEX IF NOT EXISTS idx_document_analysis_document_id
  ON public.document_analysis (document_id, revision DESC);

-- At most one analysis "in flight" (pending or processing) per document at a time — prevents
-- two concurrent analysis attempts on the same document. Does NOT limit how many completed
-- revisions may exist (see UNIQUE(document_id, revision) above, which is the real identity
-- constraint).
CREATE UNIQUE INDEX IF NOT EXISTS idx_document_analysis_one_active
  ON public.document_analysis (document_id)
  WHERE status IN ('pending', 'processing');

CREATE INDEX IF NOT EXISTS idx_document_analysis_status_processing
  ON public.document_analysis (status, started_at)
  WHERE status = 'processing';

-- Application-level dedup lookup index: most recent completed revision for a document_id +
-- content hash. NOT a uniqueness constraint (multiple completed revisions with the same hash
-- are allowed) — purely to make the "reuse a prior completed analysis" query fast.
CREATE INDEX IF NOT EXISTS idx_document_analysis_dedup_lookup
  ON public.document_analysis (document_id, content_sha256, completed_at DESC)
  WHERE status = 'completed' AND content_sha256 IS NOT NULL;

ALTER TABLE public.document_analysis ENABLE ROW LEVEL SECURITY;
-- Service-role only — no policies. See header comment for why (anonymous session ownership
-- is enforced in application code, not RLS, matching order_drafts/cost_reservations).
