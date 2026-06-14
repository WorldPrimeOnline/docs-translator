import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { supabaseServer } from '@/lib/supabase/server';
import type { Database } from '@/types';

type JobStatus =
  | 'queued'
  | 'ocr_in_progress'
  | 'ocr_completed'
  | 'translation_in_progress'
  | 'pdf_rendering'
  | 'completed'
  | 'failed';

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
  { params }: { params: Promise<{ jobId: string }> },
): Promise<NextResponse> {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { jobId } = await params;

  const { data: job, error } = await supabaseServer
    .from('jobs')
    .select('status, progress_percent, error_message, document_id, workflow_status, service_level')
    .eq('id', jobId)
    .single();

  if (error || !job) return NextResponse.json({ error: 'Job not found' }, { status: 404 });

  const { data: doc } = await supabaseServer
    .from('documents')
    .select('user_id')
    .eq('id', job.document_id)
    .single();

  if (!doc || doc.user_id !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  return NextResponse.json({
    status: job.status as JobStatus,
    progress: job.progress_percent,
    errorMessage: job.error_message,
    workflowStatus: job.workflow_status ?? null,
    serviceLevel: job.service_level ?? 'electronic',
  });
}
