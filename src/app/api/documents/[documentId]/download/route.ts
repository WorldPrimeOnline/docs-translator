import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { supabaseServer } from '@/lib/supabase/server';
import { downloadFile } from '@/lib/r2/client';
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
    .select('id')
    .eq('document_id', documentId)
    .eq('status', 'completed')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (!job) return NextResponse.json({ error: 'No completed translation found' }, { status: 404 });

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
