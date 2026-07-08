import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { deleteFile } from '@/lib/r2/client';

const RETENTION_DAYS = 30;

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

  if (!docs || docs.length === 0) {
    return NextResponse.json({ deleted: 0 });
  }

  let deleted = 0;
  const errors: string[] = [];

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

  const draftsDeleted = await cleanupExpiredOrderDrafts();

  return NextResponse.json({ deleted, errors: errors.length > 0 ? errors : undefined, draftsDeleted });
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
