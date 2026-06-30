import { supabaseServer } from '@/lib/supabase/server';
import { createPayoutIssue } from '@/lib/jira/payout-client';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface GeneratePayoutsParams {
  periodStart: string;
  periodEnd: string;
  partnerId?: string;
  dryRun?: boolean;
  createJira?: boolean;
}

export interface PayoutReferral {
  id: string;
  partner_id: string;
  job_id: string | null;
  order_amount_kzt: number | null;
  client_discount_applied_kzt: number | null;
  commission_base_kzt: number | null;
  commission_rate: number | null;
  commission_kzt: number | null;
  confirmed_at: string | null;
  order_completed_at: string | null;
  status: string;
  payout_id: string | null;
}

export interface PayoutPartner {
  id: string;
  name: string;
  partner_type: string;
  referral_code: string;
  is_active: boolean;
}

export interface PayoutSummary {
  partner_id: string;
  partner_name: string;
  referral_code: string;
  referrals_count: number;
  gross_order_amount_kzt: number;
  total_client_discount_kzt: number;
  total_commission_base_kzt: number;
  total_commission_amount_kzt: number;
  payout_id?: string;
  jira_issue_key?: string;
  jira_error?: string;
  skipped?: boolean;
  skip_reason?: string;
}

export interface GeneratePayoutsResult {
  period_start: string;
  period_end: string;
  dry_run: boolean;
  partners_count: number;
  total_referrals: number;
  total_gross_order_amount_kzt: number;
  total_client_discount_kzt: number;
  total_commission_base_kzt: number;
  total_commission_amount_kzt: number;
  payouts: PayoutSummary[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any> | typeof supabaseServer;

export async function generateMonthlyPayouts(
  params: GeneratePayoutsParams,
  // Injected for testing; defaults to production service-role client
  db: AnySupabaseClient = supabaseServer,
  jiraClient?: typeof createPayoutIssue,
): Promise<GeneratePayoutsResult> {
  const { periodStart, periodEnd, partnerId, dryRun = false, createJira = true } = params;

  // period_end is inclusive; filter confirmed_at strictly below next day
  const endDate = new Date(periodEnd);
  const periodEndExclusive = new Date(endDate);
  periodEndExclusive.setDate(periodEndExclusive.getDate() + 1);
  const periodEndExclusiveStr = periodEndExclusive.toISOString().slice(0, 10);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (db as any)
    .from('partner_referrals')
    .select(
      'id, partner_id, job_id, order_amount_kzt, client_discount_applied_kzt,' +
      ' commission_base_kzt, commission_rate, commission_kzt,' +
      ' confirmed_at, order_completed_at, status, payout_id',
    )
    .eq('status', 'confirmed')
    .is('payout_id', null)
    .gt('commission_kzt', 0)
    .gte('confirmed_at', periodStart)
    .lt('confirmed_at', periodEndExclusiveStr);

  if (partnerId) {
    query = query.eq('partner_id', partnerId);
  }

  const { data: referrals, error: refError } = (await query) as {
    data: PayoutReferral[] | null;
    error: { message: string } | null;
  };

  if (refError) throw new Error(`Failed to fetch referrals: ${refError.message}`);

  const eligible = referrals ?? [];

  if (eligible.length === 0) {
    return {
      period_start: periodStart,
      period_end: periodEnd,
      dry_run: dryRun,
      partners_count: 0,
      total_referrals: 0,
      total_gross_order_amount_kzt: 0,
      total_client_discount_kzt: 0,
      total_commission_base_kzt: 0,
      total_commission_amount_kzt: 0,
      payouts: [],
    };
  }

  // Fetch partner info for all affected partners
  const partnerIds = [...new Set(eligible.map((r) => r.partner_id))];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: partners, error: partnerError } = await (db as any)
    .from('partners')
    .select('id, name, partner_type, referral_code, is_active')
    .in('id', partnerIds);

  if (partnerError) throw new Error(`Failed to fetch partners: ${partnerError.message}`);

  const partnerMap = new Map<string, PayoutPartner>(
    ((partners ?? []) as PayoutPartner[]).map((p) => [p.id, p]),
  );

  // Group referrals by partner
  const groups = new Map<string, PayoutReferral[]>();
  for (const ref of eligible) {
    const arr = groups.get(ref.partner_id);
    if (arr) arr.push(ref);
    else groups.set(ref.partner_id, [ref]);
  }

  // Build per-partner summaries
  const summaries: PayoutSummary[] = [];
  for (const [pid, refs] of groups.entries()) {
    const partner = partnerMap.get(pid);
    if (!partner) {
      console.warn(`[generate-payout] Partner ${pid} not found — skipping ${refs.length} referrals`);
      continue;
    }

    summaries.push({
      partner_id: pid,
      partner_name: partner.name,
      referral_code: partner.referral_code,
      referrals_count: refs.length,
      gross_order_amount_kzt: round2(refs.reduce((s, r) => s + num(r.order_amount_kzt), 0)),
      total_client_discount_kzt: round2(refs.reduce((s, r) => s + num(r.client_discount_applied_kzt), 0)),
      total_commission_base_kzt: round2(refs.reduce((s, r) => s + num(r.commission_base_kzt), 0)),
      total_commission_amount_kzt: round2(refs.reduce((s, r) => s + num(r.commission_kzt), 0)),
    });
  }

  const totals = rollup(summaries);

  if (dryRun) {
    return { period_start: periodStart, period_end: periodEnd, dry_run: true, ...totals, payouts: summaries };
  }

  // Real mode: write DB and create Jira issues
  const now = new Date().toISOString();
  const issueCreator = jiraClient ?? createPayoutIssue;

  for (const summary of summaries) {
    const partner = partnerMap.get(summary.partner_id)!;
    const refs = groups.get(summary.partner_id)!;

    // Idempotency: skip if non-rejected payout already exists for this partner + period
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: existing } = await (db as any)
      .from('partner_payouts')
      .select('id, status')
      .eq('partner_id', summary.partner_id)
      .eq('period_start', periodStart)
      .eq('period_end', periodEnd)
      .not('status', 'eq', 'rejected')
      .maybeSingle();

    if (existing) {
      summary.skipped = true;
      summary.skip_reason = `payout ${existing.id} already exists (status: ${existing.status})`;
      summary.payout_id = existing.id;
      console.log(`[generate-payout] Skipping ${partner.name} — ${summary.skip_reason}`);
      continue;
    }

    // Create partner_payouts row
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: payout, error: payoutErr } = await (db as any)
      .from('partner_payouts')
      .insert({
        partner_id: summary.partner_id,
        period_start: periodStart,
        period_end: periodEnd,
        referral_count: summary.referrals_count,
        gross_kzt: summary.gross_order_amount_kzt,
        net_kzt: summary.total_commission_amount_kzt,
        gross_order_amount_kzt: summary.gross_order_amount_kzt,
        total_client_discount_kzt: summary.total_client_discount_kzt,
        total_commission_base_kzt: summary.total_commission_base_kzt,
        total_commission_amount_kzt: summary.total_commission_amount_kzt,
        currency: 'KZT',
        status: 'pending_approval',
        generated_at: now,
      })
      .select('id')
      .single();

    if (payoutErr || !payout) {
      throw new Error(`Failed to create payout for ${partner.name}: ${payoutErr?.message}`);
    }

    summary.payout_id = payout.id;

    // Mark referrals as in_payout
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: updateErr } = await (db as any)
      .from('partner_referrals')
      .update({
        status: 'in_payout',
        payout_id: payout.id,
        included_in_payout_at: now,
      })
      .in('id', refs.map((r) => r.id));

    if (updateErr) {
      throw new Error(`Failed to update referrals for ${partner.name}: ${updateErr.message}`);
    }

    // Create Jira issue (best-effort; failure keeps DB row, stores jira_error)
    if (createJira) {
      try {
        const jiraResult = await issueCreator({
          payoutId: payout.id,
          partnerName: partner.name,
          partnerType: partner.partner_type,
          referralCode: partner.referral_code,
          partnerId: summary.partner_id,
          periodStart,
          periodEnd,
          referralsCount: summary.referrals_count,
          grossOrderAmountKzt: summary.gross_order_amount_kzt,
          totalClientDiscountKzt: summary.total_client_discount_kzt,
          totalCommissionBaseKzt: summary.total_commission_base_kzt,
          totalCommissionAmountKzt: summary.total_commission_amount_kzt,
          referrals: refs.map((r) => ({
            id: r.id,
            job_id: r.job_id,
            order_amount_kzt: num(r.order_amount_kzt),
            client_discount_applied_kzt: num(r.client_discount_applied_kzt),
            commission_base_kzt: num(r.commission_base_kzt),
            commission_rate: r.commission_rate != null ? Number(r.commission_rate) : null,
            commission_kzt: num(r.commission_kzt),
            confirmed_at: r.confirmed_at ?? r.order_completed_at ?? null,
          })),
        });

        summary.jira_issue_key = jiraResult.issueKey;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (db as any)
          .from('partner_payouts')
          .update({ jira_issue_key: jiraResult.issueKey, jira_issue_url: jiraResult.issueUrl })
          .eq('id', payout.id);
      } catch (jiraErr) {
        const sanitized = (jiraErr instanceof Error ? jiraErr.message : String(jiraErr)).slice(0, 500);
        summary.jira_error = sanitized;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (db as any)
          .from('partner_payouts')
          .update({ jira_error: sanitized })
          .eq('id', payout.id);
      }
    }
  }

  return { period_start: periodStart, period_end: periodEnd, dry_run: false, ...totals, payouts: summaries };
}

function num(v: number | null | undefined): number {
  return Number(v ?? 0);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function rollup(summaries: PayoutSummary[]) {
  return {
    partners_count: summaries.length,
    total_referrals: summaries.reduce((s, p) => s + p.referrals_count, 0),
    total_gross_order_amount_kzt: round2(summaries.reduce((s, p) => s + p.gross_order_amount_kzt, 0)),
    total_client_discount_kzt: round2(summaries.reduce((s, p) => s + p.total_client_discount_kzt, 0)),
    total_commission_base_kzt: round2(summaries.reduce((s, p) => s + p.total_commission_base_kzt, 0)),
    total_commission_amount_kzt: round2(summaries.reduce((s, p) => s + p.total_commission_amount_kzt, 0)),
  };
}
