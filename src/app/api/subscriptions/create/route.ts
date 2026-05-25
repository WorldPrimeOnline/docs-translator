import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { supabaseServer } from '@/lib/supabase/server';
import { getTonPriceUsd, usdToNanoton } from '@/lib/ton/price';
import { MERCHANT_ADDRESS } from '@/lib/ton/config';
import { SUBSCRIPTION_PLANS, SUBSCRIPTION_DURATION_DAYS, type PlanKey } from '@/lib/subscriptions/config';
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

    const body = (await request.json()) as { plan?: string };
    const plan = body.plan as PlanKey | undefined;

    if (!plan || !(plan in SUBSCRIPTION_PLANS)) {
      return NextResponse.json(
        { error: 'plan must be "basic" or "pro"' },
        { status: 400 },
      );
    }

    const planConfig = SUBSCRIPTION_PLANS[plan];

    // Check for an existing pending subscription (still valid — not yet activated)
    const { data: existing } = await supabaseServer
      .from('subscriptions')
      .select('*')
      .eq('user_id', user.id)
      .eq('plan', plan)
      .eq('status', 'pending')
      .maybeSingle();

    if (existing) {
      const amountTon = Number(existing.amount_nanoton) / 1e9;
      return NextResponse.json({
        subscriptionId: existing.id,
        amountTon: amountTon.toFixed(4),
        amountNanoton: Number(existing.amount_nanoton),
        amountUsd: Number(existing.amount_usd).toFixed(2),
        tonPriceUsd: Number(existing.ton_price_usd).toFixed(2),
        walletAddress: MERCHANT_ADDRESS,
        deeplink: `ton://transfer/${MERCHANT_ADDRESS}?amount=${existing.amount_nanoton}&text=${encodeURIComponent(existing.id)}`,
        qrData: `ton://transfer/${MERCHANT_ADDRESS}?amount=${existing.amount_nanoton}&text=${encodeURIComponent(existing.id)}`,
      });
    }

    // Fetch current TON price
    let tonPriceUsd: number;
    try {
      tonPriceUsd = await getTonPriceUsd();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[subscriptions/create] price fetch failed:', msg);
      return NextResponse.json(
        { error: 'Failed to fetch TON price', detail: msg },
        { status: 502 },
      );
    }

    const amountNanoton = usdToNanoton(planConfig.priceUsd, tonPriceUsd);

    // Expire old pending subscriptions for this user+plan
    await supabaseServer
      .from('subscriptions')
      .update({ status: 'expired' })
      .eq('user_id', user.id)
      .eq('status', 'pending');

    const { data: sub, error: subError } = await supabaseServer
      .from('subscriptions')
      .insert({
        user_id: user.id,
        plan,
        status: 'pending',
        documents_limit: planConfig.documentsLimit,
        documents_used: 0,
        amount_nanoton: amountNanoton,
        amount_usd: planConfig.priceUsd,
        ton_price_usd: tonPriceUsd,
      })
      .select()
      .single();

    if (subError || !sub) {
      console.error('[subscriptions/create] insert failed:', subError);
      return NextResponse.json(
        { error: 'Failed to create subscription record', detail: subError?.message },
        { status: 500 },
      );
    }

    const amountTon = amountNanoton / 1e9;
    const deeplink = `ton://transfer/${MERCHANT_ADDRESS}?amount=${amountNanoton}&text=${encodeURIComponent(sub.id)}`;

    return NextResponse.json({
      subscriptionId: sub.id,
      amountTon: amountTon.toFixed(4),
      amountNanoton,
      amountUsd: planConfig.priceUsd.toFixed(2),
      tonPriceUsd: tonPriceUsd.toFixed(2),
      walletAddress: MERCHANT_ADDRESS,
      deeplink,
      qrData: deeplink,
      // Info for display
      plan,
      planName: planConfig.name,
      documentsLimit: planConfig.documentsLimit,
      durationDays: SUBSCRIPTION_DURATION_DAYS,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[subscriptions/create] unhandled error:', err);
    return NextResponse.json({ error: 'Internal error', detail: msg }, { status: 500 });
  }
}
