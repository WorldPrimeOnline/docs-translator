import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
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
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getAuthUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { jobId } = (await request.json()) as { jobId?: string };
    if (!jobId) {
      return NextResponse.json({ error: 'jobId is required' }, { status: 400 });
    }

    // Use limit(1) + order so duplicate rows (edge case) never cause .single() to throw.
    const { data: rows, error } = await supabaseServer
      .from('ton_payments')
      .select('status, expires_at')
      .eq('job_id', jobId)
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1);

    if (error) {
      console.error('[verify-ton-payment] DB error:', error.message);
      return NextResponse.json({ error: 'Database error' }, { status: 500 });
    }

    const payment = rows?.[0] ?? null;

    if (!payment) {
      return NextResponse.json({ error: 'Payment not found' }, { status: 404 });
    }

    if (payment.status === 'completed') {
      return NextResponse.json({ verified: true });
    }

    if (payment.status === 'expired') {
      return NextResponse.json({ verified: false, expired: true });
    }

    // Real-time expiry check even if DB still says 'pending'
    if (new Date() > new Date(payment.expires_at)) {
      await supabaseServer
        .from('ton_payments')
        .update({ status: 'expired' })
        .eq('job_id', jobId)
        .eq('user_id', user.id);
      return NextResponse.json({ verified: false, expired: true });
    }

    return NextResponse.json({ verified: false });
  } catch (err) {
    console.error('[verify-ton-payment] error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
