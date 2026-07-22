/**
 * Shared job_source_files creation, used by every job-creation entry point
 * (order-drafts convertDraftToOrder, documents/upload-card createCardOrder, and the
 * legacy documents/upload-card single-request route) — 2026-07-31/08-01 multi-file
 * fulfillment decision, migration 0063.
 */
import { supabaseServer } from '@/lib/supabase/server';

// job_source_files/job_result_files (migration 0063) aren't in the generated Database
// types yet — same `as any` pattern src/lib/document-analysis/service.ts uses for
// document_analysis until the types are regenerated post-migration.
const db = supabaseServer as any;

export interface JobSourceFileInput {
  sequence: number;
  originalName: string;
  r2Key: string;
  contentSha256: string;
  mimeType: string;
  physicalPageCount: number | null;
  /**
   * The per-source ALREADY-CONVERTED PDF the worker's OCR step reads (extractTextFromPdf
   * requires PDF input; r2Key holds the original bytes for Drive display/dedup, which may
   * be a jpg/png/docx). Every caller populates this from the same convertToPdf() call it
   * already ran per-source for merging — no PDF-conversion logic exists in the worker.
   */
  convertedPdfR2Key: string;
}

export type InsertJobSourceFilesResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Creates job_source_files rows for a newly-created job.
 *
 * `strict: true` (default, and the only mode any NEW order should ever use): an
 * insert failure here fails the whole job creation, because per-source worker
 * processing and the Drive-read-back sync depend on this row set being complete
 * and correct — a silently-missing row would let the worker process the wrong
 * source count or misalign result mapping. Callers must roll the job back to a
 * terminal failure state on `ok: false`, exactly like a saveQuote/job-insert
 * failure already does.
 *
 * `strict: false` is a TEMPORARY compatibility path — it exists ONLY for a draft
 * that predates migration 0063 (already sitting in `price_calculated` before this
 * fix shipped, so it has no per-source metadata at all to insert) being converted
 * after the deploy. It is never used by upload-card's createCardOrder or the
 * legacy upload-card route, since both create their job synchronously in the same
 * request that has the source metadata — there is no pre-0063 backlog for them.
 * Once every pre-0063 order_draft has expired or converted (order_drafts is not
 * long-lived — see its `expires_at`/cleanup cron), this fallback and the `strict`
 * parameter itself can be deleted and every caller can assume strict=true always.
 */
export async function insertJobSourceFiles(
  jobId: string,
  sources: JobSourceFileInput[],
  opts: { strict: boolean } = { strict: true },
): Promise<InsertJobSourceFilesResult> {
  const { error } = await db.from('job_source_files').insert(
    sources.map((s) => ({
      job_id: jobId,
      sequence: s.sequence,
      original_filename: s.originalName,
      r2_key: s.r2Key,
      content_sha256: s.contentSha256,
      mime_type: s.mimeType,
      physical_page_count: s.physicalPageCount,
      converted_pdf_r2_key: s.convertedPdfR2Key,
    })),
  );

  if (error) {
    if (opts.strict) return { ok: false, error: error.message };
    console.error('[job-source-files] insert failed (non-fatal, pre-0063-draft legacy path):', error.message);
  }
  return { ok: true };
}
