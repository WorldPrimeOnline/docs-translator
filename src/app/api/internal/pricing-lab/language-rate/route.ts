/**
 * Pricing Lab — GET /api/internal/pricing-lab/language-rate?versionId=&source=&target=
 * Read-only lookup via the REAL getLanguageRate() (src/lib/pricing/service.ts) — live preview
 * of the resolved rate/active/requires_operator_review flags before running a full calculation.
 */
import { NextResponse } from 'next/server';
import { requirePricingLabAccess } from '@/lib/internal/require-pricing-lab-access';
import { getLanguageRate } from '@/lib/pricing/service';

export async function GET(request: Request): Promise<NextResponse> {
  const access = await requirePricingLabAccess();
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  const url = new URL(request.url);
  const versionId = url.searchParams.get('versionId');
  const source = url.searchParams.get('source');
  const target = url.searchParams.get('target');

  if (!versionId || !source || !target) {
    return NextResponse.json({ error: 'versionId, source, and target query params are required' }, { status: 400 });
  }

  const rate = await getLanguageRate(versionId, source, target);
  if (!rate) {
    return NextResponse.json({ rate: null, message: `No pricing_language_rates row for ${source}→${target} under this version — will route to operator_review, not a fabricated rate.` });
  }
  return NextResponse.json({ rate });
}
