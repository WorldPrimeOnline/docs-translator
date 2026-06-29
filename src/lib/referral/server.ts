/**
 * Server-side referral helpers for partner_referrals wiring.
 *
 * All three exported functions are best-effort: they log errors but never throw.
 * Order creation and payment confirmation must never fail because of referral logic.
 *
 * Invariants:
 * - Only active partners (is_active=true) generate referrals.
 * - Commission base = order_amount_kzt − sum(pass-through items from price_quote_items).
 * - Commission amounts are server-calculated only; client values are never used.
 * - One referral per order enforced by unique index on partner_referrals.job_id.
 */
import { supabaseServer } from '@/lib/supabase/server';

/** Item types that represent pass-through costs and are excluded from commission base. */
const PASS_THROUGH_ITEM_TYPES = ['notary_official_fee', 'delivery_fee'] as const;

export interface AttachReferralParams {
  jobId: string;
  userId: string;
  refCode: string | null | undefined;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmContent?: string | null;
  utmTerm?: string | null;
  /** Raw order price in KZT. Present for card-payment orders; null for subscription. */
  orderAmountKzt?: number | null;
}

/**
 * Link a referral code to an order at creation time.
 * No-op if refCode is absent, partner not found, or partner is inactive.
 */
export async function attachReferralToOrder(params: AttachReferralParams): Promise<void> {
  const { jobId, userId, refCode } = params;
  if (!refCode) return;

  try {
    const { data: partner } = await supabaseServer
      .from('partners')
      .select('id, commission_rate, is_active')
      .eq('referral_code', refCode)
      .maybeSingle();

    if (!partner) {
      console.log(`[referral] no partner for code="${refCode}" jobId=${jobId} — skipping`);
      return;
    }
    if (!partner.is_active) {
      console.log(`[referral] partner for code="${refCode}" is inactive — skipping jobId=${jobId}`);
      return;
    }

    const { error } = await supabaseServer
      .from('partner_referrals')
      .insert({
        partner_id: partner.id,
        job_id: jobId,
        user_id: userId,
        ref_code: refCode,
        utm_source: params.utmSource ?? null,
        utm_medium: params.utmMedium ?? null,
        utm_campaign: params.utmCampaign ?? null,
        utm_content: params.utmContent ?? null,
        utm_term: params.utmTerm ?? null,
        order_amount_kzt: params.orderAmountKzt ?? null,
        commission_rate: partner.commission_rate,
        status: 'pending',
        captured_at: new Date().toISOString(),
      });

    if (error) {
      // code 23505 = unique_violation (duplicate referral for this job — idempotent, ignore)
      if (error.code === '23505') {
        console.log(`[referral] duplicate referral ignored for jobId=${jobId}`);
        return;
      }
      console.error(`[referral] insert failed jobId=${jobId}:`, error.message);
      return;
    }

    console.log(`[referral] linked jobId=${jobId} to partnerId=${partner.id} code="${refCode}"`);
  } catch (err) {
    console.error(`[referral] attachReferralToOrder error jobId=${jobId}:`, (err as Error).message);
  }
}

/**
 * Move a referral to `confirmed` after a verified payment.
 * Calculates commission_base_kzt by excluding pass-through costs from quote items.
 * No-op if no pending referral exists for this job.
 */
export async function confirmReferral(jobId: string, quoteId?: string | null): Promise<void> {
  try {
    const { data: referral } = await supabaseServer
      .from('partner_referrals')
      .select('id, order_amount_kzt, commission_rate')
      .eq('job_id', jobId)
      .eq('status', 'pending')
      .maybeSingle();

    if (!referral) return; // No referral linked — normal for non-referred orders

    let commissionBaseKzt: number | null = null;
    let commissionKzt: number | null = null;

    if (referral.order_amount_kzt != null && quoteId) {
      // Sum pass-through items from the quote to exclude from commission base.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: ptItems } = await (supabaseServer as any)
        .from('price_quote_items')
        .select('amount_kzt')
        .eq('quote_id', quoteId)
        .in('item_type', PASS_THROUGH_ITEM_TYPES);

      const passThroughTotal = ((ptItems ?? []) as Array<{ amount_kzt: number }>).reduce(
        (sum, item) => sum + Number(item.amount_kzt ?? 0),
        0,
      );

      commissionBaseKzt = Math.max(0, Number(referral.order_amount_kzt) - passThroughTotal);
      const rate = Number(referral.commission_rate ?? 0.05);
      commissionKzt = Math.round(commissionBaseKzt * rate * 100) / 100;
    }

    const { error } = await supabaseServer
      .from('partner_referrals')
      .update({
        status: 'confirmed',
        commission_base_kzt: commissionBaseKzt,
        commission_kzt: commissionKzt,
        order_completed_at: new Date().toISOString(),
      })
      .eq('id', referral.id);

    if (error) {
      console.error(`[referral] confirmReferral update error jobId=${jobId}:`, error.message);
      return;
    }

    console.log(
      `[referral] confirmed jobId=${jobId} referralId=${referral.id} commissionBase=${commissionBaseKzt ?? 'n/a'} KZT commissionKzt=${commissionKzt ?? 'n/a'}`,
    );
  } catch (err) {
    console.error(`[referral] confirmReferral error jobId=${jobId}:`, (err as Error).message);
  }
}

/**
 * Move a referral to `refunded` or `canceled`, zeroing out commission amounts.
 * Called from refund/cancel flows. No-op if no active referral exists for the job.
 *
 * Note: The refund API route is currently a 501 placeholder. Wire this function
 * to that route when admin refund functionality is enabled.
 */
export async function cancelReferral(
  jobId: string,
  reason: 'refunded' | 'canceled' = 'canceled',
): Promise<void> {
  try {
    const { error } = await supabaseServer
      .from('partner_referrals')
      .update({
        status: reason,
        commission_base_kzt: 0,
        commission_kzt: 0,
      })
      .eq('job_id', jobId)
      .in('status', ['pending', 'confirmed']);

    if (error) {
      console.error(`[referral] cancelReferral error jobId=${jobId}:`, error.message);
      return;
    }

    console.log(`[referral] referral for jobId=${jobId} moved to status=${reason}`);
  } catch (err) {
    console.error(`[referral] cancelReferral error jobId=${jobId}:`, (err as Error).message);
  }
}
