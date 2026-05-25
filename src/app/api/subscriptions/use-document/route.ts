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
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getAuthUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = (await request.json()) as { userId?: string };
    const targetUserId = body.userId ?? user.id;

    // Only allow checking own subscription
    if (targetUserId !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Get active subscription
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
      console.error('[subscriptions/use-document] query error:', error);
      return NextResponse.json({ allowed: false, reason: 'database_error' });
    }

    if (!sub) {
      return NextResponse.json({ allowed: false, reason: 'no_subscription' });
    }

    if (sub.documents_used >= sub.documents_limit) {
      return NextResponse.json({
        allowed: false,
        reason: 'limit_reached',
        plan: sub.plan,
        documentsLimit: sub.documents_limit,
        documentsUsed: sub.documents_used,
        remainingDocs: 0,
      });
    }

    // Increment documents_used
    const { error: updateErr } = await supabaseServer
      .from('subscriptions')
      .update({ documents_used: sub.documents_used + 1 })
      .eq('id', sub.id);

    if (updateErr) {
      console.error('[subscriptions/use-document] update error:', updateErr);
      return NextResponse.json({ allowed: false, reason: 'database_error' });
    }

    const remainingDocs = sub.documents_limit - sub.documents_used - 1;

    return NextResponse.json({
      allowed: true,
      subscriptionId: sub.id,
      plan: sub.plan,
      documentsLimit: sub.documents_limit,
      documentsUsed: sub.documents_used + 1,
      remainingDocs,
    });
  } catch (err) {
    console.error('[subscriptions/use-document] unhandled error:', err);
    return NextResponse.json({ allowed: false, reason: 'internal_error' });
  }
}
