import { NextResponse } from 'next/server';
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
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

export async function GET(): Promise<NextResponse> {
  try {
    const user = await getAuthUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // Expire overdue active subscriptions first
    await supabaseServer
      .from('subscriptions')
      .update({ status: 'expired' })
      .eq('user_id', user.id)
      .eq('status', 'active')
      .lt('expires_at', new Date().toISOString());

    // Return the active subscription if it exists
    const { data: sub, error } = await supabaseServer
      .from('subscriptions')
      .select('*')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('[subscriptions/current] query error:', error);
      return NextResponse.json({ error: 'Database error' }, { status: 500 });
    }

    if (!sub) {
      return NextResponse.json({ subscription: null });
    }

    return NextResponse.json({
      subscription: {
        id: sub.id,
        plan: sub.plan,
        status: sub.status,
        documentsLimit: sub.documents_limit,
        documentsUsed: sub.documents_used,
        expiresAt: sub.expires_at,
        startedAt: sub.started_at,
      },
    });
  } catch (err) {
    console.error('[subscriptions/current] unhandled error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
