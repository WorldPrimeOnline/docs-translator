import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { processJob } from '@/lib/jobs/processor';
import { SUBSCRIPTION_DURATION_DAYS } from '@/lib/subscriptions/config';

const TONAPI_BASE = 'https://tonapi.io/v2/blockchain/transactions';

// UUID v4 pattern — used to distinguish subscription IDs from job IDs
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface TonconsoleWebhook {
  account_id?: string;
  lt?: string | number;
  tx_hash?: string;
}

interface TonapiMessage {
  decoded_body?: {
    text?: string;
    comment?: string;
  };
  value?: number;
  source?: { address?: string } | string;
}

interface TonapiTx {
  in_msg?: TonapiMessage;
  [key: string]: unknown;
}

function extractComment(inMsg: TonapiMessage): string {
  return (
    inMsg.decoded_body?.text ??
    inMsg.decoded_body?.comment ??
    ''
  );
}

async function handleSubscriptionPayment(
  subscriptionId: string,
  valueNanoton: number,
  txHash: string,
): Promise<{ handled: boolean }> {
  const { data: sub, error: fetchErr } = await supabaseServer
    .from('subscriptions')
    .select('*')
    .eq('id', subscriptionId)
    .maybeSingle();

  if (fetchErr || !sub) {
    console.log('[ton-webhook] no subscription found for id:', subscriptionId);
    return { handled: false };
  }

  // Idempotency
  if (sub.status === 'active') {
    console.log('[ton-webhook] subscription already active:', subscriptionId);
    return { handled: true };
  }

  if (sub.status !== 'pending') {
    console.warn('[ton-webhook] subscription status not pending:', sub.status, subscriptionId);
    return { handled: true };
  }

  // Verify amount (allow 1% slippage)
  const minAmount = Math.floor(Number(sub.amount_nanoton) * 0.99);
  if (valueNanoton < minAmount) {
    console.warn('[ton-webhook] subscription amount too low', valueNanoton, '<', minAmount);
    return { handled: true };
  }

  const now = new Date();
  const expiresAt = new Date(now);
  expiresAt.setDate(expiresAt.getDate() + SUBSCRIPTION_DURATION_DAYS);

  const { error: updateErr } = await supabaseServer
    .from('subscriptions')
    .update({
      status: 'active',
      tx_hash: txHash,
      started_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
    })
    .eq('id', sub.id);

  if (updateErr) {
    console.error('[ton-webhook] subscription update failed:', updateErr);
    return { handled: true };
  }

  console.log('[ton-webhook] subscription activated:', subscriptionId, 'expires:', expiresAt.toISOString());
  return { handled: true };
}

async function handleJobPayment(
  comment: string,
  valueNanoton: number,
  txHash: string,
): Promise<{ handled: boolean }> {
  const { data: payment, error: fetchErr } = await supabaseServer
    .from('ton_payments')
    .select('*')
    .eq('job_id', comment)
    .single();

  if (fetchErr || !payment) {
    console.warn('[ton-webhook] no payment found for job_id:', comment, 'error:', fetchErr);
    return { handled: false };
  }

  // Idempotency
  if (payment.status === 'completed') {
    console.log('[ton-webhook] payment already completed for job_id:', comment);
    return { handled: true };
  }

  if (payment.status !== 'pending') {
    console.warn('[ton-webhook] payment status is not pending:', payment.status, 'job_id:', comment);
    return { handled: true };
  }

  // Check expiry
  if (new Date() > new Date(payment.expires_at)) {
    await supabaseServer
      .from('ton_payments')
      .update({ status: 'expired' })
      .eq('id', payment.id);
    console.log('[ton-webhook] payment expired for job_id:', comment);
    return { handled: true };
  }

  // Verify amount (allow 1% slippage)
  const minAmount = Math.floor(Number(payment.amount_nanoton) * 0.99);
  if (valueNanoton < minAmount) {
    console.warn('[ton-webhook] amount too low', valueNanoton, '<', minAmount, 'for job_id:', comment);
    return { handled: true };
  }

  const { data: updateData, error: updateErr } = await supabaseServer
    .from('ton_payments')
    .update({ status: 'completed', tx_hash: txHash })
    .eq('id', payment.id)
    .select();

  console.log('[ton-webhook] UPDATE result — data:', JSON.stringify(updateData), 'error:', updateErr);

  if (updateErr) {
    console.error('[ton-webhook] UPDATE failed for job_id:', comment, 'error:', updateErr);
    return { handled: true };
  }

  console.log('[ton-webhook] payment completed for job_id:', comment);

  setTimeout(() => {
    void processJob(payment.job_id, payment.document_id);
  }, 0);

  return { handled: true };
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    // Verify webhook secret if configured
    const secret = process.env.TONCONSOLE_WEBHOOK_SECRET;
    if (secret) {
      const authHeader = request.headers.get('authorization') ?? '';
      const provided = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
      if (provided !== secret) {
        console.warn('[ton-webhook] unauthorized — header:', authHeader);
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    }

    const rawBody = (await request.json()) as TonconsoleWebhook;
    console.log('[ton-webhook] raw payload:', JSON.stringify(rawBody));

    const { tx_hash } = rawBody;

    if (!tx_hash) {
      console.warn('[ton-webhook] missing tx_hash in payload:', JSON.stringify(rawBody));
      return NextResponse.json({ error: 'tx_hash required' }, { status: 400 });
    }

    // Fetch full transaction from tonapi.io
    const tonapiRes = await fetch(`${TONAPI_BASE}/${tx_hash}`, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });

    if (!tonapiRes.ok) {
      console.error('[ton-webhook] tonapi error', tonapiRes.status, tx_hash);
      return NextResponse.json({ error: 'tonapi fetch failed' }, { status: 502 });
    }

    const txData = (await tonapiRes.json()) as TonapiTx;
    console.log('[ton-webhook] tonapi tx data:', JSON.stringify(txData));

    const inMsg = txData.in_msg;

    if (!inMsg) {
      console.log('[ton-webhook] no in_msg in tx', tx_hash);
      return NextResponse.json({ ok: true });
    }

    const comment = extractComment(inMsg).trim();
    console.log('[ton-webhook] extracted comment:', JSON.stringify(comment));

    if (!comment) {
      console.warn('[ton-webhook] no comment in tx — full in_msg:', JSON.stringify(inMsg));
      return NextResponse.json({ ok: true });
    }

    const valueNanoton = Number(inMsg.value ?? 0);
    console.log('[ton-webhook] tx', tx_hash, 'comment:', comment, 'value:', valueNanoton);

    // Route: UUID comment → check subscription first, then job payment
    if (UUID_RE.test(comment)) {
      // Try subscription first
      const subResult = await handleSubscriptionPayment(comment, valueNanoton, tx_hash);
      if (subResult.handled) return NextResponse.json({ ok: true });

      // Fall through to job payment (comment is a jobId UUID)
      const jobResult = await handleJobPayment(comment, valueNanoton, tx_hash);
      if (!jobResult.handled) {
        console.warn('[ton-webhook] no match for UUID comment:', comment);
      }
    } else {
      // Non-UUID comment — treat as job payment
      const jobResult = await handleJobPayment(comment, valueNanoton, tx_hash);
      if (!jobResult.handled) {
        console.warn('[ton-webhook] no match for comment:', comment);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[ton-webhook] error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
