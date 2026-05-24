import { NextRequest, NextResponse } from 'next/server';
import { validateEvent, WebhookVerificationError } from '@polar-sh/sdk/webhooks';
import { supabaseServer } from '@/lib/supabase/server';
import { processJob } from '@/lib/jobs/processor';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const webhookSecret = process.env.POLAR_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error('[polar-webhook] POLAR_WEBHOOK_SECRET not set');
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 });
  }

  const rawBody = await request.text();
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => { headers[key] = value; });

  let event;
  try {
    event = validateEvent(rawBody, headers, webhookSecret);
  } catch (err) {
    if (err instanceof WebhookVerificationError) {
      console.error('[polar-webhook] signature verification failed');
      return NextResponse.json({ error: 'Invalid webhook signature' }, { status: 403 });
    }
    throw err;
  }

  if (event.type === 'order.paid') {
    const order = event.data;
    const meta = order.metadata as Record<string, string>;
    const { documentId, jobId, userId } = meta;

    if (!documentId || !jobId || !userId) {
      console.error('[polar-webhook] missing metadata:', order.metadata);
      return NextResponse.json({ error: 'Missing metadata' }, { status: 400 });
    }

    await supabaseServer.from('payments').insert({
      user_id: userId,
      document_id: documentId,
      stripe_charge_id: order.id,
      amount_cents: order.totalAmount,
      status: 'completed',
    });

    await supabaseServer
      .from('documents')
      .update({ status: 'processing' })
      .eq('id', documentId);

    setTimeout(() => {
      void processJob(jobId, documentId);
    }, 0);
  }

  return NextResponse.json({ received: true });
}
