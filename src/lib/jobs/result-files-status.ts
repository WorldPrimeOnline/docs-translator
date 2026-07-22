/**
 * DB-aware lookup of a job's job_result_files readiness — 2026-08-01 multi-file
 * fulfillment decision. The pure coverage check itself lives in
 * src/lib/translation-workflow/result-file-coverage.ts (dependency-free, shared
 * convention with customer-order-state.ts); this module does the actual query and
 * decides which stage(s) are relevant for a given service level.
 *
 * Used by /api/jobs, /api/jobs/[jobId], and the download route so all three agree on
 * exactly the same definition of "ready" — never re-derive this logic separately.
 */
import { supabaseServer } from '@/lib/supabase/server';
import { isFullyCovered } from '@/lib/translation-workflow/result-file-coverage';

export interface ReadyResultFile {
  sequenceMin: number;
  sourceSequences: number[];
  filename: string;
  r2Key: string;
}

export interface ResultFilesStatus {
  /** Whether this job has any job_source_files rows at all (multi-source design). */
  isMultiSource: boolean;
  /** Only meaningful when isMultiSource is true. */
  hasReadyResultFiles: boolean;
  /** Only populated when hasReadyResultFiles is true — the actual artifacts to serve,
   * already sorted by minimum source sequence (see the user's download-ordering rule). */
  readyFiles: ReadyResultFile[];
}

const STAGES_BY_SERVICE_LEVEL: Record<string, string[]> = {
  electronic: ['electronic_final_pdf', 'electronic_final_docx', 'electronic_final_html'],
  official_with_translator_signature_and_provider_stamp: ['signature_stamp'],
  notarization_through_partners: ['notary'],
};

interface ResultFileRow {
  stage: string;
  source_sequences: number[];
  filename: string;
  r2_key: string | null;
}

export async function getResultFilesStatus(jobId: string, serviceLevel: string | null): Promise<ResultFilesStatus> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { count: totalSources } = await (supabaseServer as any)
    .from('job_source_files')
    .select('id', { count: 'exact', head: true })
    .eq('job_id', jobId);

  if (!totalSources || totalSources === 0) {
    return { isMultiSource: false, hasReadyResultFiles: false, readyFiles: [] };
  }

  const stages = STAGES_BY_SERVICE_LEVEL[serviceLevel ?? 'electronic'] ?? [];
  if (stages.length === 0) return { isMultiSource: true, hasReadyResultFiles: false, readyFiles: [] };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabaseServer as any)
    .from('job_result_files')
    .select('stage, source_sequences, filename, r2_key, status')
    .eq('job_id', jobId)
    .in('stage', stages)
    .eq('status', 'ready');

  const rows = (data ?? []) as ResultFileRow[];

  const byStage = new Map<string, ResultFileRow[]>();
  for (const r of rows) {
    const list = byStage.get(r.stage) ?? [];
    list.push(r);
    byStage.set(r.stage, list);
  }

  // A job's output format is fixed at creation time, so at most one stage should
  // ever have rows — but defensively check each independently rather than assuming.
  for (const stageRows of byStage.values()) {
    if (!isFullyCovered(totalSources, stageRows.map((r) => r.source_sequences))) continue;

    const readyFiles: ReadyResultFile[] = stageRows
      .filter((r): r is ResultFileRow & { r2_key: string } => !!r.r2_key)
      .map((r) => ({
        sequenceMin: Math.min(...r.source_sequences),
        sourceSequences: r.source_sequences,
        filename: r.filename,
        r2Key: r.r2_key,
      }))
      .sort((a, b) => a.sequenceMin - b.sequenceMin);

    // Coverage was computed over ALL rows for the stage, including any missing an
    // r2_key — if filtering dropped one, the set is no longer actually complete.
    if (readyFiles.length === stageRows.length) {
      return { isMultiSource: true, hasReadyResultFiles: true, readyFiles };
    }
  }

  return { isMultiSource: true, hasReadyResultFiles: false, readyFiles: [] };
}
