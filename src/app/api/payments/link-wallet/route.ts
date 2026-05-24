import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { supabaseServer } from '@/lib/supabase/server';
import { Address } from '@ton/core';
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

    const { address } = (await request.json()) as { address?: string };
    if (!address) return NextResponse.json({ error: 'address is required' }, { status: 400 });

    let addressRaw: string;
    try {
      addressRaw = Address.parse(address).toRawString();
    } catch {
      return NextResponse.json({ error: 'Invalid TON address' }, { status: 400 });
    }

    const { error } = await supabaseServer
      .from('wallet_links')
      .upsert(
        { user_id: user.id, address, address_raw: addressRaw },
        { onConflict: 'user_id' },
      );

    if (error) {
      console.error('[link-wallet] upsert failed:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[link-wallet] error:', err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
