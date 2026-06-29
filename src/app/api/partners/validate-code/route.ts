/**
 * POST /api/partners/validate-code
 *
 * Validates a partner referral code and returns public-safe discount info.
 * Requires authentication — called from the logged-in dashboard only.
 *
 * Does NOT expose: commission_rate, payout rules, internal partner IDs.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { supabaseServer } from '@/lib/supabase/server';
import type { Database } from '@/types';

const BodySchema = z.object({
  code: z.string().min(1).max(100).transform((v) => v.trim().toUpperCase()),
});

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
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ valid: false }, { status: 200 });
  }

  const { code } = parsed.data;

  const { data: partner } = await supabaseServer
    .from('partners')
    .select(
      'name, organization, is_active, client_discount_enabled, client_discount_type, client_discount_value, client_discount_min_order_amount, client_discount_max_amount',
    )
    .eq('referral_code', code)
    .maybeSingle();

  if (!partner || !partner.is_active) {
    return NextResponse.json({ valid: false });
  }

  // Public-safe response — no commission_rate, no internal IDs
  const response: {
    valid: boolean;
    partnerName: string;
    discountEnabled: boolean;
    discountType?: string;
    discountValue?: number;
    discountMinOrderKzt?: number;
    discountMaxKzt?: number;
  } = {
    valid: true,
    partnerName: partner.organization ?? partner.name,
    discountEnabled: partner.client_discount_enabled,
  };

  if (partner.client_discount_enabled) {
    response.discountType = partner.client_discount_type ?? undefined;
    response.discountValue = partner.client_discount_value != null
      ? Number(partner.client_discount_value)
      : undefined;
    response.discountMinOrderKzt = partner.client_discount_min_order_amount != null
      ? Number(partner.client_discount_min_order_amount)
      : undefined;
    response.discountMaxKzt = partner.client_discount_max_amount != null
      ? Number(partner.client_discount_max_amount)
      : undefined;
  }

  return NextResponse.json(response);
}
