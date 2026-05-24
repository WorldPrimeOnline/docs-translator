import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { supabaseServer } from '@/lib/supabase/server';
import { getPriceUsd, MERCHANT_ADDRESS, PAYMENT_WINDOW_MS } from '@/lib/ton/config';
import { getTonPriceUsd, usdToNanoton } from '@/lib/ton/price';
import { beginCell } from '@ton/ton';
import type { Database } from '@/types';

function buildCommentPayload(comment: string): string {
  return beginCell().storeUint(0, 32).storeStringTail(comment).endCell().toBoc().toString('base64');
}

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

    const { documentId, jobId } = (await request.json()) as { documentId?: string; jobId?: string };
    if (!documentId || !jobId) {
      return NextResponse.json({ error: 'documentId and jobId are required' }, { status: 400 });
    }

    // Verify ownership
    const { data: doc } = await supabaseServer
      .from('documents')
      .select('id, user_id, document_type')
      .eq('id', documentId)
      .single();

    if (!doc || doc.user_id !== user.id) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    // Return existing pending payment if one exists for this job
    const { data: existing } = await supabaseServer
      .from('ton_payments')
      .select('*')
      .eq('job_id', jobId)
      .eq('status', 'pending')
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();

    if (existing) {
      const amountTon = Number(existing.amount_nanoton) / 1e9;
      return NextResponse.json({
        paymentId: existing.id,
        amountNanoton: Number(existing.amount_nanoton),
        amountTon: amountTon.toFixed(4),
        amountUsd: Number(existing.amount_usd).toFixed(2),
        tonPriceUsd: Number(existing.ton_price_usd).toFixed(2),
        merchantAddress: MERCHANT_ADDRESS,
        memo: existing.id,
        payload: buildCommentPayload(existing.id),
        expiresAt: existing.expires_at,
      });
    }

    const amountUsd = getPriceUsd(doc.document_type);
    const tonPriceUsd = await getTonPriceUsd();
    const amountNanoton = usdToNanoton(amountUsd, tonPriceUsd);
    const expiresAt = new Date(Date.now() + PAYMENT_WINDOW_MS).toISOString();

    const { data: payment, error: paymentError } = await supabaseServer
      .from('ton_payments')
      .insert({
        user_id: user.id,
        document_id: documentId,
        job_id: jobId,
        amount_nanoton: amountNanoton,
        amount_usd: amountUsd,
        ton_price_usd: tonPriceUsd,
        expires_at: expiresAt,
      })
      .select()
      .single();

    if (paymentError || !payment) {
      console.error('[create-ton-payment] insert failed:', paymentError);
      return NextResponse.json({ error: 'Failed to create payment' }, { status: 500 });
    }

    const amountTon = amountNanoton / 1e9;
    return NextResponse.json({
      paymentId: payment.id,
      amountNanoton,
      amountTon: amountTon.toFixed(4),
      amountUsd: amountUsd.toFixed(2),
      tonPriceUsd: tonPriceUsd.toFixed(2),
      merchantAddress: MERCHANT_ADDRESS,
      memo: payment.id,
      payload: buildCommentPayload(payment.id),
      expiresAt,
    });
  } catch (err) {
    console.error('[create-ton-payment] error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
