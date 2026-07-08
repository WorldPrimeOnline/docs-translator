/**
 * Converts a checked-out draft into a real document + job (payment_pending) + quote —
 * the exact same DB-write sequence upload-card/route.ts uses for logged-in orders.
 * Does not touch Halyk, Jira, or Drive — those are unchanged and downstream of payment.
 */
import { NextRequest, NextResponse } from 'next/server';
import { convertDraftToOrder } from '@/lib/order-drafts/service';
import { getOptionalAuthUser } from '@/lib/order-drafts/request-context';

export async function POST(_request: NextRequest, { params }: { params: Promise<{ draftId: string }> }): Promise<NextResponse> {
  try {
    const { draftId } = await params;
    const user = await getOptionalAuthUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const result = await convertDraftToOrder(draftId, user.id);
    if (!result.ok) {
      const status =
        result.error === 'DRAFT_NOT_FOUND' ? 404 :
        result.error === 'FORBIDDEN' ? 403 :
        result.error === 'CONVERSION_IN_PROGRESS' ? 409 : 422;
      return NextResponse.json({ error: result.error }, { status });
    }

    return NextResponse.json({
      jobId: result.value.jobId,
      documentId: result.value.documentId,
      quoteId: result.value.quoteId,
      priceKzt: result.value.priceKzt,
      currency: 'KZT',
    });
  } catch (err) {
    console.error('[order-drafts] convert failed:', err);
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
