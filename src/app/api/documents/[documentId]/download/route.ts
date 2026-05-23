import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { supabaseServer } from '@/lib/supabase/server';
import { getPresignedUrl } from '@/lib/r2/client';
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

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ documentId: string }> },
): Promise<NextResponse> {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { documentId } = await params;

  const { data: doc, error: docError } = await supabaseServer
    .from('documents')
    .select('user_id')
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

  const url = await getPresignedUrl(trans.translated_pdf_key, 300);
  return NextResponse.redirect(url);
}
