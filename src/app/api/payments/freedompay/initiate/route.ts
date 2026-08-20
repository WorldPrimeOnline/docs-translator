/**
 * Freedom Pay payment initiation — session-authed.
 * Mirrors src/app/api/payments/halyk/initiate/route.ts's structure, with two
 * deliberate differences:
 *  - Gated ONLY by FREEDOMPAY_ENABLED + credentials — never by the card-payments
 *    entity flag in src/lib/business-profile.ts (that flag exists solely to block
 *    Halyk's old-entity credentials; Freedom Pay's test merchant matches the current entity).
 *  - pg_order_id is the payment_transactions row's own id (a fresh UUID), not a
 *    separately-generated numeric invoice id — simpler than Halyk's scheme, which
 *    exists only because of a Halyk-specific 15-digit/6-digit-suffix requirement that
 *    does not apply to Freedom Pay.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { randomUUID } from 'crypto';
import { supabaseServer } from '@/lib/supabase/server';
import { getFreedomPayConfig, FREEDOMPAY_RESULT_PATH } from '@/lib/payments/freedompay/config';
import { initPayment, FreedomPayApiError } from '@/lib/payments/freedompay/client';
import { verifyQuotePayable, markQuotePaymentPending } from '@/lib/pricing/service';
import type { Database } from '@/types';

const RequestSchema = z.object({
  jobId: z.string().uuid(),
  quoteId: z.string().uuid(),
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

export async function POST(request: NextRequest): Promise<NextResponse> {
  const correlationId = crypto.randomUUID();
  try {
    return await handlePost(request, correlationId);
  } catch (err) {
    console.error('[freedompay/initiate] unhandled error', {
      correlationId,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: 'INTERNAL_ERROR', correlationId }, { status: 500 });
  }
}

async function handlePost(request: NextRequest, correlationId: string): Promise<NextResponse> {
  const config = getFreedomPayConfig();

  // ── Config gate — independent of the Halyk-only card-payments entity flag ────
  if (!config.enabled) {
    console.error('[freedompay/initiate] payment not configured', {
      correlationId,
      merchantIdPresent: !!process.env.FREEDOMPAY_MERCHANT_ID,
      secretKeyPresent: !!process.env.FREEDOMPAY_SECRET_KEY,
      enabledFlag: process.env.FREEDOMPAY_ENABLED,
    });
    return NextResponse.json({ error: 'PAYMENT_NOT_CONFIGURED', correlationId }, { status: 503 });
  }

  // ── APP_BASE_URL validation (identical posture to Halyk's initiate route) ────
  const appBaseUrl = config.appBaseUrl;
  if (!appBaseUrl) {
    console.error('[freedompay/initiate] APP_BASE_URL missing', { correlationId });
    return NextResponse.json({ error: 'APP_BASE_URL_INVALID', correlationId }, { status: 503 });
  }
  try {
    const parsed = new URL(appBaseUrl);
    const isLocal = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
    if (parsed.protocol !== 'https:' && !isLocal) {
      console.error('[freedompay/initiate] APP_BASE_URL not HTTPS', { correlationId, host: parsed.hostname });
      return NextResponse.json({ error: 'APP_BASE_URL_INVALID', correlationId }, { status: 503 });
    }
  } catch {
    console.error('[freedompay/initiate] APP_BASE_URL invalid', { correlationId });
    return NextResponse.json({ error: 'APP_BASE_URL_INVALID', correlationId }, { status: 503 });
  }

  // ── Auth check ───────────────────────────────────────────────────────────────
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // ── Parse request body ───────────────────────────────────────────────────────
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 });
  }

  const { jobId, quoteId } = parsed.data;

  // ── Load job + document, verify ownership ────────────────────────────────────
  const { data: job, error: jobError } = await supabaseServer
    .from('jobs')
    .select(`
      id, status, document_id,
      documents!inner ( id, user_id )
    `)
    .eq('id', jobId)
    .maybeSingle();

  if (jobError || !job) {
    return NextResponse.json({ error: 'JOB_NOT_FOUND', correlationId }, { status: 404 });
  }

  const doc = Array.isArray(job.documents) ? job.documents[0] : job.documents;
  if (!doc || doc.user_id !== user.id) {
    return NextResponse.json({ error: 'JOB_NOT_FOUND', correlationId }, { status: 404 });
  }

  if (job.status === 'completed') {
    return NextResponse.json({ error: 'JOB_NOT_PAYABLE', correlationId }, { status: 409 });
  }

  // ── Quote verification — amount is ALWAYS read from price_quotes, never the client ──
  const quoteCheck = await verifyQuotePayable(quoteId, jobId, user.id);
  if (!quoteCheck.ok) {
    console.error('[freedompay/initiate] quote verification failed', { correlationId, quoteId, error: quoteCheck.error });
    return NextResponse.json({ error: quoteCheck.error, correlationId }, { status: 422 });
  }
  const priceKzt = quoteCheck.amountKzt;

  // ── Idempotency: block a second init while a recent pending attempt exists ──
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existingAttempts } = await (supabaseServer as any)
    .from('payment_transactions')
    .select('id, status, created_at')
    .eq('job_id', jobId)
    .eq('payment_provider', 'freedom_pay')
    .order('created_at', { ascending: false })
    .limit(5) as { data: Array<{ id: string; status: string; created_at: string }> | null };

  const pendingAttempt = existingAttempts?.find((a) => a.status === 'payment_pending');
  if (pendingAttempt) {
    const ageMs = Date.now() - new Date(pendingAttempt.created_at).getTime();
    if (ageMs < 10 * 60 * 1000) {
      return NextResponse.json({ error: 'PAYMENT_ALREADY_PENDING', correlationId }, { status: 409 });
    }
  }

  // ── Create payment_transactions row before calling Freedom Pay ──────────────
  // id doubles as pg_order_id — immutable, unique, exists before initiation, maps
  // back to exactly one WPO payment. No separate invoice-id generator needed (that
  // was a Halyk-specific 15-digit/6-digit-suffix protocol requirement).
  const paymentId = randomUUID();
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: paymentTx, error: txError } = await (supabaseServer as any)
    .from('payment_transactions')
    .insert({
      id: paymentId,
      user_id: user.id,
      document_id: doc.id,
      job_id: jobId,
      quote_id: quoteId,
      amount: priceKzt,
      currency: 'KZT',
      payment_provider: 'freedom_pay',
      payment_source: 'card_payment',
      status: 'payment_pending',
      provider_invoice_id: paymentId,
      provider_environment: 'test',
      price_locked_at: new Date().toISOString(),
      amount_source: 'quote',
      pricing_snapshot_json: { quoteId, amountKzt: priceKzt },
      expires_at: expiresAt,
    })
    .select()
    .single() as { data: { id: string } | null; error: { code?: string; message?: string } | null };

  if (txError || !paymentTx) {
    console.error('[freedompay/initiate] failed to create payment_transaction', {
      correlationId,
      jobId,
      quoteId,
      amountKzt: priceKzt,
      errorCode: txError?.code,
      errorMessage: txError?.message,
    });
    return NextResponse.json({ error: 'TRANSACTION_CREATE_FAILED', correlationId }, { status: 500 });
  }

  // ── Update job to payment_pending if not already ─────────────────────────────
  if (job.status !== 'payment_pending') {
    await supabaseServer.from('jobs').update({ status: 'payment_pending' }).eq('id', jobId);
  }

  // ── Mark quote as payment_pending (non-blocking) ─────────────────────────────
  void markQuotePaymentPending(quoteId).catch((err) => {
    console.error('[freedompay/initiate] failed to mark quote payment_pending (non-fatal):', (err as Error).message);
  });

  // ── Call Freedom Pay init_payment ─────────────────────────────────────────────
  const resultUrl = `${appBaseUrl}${FREEDOMPAY_RESULT_PATH}`;
  // provider=freedom_pay lets the shared /payment/result page know which status
  // endpoint to poll — Halyk's existing backLink (no provider param) is unchanged
  // and continues to default to the Halyk status endpoint.
  const successUrl = `${appBaseUrl}/payment/result?payment=${paymentId}&provider=freedom_pay`;
  const failureUrl = successUrl;

  console.log('[freedompay/initiate] calling init_payment', {
    correlationId,
    paymentId,
    jobId,
    amount: priceKzt,
  });

  let initResult;
  try {
    initResult = await initPayment({
      orderId: paymentId,
      amountKzt: priceKzt,
      description: `WPO order ${jobId.slice(0, 8)}`,
      resultUrl,
      successUrl,
      failureUrl,
    });
  } catch (err) {
    const isFp = err instanceof FreedomPayApiError;
    console.error('[freedompay/initiate] init_payment failed', {
      correlationId,
      code: isFp ? err.code : 'UNKNOWN',
      httpStatus: isFp ? err.httpStatus : undefined,
      responseBodySnippet: isFp ? err.responseBodySnippet : undefined,
      message: err instanceof Error ? err.message.slice(0, 300) : String(err),
    });

    await supabaseServer
      .from('payment_transactions')
      .update({ status: 'failed', failed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', paymentId);

    return NextResponse.json({ error: 'FREEDOMPAY_INIT_FAILED', correlationId }, { status: 502 });
  }

  // Persist pg_payment_id immediately if the init response included one — gives
  // refunds/diagnostics a provider_transaction_id breadcrumb before any callback or
  // status check ever runs. Best-effort: a failure here must not block returning the
  // redirect URL to the customer.
  if (initResult.pgPaymentId) {
    const { error: ptidError } = await supabaseServer
      .from('payment_transactions')
      .update({ provider_transaction_id: initResult.pgPaymentId, updated_at: new Date().toISOString() })
      .eq('id', paymentId);
    if (ptidError) {
      console.error('[freedompay/initiate] failed to persist provider_transaction_id (non-fatal)', {
        correlationId, paymentId, error: ptidError.message,
      });
    }
  }

  console.log('[freedompay/initiate] payment created, returning redirect', { correlationId, paymentId, jobId });

  return NextResponse.json({ paymentId, redirectUrl: initResult.redirectUrl });
}

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ error: 'Method not allowed' }, { status: 405 });
}
