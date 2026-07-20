import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { deleteFile, listObjectsByPrefix } from '@/lib/r2/client';
import { RAW_UPLOAD_PREFIX } from '@/lib/order-drafts/upload-constants';

const RETENTION_DAYS = 30;
const RAW_UPLOAD_RETENTION_HOURS = 24;
const PRICING_LAB_RETENTION_HOURS = 1;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get('authorization');

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data: docs, error } = await supabaseServer
    .from('documents')
    .select('id, file_key')
    .lt('created_at', cutoff)
    .limit(100);

  if (error) {
    console.error('[cleanup] failed to fetch old documents:', error);
    return NextResponse.json({ error: 'Failed to fetch documents' }, { status: 500 });
  }

  // NOTE: previously this returned early here when there were no expired documents,
  // which meant cleanupExpiredOrderDrafts() and cleanupOrphanedRawUploads() below
  // never ran on any day with zero 30-day-old documents — a pre-existing bug (not
  // introduced by the raw-upload sweep) that would have silently starved both sweeps.
  // Fixed by only skipping the per-document deletion loop, not the rest of the route.
  let deleted = 0;
  const errors: string[] = [];

  if (docs && docs.length > 0) {
    for (const doc of docs) {
      try {
        // Get all translated file keys for this document
        const { data: jobs } = await supabaseServer
          .from('jobs')
          .select('id')
          .eq('document_id', doc.id);

        const jobIds = (jobs ?? []).map((j) => j.id);

        if (jobIds.length > 0) {
          const { data: translations } = await supabaseServer
            .from('translations')
            .select('translated_pdf_key')
            .in('job_id', jobIds);

          for (const t of translations ?? []) {
            await deleteFile(t.translated_pdf_key).catch((e: unknown) => {
              console.error('[cleanup] R2 delete translated failed:', t.translated_pdf_key, e);
            });
          }
        }

        // Delete original file from R2
        await deleteFile(doc.file_key).catch((e: unknown) => {
          console.error('[cleanup] R2 delete original failed:', doc.file_key, e);
        });

        // Delete DB record (cascades to jobs, translations, ocr_results)
        const { error: delError } = await supabaseServer
          .from('documents')
          .delete()
          .eq('id', doc.id);

        if (delError) {
          errors.push(`doc ${doc.id}: ${delError.message}`);
        } else {
          deleted++;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`doc ${doc.id}: ${msg}`);
      }
    }

    console.log(`[cleanup] deleted ${deleted}/${docs.length} documents`);
  }

  const draftsDeleted = await cleanupExpiredOrderDrafts();
  const rawUploadsDeleted = await cleanupOrphanedRawUploads();
  const pricingLabFilesDeleted = await cleanupStalePricingLabFiles();

  return NextResponse.json({ deleted, errors: errors.length > 0 ? errors : undefined, draftsDeleted, rawUploadsDeleted, pricingLabFilesDeleted });
}

/**
 * Expired, never-converted pre-checkout drafts (see supabase/migrations/0044_order_drafts.sql)
 * have no dedicated worker — piggybacking on this existing daily cron avoids adding a second
 * Vercel cron entry (Hobby plan only allows one; see docs/ai-context/50_PAYMENTS_FINANCE_FISCALIZATION.md).
 */
async function cleanupExpiredOrderDrafts(): Promise<number> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabaseServer as any;
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

/**
 * Sweeps internal Pricing Lab test files (pricing-lab/{operatorUserId}/{uuid}.{ext} — see
 * src/app/api/internal/pricing-lab/analyze-file/route.ts). This is a DEFENSE-IN-DEPTH backstop,
 * not the primary cleanup mechanism — the Pricing Lab UI's "Удалить" button deletes a file
 * immediately, and a failed analysis deletes its own upload right away. This sweep only catches
 * files an operator uploaded and never explicitly deleted (tab closed, forgot).
 *
 * Retention is 1 hour, but this cron itself runs once daily (Vercel Hobby plan allows only one
 * cron job — see the other sweeps above) — so in practice a forgotten file may live up to
 * ~24h before this sweep catches it, not a strict 1-hour guarantee on its own. The strict
 * "maximum 1 hour" requirement is met by the immediate-delete paths, not this sweep alone;
 * this is disclosed explicitly, not silently assumed to be a real 1-hour SLA.
 *
 * Scoped to the pricing-lab/ prefix only — never touches documents/ (real customer orders)
 * or draft-uploads/ (real order drafts). Test data is kept structurally separate from real
 * customer data, per the "never mix retention policies" rule.
 */
async function cleanupStalePricingLabFiles(): Promise<number> {
  const cutoffMs = Date.now() - PRICING_LAB_RETENTION_HOURS * 60 * 60 * 1000;

  let objects: Array<{ key: string; lastModified: Date | null }>;
  try {
    objects = await listObjectsByPrefix('pricing-lab/');
  } catch (err) {
    console.error('[cleanup] failed to list pricing-lab files:', err instanceof Error ? err.message : String(err));
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
      console.error('[cleanup] pricing-lab file delete failed:', obj.key, err instanceof Error ? err.message : String(err));
    }
  }

  console.log(`[cleanup] deleted ${deleted}/${stale.length} stale pricing-lab files`);
  return deleted;
}
