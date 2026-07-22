/**
 * Idempotent job_result_files writes — 2026-08-01 multi-file fulfillment decision,
 * migration 0063. Every write in this module goes through upsertJobResultFile(), never
 * a blind insert, so retries (a re-rendered AI draft, a re-run Drive sync) update the
 * existing row in place instead of creating a duplicate. The conflict target is the DB
 * unique constraint on (job_id, stage, source_sequences) — see the migration.
 *
 * source_sequences MUST be passed pre-sorted ascending: Postgres array equality is
 * positional, so [1,2] and [2,1] would be treated as different upsert targets and defeat
 * idempotency. sortSequences() below is the single place that ordering is enforced.
 */
import { supabase } from './supabase';

export type JobResultFileStage =
  | 'ai_draft'
  | 'electronic_final_pdf'
  | 'electronic_final_docx'
  | 'electronic_final_html'
  | 'translator_result'
  | 'signature_stamp'
  | 'notary'
  | 'final';

export type JobResultFileStatus = 'pending' | 'ready' | 'failed';

export interface UpsertJobResultFileInput {
  jobId: string;
  stage: JobResultFileStage;
  sourceSequences: number[];
  filename: string;
  status: JobResultFileStatus;
  driveFileId?: string | null;
  /** Null until the artifact is durably re-hosted in R2 — never a raw Drive link. */
  r2Key?: string | null;
  lastError?: string | null;
}

export type UpsertJobResultFileResult =
  | { ok: true }
  | { ok: false; error: string };

function sortSequences(sequences: number[]): number[] {
  return [...sequences].sort((a, b) => a - b);
}

export async function upsertJobResultFile(input: UpsertJobResultFileInput): Promise<UpsertJobResultFileResult> {
  // job_result_files (migration 0063) isn't in the generated Database types yet.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from('job_result_files')
    .upsert(
      {
        job_id: input.jobId,
        stage: input.stage,
        source_sequences: sortSequences(input.sourceSequences),
        filename: input.filename,
        drive_file_id: input.driveFileId ?? null,
        r2_key: input.r2Key ?? null,
        status: input.status,
        last_error: input.lastError ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'job_id,stage,source_sequences' },
    );

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export interface ExistingJobResultFileRow {
  id: string;
  source_sequences: number[];
  status: JobResultFileStatus;
  drive_file_id: string | null;
}

/** All current rows for (jobId, stage) — used by the Drive sync reconciler to diff
 * the current Drive folder listing against what's already stored. */
export async function getResultFilesForStage(jobId: string, stage: JobResultFileStage): Promise<ExistingJobResultFileRow[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any)
    .from('job_result_files')
    .select('id, source_sequences, status, drive_file_id')
    .eq('job_id', jobId)
    .eq('stage', stage);
  return (data ?? []) as ExistingJobResultFileRow[];
}

/**
 * Deletes job_result_files rows by id — used ONLY to remove rows superseded by a
 * folder reconciliation (e.g. staff replaced one grouped file covering [1..10] with
 * two smaller files covering [1..5] and [6..10]; the stale [1..10] row must not
 * linger and be double-counted as coverage alongside the two new rows).
 */
export async function deleteJobResultFilesByIds(ids: string[]): Promise<UpsertJobResultFileResult> {
  if (ids.length === 0) return { ok: true };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).from('job_result_files').delete().in('id', ids);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
