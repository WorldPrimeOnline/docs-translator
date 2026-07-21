import { NextRequest, NextResponse } from 'next/server';
import { calculateDraftPrice } from '@/lib/order-drafts/service';
import { getDraftSessionToken } from '@/lib/order-drafts/session';
import { getClientIp, getOptionalAuthUser } from '@/lib/order-drafts/request-context';
import { checkAnonymousPreflightRateLimit, recordAnonymousPreflightAttempt } from '@/lib/order-drafts/rate-limit';
import { PRICING_REVIEW_HTTP_STATUS, type PricingReviewClassification } from '@/lib/pricing/review-classification';

function isPricingReviewClassification(error: string): error is PricingReviewClassification {
  return error in PRICING_REVIEW_HTTP_STATUS;
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ draftId: string }> }): Promise<NextResponse> {
  try {
    const { draftId } = await params;
    const [sessionToken, user] = await Promise.all([getDraftSessionToken(), getOptionalAuthUser()]);
    const ip = getClientIp(request);

    // Rate limit only applies to anonymous visitors — authenticated users are already
    // subject to the per-user upload limits enforced elsewhere.
    if (!user) {
      if (!sessionToken) return NextResponse.json({ error: 'SESSION_MISSING' }, { status: 400 });
      const rateLimit = await checkAnonymousPreflightRateLimit(sessionToken, ip);
      if (!rateLimit.allowed) {
        return NextResponse.json({ error: 'RATE_LIMITED', reason: rateLimit.reason }, { status: 429 });
      }
    }

    const result = await calculateDraftPrice(draftId, { sessionToken, userId: user?.id ?? null });
    if (!result.ok) {
      const status = result.error === 'DRAFT_NOT_FOUND' ? 404
        : result.error === 'FORBIDDEN' ? 403
        : isPricingReviewClassification(result.error) ? PRICING_REVIEW_HTTP_STATUS[result.error]
        : 422;
      return NextResponse.json({ error: result.error }, { status });
    }

    if (!user && sessionToken) {
      await recordAnonymousPreflightAttempt(sessionToken, ip);
    }

    const { snapshot } = result.value;
    return NextResponse.json({
      priceKzt: Math.round(snapshot.result.amountKzt),
      currency: snapshot.result.currency,
      requiresOperatorReview: snapshot.result.requiresOperatorReview,
      reviewReasons: snapshot.result.requiresOperatorReview ? snapshot.result.reviewReasons : undefined,
      computedAt: snapshot.computedAt,
      priceBeforeDiscountKzt: snapshot.priceBeforeDiscountKzt,
      discountAppliedKzt: snapshot.discountAppliedKzt,
      discountCode: snapshot.discountCode,
    });
  } catch (err) {
    console.error('[order-drafts] calculate failed:', err);
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
