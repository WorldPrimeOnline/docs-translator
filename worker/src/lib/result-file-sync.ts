/**
 * Drive → R2 read-back sync for translator/signature-stamp/notary results
 * (2026-08-01 multi-file fulfillment decision). Reads ALL files currently in a Drive
 * folder, validates the NNN/NNN-MMM sequence mapping, downloads each, re-uploads to
 * R2, and upserts job_result_files — never exposing a raw Drive link or a partial/
 * inconsistent result set to the customer.
 *
 * Trigger mechanism: the Jira webhook route (src/app/api/webhooks/jira/route.ts)
 * only calls syncNotaryDone()/syncSignatureStamp equivalents, which set
 * workflow_status and notify staff — nothing in the web app has Drive/R2 access, and
 * the worker exposes no HTTP endpoint for the web app to call. The actual Drive
 * read-back always runs from this module's own periodic sweeps in
 * worker/src/index.ts, never synchronously from the webhook (explicit requirement —
 * a Jira Automation webhook must never block on Drive/R2 round-trips).
 *
 * 2026-07-24 SLA fix: signature_stamp (Official) keeps the general
 * reconcileResultFileSyncs() sweep at RESULT_SYNC_RECONCILE_INTERVAL_MS (3 minutes,
 * unchanged — no SLA was requested for it). Notary now ALSO gets
 * reconcileNotaryResultFileSync(), a notary-only sweep run every
 * NOTARY_RESULT_SYNC_INTERVAL_MS (30s) to satisfy a ≤60s "file ready in Drive →
 * visible in the customer's account" target: worst case is one 30s tick plus the
 * sync itself (typically well under a second for a handful of files), comfortably
 * under 60s. Both sweeps call the exact same idempotent syncResultFilesAndApplyCompletion()
 * — running notary through both on overlapping schedules is harmless by
 * construction (isStageAlreadySynced()/the upsert-by-(job,stage,source_sequences)
 * skip-when-unchanged logic already make a redundant pass a no-op).
 */
import { supabase } from './supabase';
import { listFilesInFolder, downloadFileFromDrive, getSubfolderId, DRIVE_SUBFOLDER_NAMES } from './google-drive';
import { uploadFile } from './r2';
import { validateResultFileMapping, isFullyCovered } from './result-file-mapping';
import {
  upsertJobResultFile,
  getResultFilesForStage,
  deleteJobResultFilesByIds,
  type JobResultFileStage,
} from './job-result-files';

export type ResultSyncStage = Extract<JobResultFileStage, 'signature_stamp' | 'notary'>;

export type SyncResultFilesOutcome =
  | { ok: true; groupsSynced: number; fullyCovered: true }
  | { ok: false; reason: string };

const EXT_MIME: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
};

function sequenceKey(sequences: number[]): string {
  return JSON.stringify([...sequences].sort((a, b) => a - b));
}

function rangeLabel(sequences: number[]): string {
  const sorted = [...sequences].sort((a, b) => a - b);
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  return first === last ? String(first).padStart(3, '0') : `${String(first).padStart(3, '0')}-${String(last).padStart(3, '0')}`;
}

/**
 * Reconciles the FULL current state of a Drive result folder against
 * job_result_files for (jobId, stage). Refuses to touch anything if the current
 * folder listing fails mapping validation (gap/overlap/out-of-range/ambiguous
 * unprefixed filename) — an invalid folder state must never publish a partial or
 * inconsistent result to the customer, and must never delete the last known-good
 * rows either (a transient bad listing must not regress a previously-working sync).
 */
export async function syncResultFilesFromDrive(params: {
  jobId: string;
  stage: ResultSyncStage;
  driveFolderId: string;
}): Promise<SyncResultFilesOutcome> {
  const { jobId, stage, driveFolderId } = params;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { count: totalSources } = await (supabase as any)
    .from('job_source_files')
    .select('id', { count: 'exact', head: true })
    .eq('job_id', jobId);

  if (!totalSources || totalSources === 0) {
    return { ok: false, reason: 'job has no job_source_files rows — not a multi-source job' };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: jobRow } = await (supabase as any)
    .from('jobs')
    .select('document_id')
    .eq('id', jobId)
    .single();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: docRow } = await (supabase as any)
    .from('documents')
    .select('user_id')
    .eq('id', jobRow?.document_id ?? '')
    .single();

  if (!jobRow?.document_id || !docRow?.user_id) {
    return { ok: false, reason: 'could not resolve document/user for job' };
  }

  let files;
  try {
    files = await listFilesInFolder(driveFolderId);
  } catch (err) {
    return { ok: false, reason: `Drive list failed: ${err instanceof Error ? err.message : String(err)}` };
  }

  if (files.length === 0) {
    return { ok: false, reason: 'no files found in Drive folder yet' };
  }

  const validation = validateResultFileMapping(totalSources, files.map((f) => ({ filename: f.name })));
  if (!validation.ok) {
    return { ok: false, reason: `mapping validation failed: ${validation.errors.join('; ')}` };
  }

  const byName = new Map(files.map((f) => [f.name, f.id]));
  const newKeys = new Set(validation.groups.map((g) => sequenceKey(g.sourceSequences)));

  // ── Reconcile: remove any existing row for this (job, stage) whose sequence set is
  // no longer represented by any current file — e.g. a grouped file was replaced by
  // several smaller ones. Never removes a row that still matches a current file. ──
  const existingRows = await getResultFilesForStage(jobId, stage);
  const staleIds = existingRows.filter((r) => !newKeys.has(sequenceKey(r.source_sequences))).map((r) => r.id);
  if (staleIds.length > 0) {
    const delResult = await deleteJobResultFilesByIds(staleIds);
    if (!delResult.ok) {
      return { ok: false, reason: `failed to remove superseded result rows: ${delResult.error}` };
    }
  }

  // ── Upsert each current group. Skip re-download/re-upload when this exact file
  // (same drive_file_id, same sequence key, already status='ready') is unchanged —
  // avoids redundant R2 traffic on every reconciler pass. ──
  const existingByKey = new Map(existingRows.map((r) => [sequenceKey(r.source_sequences), r]));

  for (const group of validation.groups) {
    const driveFileId = byName.get(group.filename)!;
    const key = sequenceKey(group.sourceSequences);
    const existing = existingByKey.get(key);
    if (existing && existing.status === 'ready' && existing.drive_file_id === driveFileId) {
      continue; // already synced, nothing changed
    }

    try {
      const buf = await downloadFileFromDrive(driveFileId);
      const ext = group.filename.split('.').pop()?.toLowerCase() ?? 'pdf';
      const mimeType = EXT_MIME[ext] ?? 'application/octet-stream';
      const r2Key = `documents/${docRow.user_id}/${jobRow.document_id}/results/${stage}/${rangeLabel(group.sourceSequences)}.${ext}`;
      await uploadFile(r2Key, buf, mimeType);

      const upsertResult = await upsertJobResultFile({
        jobId,
        stage,
        sourceSequences: group.sourceSequences,
        filename: group.filename,
        status: 'ready',
        r2Key,
        driveFileId,
      });
      if (!upsertResult.ok) {
        return { ok: false, reason: `job_result_files upsert failed for "${group.filename}": ${upsertResult.error}` };
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      await upsertJobResultFile({
        jobId,
        stage,
        sourceSequences: group.sourceSequences,
        filename: group.filename,
        status: 'failed',
        lastError: reason,
      });
      return { ok: false, reason: `download/upload failed for "${group.filename}": ${reason}` };
    }
  }

  return { ok: true, groupsSynced: validation.groups.length, fullyCovered: true };
}

async function isStageAlreadySynced(jobId: string, stage: ResultSyncStage): Promise<boolean> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { count: totalSources } = await (supabase as any)
    .from('job_source_files')
    .select('id', { count: 'exact', head: true })
    .eq('job_id', jobId);
  if (!totalSources) return false;

  const rows = await getResultFilesForStage(jobId, stage);
  const readyGroups = rows.filter((r) => r.status === 'ready').map((r) => r.source_sequences);
  return isFullyCovered(totalSources, readyGroups);
}

/**
 * Runs the sync for one job/stage and applies the Notary completion side-effect on
 * success — pickup fulfillment completes the document right after a successful sync
 * (no separate physical event to wait for); delivery fulfillment does NOT complete
 * the document here (digital access is already available via job_result_files being
 * 'ready' — see getCustomerOrderState's hasReadyResultFiles input — but the order
 * stays open until syncDelivered fires). Official (signature_stamp) has no completion
 * side-effect here — that stays gated on the existing operator ORDER_READY step.
 */
export async function syncResultFilesAndApplyCompletion(params: {
  jobId: string;
  stage: ResultSyncStage;
  driveFolderId: string;
}): Promise<SyncResultFilesOutcome> {
  const result = await syncResultFilesFromDrive(params);
  if (!result.ok || params.stage !== 'notary') return result;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: jobRow } = await (supabase as any)
    .from('jobs')
    .select('document_id, fulfillment_method')
    .eq('id', params.jobId)
    .single();

  if (jobRow?.fulfillment_method === 'pickup' && jobRow.document_id) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any).from('documents').update({ status: 'completed' }).eq('id', jobRow.document_id);
  }

  return result;
}

/** Trigger candidates: workflow_status values at or past the point where the
 * relevant Drive folder should already contain the staff-uploaded result. */
const OFFICIAL_TRIGGER_STATUSES = ['translator_approved', 'ready_for_delivery', 'delivered'];
const NOTARY_TRIGGER_STATUSES = ['notarized', 'ready_for_delivery', 'ready_for_pickup', 'out_for_delivery', 'delivered', 'picked_up'];

function getResultSyncMaxItemsPerCycle(): number {
  const raw = process.env.RESULT_SYNC_RECONCILE_BATCH_SIZE;
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isInteger(n) && n > 0 ? n : 10;
}

interface ResultSyncCandidate {
  id: string;
  google_drive_folder_id: string | null;
}

async function findCandidates(stage: ResultSyncStage, serviceLevel: string, statuses: string[], limit: number): Promise<ResultSyncCandidate[]> {
  // job_source_files!inner(id) filters to jobs that actually have at least one
  // source row — a plain single-file job is never a candidate for this sync.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('jobs')
    .select('id, google_drive_folder_id, job_source_files!inner(id)')
    .eq('service_level', serviceLevel)
    .in('workflow_status', statuses)
    .not('google_drive_folder_id', 'is', null)
    .limit(limit);

  if (error) {
    console.error(`[result-sync-reconcile] DB error fetching ${stage} candidates:`, error.message);
    return [];
  }
  return (data ?? []) as ResultSyncCandidate[];
}

interface StageSweepConfig {
  stage: ResultSyncStage;
  serviceLevel: string;
  statuses: string[];
  subfolder: string;
}

const SIGNATURE_STAMP_SWEEP: StageSweepConfig = {
  stage: 'signature_stamp',
  serviceLevel: 'official_with_translator_signature_and_provider_stamp',
  statuses: OFFICIAL_TRIGGER_STATUSES,
  subfolder: DRIVE_SUBFOLDER_NAMES.signatureStamp,
};

const NOTARY_SWEEP: StageSweepConfig = {
  stage: 'notary',
  serviceLevel: 'notarization_through_partners',
  statuses: NOTARY_TRIGGER_STATUSES,
  subfolder: DRIVE_SUBFOLDER_NAMES.notary,
};

/**
 * One reconciler pass for a single stage — retries every candidate whose stage isn't
 * yet fully covered by 'ready' job_result_files rows. Shared by both
 * reconcileResultFileSyncs() (all stages, 3-minute cadence) and
 * reconcileNotaryResultFileSync() (notary only, 30s cadence) — see this file's top
 * doc comment for why notary gets its own faster sweep.
 */
async function reconcileStage({ stage, serviceLevel, statuses, subfolder }: StageSweepConfig, maxItemsPerCycle: number): Promise<void> {
  const candidates = await findCandidates(stage, serviceLevel, statuses, maxItemsPerCycle);
  if (candidates.length === 0) return;

  for (const job of candidates) {
    try {
      if (await isStageAlreadySynced(job.id, stage)) continue;
      if (!job.google_drive_folder_id) continue;

      const folderId = await getSubfolderId(job.google_drive_folder_id, subfolder);
      if (!folderId) {
        console.error(`[result-sync-reconcile] job ${job.id.slice(0, 8)}: ${subfolder} subfolder not found`);
        continue;
      }

      const result = await syncResultFilesAndApplyCompletion({ jobId: job.id, stage, driveFolderId: folderId });
      if (result.ok) {
        console.log(`[result-sync-reconcile] ✓ job ${job.id.slice(0, 8)} [${stage}] synced (${result.groupsSynced} group(s))`);
      } else {
        console.warn(`[result-sync-reconcile] job ${job.id.slice(0, 8)} [${stage}] still not ready: ${result.reason}`);
      }
    } catch (err) {
      console.error(`[result-sync-reconcile] job ${job.id.slice(0, 8)} [${stage}] unexpected error (non-fatal):`, err instanceof Error ? err.message : String(err));
    }
  }
}

/**
 * Periodic sweep, all stages — matches the existing reconcileMissingJiraIssues()/
 * reconcilePendingPriceBreakdownIssues() pattern in worker/src/index.ts. Run every
 * RESULT_SYNC_RECONCILE_INTERVAL_MS (3 minutes) plus once at worker startup.
 */
export async function reconcileResultFileSyncs(): Promise<void> {
  const maxItemsPerCycle = getResultSyncMaxItemsPerCycle();
  await reconcileStage(SIGNATURE_STAMP_SWEEP, maxItemsPerCycle);
  await reconcileStage(NOTARY_SWEEP, maxItemsPerCycle);
}

/**
 * 2026-07-24 SLA fix: notary-only sweep, run every NOTARY_RESULT_SYNC_INTERVAL_MS
 * (30s, see worker/src/index.ts) so a file that lands in 05_NOTARY after
 * NOTARY_COMPLETED becomes visible to the customer within ≤60s worst case, instead
 * of waiting for the general 3-minute sweep. Deliberately does not touch
 * signature_stamp — no faster SLA was requested for Official, and reusing the same
 * reconcileStage() means notary gets identical idempotency/error-handling guarantees
 * on both the fast and slow sweep.
 */
export async function reconcileNotaryResultFileSync(): Promise<void> {
  const maxItemsPerCycle = getResultSyncMaxItemsPerCycle();
  await reconcileStage(NOTARY_SWEEP, maxItemsPerCycle);
}
