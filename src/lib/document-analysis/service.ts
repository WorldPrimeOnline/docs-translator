/**
 * DB-backed, idempotent wrapper around analyzeDocumentForPricing() (analyze.ts — pure function,
 * unchanged) for the document_analysis table (migration 0052). Ensures checkout never re-runs
 * OCR/text-extraction twice for the same document: reuses a completed revision, refuses to start
 * a second analysis while one is already in flight, and creates exactly one new revision when
 * none exists yet.
 *
 * Runs synchronously within the calling request (2026-07-22 decision — no separate worker
 * claim/poll loop for this pass, unlike the pending/processing state machine migration 0052's
 * own header comment originally described; see docs/ai-context/DECISIONS.md). A concurrent
 * duplicate request racing in is caught by idx_document_analysis_one_active (a partial unique
 * index on (document_id) WHERE status IN ('pending','processing')) — the insert simply fails,
 * and that failure is treated as "already in flight", never as a hard error.
 */
import { supabaseServer } from '@/lib/supabase/server';
import { analyzeDocumentForPricing, type AnalyzeDocumentOptions } from './analyze';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabaseServer as any;

export interface DocumentAnalysisRow {
  id: string;
  documentId: string;
  revision: number;
  status: 'pending' | 'processing' | 'completed' | 'requires_operator_review' | 'failed';
  method: string | null;
  sourceCharacterCountWithSpaces: number | null;
  physicalPageCount: number | null;
}

export type ResolveAnalysisResult =
  | { kind: 'completed'; row: DocumentAnalysisRow }
  | { kind: 'requires_operator_review'; row: DocumentAnalysisRow; reasons: string[] }
  | { kind: 'in_progress' }
  | { kind: 'failed'; reason: string };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRow(row: any): DocumentAnalysisRow {
  return {
    id: row.id,
    documentId: row.document_id,
    revision: row.revision,
    status: row.status,
    method: row.method ?? null,
    sourceCharacterCountWithSpaces: row.source_character_count_with_spaces ?? null,
    physicalPageCount: row.physical_page_count ?? null,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getLatestRow(documentId: string): Promise<any | null> {
  const { data } = await db
    .from('document_analysis')
    .select('*')
    .eq('document_id', documentId)
    .order('revision', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

/**
 * The single entry point checkout uses to get a real, measured page/character count before
 * calling computeQuoteForJob(). Never fabricates a physical page count — mirrors the same
 * "reliablePhysicalPageCount or null" rule the calculator itself enforces.
 */
export async function resolveDocumentAnalysisForPricing(
  documentId: string,
  mimeType: string,
  fetchBuffer: () => Promise<Buffer>,
  options?: AnalyzeDocumentOptions,
): Promise<ResolveAnalysisResult> {
  const latest = await getLatestRow(documentId);

  if (latest?.status === 'completed') {
    return { kind: 'completed', row: mapRow(latest) };
  }
  if (latest?.status === 'requires_operator_review') {
    return { kind: 'requires_operator_review', row: mapRow(latest), reasons: latest.failure_reason ? [latest.failure_reason as string] : [] };
  }
  if (latest?.status === 'pending' || latest?.status === 'processing') {
    return { kind: 'in_progress' };
  }

  // No usable row exists yet (none at all, or the latest was 'failed') — claim exactly one new
  // revision. Never retries a failed row in place; always a fresh, immutable revision.
  const nextRevision = (latest?.revision ?? 0) + 1;
  const { data: inserted, error: insertError } = await db
    .from('document_analysis')
    .insert({
      document_id: documentId,
      revision: nextRevision,
      supersedes_analysis_id: latest?.id ?? null,
      status: 'pending',
      started_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (insertError || !inserted) {
    // A concurrent request already claimed the in-flight slot for this document
    // (idx_document_analysis_one_active) — never a second analysis attempt, never a hard error.
    return { kind: 'in_progress' };
  }

  const analysisId = inserted.id as string;
  await db.from('document_analysis').update({ status: 'processing' }).eq('id', analysisId);

  let result;
  try {
    const buffer = await fetchBuffer();
    result = await analyzeDocumentForPricing(buffer, mimeType, options);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await db
      .from('document_analysis')
      .update({ status: 'failed', failure_reason: reason, completed_at: new Date().toISOString() })
      .eq('id', analysisId);
    return { kind: 'failed', reason };
  }

  const finalStatus = result.requiresOperatorReview ? 'requires_operator_review' : 'completed';
  const { data: updated } = await db
    .from('document_analysis')
    .update({
      status: finalStatus,
      method: result.method,
      source_character_count_with_spaces: result.characterCount,
      physical_page_count: result.physicalPageCount,
      page_count_method: result.physicalPageCount != null ? 'pdf_lib_page_count' : null,
      analysis_quality_signals: result.qualitySignals,
      failure_reason: result.requiresOperatorReview ? result.reviewReasons.join('; ') : null,
      completed_at: new Date().toISOString(),
    })
    .eq('id', analysisId)
    .select('*')
    .single();

  const row = mapRow(updated);
  return finalStatus === 'completed'
    ? { kind: 'completed', row }
    : { kind: 'requires_operator_review', row, reasons: result.reviewReasons };
}
