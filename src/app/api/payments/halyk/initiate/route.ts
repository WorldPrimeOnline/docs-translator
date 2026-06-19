import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { supabaseServer } from '@/lib/supabase/server';
import { getHalykConfig } from '@/lib/payments/halyk/config';
import { createPaymentToken } from '@/lib/payments/halyk/client';
import { generateUniqueInvoiceId, getInvoiceSuffix6 } from '@/lib/payments/halyk/invoice';
import { generateSecretHash, digestSecretHash } from '@/lib/payments/halyk/security';
import { mapLocaleToHalyk } from '@/lib/payments/halyk/locale';
import { buildPaymentDescription } from '@/lib/payments/halyk/description';
import type { HalykPayBootstrap, HalykPaymentObject } from '@/lib/payments/halyk/types';
import type { Database } from '@/types';

const RequestSchema = z.object({
  jobId: z.string().uuid(),
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

export async function POST(request: NextRequest): Promise<NextResponse> {
  const config = getHalykConfig();

  if (!config.enabled) {
    return NextResponse.json(
      { error: 'Card payments are not available at this time' },
      { status: 503 },
    );
  }

  // Auth check
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Parse request body
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

  const { jobId, locale } = parsed.data;
  const clientIp = getClientIp(request);

  // Load job + document, verify ownership
  const { data: job, error: jobError } = await supabaseServer
    .from('jobs')
    .select(`
      id, status, price_kzt, payment_source, document_id,
      documents!inner ( id, user_id, filename )
    `)
    .eq('id', jobId)
    .maybeSingle();

  if (jobError || !job) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 });
  }

  // Ownership check
  const doc = Array.isArray(job.documents) ? job.documents[0] : job.documents;
  if (!doc || doc.user_id !== user.id) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 });
  }

  // Status checks: cannot initiate for already-paid, canceled, or processing orders
  if (job.status === 'completed') {
    return NextResponse.json({ error: 'Order already completed' }, { status: 409 });
  }
  if (['failed'].includes(job.status) && job.payment_source !== 'card_payment') {
    return NextResponse.json({ error: 'Order cannot be paid' }, { status: 409 });
  }

  // Amount must be set and positive
  const priceKzt = job.price_kzt;
  if (!priceKzt || priceKzt <= 0) {
    return NextResponse.json({ error: 'Order amount not set' }, { status: 409 });
  }

  // Check for an existing pending payment attempt
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
    // Return the age: if recent (< 10 min), reject to prevent double-click double-init
    const ageMs = Date.now() - new Date(pendingAttempt.created_at).getTime();
    if (ageMs < 10 * 60 * 1000) {
      return NextResponse.json(
        { error: 'A payment attempt is already in progress for this order' },
        { status: 409 },
      );
    }
  }

  // Get user email for payment form pre-fill
  const { data: userRow } = await supabaseServer
    .from('users')
    .select('email')
    .eq('id', user.id)
    .maybeSingle();
  const email = userRow?.email ?? user.email ?? '';

  // Generate unique invoice ID
  const invoiceId = await generateUniqueInvoiceId(async (id, suffix6) => {
    const { data } = await supabaseServer
      .from('payment_transactions')
      .select('id')
      .or(`provider_invoice_id.eq.${id},provider_invoice_suffix6.eq.${suffix6}`)
      .limit(1);
    return !data || data.length === 0;
  });

  const invoiceSuffix6 = getInvoiceSuffix6(invoiceId);

  // Generate secret_hash; store only digest
  const secretHash = generateSecretHash();
  const secretHashDigest = digestSecretHash(secretHash);

  // Build callback URLs from APP_BASE_URL (never from Host header)
  const baseUrl = config.appBaseUrl;
  const postLink = `${baseUrl}/api/payments/halyk/callback`;
  const failurePostLink = `${baseUrl}/api/payments/halyk/callback`;

  // Create payment_transaction record first (before calling Halyk)
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString(); // 30 min window

  const { data: paymentTx, error: txError } = await supabaseServer
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
    })
    .select()
    .single();

  if (txError || !paymentTx) {
    console.error('[halyk/initiate] failed to create payment_transaction:', txError?.message);
    return NextResponse.json({ error: 'Failed to create payment record' }, { status: 500 });
  }

  // Update job to payment_pending if not already
  if (job.status !== 'payment_pending') {
    await supabaseServer
      .from('jobs')
      .update({ status: 'payment_pending' })
      .eq('id', jobId);
  }

  // Call Halyk to get payment token
  let halykToken;
  try {
    halykToken = await createPaymentToken({
      invoiceId,
      secretHash,
      amount: priceKzt,
      postLink,
      failurePostLink,
    });
  } catch {
    // Mark transaction as failed if token acquisition fails
    console.error('[halyk/initiate] token acquisition failed (no secret logged)');

    await supabaseServer
      .from('payment_transactions')
      .update({ status: 'failed', failed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', paymentTx.id);

    return NextResponse.json(
      { error: 'Payment gateway temporarily unavailable. Please try again.' },
      { status: 502 },
    );
  }

  // Build the payment object for halyk.pay() — client_secret is NOT included
  const language = mapLocaleToHalyk(locale);
  const description = buildPaymentDescription(jobId);

  const paymentObject: HalykPaymentObject = {
    invoiceId,
    backLink: `${baseUrl}/payment/result?payment=${paymentTx.id}`,
    failureBackLink: `${baseUrl}/payment/result?payment=${paymentTx.id}`,
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
      token_type: halykToken.token_type,
      expires_in: halykToken.expires_in,
      ...(halykToken.scope ? { scope: halykToken.scope } : {}),
    },
    data: JSON.stringify({ paymentId: paymentTx.id, jobId }),
  };

  const bootstrap: HalykPayBootstrap = {
    paymentId: paymentTx.id,
    paymentObject,
    scriptUrl: config.endpoints.scriptUrl,
  };

  return NextResponse.json(bootstrap);
}
