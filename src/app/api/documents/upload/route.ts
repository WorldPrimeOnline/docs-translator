import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { supabaseServer } from '@/lib/supabase/server';
import { uploadFile } from '@/lib/r2/client';
import { processJob } from '@/lib/jobs/processor';
import type { Database } from '@/types';

const MAX_FILE_SIZE = 25 * 1024 * 1024;

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

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getAuthUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const formData = await request.formData();
    const file = formData.get('file');
    const sourceLang = formData.get('sourceLang');
    const targetLang = formData.get('targetLang');
    const documentType = formData.get('documentType');

    if (!(file instanceof File))
      return NextResponse.json({ error: 'file is required' }, { status: 400 });
    if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf')
      return NextResponse.json({ error: 'Only PDF files are accepted' }, { status: 400 });
    if (file.size > MAX_FILE_SIZE)
      return NextResponse.json({ error: 'File exceeds 25 MB limit' }, { status: 400 });
    if (
      typeof sourceLang !== 'string' ||
      typeof targetLang !== 'string' ||
      typeof documentType !== 'string'
    )
      return NextResponse.json(
        { error: 'sourceLang, targetLang, documentType are required' },
        { status: 400 },
      );

    const safeFilename = file.name
      .replace(/[^a-zA-Z0-9._\- ]/g, '_')
      .slice(0, 200);

    const docId = crypto.randomUUID();
    const fileKey = `documents/${user.id}/${docId}/original.pdf`;
    const buffer = Buffer.from(await file.arrayBuffer());

    await uploadFile(fileKey, buffer, 'application/pdf');

    const { data: doc, error: docError } = await supabaseServer
      .from('documents')
      .insert({
        id: docId,
        user_id: user.id,
        filename: safeFilename,
        original_file_size: file.size,
        file_key: fileKey,
        source_language: sourceLang,
        target_language: targetLang,
        document_type: documentType,
        status: 'processing',
      })
      .select()
      .single();

    if (docError || !doc) {
      console.error('[upload] document insert failed:', docError);
      return NextResponse.json(
        { error: 'Failed to create document record', detail: docError },
        { status: 500 },
      );
    }

    const { data: job, error: jobError } = await supabaseServer
      .from('jobs')
      .insert({ document_id: doc.id, status: 'queued', progress_percent: 0 })
      .select()
      .single();

    if (jobError || !job) {
      console.error('[upload] job insert failed:', jobError);
      return NextResponse.json({ error: 'Failed to create job' }, { status: 500 });
    }

    setTimeout(() => {
      void processJob(job.id, doc.id);
    }, 0);

    return NextResponse.json({ jobId: job.id, documentId: doc.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[upload] unhandled error:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
