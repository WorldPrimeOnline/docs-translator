import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { supabaseServer } from '@/lib/supabase/server';
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

export async function GET(): Promise<NextResponse> {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Fetch all documents for this user (source of truth for ownership)
  const { data: docs } = await supabaseServer
    .from('documents')
    .select('id, filename, source_language, target_language, document_type, status, created_at, updated_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  if (!docs || docs.length === 0) {
    return NextResponse.json({ jobs: [] });
  }

  const docIds = docs.map((d) => d.id);

  // Fetch latest job per document
  const { data: jobs } = await supabaseServer
    .from('jobs')
    .select(
      'id, document_id, status, progress_percent, error_message, workflow_status, service_level, fulfillment_method, price_kzt, created_at',
    )
    .in('document_id', docIds)
    .order('created_at', { ascending: false });

  type JobRow = NonNullable<typeof jobs>[number];

  // Build a map: documentId → latest job (first row per document after DESC sort)
  const latestJobByDoc = new Map<string, JobRow>();
  if (jobs) {
    for (const job of jobs) {
      if (!latestJobByDoc.has(job.document_id)) {
        latestJobByDoc.set(job.document_id, job);
      }
    }
  }

  // Fetch latest price quote per job
  type QuoteRow = {
    id: string;
    job_id: string;
    status: string;
    amount_kzt: number;
    currency: string;
    expires_at: string;
    pricing_context_json: Record<string, unknown>;
    requiresReview: boolean;
  };
  const latestQuoteByJob = new Map<string, QuoteRow>();
  const jobIds = Array.from(latestJobByDoc.values()).map((j) => j.id).filter(Boolean);
  if (jobIds.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: quotes } = await (supabaseServer as any)
      .from('price_quotes')
      .select('id, job_id, status, amount_kzt, currency, expires_at, pricing_context_json')
      .in('job_id', jobIds)
      .in('status', ['quoted', 'payment_pending', 'requires_operator_review', 'paid', 'expired'])
      .order('created_at', { ascending: false });

    if (quotes) {
      for (const q of quotes as QuoteRow[]) {
        if (!latestQuoteByJob.has(q.job_id)) {
          latestQuoteByJob.set(q.job_id, {
            ...q,
            amount_kzt: Number(q.amount_kzt),
            currency: q.currency ?? 'KZT',
            requiresReview:
              q.status === 'requires_operator_review' ||
              (q.pricing_context_json as Record<string, unknown>)?.requiresOperatorReview === true,
          });
        }
      }
    }
  }

  const result = docs.map((doc) => {
    const job = latestJobByDoc.get(doc.id) ?? null;
    const quote = job ? (latestQuoteByJob.get(job.id) ?? null) : null;

    const state = job
      ? getCustomerOrderState({
          jobStatus: job.status,
          progressPercent: job.progress_percent,
          workflowStatus: job.workflow_status ?? null,
          serviceLevel: job.service_level ?? 'electronic',
          fulfillmentMethod: (job.fulfillment_method as 'pickup' | 'delivery' | null) ?? null,
        })
      : null;

    return {
      documentId: doc.id,
      jobId: job?.id ?? null,
      filename: doc.filename,
      sourceLanguage: doc.source_language,
      targetLanguage: doc.target_language,
      documentType: doc.document_type,
      documentStatus: doc.status,
      serviceLevel: job?.service_level ?? 'electronic',
      fulfillmentMethod: (job?.fulfillment_method as 'pickup' | 'delivery' | null) ?? null,
      jobStatus: job?.status ?? null,
      workflowStatus: job?.workflow_status ?? null,
      progressPercent: state?.progressPercent ?? 0,
      errorMessage: job?.error_message ?? null,
      createdAt: doc.created_at,
      updatedAt: job?.created_at ?? doc.created_at,
      customerStatus: state?.customerStatus ?? null,
      canDownload: state?.canDownload ?? false,
      isActive: state?.isActive ?? false,
      isTerminal: state?.isTerminal ?? true,
      stages: state?.stages ?? [],
      priceKzt: job?.price_kzt ?? null,
      latestQuoteId: quote?.id ?? null,
      quoteStatus: quote?.status ?? null,
      quoteAmountKzt: quote?.amount_kzt ?? null,
      quoteCurrency: quote?.currency ?? null,
      quoteExpiresAt: quote?.expires_at ?? null,
      quoteRequiresOperatorReview: quote?.requiresReview ?? false,
    };
  });

  return NextResponse.json({ jobs: result });
}
