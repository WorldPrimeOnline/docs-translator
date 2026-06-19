/**
 * Internal payment status endpoint for frontend polling.
 * Requires user session. Returns only data the user is allowed to see.
 * NEVER uses query params (success=true etc.) to determine paid status.
 */
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { supabaseServer } from '@/lib/supabase/server';
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

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ paymentId: string }> },
): Promise<NextResponse> {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { paymentId } = await params;

  // Load payment transaction and verify ownership
  const { data: paymentTx } = await supabaseServer
    .from('payment_transactions')
    .select('id, status, amount, currency, paid_at, failed_at, job_id, user_id')
    .eq('id', paymentId)
    .maybeSingle();

  if (!paymentTx) {
    return NextResponse.json({ error: 'Payment not found' }, { status: 404 });
  }

  if (paymentTx.user_id !== user.id) {
    return NextResponse.json({ error: 'Payment not found' }, { status: 404 });
  }

  // Return safe subset — no internal fields, no provider raw payload
  return NextResponse.json({
    paymentId: paymentTx.id,
    status: paymentTx.status,
    amount: paymentTx.amount,
    currency: paymentTx.currency,
    paidAt: paymentTx.paid_at ?? null,
    failedAt: paymentTx.failed_at ?? null,
    jobId: paymentTx.job_id,
  });
}
