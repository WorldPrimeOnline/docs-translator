import { NextRequest, NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe/client';
import { supabaseServer } from '@/lib/supabase/server';
import { processJob } from '@/lib/jobs/processor';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error('[stripe-webhook] STRIPE_WEBHOOK_SECRET is not set');
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 });
  }

  const body = await request.text();
  const sig = request.headers.get('stripe-signature');
  if (!sig) return NextResponse.json({ error: 'Missing stripe-signature header' }, { status: 400 });

  let event: ReturnType<typeof stripe.webhooks.constructEvent>;
  try {
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[stripe-webhook] signature verification failed:', msg);
    return NextResponse.json({ error: `Webhook signature invalid: ${msg}` }, { status: 400 });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const { documentId, jobId, userId } = session.metadata ?? {};

    if (!documentId || !jobId || !userId) {
      console.error('[stripe-webhook] missing metadata:', session.metadata);
      return NextResponse.json({ error: 'Missing metadata' }, { status: 400 });
    }

    await supabaseServer.from('payments').insert({
      user_id: userId,
      document_id: documentId,
      stripe_charge_id: typeof session.payment_intent === 'string' ? session.payment_intent : '',
      amount_cents: 999,
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
