import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { supabaseServer } from '@/lib/supabase/server';
import { downloadFile, getPresignedUrl } from '@/lib/r2/client';
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
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

/** Derive the expected PDF key from an HTML key (for backward-compat lookup). */
function toPdfKey(key: string): string {
  return key.replace(/\/translated\.html$/, '/translated.pdf');
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ documentId: string }> },
): Promise<NextResponse> {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { documentId } = await params;

  // Ownership check
  const { data: doc, error: docError } = await supabaseServer
    .from('documents')
    .select('user_id, filename')
    .eq('id', documentId)
    .single();

  if (docError || !doc) return NextResponse.json({ error: 'Document not found' }, { status: 404 });
  if (doc.user_id !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  // Find the completed job
  const { data: job } = await supabaseServer
    .from('jobs')
    .select('id')
    .eq('document_id', documentId)
    .eq('status', 'completed')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (!job) return NextResponse.json({ error: 'No completed translation found' }, { status: 404 });

  // Get translation record
  const { data: trans } = await supabaseServer
    .from('translations')
    .select('translated_pdf_key')
    .eq('job_id', job.id)
    .single();

  if (!trans?.translated_pdf_key) {
    return NextResponse.json({ error: 'Translation file not found' }, { status: 404 });
  }

  const storedKey = trans.translated_pdf_key;
  const safeFilename = (doc.filename ?? 'translation')
    .replace(/\.pdf$/i, '')
    .replace(/[^a-zA-Z0-9._\- ]/g, '_')
    .slice(0, 100);

  // ── PDF-first strategy ───────────────────────────────────────────────────
  // The Railway worker saves translated.pdf; the Vercel fallback saved translated.html.
  // Try the PDF key first (either stored directly or derived from an HTML key).

  const pdfKey = storedKey.endsWith('.pdf') ? storedKey : toPdfKey(storedKey);

  if (pdfKey !== storedKey) {
    // storedKey points to HTML — check if the worker has already generated a PDF
    try {
      const pdfBuffer = await downloadFile(pdfKey);
      return new NextResponse(new Uint8Array(pdfBuffer), {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="${safeFilename}.pdf"`,
          'Content-Length': String(pdfBuffer.length),
          'Cache-Control': 'private, max-age=300',
        },
      });
    } catch {
      // PDF not yet generated — fall through to HTML
    }
  }

  if (storedKey.endsWith('.pdf')) {
    // Worker generated a PDF — stream it directly
    try {
      const pdfBuffer = await downloadFile(storedKey);
      return new NextResponse(new Uint8Array(pdfBuffer), {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="${safeFilename}.pdf"`,
          'Content-Length': String(pdfBuffer.length),
          'Cache-Control': 'private, max-age=300',
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[download] failed to stream PDF from R2:', msg);
      return NextResponse.json({ error: 'Failed to retrieve PDF' }, { status: 502 });
    }
  }

  // ── HTML fallback ────────────────────────────────────────────────────────
  // Vercel's processJob saved an HTML file. Redirect to presigned URL with
  // an attachment disposition so the browser downloads rather than renders it.
  const url = await getPresignedUrl(storedKey, 300);

  // We can't set Content-Disposition on a presigned redirect, so stream it
  try {
    const htmlBuffer = await downloadFile(storedKey);
    return new NextResponse(new Uint8Array(htmlBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Disposition': `attachment; filename="${safeFilename}.html"`,
        'Content-Length': String(htmlBuffer.length),
        'Cache-Control': 'private, max-age=300',
      },
    });
  } catch {
    // If streaming fails, plain redirect as last resort
    return NextResponse.redirect(url);
  }
}
