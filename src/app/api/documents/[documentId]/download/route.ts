import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import JSZip from 'jszip';
import { supabaseServer } from '@/lib/supabase/server';
import { downloadFile } from '@/lib/r2/client';
import { getResultFilesStatus, type ReadyResultFile } from '@/lib/jobs/result-files-status';
import { getCustomerOrderState } from '@/lib/translation-workflow/customer-order-state';
import type { Database } from '@/types';

async function getAuthUser() {
  const cookieStore = await cookies();
  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (toSet) => {
          toSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        },
      },
    },
  );
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

const MIME: Record<string, string> = {
  '.pdf':  'application/pdf',
  '.html': 'text/html; charset=utf-8',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

function extOf(filename: string): string {
  return filename.match(/\.(pdf|html|docx)$/i)?.[0]?.toLowerCase() ?? '.pdf';
}

/** Safe, deterministic filename for a Content-Disposition header or ZIP entry —
 * never trusts a Drive/staff-supplied filename directly. */
function sanitizeDownloadFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._\- ]/g, '_').slice(0, 150);
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ documentId: string }> },
): Promise<NextResponse> {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { documentId } = await params;

  const { data: doc, error: docError } = await supabaseServer
    .from('documents')
    .select('user_id, filename, document_type')
    .eq('id', documentId)
    .single();

  if (docError || !doc) return NextResponse.json({ error: 'Document not found' }, { status: 404 });
  if (doc.user_id !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { data: job } = await supabaseServer
    .from('jobs')
    .select('id, workflow_status, service_level, fulfillment_method')
    .eq('document_id', documentId)
    .eq('status', 'completed')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (!job) return NextResponse.json({ error: 'No completed translation found' }, { status: 404 });

  // ── 2026-08-01 multi-file fulfillment decision: jobs with job_source_files rows
  // are served entirely from job_result_files (never translations/ai_draft) — a
  // completely separate path from the legacy single-file logic below, which stays
  // byte-for-byte unchanged for every job that predates this feature. ──
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { count: totalSources } = await (supabaseServer as any)
    .from('job_source_files')
    .select('id', { count: 'exact', head: true })
    .eq('job_id', job.id);

  if (totalSources && totalSources > 0) {
    return serveMultiSourceDownload(job, totalSources, doc.filename);
  }

  // ── Download gating by service level ──────────────────────────────────────
  //
  // Notarized physical orders (delivery or pickup): NEVER allow electronic download.
  // The final product is a physical notarized document — no digital file for the customer.
  if (job.service_level === 'notarization_through_partners') {
    return NextResponse.json(
      { error: 'Physical notarized document. Your order will be delivered or available for pickup — no electronic download.' },
      { status: 403 },
    );
  }

  // Certified orders: allow download only once operator has approved (ready_for_delivery or delivered).
  if (job.service_level === 'official_with_translator_signature_and_provider_stamp') {
    const certifiedAllowed = new Set(['ready_for_delivery', 'delivered']);
    if (!certifiedAllowed.has(job.workflow_status ?? '')) {
      const statusMessages: Record<string, string> = {
        awaiting_translator_review: 'Document is being reviewed by a certified translator.',
        translator_approved: 'Translation verified — awaiting operator stamp.',
        awaiting_signature_stamp: 'Document is awaiting translator signature and provider stamp.',
        translator_declined: 'Translator assignment was declined. Please contact support.',
      };
      return NextResponse.json(
        {
          error: statusMessages[job.workflow_status ?? '']
            ?? 'Document is not yet approved for download — please check back later.',
        },
        { status: 403 },
      );
    }
  }

  // Electronic orders: job.status === 'completed' is sufficient (guaranteed by the query above).
  // workflow_status is typically null or 'completed' for electronic jobs.

  const { data: trans } = await supabaseServer
    .from('translations')
    .select('translated_pdf_key')
    .eq('job_id', job.id)
    .single();

  if (!trans?.translated_pdf_key) {
    return NextResponse.json({ error: 'Translation file not found' }, { status: 404 });
  }

  const storedKey = trans.translated_pdf_key;

  // Determine extension from the stored key
  const ext = storedKey.match(/\.(pdf|html|docx)$/)?.[0] ?? '.html';
  const contentType = MIME[ext] ?? 'application/octet-stream';

  // Build a clean download filename (strip |format suffix from document_type)
  const baseName = (doc.filename ?? 'translation')
    .replace(/\.pdf$/i, '')
    .replace(/[^a-zA-Z0-9._\- ]/g, '_')
    .slice(0, 100);
  const downloadFilename = `${baseName}${ext}`;

  try {
    const fileBuffer = await downloadFile(storedKey);
    return new NextResponse(new Uint8Array(fileBuffer), {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${downloadFilename}"`,
        'Content-Length': String(fileBuffer.length),
        'Cache-Control': 'private, max-age=300',
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[download] failed to retrieve file from R2:', msg, 'key:', storedKey);
    return NextResponse.json({ error: 'Failed to retrieve translation file' }, { status: 502 });
  }
}

interface MultiSourceJob {
  id: string;
  workflow_status: string | null;
  service_level: string | null;
  fulfillment_method: string | null;
}

/**
 * 2026-08-01 multi-file fulfillment decision: serves Electronic → electronic_final_*,
 * Official → signature_stamp, Notary → notary job_result_files — NEVER ai_draft or
 * translations.translated_* for a job that has job_source_files rows. Uses the exact
 * same getCustomerOrderState/canCustomerDownload gate the dashboard uses, so the
 * download button's visibility and this route's actual enforcement can never drift.
 * A missing/failed artifact (not fully covered) is refused outright — never a partial
 * ZIP presented as if it were the complete, ready order.
 */
async function serveMultiSourceDownload(
  job: MultiSourceJob,
  totalSources: number,
  docFilename: string,
): Promise<NextResponse> {
  const resultStatus = await getResultFilesStatus(job.id, job.service_level);

  const state = getCustomerOrderState({
    jobStatus: 'completed',
    progressPercent: 100,
    workflowStatus: job.workflow_status,
    serviceLevel: job.service_level,
    fulfillmentMethod: (job.fulfillment_method as 'pickup' | 'delivery' | null) ?? null,
    hasReadyResultFiles: resultStatus.hasReadyResultFiles,
  });

  if (!state.canDownload) {
    if (job.service_level === 'notarization_through_partners') {
      return NextResponse.json(
        { error: resultStatus.hasReadyResultFiles ? 'Not yet available for download.' : 'Notarized document is not yet available — the notary result has not finished syncing.' },
        { status: 403 },
      );
    }
    return NextResponse.json(
      { error: 'Document is not yet approved for download — please check back later.' },
      { status: 403 },
    );
  }

  // Defense in depth: canDownload=true implies hasReadyResultFiles=true for both
  // service levels this branch handles, but never trust that alone — an inconsistent
  // or empty set must never be served as if it were the complete, ready order.
  if (!resultStatus.hasReadyResultFiles || resultStatus.readyFiles.length === 0) {
    return NextResponse.json({ error: 'Result files are not fully synced yet — please check back later.' }, { status: 404 });
  }

  const files: ReadyResultFile[] = resultStatus.readyFiles; // already sorted by minimum source sequence

  try {
    if (files.length === 1) {
      const file = files[0]!;
      const ext = extOf(file.filename);
      const contentType = MIME[ext] ?? 'application/octet-stream';
      const baseName = sanitizeDownloadFilename((docFilename ?? 'translation').replace(/\.[^./]+$/, ''));
      const downloadFilename = `${baseName}${ext}`;
      const buffer = await downloadFile(file.r2Key);
      return new NextResponse(new Uint8Array(buffer), {
        status: 200,
        headers: {
          'Content-Type': contentType,
          'Content-Disposition': `attachment; filename="${downloadFilename}"`,
          'Content-Length': String(buffer.length),
          'Cache-Control': 'private, max-age=300',
        },
      });
    }

    const zip = new JSZip();
    const usedNames = new Set<string>();
    for (let i = 0; i < files.length; i++) {
      const file = files[i]!;
      const buffer = await downloadFile(file.r2Key);
      let entryName = sanitizeDownloadFilename(file.filename);
      if (usedNames.has(entryName)) {
        // Deterministic disambiguation by position — never silently overwrite an
        // entry in the ZIP (would drop one of the customer's files).
        entryName = `${String(i + 1).padStart(3, '0')}_${entryName}`;
      }
      usedNames.add(entryName);
      zip.file(entryName, buffer);
    }
    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
    const baseName = sanitizeDownloadFilename((docFilename ?? 'translation').replace(/\.[^./]+$/, ''));

    return new NextResponse(new Uint8Array(zipBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${baseName}.zip"`,
        'Content-Length': String(zipBuffer.length),
        'Cache-Control': 'private, max-age=300',
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[download] multi-source: failed to retrieve/package result files:', msg, 'jobId:', job.id, 'totalSources:', totalSources);
    return NextResponse.json({ error: 'Failed to retrieve translation file(s)' }, { status: 502 });
  }
}
