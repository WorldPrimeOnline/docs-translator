import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { processJob } from '@/lib/jobs/processor';

const TONAPI_BASE = 'https://tonapi.io/v2/blockchain/transactions';

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

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    // Verify webhook secret if configured
    const secret = process.env.TONCONSOLE_WEBHOOK_SECRET;
    if (secret) {
      const authHeader = request.headers.get('authorization') ?? '';
      const provided = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
      if (provided !== secret) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    }

    const body = (await request.json()) as TonconsoleWebhook;
    const { tx_hash } = body;

    if (!tx_hash) {
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
    const inMsg = txData.in_msg;

    if (!inMsg) {
      console.log('[ton-webhook] no in_msg in tx', tx_hash);
      return NextResponse.json({ ok: true });
    }

    const comment = extractComment(inMsg).trim();
    if (!comment) {
      console.log('[ton-webhook] no comment in tx', tx_hash);
      return NextResponse.json({ ok: true });
    }

    // nanotons: tonapi returns value in nanotons
    const valueNanoton = Number(inMsg.value ?? 0);

    console.log('[ton-webhook] tx', tx_hash, 'comment:', comment, 'value:', valueNanoton);

    // Find pending payment by job_id (comment = jobId)
    const { data: payment, error: fetchErr } = await supabaseServer
      .from('ton_payments')
      .select('*')
      .eq('job_id', comment)
      .eq('status', 'pending')
      .single();

    if (fetchErr || !payment) {
      console.log('[ton-webhook] no pending payment for job_id:', comment);
      return NextResponse.json({ ok: true });
    }

    // Check expiry
    if (new Date() > new Date(payment.expires_at)) {
      await supabaseServer
        .from('ton_payments')
        .update({ status: 'expired' })
        .eq('id', payment.id);
      console.log('[ton-webhook] payment expired for job_id:', comment);
      return NextResponse.json({ ok: true });
    }

    // Verify amount (allow 1% slippage)
    const minAmount = Math.floor(Number(payment.amount_nanoton) * 0.99);
    if (valueNanoton < minAmount) {
      console.log('[ton-webhook] amount too low', valueNanoton, '<', minAmount);
      return NextResponse.json({ ok: true });
    }

    // Mark completed
    await supabaseServer
      .from('ton_payments')
      .update({ status: 'completed', tx_hash })
      .eq('id', payment.id);

    console.log('[ton-webhook] payment completed for job_id:', comment);

    setTimeout(() => {
      void processJob(payment.job_id, payment.document_id);
    }, 0);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[ton-webhook] error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
