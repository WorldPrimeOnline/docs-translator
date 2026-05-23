import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
): Promise<NextResponse> {
  const { jobId } = await params;

  const { data: job, error } = await supabaseServer
    .from('jobs')
    .select('status, progress_percent, error_message')
    .eq('id', jobId)
    .single();

  if (error || !job) return NextResponse.json({ error: 'Job not found' }, { status: 404 });

  return NextResponse.json({
    status: job.status,
    progress: job.progress_percent,
    errorMessage: job.error_message,
  });
}
