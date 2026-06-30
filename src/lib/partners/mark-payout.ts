import { supabaseServer } from '@/lib/supabase/server';
import { addPayoutPaidComment } from '@/lib/jira/payout-client';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface MarkPayoutPaidParams {
  payoutId: string;
  paymentReference: string;
  paidAt?: string;
  note?: string;
}

export interface MarkPayoutPaidResult {
  payoutId: string;
  status: string;
  paidAt: string;
  referralsUpdated: number;
  jiraCommentAdded: boolean;
  jiraCommentError?: string;
  alreadyPaid: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any> | typeof supabaseServer;

export async function markPayoutPaid(
  params: MarkPayoutPaidParams,
  db: AnySupabaseClient = supabaseServer,
  jiraCommentFn?: typeof addPayoutPaidComment,
): Promise<MarkPayoutPaidResult> {
  const { payoutId, paymentReference, note } = params;
  const paidAt = params.paidAt ?? new Date().toISOString();

  // Load payout row
  const { data: payout, error: loadErr } = await (db as any)
    .from('partner_payouts')
    .select('id, status, jira_issue_key, notes')
    .eq('id', payoutId)
    .maybeSingle();

  if (loadErr) throw new Error(`Failed to load payout ${payoutId}: ${loadErr.message}`);
  if (!payout) throw new Error(`Payout ${payoutId} not found`);

  // Idempotent: already paid
  if (payout.status === 'paid') {
    return {
      payoutId,
      status: 'paid',
      paidAt: payout.paid_at ?? paidAt,
      referralsUpdated: 0,
      jiraCommentAdded: false,
      alreadyPaid: true,
    };
  }

  // Build updated notes
  const updatedNotes = buildNotes(payout.notes as string | null, note);

  // Update partner_payouts
  const { error: payoutUpdateErr } = await (db as any)
    .from('partner_payouts')
    .update({
      status: 'paid',
      paid_at: paidAt,
      payment_reference: paymentReference,
      notes: updatedNotes,
      updated_at: new Date().toISOString(),
    })
    .eq('id', payoutId);

  if (payoutUpdateErr) {
    throw new Error(`Failed to update payout ${payoutId}: ${payoutUpdateErr.message}`);
  }

  // Update included partner_referrals
  const { data: updatedRefs, error: refsUpdateErr } = await (db as any)
    .from('partner_referrals')
    .update({ status: 'paid', paid_at: paidAt })
    .eq('payout_id', payoutId)
    .select('id');

  if (refsUpdateErr) {
    throw new Error(`Failed to update referrals for payout ${payoutId}: ${refsUpdateErr.message}`);
  }

  const referralsUpdated = (updatedRefs as unknown[])?.length ?? 0;

  // Add Jira comment (best-effort — DB update is already committed)
  let jiraCommentAdded = false;
  let jiraCommentError: string | undefined;

  if (payout.jira_issue_key) {
    const commentFn = jiraCommentFn ?? addPayoutPaidComment;
    try {
      await commentFn(payout.jira_issue_key as string, paymentReference, paidAt);
      jiraCommentAdded = true;
    } catch (err) {
      jiraCommentError = (err instanceof Error ? err.message : String(err)).slice(0, 300);
      console.error(`[mark-payout] Jira comment failed for ${payout.jira_issue_key}: ${jiraCommentError}`);
    }
  }

  return {
    payoutId,
    status: 'paid',
    paidAt,
    referralsUpdated,
    jiraCommentAdded,
    jiraCommentError,
    alreadyPaid: false,
  };
}

function buildNotes(existing: string | null, note: string | undefined): string | null {
  if (!note) return existing ?? null;
  const timestamp = new Date().toISOString().slice(0, 10);
  const entry = `[${timestamp}] ${note}`;
  return existing ? `${existing}\n${entry}` : entry;
}
