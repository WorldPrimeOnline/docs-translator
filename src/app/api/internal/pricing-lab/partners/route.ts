/**
 * Pricing Lab — GET /api/internal/pricing-lab/partners
 * Read-only list of active staging partners (id, name, commission_rate) for the Referral
 * channel dropdown ("либо выбрать реального staging-партнёра").
 */
import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { requirePricingLabAccess } from '@/lib/internal/require-pricing-lab-access';

export async function GET(): Promise<NextResponse> {
  const access = await requirePricingLabAccess();
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabaseServer as any)
    .from('partners')
    .select('id, name, commission_rate, partner_type')
    .eq('is_active', true)
    .order('name');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const partners = (data ?? []).map((p: { id: string; name: string; commission_rate: string | number; partner_type: string }) => ({
    id: p.id,
    name: p.name,
    commissionRate: Number(p.commission_rate),
    partnerType: p.partner_type,
  }));

  return NextResponse.json({ partners });
}
