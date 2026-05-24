import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { supabaseServer } from '@/lib/supabase/server';
import { verifyTonPayment } from '@/lib/ton/verify-payment';
import { MERCHANT_ADDRESS } from '@/lib/ton/config';
import { processJob } from '@/lib/jobs/processor';
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

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getAuthUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { paymentId } = (await request.json()) as { paymentId?: string };
    if (!paymentId) return NextResponse.json({ error: 'paymentId is required' }, { status: 400 });

    const { data: payment } = await supabaseServer
      .from('ton_payments')
      .select('*')
      .eq('id', paymentId)
      .eq('user_id', user.id)
      .single();

    if (!payment) return NextResponse.json({ error: 'Payment not found' }, { status: 404 });

    if (payment.status === 'completed') {
      return NextResponse.json({ verified: true });
    }

    const now = new Date();
    const expiresAt = new Date(payment.expires_at);

    if (now > expiresAt) {
      await supabaseServer
        .from('ton_payments')
        .update({ status: 'expired' })
        .eq('id', paymentId);
      return NextResponse.json({ verified: false, expired: true });
    }

    const result = await verifyTonPayment({
      address: MERCHANT_ADDRESS,
      amountNanoton: Number(payment.amount_nanoton),
      memo: payment.id,
      createdAtSec: Math.floor(new Date(payment.created_at).getTime() / 1000),
      expiresAtSec: Math.floor(expiresAt.getTime() / 1000),
    });

    if (!result.verified) return NextResponse.json({ verified: false });

    await supabaseServer
      .from('ton_payments')
      .update({ status: 'completed', tx_hash: result.txHash ?? null })
      .eq('id', paymentId);

    setTimeout(() => {
      void processJob(payment.job_id, payment.document_id);
    }, 0);

    return NextResponse.json({ verified: true });
  } catch (err) {
    console.error('[verify-ton-payment] error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
