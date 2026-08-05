import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { deleteFile, listObjectsByPrefix } from '@/lib/r2/client';
import { trashOrderFolder } from '@/lib/google-drive/client';
import { RAW_UPLOAD_PREFIX } from '@/lib/order-drafts/upload-constants';

const RETENTION_DAYS = 30;
const RAW_UPLOAD_RETENTION_HOURS = 24;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabaseServer as any;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get('authorization');

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { filesPurged, errors } = await purgeExpiredDocumentFiles(cutoff);
  const drivePurged = await purgeExpiredDriveFolders();
  const draftsDeleted = await cleanupExpiredOrderDrafts();
  const rawUploadsDeleted = await cleanupOrphanedRawUploads();

  return NextResponse.json({
    filesPurged,
    drivePurged,
    errors: errors.length > 0 ? errors : undefined,
    draftsDeleted,
    rawUploadsDeleted,
  });
}

/**
 * 2026-07-24 retention fix (metadata-preserving cleanup).
 *
 * The previous version of this function deleted the ENTIRE `documents` row past
 * RETENTION_DAYS, intending a CASCADE through jobs -> translations/ocr_results. That
 * already silently failed for any order with a fiscal_receipts or refund_transactions
 * row: those tables reference jobs/documents/payment_transactions with NO `ON DELETE`
 * clause (default NO ACTION/RESTRICT in Postgres — confirmed by reading every
 * migration that touches them; nothing ever added an explicit ON DELETE), so
 * cascading the documents delete through jobs into a fiscalized job's row was always
 * rejected by the FK constraint. Worse: the R2 object deletes below ran BEFORE that
 * failing row-delete was even attempted, and are not transactional with it — so for
 * every paid/fiscalized order past 30 days, the R2 files were already being deleted
 * while documents/jobs/translations silently survived with dead R2 keys (broken
 * downloads, no expiry messaging, never surfaced anywhere).
 *
 * New model: never delete documents/jobs/price_quotes/price_quote_items/
 * payment_transactions/fiscal_receipts/refund_transactions/cost_reservations rows.
 * Only ever delete the R2 objects themselves and the job_source_files/
 * job_result_files rows that reference them (removing the customer/staff-supplied
 * original filenames along with the now-dead references — job_source_files/
 * job_result_files must no longer be able to grant a download once purged). Legacy
 * single-file jobs' `translations`/`ocr_results` text columns (NOT NULL — cannot be
 * set to NULL) are replaced with a short placeholder rather than left holding the
 * full source/translated document text indefinitely past the stated retention
 * window. `documents.files_purged_at` is the sole authoritative "purged" marker,
 * selected on (`created_at < cutoff AND files_purged_at IS NULL`) so a second run is
 * a pure no-op for anything already purged — idempotent by construction.
 */
async function purgeExpiredDocumentFiles(cutoff: string): Promise<{ filesPurged: number; errors: string[] }> {
  const { data: docs, error } = await db
    .from('documents')
    .select('id, file_key')
    .lt('created_at', cutoff)
    .is('files_purged_at', null)
    .limit(100);

  if (error) {
    console.error('[cleanup] failed to fetch documents due for retention purge:', error.message);
    return { filesPurged: 0, errors: [error.message] };
  }
  if (!docs || docs.length === 0) return { filesPurged: 0, errors: [] };

  let filesPurged = 0;
  const errors: string[] = [];

  for (const doc of docs as Array<{ id: string; file_key: string }>) {
    try {
      const { data: jobs } = await db.from('jobs').select('id').eq('document_id', doc.id);
      const jobIds = (jobs ?? []).map((j: { id: string }) => j.id);

      if (jobIds.length > 0) {
        // Legacy single-file path: delete the translated PDF from R2, then replace the
        // text columns (NOT NULL) with a placeholder — never leave full source/
        // translated document text sitting in the DB past the retention window.
        const { data: translations } = await db
          .from('translations')
          .select('id, translated_pdf_key')
          .in('job_id', jobIds);
        for (const t of (translations ?? []) as Array<{ id: string; translated_pdf_key: string }>) {
          await deleteFile(t.translated_pdf_key).catch((e: unknown) => {
            console.error('[cleanup] R2 delete translated failed:', t.translated_pdf_key, e);
          });
        }
        if (translations && translations.length > 0) {
          await db.from('translations').update({ translated_markdown: '[purged: retention period expired]' }).in('job_id', jobIds);
        }
        await db.from('ocr_results').update({ markdown: '[purged: retention period expired]' }).in('job_id', jobIds);

        // Multi-source path (2026-08-01 model): delete every source/result R2 object,
        // then delete the rows themselves — this is what makes hasReadyResultFiles
        // (and therefore canCustomerDownload) naturally and permanently false again,
        // and removes the customer/staff-supplied original filenames.
        const { data: sourceFiles } = await db
          .from('job_source_files')
          .select('r2_key, converted_pdf_r2_key')
          .in('job_id', jobIds);
        for (const sf of (sourceFiles ?? []) as Array<{ r2_key: string; converted_pdf_r2_key: string | null }>) {
          await deleteFile(sf.r2_key).catch((e: unknown) => console.error('[cleanup] R2 delete job_source_files.r2_key failed:', sf.r2_key, e));
          if (sf.converted_pdf_r2_key) {
            await deleteFile(sf.converted_pdf_r2_key).catch((e: unknown) => console.error('[cleanup] R2 delete job_source_files.converted_pdf_r2_key failed:', sf.converted_pdf_r2_key, e));
          }
        }

        const { data: resultFiles } = await db
          .from('job_result_files')
          .select('r2_key')
          .in('job_id', jobIds);
        for (const rf of (resultFiles ?? []) as Array<{ r2_key: string | null }>) {
          if (rf.r2_key) {
            await deleteFile(rf.r2_key).catch((e: unknown) => console.error('[cleanup] R2 delete job_result_files.r2_key failed:', rf.r2_key, e));
          }
        }

        await db.from('job_source_files').delete().in('job_id', jobIds);
        await db.from('job_result_files').delete().in('job_id', jobIds);
      }

      // Original uploaded file.
      await deleteFile(doc.file_key).catch((e: unknown) => {
        console.error('[cleanup] R2 delete original failed:', doc.file_key, e);
      });

      const { error: markError } = await db
        .from('documents')
        .update({ files_purged_at: new Date().toISOString() })
        .eq('id', doc.id);

      if (markError) {
        errors.push(`doc ${doc.id}: ${markError.message}`);
      } else {
        filesPurged++;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`doc ${doc.id}: ${msg}`);
    }
  }

  console.log(`[cleanup] purged files for ${filesPurged}/${docs.length} documents (rows preserved)`);
  return { filesPurged, errors };
}

/**
 * Independent, best-effort Drive-folder cleanup sweep. Deliberately decoupled from
 * purgeExpiredDocumentFiles(): a Drive failure must never block or be blocked by the
 * R2/DB purge (documents.files_purged_at). Only ever considers documents whose files
 * have ALREADY been purged (files_purged_at IS NOT NULL) and whose drive_purged_at is
 * still NULL — a second run only retries the jobs that failed or were never attempted,
 * never re-processes an already-trashed folder.
 */
async function purgeExpiredDriveFolders(): Promise<number> {
  const { data: docs, error } = await db
    .from('documents')
    .select('id')
    .not('files_purged_at', 'is', null)
    .is('drive_purged_at', null)
    .limit(100);

  if (error) {
    console.error('[cleanup] failed to fetch documents due for Drive purge:', error.message);
    return 0;
  }
  if (!docs || docs.length === 0) return 0;

  let purged = 0;

  for (const doc of docs as Array<{ id: string }>) {
    try {
      const { data: jobs } = await db
        .from('jobs')
        .select('google_drive_folder_id')
        .eq('document_id', doc.id)
        .not('google_drive_folder_id', 'is', null)
        .limit(1);

      const folderId = (jobs ?? [])[0]?.google_drive_folder_id as string | undefined;

      // No Drive folder for this order (e.g. Electronic — never creates one) —
      // trivially "done", mark it so this sweep never re-considers it.
      if (!folderId) {
        await db.from('documents').update({ drive_purged_at: new Date().toISOString() }).eq('id', doc.id);
        purged++;
        continue;
      }

      const ok = await trashOrderFolder(folderId);
      if (ok) {
        await db.from('documents').update({ drive_purged_at: new Date().toISOString() }).eq('id', doc.id);
        purged++;
      } else {
        console.warn(`[cleanup] Drive folder trash failed for document ${doc.id} — will retry on next run`);
      }
    } catch (err) {
      console.error(`[cleanup] Drive purge error for document ${doc.id} (non-fatal, retried next run):`, err instanceof Error ? err.message : String(err));
    }
  }

  console.log(`[cleanup] trashed Drive folders for ${purged}/${docs.length} documents`);
  return purged;
}

/**
 * Expired, never-converted pre-checkout drafts (see supabase/migrations/0044_order_drafts.sql)
 * have no dedicated worker — piggybacking on this existing daily cron avoids adding a second
 * Vercel cron entry (Hobby plan only allows one; see docs/ai-context/50_PAYMENTS_FINANCE_FISCALIZATION.md).
 */
async function cleanupExpiredOrderDrafts(): Promise<number> {
  const nowIso = new Date().toISOString();

  const { data: drafts, error } = await db
    .from('order_drafts')
    .select('id, file_keys')
    .neq('status', 'converted')
    .lt('expires_at', nowIso)
    .limit(100);

  if (error) {
    console.error('[cleanup] failed to fetch expired order_drafts:', error.message);
    return 0;
  }
  if (!drafts || drafts.length === 0) return 0;

  let deleted = 0;
  for (const draft of drafts as Array<{ id: string; file_keys: Array<{ key: string }> }>) {
    for (const file of draft.file_keys ?? []) {
      await deleteFile(file.key).catch((e: unknown) => {
        console.error('[cleanup] R2 delete draft file failed:', file.key, e);
      });
    }
    const { error: delError } = await db.from('order_drafts').delete().eq('id', draft.id);
    if (delError) console.error('[cleanup] order_drafts delete failed:', draft.id, delError.message);
    else deleted++;
  }

  console.log(`[cleanup] deleted ${deleted}/${drafts.length} expired order_drafts`);
  return deleted;
}

/**
 * Sweeps temporary raw uploads (draft-upload-raw/{draftId}/{uuid}) left behind when a
 * browser completed the presigned PUT to R2 but never called /upload/complete (tab
 * closed, network drop, abandoned draft). These are invisible to
 * cleanupExpiredOrderDrafts() above, because they are never recorded in any
 * order_drafts.file_keys row — completion is what would have moved them into the
 * final draft-uploads/{draftId}/original.pdf key (or deleted them outright).
 *
 * Deliberately scoped to the RAW_UPLOAD_PREFIX only via the R2 ListObjectsV2 Prefix
 * filter — never touches draft-uploads/ (final draft PDFs) or documents/ (real orders).
 */
async function cleanupOrphanedRawUploads(): Promise<number> {
  const cutoffMs = Date.now() - RAW_UPLOAD_RETENTION_HOURS * 60 * 60 * 1000;

  let objects: Array<{ key: string; lastModified: Date | null }>;
  try {
    objects = await listObjectsByPrefix(`${RAW_UPLOAD_PREFIX}/`);
  } catch (err) {
    console.error('[cleanup] failed to list raw uploads:', err instanceof Error ? err.message : String(err));
    return 0;
  }

  const stale = objects.filter((o) => o.lastModified !== null && o.lastModified.getTime() < cutoffMs);
  if (stale.length === 0) return 0;

  let deleted = 0;
  for (const obj of stale) {
    try {
      await deleteFile(obj.key);
      deleted++;
    } catch (err) {
      // Key only — never log filenames or file contents (client document handling rule).
      console.error('[cleanup] raw upload delete failed:', obj.key, err instanceof Error ? err.message : String(err));
    }
  }

  console.log(`[cleanup] deleted ${deleted}/${stale.length} orphaned raw uploads`);
  return deleted;
}
