import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { supabaseServer } from '@/lib/supabase/server';
import type { Database } from '@/types';

type JobStatus =
  | 'payment_pending'
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
    .select('status, progress_percent, error_message, document_id, workflow_status, service_level, fulfillment_method')
    .eq('id', jobId)
    .single();

  if (error) {
    // PGRST116 = "JSON object requested, multiple (or no) rows returned" — genuinely not found
    if (error.code === 'PGRST116') {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }
    console.error('[jobs/[jobId]] DB error', { code: error.code, message: error.message, jobId });
    return NextResponse.json({ error: 'Database error' }, { status: 500 });
  }
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 });

  const { data: doc } = await supabaseServer
    .from('documents')
    .select('user_id')
    .eq('id', job.document_id)
    .single();

  if (!doc || doc.user_id !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Fetch latest payable quote for this job
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: quotes } = await (supabaseServer as any)
    .from('price_quotes')
    .select('id, status, amount_kzt, currency, expires_at, pricing_context_json')
    .eq('job_id', jobId)
    .in('status', ['quoted', 'payment_pending', 'requires_operator_review', 'paid', 'expired'])
    .order('created_at', { ascending: false })
    .limit(1);

  type QuoteRow = { id: string; status: string; amount_kzt: number; currency: string; expires_at: string; pricing_context_json: Record<string, unknown> };
  const quote: QuoteRow | null = quotes?.[0] ?? null;

  return NextResponse.json({
    status: job.status as JobStatus,
    progress: job.progress_percent,
    errorMessage: job.error_message,
    workflowStatus: job.workflow_status ?? null,
    serviceLevel: job.service_level ?? 'electronic',
    fulfillmentMethod: (job.fulfillment_method as 'pickup' | 'delivery' | null) ?? null,
    latestQuoteId: quote?.id ?? null,
    quoteStatus: quote?.status ?? null,
    quoteAmountKzt: quote ? Number(quote.amount_kzt) : null,
    quoteCurrency: quote?.currency ?? null,
    quoteExpiresAt: quote?.expires_at ?? null,
    quoteRequiresOperatorReview:
      quote?.status === 'requires_operator_review' ||
      (quote?.pricing_context_json as Record<string, unknown>)?.requiresOperatorReview === true,
  });
}
