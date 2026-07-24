import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { supabaseServer } from '@/lib/supabase/server';
import { getCustomerOrderState } from '@/lib/translation-workflow/customer-order-state';
import { getResultFilesStatus } from '@/lib/jobs/result-files-status';
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

  interface DocRow {
    id: string;
    filename: string;
    source_language: string;
    target_language: string;
    document_type: string;
    status: string;
    created_at: string;
    updated_at: string;
    /** 2026-07-24 retention fix — see supabase/migrations/0066. Not yet in generated types. */
    files_purged_at: string | null;
  }

  // Fetch all documents for this user (source of truth for ownership)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: docs, error: docsError } = await (supabaseServer as any)
    .from('documents')
    .select('id, filename, source_language, target_language, document_type, status, created_at, updated_at, files_purged_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false }) as { data: DocRow[] | null; error: { message: string; code?: string } | null };

  // 2026-07-25 regression: a query error here was previously indistinguishable from
  // "this user genuinely has zero orders" — both fell through to `{ jobs: [] }`,
  // silently emptying every user's dashboard (both Active and History) whenever the
  // query itself failed (e.g. a column referenced in code before its migration was
  // applied — see docs/ai-context/DECISIONS.md). A DB error must never look like an
  // empty account.
  if (docsError) {
    console.error('[api/jobs] documents query failed:', docsError.code, docsError.message);
    return NextResponse.json({ error: 'Failed to load orders' }, { status: 500 });
  }

  if (!docs || docs.length === 0) {
    return NextResponse.json({ jobs: [] });
  }

  const docIds = docs.map((d) => d.id);

  // Fetch latest job per document
  const { data: jobs, error: jobsError } = await supabaseServer
    .from('jobs')
    .select(
      'id, document_id, status, progress_percent, error_message, workflow_status, service_level, fulfillment_method, price_kzt, price_before_discount_kzt, discount_applied_kzt, discount_code, created_at',
    )
    .in('document_id', docIds)
    .order('created_at', { ascending: false });

  // Same guarantee as the documents query above — without job rows an order can't
  // be classified as payment_pending/active at all, so a query failure here must
  // never silently degrade into "this order has no job" (which would misclassify it
  // into history with a blank status instead of failing loudly).
  if (jobsError) {
    console.error('[api/jobs] jobs query failed:', jobsError.code, jobsError.message);
    return NextResponse.json({ error: 'Failed to load orders' }, { status: 500 });
  }

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

  // Fetch sale fiscal receipts per job — only for jobs this user owns (docIds already scoped to user.id)
  type FiscalRow = { job_id: string; status: string; fiscal_url: string | null };
  const fiscalByJob = new Map<string, FiscalRow>();
  if (jobIds.length > 0) {
    const { data: fiscalReceipts } = await supabaseServer
      .from('fiscal_receipts')
      .select('job_id, status, fiscal_url')
      .in('job_id', jobIds)
      .eq('operation_type', 'sale')
      .order('created_at', { ascending: false });

    if (fiscalReceipts) {
      for (const fr of fiscalReceipts as FiscalRow[]) {
        if (!fiscalByJob.has(fr.job_id)) {
          fiscalByJob.set(fr.job_id, fr);
        }
      }
    }
  }
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

  // 2026-08-01 multi-file fulfillment decision: batch-resolve job_result_files
  // readiness for every job with a job (legacy single-file jobs resolve to
  // isMultiSource=false, in which case hasReadyResultFiles is omitted below so
  // getCustomerOrderState falls back to its exact pre-existing behavior).
  const resultFilesStatusByJob = new Map<string, Awaited<ReturnType<typeof getResultFilesStatus>>>();
  await Promise.all(
    Array.from(latestJobByDoc.values()).map(async (job) => {
      const status = await getResultFilesStatus(job.id, job.service_level ?? 'electronic');
      resultFilesStatusByJob.set(job.id, status);
    }),
  );

  // 2026-08-03 dashboard-ordering incident: this response must be strictly
  // jobs.created_at DESC (falling back to documents.created_at only for a
  // document with no job at all yet), with a stable id DESC tie-breaker — NEVER
  // grouped by status. The old code mapped over `docs` (sorted by
  // documents.created_at DESC) unchanged, which is not the same ordering
  // guarantee once a document's job is created later than the document itself.
  const sortedDocs = [...docs].sort((a, b) => {
    const jobA = latestJobByDoc.get(a.id) ?? null;
    const jobB = latestJobByDoc.get(b.id) ?? null;
    const aCreatedAt = jobA?.created_at ?? a.created_at;
    const bCreatedAt = jobB?.created_at ?? b.created_at;
    const aTime = new Date(aCreatedAt).getTime();
    const bTime = new Date(bCreatedAt).getTime();
    if (aTime !== bTime) return bTime - aTime;
    const aId = jobA?.id ?? a.id;
    const bId = jobB?.id ?? b.id;
    if (aId === bId) return 0;
    return aId < bId ? 1 : -1;
  });

  const result = sortedDocs.map((doc) => {
    const job = latestJobByDoc.get(doc.id) ?? null;
    const quote = job ? (latestQuoteByJob.get(job.id) ?? null) : null;
    const fiscal = job ? (fiscalByJob.get(job.id) ?? null) : null;
    const resultFilesStatus = job ? resultFilesStatusByJob.get(job.id) : undefined;

    const state = job
      ? getCustomerOrderState({
          jobStatus: job.status,
          progressPercent: job.progress_percent,
          workflowStatus: job.workflow_status ?? null,
          serviceLevel: job.service_level ?? 'electronic',
          fulfillmentMethod: (job.fulfillment_method as 'pickup' | 'delivery' | null) ?? null,
          hasReadyResultFiles: resultFilesStatus?.isMultiSource ? resultFilesStatus.hasReadyResultFiles : undefined,
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
      // Dashboard sort key ONLY — jobs.created_at (documents.created_at fallback
      // when a document has no job yet). Deliberately separate from `createdAt`
      // above (documents.created_at, shown to the user as "Создан …") and from
      // `updatedAt` (not actually a last-modified timestamp despite the name) —
      // see src/lib/translation-workflow/order-sort.ts.
      sortCreatedAt: job?.created_at ?? doc.created_at,
      customerStatus: state?.customerStatus ?? null,
      // 2026-07-24 retention fix: once retention cleanup has purged this document's
      // R2 objects, download must never be offered — regardless of what the
      // customer-order-state gate would otherwise say (it has no knowledge of R2
      // object existence, only DB-derived readiness signals). filesPurgedAt is the
      // sole authoritative "expired" signal for the dashboard, distinct from any
      // client-side createdAt+30-day estimate.
      canDownload: doc.files_purged_at ? false : (state?.canDownload ?? false),
      filesPurgedAt: doc.files_purged_at ?? null,
      isActive: state?.isActive ?? false,
      isTerminal: state?.isTerminal ?? true,
      stages: state?.stages ?? [],
      priceKzt: job?.price_kzt ?? null,
      priceBeforeDiscountKzt: job?.price_before_discount_kzt ?? null,
      discountAppliedKzt: job?.discount_applied_kzt ?? null,
      discountCode: job?.discount_code ?? null,
      latestQuoteId: quote?.id ?? null,
      quoteStatus: quote?.status ?? null,
      quoteAmountKzt: quote?.requiresReview ? null : (quote?.amount_kzt ?? null),
      quoteCurrency: quote?.currency ?? null,
      quoteExpiresAt: quote?.expires_at ?? null,
      quoteRequiresOperatorReview: quote?.requiresReview ?? false,
      fiscalUrl: fiscal?.fiscal_url ?? null,
      fiscalReceiptStatus: fiscal?.status ?? null,
    };
  });

  return NextResponse.json({ jobs: result });
}
