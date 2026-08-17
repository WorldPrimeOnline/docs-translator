/**
 * Staging-only payment bypass — lets QA complete a full order E2E flow (upload →
 * checkout → "pay" → worker → Drive/Jira) without a real Halyk transaction.
 *
 * SAFETY:
 *   - Refuses (404, before parsing the body) unless APP_ENV/NEXT_PUBLIC_APP_ENV is not
 *     "production" AND STAGING_PAYMENT_BYPASS_ENABLED=true. See src/lib/payments/staging-bypass.ts.
 *   - Password is checked server-side only, constant-time, never logged, never echoed back.
 *   - Reuses finalizePaymentForStaging() (src/lib/payments/finalize-payment.ts) for every
 *     downstream state transition — the exact same function the existing
 *     scripts/staging/confirm-payment-paid.ts CLI tool uses, which itself mirrors the real
 *     Halyk callback's finalize_halyk_payment RPC path. This route's only job is to find/create
 *     the payment_transactions row and enforce the password + ownership + rate limiting
 *     (rate limiting comes for free from the global per-IP limiter in src/middleware.ts,
 *     which covers every /api/* route not under /api/webhooks/).
 *   - Never trusts a client-supplied price — amount is re-derived via verifyQuotePayable()
 *     exactly like /api/payments/halyk/initiate does.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { supabaseServer } from '@/lib/supabase/server';
import { verifyQuotePayable } from '@/lib/pricing/service';
import { isStagingBypassEnabled, verifyStagingBypassPassword } from '@/lib/payments/staging-bypass';
import { finalizePaymentForStaging } from '@/lib/payments/finalize-payment';
import type { Database } from '@/types';

const RequestSchema = z.object({
  jobId: z.string().uuid(),
  quoteId: z.string().uuid(),
  password: z.string().min(1).max(200),
});

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

function getClientIp(req: NextRequest): string | null {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return req.headers.get('x-real-ip')?.trim() ?? null;
}

// Any method on a disabled/production endpoint gets the same 404 — indistinguishable
// from a route that doesn't exist.
function notFound(): NextResponse {
  return new NextResponse(null, { status: 404 });
}

export async function GET(): Promise<NextResponse> {
  return notFound();
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  // ── Hard gate, before touching the body ──────────────────────────────────────
  if (!isStagingBypassEnabled()) {
    return notFound();
  }

  const correlationId = crypto.randomUUID();

  try {
    return await handlePost(request, correlationId);
  } catch (err) {
    console.error('[staging-bypass] unhandled error', {
      correlationId,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: 'INTERNAL_ERROR', correlationId }, { status: 500 });
  }
}

async function handlePost(request: NextRequest, correlationId: string): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'VALIDATION_FAILED', correlationId }, { status: 400 });
  }
  const { jobId, quoteId, password } = parsed.data;

  // ── Auth ──────────────────────────────────────────────────────────────────────
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // ── Password (server-side only, constant-time, never logged) ────────────────
  if (!verifyStagingBypassPassword(password)) {
    console.warn('[staging-bypass] invalid password attempt', { correlationId, userId: user.id, jobId });
    return NextResponse.json({ error: 'INVALID_PASSWORD', correlationId }, { status: 401 });
  }

  // ── Load job + document, verify ownership ────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: job, error: jobError } = await (supabaseServer as any)
    .from('jobs')
    .select('id, status, document_id, documents!inner ( id, user_id )')
    .eq('id', jobId)
    .maybeSingle();

  if (jobError || !job) {
    return NextResponse.json({ error: 'JOB_NOT_FOUND', correlationId }, { status: 404 });
  }

  const doc = Array.isArray(job.documents) ? job.documents[0] : job.documents;
  if (!doc || doc.user_id !== user.id) {
    return NextResponse.json({ error: 'JOB_NOT_FOUND', correlationId }, { status: 404 });
  }

  // ── Find the most recent payment attempt for this job, if any ───────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existingTx } = await (supabaseServer as any)
    .from('payment_transactions')
    .select('id, status')
    .eq('job_id', jobId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  let transactionId: string;

  if (existingTx && existingTx.status === 'paid') {
    // Idempotent path: finalizePaymentForStaging() reports 'already_complete' (or
    // 'repaired' if the job never got queued) without creating anything new.
    transactionId = existingTx.id as string;
  } else if (job.status !== 'payment_pending') {
    // Job isn't waiting on payment and there's no paid transaction to reconcile —
    // e.g. failed/canceled/refunded/completed without payment. Refuse rather than
    // silently no-op (finalizePaymentForStaging would return "ok" but queue nothing).
    return NextResponse.json({ error: 'JOB_NOT_PAYABLE', correlationId, jobStatus: job.status }, { status: 409 });
  } else if (existingTx && existingTx.status === 'payment_pending') {
    // Reuse a stuck/prior attempt for this job (real Halyk init, or a previous
    // bypass call that failed before reaching finalize).
    transactionId = existingTx.id as string;
  } else {
    // No reusable row — create one. Amount is re-derived from price_quotes, never
    // trusted from the client (CLAUDE.md payments invariant).
    const quoteCheck = await verifyQuotePayable(quoteId, jobId, user.id);
    if (!quoteCheck.ok) {
      return NextResponse.json({ error: quoteCheck.error, correlationId }, { status: 422 });
    }

    const now = new Date().toISOString();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: newTx, error: txError } = await (supabaseServer as any)
      .from('payment_transactions')
      .insert({
        user_id: user.id,
        document_id: doc.id,
        job_id: jobId,
        quote_id: quoteId,
        amount: quoteCheck.amountKzt,
        currency: 'KZT',
        // Clearly distinguishable from a real Halyk attempt — see docs/ai-context/50_PAYMENTS_FINANCE_FISCALIZATION.md.
        payment_provider: 'staging_bypass',
        payment_source: 'card_payment',
        status: 'payment_pending',
        provider_environment: 'test',
        amount_source: 'quote',
        price_locked_at: now,
        pricing_snapshot_json: { quoteId, amountKzt: quoteCheck.amountKzt, source: 'staging_payment_bypass' },
        ip_address: getClientIp(request),
      })
      .select('id')
      .single();

    if (txError || !newTx) {
      console.error('[staging-bypass] failed to create payment_transaction', {
        correlationId,
        jobId,
        error: txError?.message,
      });
      return NextResponse.json({ error: 'TRANSACTION_CREATE_FAILED', correlationId }, { status: 500 });
    }
    transactionId = newTx.id as string;
  }

  // ── Shared downstream finalization — same function the CLI tool uses ────────
  const result = await finalizePaymentForStaging(transactionId, {
    reason: 'Staging payment bypass (checkout UI)',
    confirmedBy: `staging-bypass-ui:${user.id}`,
  });

  if (!result.ok) {
    console.error('[staging-bypass] finalize failed', { correlationId, jobId, transactionId, error: result.error });
    return NextResponse.json({ error: 'FINALIZE_FAILED', correlationId }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    action: result.action,
    paymentId: result.paymentId,
    jobId: result.jobId,
    jobStatus: result.jobStatus,
  });
}
