-- Migration 0061: order_drafts.analysis_snapshot — cache document analysis before a real
-- documents row exists
--
-- document_analysis.document_id (migration 0052) is a NOT NULL FK to documents — but an
-- order_drafts row (the anonymous pre-signup /start wizard, 2026-07-22) has no real documents
-- row until convertDraftToOrder() runs, well after price calculation. Without a cache, every
-- "recalculate price" click on the same draft (e.g. after changing the language pair) would
-- re-run analyzeDocumentForPricing() — including real OCR for a scanned document — from
-- scratch. This column caches that one analysis result, keyed by file_keys[0].key, so a repeat
-- price calculation for the SAME uploaded file reuses it instead of re-analyzing.
--
-- Once convertDraftToOrder() creates a real documents row, this cached result is materialized
-- into exactly one document_analysis row (see src/lib/order-drafts/service.ts) — this column is
-- never itself referenced by price_quotes or any other table; it is purely a pre-document cache.

ALTER TABLE public.order_drafts
  ADD COLUMN IF NOT EXISTS analysis_snapshot jsonb;

COMMENT ON COLUMN public.order_drafts.analysis_snapshot IS
  'Cached analyzeDocumentForPricing() result for file_keys[0] (method, characterCount, physicalPageCount, requiresOperatorReview, reviewReasons), keyed by fileKey — see resolveDraftAnalysis() in src/lib/order-drafts/service.ts. Invalidated only by a different file_keys[0].key (re-upload). Pre-document equivalent of document_analysis''s reuse guarantee; never itself referenced by price_quotes.';
