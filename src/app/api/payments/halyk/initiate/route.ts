import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { supabaseServer } from '@/lib/supabase/server';
import { getHalykConfig } from '@/lib/payments/halyk/config';
import { createPaymentToken, HalykApiError } from '@/lib/payments/halyk/client';
import { generateUniqueInvoiceId, getInvoiceSuffix6 } from '@/lib/payments/halyk/invoice';
import { generateSecretHash, digestSecretHash } from '@/lib/payments/halyk/security';
import { mapLocaleToHalyk } from '@/lib/payments/halyk/locale';
import { buildPaymentDescription } from '@/lib/payments/halyk/description';
import { verifyQuotePayable, markQuotePaymentPending } from '@/lib/pricing/service';
import type { HalykPayBootstrap, HalykPaymentObject } from '@/lib/payments/halyk/types';
import type { Database } from '@/types';

const RequestSchema = z.object({
  jobId: z.string().uuid(),
  quoteId: z.string().uuid().optional(),
  locale: z.string().optional().default('en'),
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

function safeHostname(url: string): string | null {
  try { return new URL(url).hostname; } catch { return null; }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const correlationId = crypto.randomUUID();

  try {
    return await handlePost(request, correlationId);
  } catch (err) {
    console.error('[halyk/initiate] unhandled error', {
      correlationId,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { error: 'INTERNAL_ERROR', correlationId },
      { status: 500 },
    );
  }
}

async function handlePost(request: NextRequest, correlationId: string): Promise<NextResponse> {
  const config = getHalykConfig();

  // ── Config gate ─────────────────────────────────────────────────────────────
  if (!config.enabled) {
    console.error('[halyk/initiate] payment not configured', {
      correlationId,
      mode: config.mode,
      clientIdPresent: !!process.env.HALYK_EPAY_CLIENT_ID,
      clientSecretPresent: !!process.env.HALYK_EPAY_CLIENT_SECRET,
      terminalIdPresent: !!process.env.HALYK_EPAY_TERMINAL_ID,
      enabledFlag: process.env.HALYK_EPAY_ENABLED,
    });
    return NextResponse.json(
      { error: 'PAYMENT_NOT_CONFIGURED', correlationId },
      { status: 503 },
    );
  }

  // ── APP_BASE_URL validation ──────────────────────────────────────────────────
  const appBaseUrl = config.appBaseUrl;
  if (!appBaseUrl) {
    console.error('[halyk/initiate] APP_BASE_URL missing', { correlationId });
    return NextResponse.json(
      { error: 'APP_BASE_URL_INVALID', correlationId },
      { status: 503 },
    );
  }
  try {
    const parsed = new URL(appBaseUrl);
    const isLocal = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
    if (parsed.protocol !== 'https:' && !isLocal) {
      console.error('[halyk/initiate] APP_BASE_URL not HTTPS', {
        correlationId,
        appBaseUrlHost: parsed.hostname,
      });
      return NextResponse.json(
        { error: 'APP_BASE_URL_INVALID', correlationId },
        { status: 503 },
      );
    }
  } catch {
    console.error('[halyk/initiate] APP_BASE_URL invalid', { correlationId });
    return NextResponse.json(
      { error: 'APP_BASE_URL_INVALID', correlationId },
      { status: 503 },
    );
  }

  // ── Staging/production mismatch guard ───────────────────────────────────────
  const vercelEnv = process.env.VERCEL_ENV;
  if (config.mode === 'production' && vercelEnv && vercelEnv !== 'production') {
    console.warn('[halyk/initiate] PAYMENT_ENV_MISMATCH: production Halyk mode on non-production Vercel env', {
      correlationId,
      mode: config.mode,
      vercelEnv,
    });
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
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { jobId, quoteId, locale } = parsed.data;
  const clientIp = getClientIp(request);

  // ── Load job + document, verify ownership ────────────────────────────────────
  const { data: job, error: jobError } = await supabaseServer
    .from('jobs')
    .select(`
      id, status, price_kzt, payment_source, document_id,
      documents!inner ( id, user_id, filename )
    `)
    .eq('id', jobId)
    .maybeSingle();

  if (jobError) {
    console.error('[halyk/initiate] job lookup error', {
      correlationId,
      code: jobError.code,
      message: jobError.message,
    });
    return NextResponse.json({ error: 'JOB_NOT_FOUND', correlationId }, { status: 404 });
  }

  if (!job) {
    return NextResponse.json({ error: 'JOB_NOT_FOUND', correlationId }, { status: 404 });
  }

  // ── Ownership check ──────────────────────────────────────────────────────────
  const doc = Array.isArray(job.documents) ? job.documents[0] : job.documents;
  if (!doc || doc.user_id !== user.id) {
    return NextResponse.json({ error: 'JOB_NOT_FOUND', correlationId }, { status: 404 });
  }

  // ── Status checks ────────────────────────────────────────────────────────────
  if (job.status === 'completed') {
    return NextResponse.json({ error: 'JOB_NOT_PAYABLE', correlationId }, { status: 409 });
  }
  if (job.status === 'failed' && job.payment_source !== 'card_payment') {
    return NextResponse.json({ error: 'JOB_NOT_PAYABLE', correlationId }, { status: 409 });
  }

  // ── Quote verification (preferred) or fallback to jobs.price_kzt ────────────
  let priceKzt: number;
  let verifiedQuoteId: string | null = quoteId ?? null;

  if (quoteId) {
    const quoteCheck = await verifyQuotePayable(quoteId, jobId, user.id);
    if (!quoteCheck.ok) {
      console.error('[halyk/initiate] quote verification failed', { correlationId, quoteId, error: quoteCheck.error });
      return NextResponse.json({ error: quoteCheck.error, correlationId }, { status: 422 });
    }
    priceKzt = quoteCheck.amountKzt;

    // Notary cutoff check: if this is a same-day notary quote and the cutoff has passed,
    // reject it so the user re-uploads at the current window's price.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: quoteDetail } = await (supabaseServer as any)
      .from('price_quotes')
      .select('pricing_context_json')
      .eq('id', quoteId)
      .maybeSingle();

    if (quoteDetail?.pricing_context_json) {
      const ctx = quoteDetail.pricing_context_json as Record<string, unknown>;
      const cutoff = ctx['notaryCutoff'] as { cutoffAt?: string | null } | undefined;
      if (cutoff?.cutoffAt) {
        const cutoffDate = new Date(cutoff.cutoffAt);
        if (new Date() >= cutoffDate) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (supabaseServer as any)
            .from('price_quotes')
            .update({ status: 'expired', updated_at: new Date().toISOString() })
            .eq('id', quoteId);
          console.warn('[halyk/initiate] notary cutoff passed', { correlationId, quoteId, cutoffAt: cutoff.cutoffAt });
          return NextResponse.json({ error: 'NOTARY_CUTOFF_PASSED', correlationId }, { status: 422 });
        }
      }
    }
  } else {
    // Legacy path: use price set on job (still DB-authoritative, not from client)
    const jobPrice = job.price_kzt;
    if (!jobPrice || jobPrice <= 0) {
      console.error('[halyk/initiate] price not set on job', { correlationId, jobId });
      return NextResponse.json({ error: 'PRICE_NOT_SET', correlationId }, { status: 422 });
    }
    priceKzt = jobPrice;
    verifiedQuoteId = null;
  }

  // ── Idempotency: check for recent pending attempt ────────────────────────────
  const { data: existingAttempts } = await supabaseServer
    .from('payment_transactions')
    .select('id, status, provider_invoice_id, created_at')
    .eq('job_id', jobId)
    .order('created_at', { ascending: false })
    .limit(5);

  const pendingAttempt = existingAttempts?.find(
    (a) => a.status === 'payment_pending' && a.provider_invoice_id,
  );

  if (pendingAttempt) {
    const ageMs = Date.now() - new Date(pendingAttempt.created_at).getTime();
    if (ageMs < 10 * 60 * 1000) {
      return NextResponse.json(
        { error: 'PAYMENT_ALREADY_PENDING', correlationId },
        { status: 409 },
      );
    }
  }

  // ── User email ───────────────────────────────────────────────────────────────
  const { data: userRow } = await supabaseServer
    .from('users')
    .select('email')
    .eq('id', user.id)
    .maybeSingle();
  const email = userRow?.email ?? user.email ?? '';

  // ── Generate unique invoice ID ───────────────────────────────────────────────
  const invoiceId = await generateUniqueInvoiceId(async (id, suffix6) => {
    const { data } = await supabaseServer
      .from('payment_transactions')
      .select('id')
      .or(`provider_invoice_id.eq.${id},provider_invoice_suffix6.eq.${suffix6}`)
      .limit(1);
    return !data || data.length === 0;
  });

  const invoiceSuffix6 = getInvoiceSuffix6(invoiceId);

  // ── secret_hash — used once, never returned to browser ──────────────────────
  const secretHash = generateSecretHash();
  const secretHashDigest = digestSecretHash(secretHash);

  // ── Callback URLs — always from APP_BASE_URL, never from Host header ─────────
  const postLink = `${appBaseUrl}/api/payments/halyk/callback`;
  const failurePostLink = `${appBaseUrl}/api/payments/halyk/callback`;

  // ── Create payment_transaction record before calling Halyk ───────────────────
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: paymentTx, error: txError } = await (supabaseServer as any)
    .from('payment_transactions')
    .insert({
      user_id: user.id,
      document_id: doc.id,
      job_id: jobId,
      amount: priceKzt,
      currency: 'KZT',
      payment_provider: 'halyk_epay',
      payment_source: 'card_payment',
      status: 'payment_pending',
      provider_invoice_id: invoiceId,
      provider_invoice_suffix6: invoiceSuffix6,
      secret_hash_digest: secretHashDigest,
      provider_environment: config.mode,
      ip_address: clientIp,
      expires_at: expiresAt,
      // Quote linkage — amount is sourced from price_quotes when quoteId is provided
      quote_id: verifiedQuoteId ?? null,
      price_locked_at: verifiedQuoteId ? new Date().toISOString() : null,
      amount_source: verifiedQuoteId ? 'quote' : 'legacy_test',
      pricing_snapshot_json: verifiedQuoteId ? { quoteId: verifiedQuoteId, amountKzt: priceKzt } : {},
    })
    .select()
    .single() as { data: { id: string; [key: string]: unknown } | null; error: { code?: string; message?: string } | null };

  if (txError || !paymentTx) {
    console.error('[halyk/initiate] failed to create payment_transaction', {
      correlationId,
      jobId,
      quoteId: verifiedQuoteId,
      amountKzt: priceKzt,
      currency: 'KZT',
      errorCode: txError?.code,
      errorMessage: txError?.message,
      errorDetails: (txError as Record<string, unknown>)?.details,
      errorHint: (txError as Record<string, unknown>)?.hint,
    });
    return NextResponse.json(
      { error: 'TRANSACTION_CREATE_FAILED', correlationId },
      { status: 500 },
    );
  }

  // ── Update job to payment_pending if not already ─────────────────────────────
  if (job.status !== 'payment_pending') {
    await supabaseServer
      .from('jobs')
      .update({ status: 'payment_pending' })
      .eq('id', jobId);
  }

  // ── Mark quote as payment_pending (non-blocking) ─────────────────────────────
  if (verifiedQuoteId) {
    void markQuotePaymentPending(verifiedQuoteId).catch(err => {
      console.error('[halyk/initiate] failed to mark quote payment_pending (non-fatal):', (err as Error).message);
    });
  }

  // ── Call Halyk OAuth to get payment token ────────────────────────────────────
  console.log('[halyk/initiate] requesting token', {
    correlationId,
    mode: config.mode,
    oauthUrlHost: safeHostname(config.endpoints.oauthUrl),
    apiBaseHost: safeHostname(config.endpoints.apiBase),
    terminalIdPresent: !!process.env.HALYK_EPAY_TERMINAL_ID,
    clientIdPresent: !!process.env.HALYK_EPAY_CLIENT_ID,
    clientSecretPresent: !!process.env.HALYK_EPAY_CLIENT_SECRET,
    appBaseUrlHost: safeHostname(appBaseUrl),
    invoiceId,
    amount: priceKzt,
    currency: 'KZT',
  });

  let halykToken;
  try {
    halykToken = await createPaymentToken({
      invoiceId,
      secretHash,
      amount: priceKzt,
      postLink,
      failurePostLink,
    });
  } catch (err) {
    const isHalyk = err instanceof HalykApiError;
    console.error('[halyk/initiate] token acquisition failed', {
      correlationId,
      code: isHalyk ? err.code : 'UNKNOWN',
      httpStatus: isHalyk ? err.httpStatus : undefined,
      responseContentType: isHalyk ? err.responseContentType : undefined,
      // snippet already has access_token redacted by client.ts
      responseBodySnippetSanitized: isHalyk ? err.responseBodySnippet : undefined,
      halykErrorCode: isHalyk ? err.halykErrorCode : undefined,
      halykErrorDescription: isHalyk ? err.halykErrorDescription : undefined,
      validationIssues: isHalyk ? err.validationIssues : undefined,
      message: err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300),
      mode: config.mode,
      oauthUrlHost: safeHostname(config.endpoints.oauthUrl),
    });

    await supabaseServer
      .from('payment_transactions')
      .update({
        status: 'failed',
        failed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', paymentTx.id);

    return NextResponse.json(
      { error: 'HALYK_TOKEN_FAILED', correlationId },
      { status: 502 },
    );
  }

  // ── Build payment object — access_token passed to browser for halyk.pay() ────
  const language = mapLocaleToHalyk(locale);
  const description = buildPaymentDescription(jobId);

  const paymentObject: HalykPaymentObject = {
    invoiceId,
    backLink: `${appBaseUrl}/payment/result?payment=${paymentTx.id}`,
    failureBackLink: `${appBaseUrl}/payment/result?payment=${paymentTx.id}`,
    autoBackLink: true,
    postLink,
    failurePostLink,
    language,
    description,
    accountId: user.id,
    terminal: config.terminalId,
    amount: priceKzt,
    currency: 'KZT',
    email,
    auth: {
      access_token: halykToken.access_token,
      token_type: halykToken.token_type ?? 'Bearer',
      expires_in: halykToken.expires_in ?? 7200,
      ...(halykToken.scope ? { scope: halykToken.scope } : {}),
    },
    data: JSON.stringify({ paymentId: paymentTx.id, jobId }),
  };

  const bootstrap: HalykPayBootstrap = {
    paymentId: paymentTx.id,
    paymentObject,
    scriptUrl: config.endpoints.scriptUrl,
  };

  console.log('[halyk/initiate] token acquired, returning bootstrap', {
    correlationId,
    paymentId: paymentTx.id,
    invoiceId,
  });

  return NextResponse.json(bootstrap);
}
