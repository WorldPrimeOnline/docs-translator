/**
 * Pricing Lab — GET /api/internal/pricing-lab/pricing-versions
 * Read-only list of all pricing_versions rows (any status) for the version dropdown.
 */
import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { requirePricingLabAccess } from '@/lib/internal/require-pricing-lab-access';

export async function GET(): Promise<NextResponse> {
  const access = await requirePricingLabAccess();
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabaseServer as any)
    .from('pricing_versions')
    .select('id, code, status, created_at, metadata')
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const versions = (data ?? []).map((v: { id: string; code: string; status: string; created_at: string; metadata: Record<string, unknown> | null }) => ({
    id: v.id,
    code: v.code,
    status: v.status,
    createdAt: v.created_at,
    formulaVersion: (v.metadata?.formula_version as string | undefined) ?? 'legacy',
  }));

  return NextResponse.json({ versions });
}
