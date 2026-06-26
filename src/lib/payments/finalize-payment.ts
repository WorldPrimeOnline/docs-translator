/**
 * Shared payment finalization service for staging manual confirmation.
 *
 * This module provides the shared logic for manually finalizing a payment on staging,
 * following the same downstream flow as a real Halyk ePay callback/reconcile would:
 *   1. Mark payment_transactions as paid (via RPC if possible, direct update otherwise)
 *   2. Move jobs.status from payment_pending → queued (triggers worker pickup)
 *   3. Mark price_quotes as paid and commit cost_reservations
 *   4. Create a fiscal_receipts row (pending_manual for staging)
 *   5. Write a job_audit_log entry
 *
 * STAGING ONLY — never call from production code paths.
 * Guards: ALLOW_STAGING_PAYMENT_OVERRIDE=true AND (APP_ENV/NEXT_PUBLIC_APP_ENV) ≠ production.
 */

import { createClient } from '@supabase/supabase-js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ManualConfirmOptions {
  reason?: string;
  confirmedBy?: string;
}

export type ManualConfirmResult =
  | { ok: true; action: 'finalized' | 'repaired' | 'already_complete'; paymentId: string; jobId: string; jobStatus: string }
  | { ok: false; error: string };

// ─── Environment guard ────────────────────────────────────────────────────────

export function checkStagingGuards(): { allowed: boolean; reason: string } {
  const appEnv = process.env.NEXT_PUBLIC_APP_ENV ?? process.env.APP_ENV ?? 'production';
  const overrideFlag = process.env.ALLOW_STAGING_PAYMENT_OVERRIDE;

  if (appEnv === 'production') {
    return {
      allowed: false,
      reason: `Refused: APP_ENV/NEXT_PUBLIC_APP_ENV is "production". Manual payment override is forbidden in production.`,
    };
  }

  if (overrideFlag !== 'true') {
    return {
      allowed: false,
      reason: `Refused: ALLOW_STAGING_PAYMENT_OVERRIDE is not set to "true". Set it explicitly on staging to enable manual payment confirmation.`,
    };
  }

  return { allowed: true, reason: 'ok' };
}

// ─── Core service ─────────────────────────────────────────────────────────────

export async function finalizePaymentForStaging(
  transactionId: string,
  options: ManualConfirmOptions = {},
): Promise<ManualConfirmResult> {
  const guard = checkStagingGuards();
  if (!guard.allowed) {
    return { ok: false, error: guard.reason };
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return { ok: false, error: 'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY' };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createClient(supabaseUrl, serviceKey) as any;

  const reason = options.reason ?? 'Manual staging payment confirmation';
  const confirmedBy = options.confirmedBy ?? 'developer-script';

  // ── 1. Load transaction ────────────────────────────────────────────────────
  const { data: tx, error: txErr } = await db
    .from('payment_transactions')
    .select('id, status, job_id, quote_id, amount, currency, provider_invoice_id, provider_environment, paid_at, callback_received_at, provider_transaction_id')
    .eq('id', transactionId)
    .maybeSingle();

  if (txErr) return { ok: false, error: `DB error loading transaction: ${txErr.message}` };
  if (!tx) return { ok: false, error: `Transaction not found: ${transactionId}` };

  // ── 2. Validate environment ────────────────────────────────────────────────
  // Allow if: provider_environment = 'test', OR the user has explicitly set the override flag (already checked above)
  const appEnv = process.env.NEXT_PUBLIC_APP_ENV ?? process.env.APP_ENV ?? 'production';
  if (tx.provider_environment === 'production' && appEnv !== 'staging') {
    return {
      ok: false,
      error: `Refused: provider_environment is "production". Cannot manually confirm a production-environment payment. This is a safety guard.`,
    };
  }

  // ── 3. Load job ────────────────────────────────────────────────────────────
  const { data: job, error: jobErr } = await db
    .from('jobs')
    .select('id, status, payment_source')
    .eq('id', tx.job_id)
    .maybeSingle();

  if (jobErr) return { ok: false, error: `DB error loading job: ${jobErr.message}` };
  if (!job) return { ok: false, error: `Job not found for transaction: ${tx.job_id}` };

  const now = new Date().toISOString();
  const txShort = transactionId.slice(0, 8);

  // ── 4. Determine which action is needed ────────────────────────────────────
  //
  // Case A: Already fully complete — payment paid AND job past payment_pending
  if (tx.status === 'paid' && job.status !== 'payment_pending') {
    console.log(`[manual-confirm:${txShort}] Already complete: payment=${tx.status} job=${job.status}`);
    await writeAuditLog(db, tx.job_id, transactionId, 'manual_staging_confirm_skipped_already_complete', {
      paymentStatus: tx.status, jobStatus: job.status, reason, confirmedBy,
    });
    return { ok: true, action: 'already_complete', paymentId: tx.id, jobId: tx.job_id, jobStatus: job.status };
  }

  // Case B: Payment already marked paid (manual DB edit) but job still stuck at payment_pending
  if (tx.status === 'paid' && job.status === 'payment_pending') {
    console.log(`[manual-confirm:${txShort}] Repair: payment=paid but job=payment_pending — completing finalization`);
    return await repairHalfFinalizedPayment(db, tx, job, now, reason, confirmedBy);
  }

  // Case C: Payment not yet paid — try RPC first (canonical path), fall back to direct
  if (tx.provider_invoice_id) {
    return await finalizeViaRpc(db, tx, now, reason, confirmedBy);
  }

  // Case D: No invoice_id (full staging bypass — no real Halyk flow was used)
  return await finalizeViaStagingBypass(db, tx, job, now, reason, confirmedBy);
}

// ─── Case B: Repair half-finalized payment ────────────────────────────────────
// Payment was manually set to 'paid' but the downstream wasn't run.

async function repairHalfFinalizedPayment(
  db: ReturnType<typeof createClient>,
  tx: Record<string, unknown>,
  job: Record<string, unknown>,
  now: string,
  reason: string,
  confirmedBy: string,
): Promise<ManualConfirmResult> {
  const txShort = (tx.id as string).slice(0, 8);

  // Patch payment_transactions — fill in any nulls the manual update left behind
  const ptUpdate: Record<string, unknown> = {
    status_checked_at: now,
    updated_at: now,
  };
  if (!tx.paid_at) ptUpdate.paid_at = now;
  if (!tx.callback_received_at) ptUpdate.callback_received_at = now;
  if (!tx.provider_transaction_id) {
    ptUpdate.provider_transaction_id = `manual-staging-${txShort}`;
  }
  if (!tx.provider_status) ptUpdate.provider_status = 'CHARGE';
  if (!tx.provider_reason) ptUpdate.provider_reason = 'Successfully';
  ptUpdate.provider_payload = {
    manualOverride: true,
    environment: 'staging',
    reason,
    confirmedBy,
    repairCase: true,
    timestamp: now,
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: ptErr } = await (db as any)
    .from('payment_transactions')
    .update(ptUpdate)
    .eq('id', tx.id);

  if (ptErr) {
    return { ok: false, error: `Failed to update payment_transactions: ${ptErr.message}` };
  }

  // Move job to queued
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: jobErr } = await (db as any)
    .from('jobs')
    .update({ status: 'queued', payment_source: 'card_payment' })
    .eq('id', job.id)
    .eq('status', 'payment_pending');

  if (jobErr) {
    return { ok: false, error: `Failed to queue job: ${jobErr.message}` };
  }

  await runPostFinalizationSteps(db, tx as Record<string, string | number | null>, now, reason, confirmedBy, 'repaired');

  console.log(`[manual-confirm:${txShort}] ✓ Repair complete — job queued`);
  return { ok: true, action: 'repaired', paymentId: tx.id as string, jobId: tx.job_id as string, jobStatus: 'queued' };
}

// ─── Case C: Finalize via existing finalize_halyk_payment RPC ─────────────────

async function finalizeViaRpc(
  db: ReturnType<typeof createClient>,
  tx: Record<string, unknown>,
  now: string,
  reason: string,
  confirmedBy: string,
): Promise<ManualConfirmResult> {
  const txShort = (tx.id as string).slice(0, 8);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rpcResult, error: rpcError } = await (db as any).rpc('finalize_halyk_payment', {
    p_invoice_id: tx.provider_invoice_id,
    p_transaction_id: `manual-staging-${txShort}`,
    p_provider_status: 'CHARGE',
    p_provider_reason: 'Successfully',
    p_provider_reason_code: null,
    p_card_mask: null,
    p_card_type: null,
    p_issuer: null,
    p_approval_code: null,
    p_reference: null,
    p_secure: null,
    p_provider_payload: {
      manualOverride: true,
      environment: 'staging',
      reason,
      confirmedBy,
      timestamp: now,
    },
  });

  if (rpcError) {
    return { ok: false, error: `finalize_halyk_payment RPC failed: ${rpcError.message}` };
  }

  const result = rpcResult as Record<string, unknown>;
  if (!result.ok) {
    return { ok: false, error: `finalize_halyk_payment returned not-ok: ${JSON.stringify(result)}` };
  }

  await runPostFinalizationSteps(db, tx as Record<string, string | number | null>, now, reason, confirmedBy, 'finalized');

  console.log(`[manual-confirm:${txShort}] ✓ Finalized via RPC — job queued`);
  return {
    ok: true,
    action: 'finalized',
    paymentId: tx.id as string,
    jobId: tx.job_id as string,
    jobStatus: 'queued',
  };
}

// ─── Case D: Full staging bypass (no provider_invoice_id) ─────────────────────

async function finalizeViaStagingBypass(
  db: ReturnType<typeof createClient>,
  tx: Record<string, unknown>,
  job: Record<string, unknown>,
  now: string,
  reason: string,
  confirmedBy: string,
): Promise<ManualConfirmResult> {
  const txShort = (tx.id as string).slice(0, 8);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: ptErr } = await (db as any)
    .from('payment_transactions')
    .update({
      status: 'paid',
      provider_transaction_id: `manual-staging-${txShort}`,
      provider_status: 'CHARGE',
      provider_reason: 'Successfully',
      paid_at: now,
      callback_received_at: now,
      status_checked_at: now,
      updated_at: now,
      provider_payload: {
        manualOverride: true,
        environment: 'staging',
        reason,
        confirmedBy,
        timestamp: now,
      },
    })
    .eq('id', tx.id)
    .neq('status', 'paid');

  if (ptErr) {
    return { ok: false, error: `Failed to finalize payment_transactions: ${ptErr.message}` };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: jobErr } = await (db as any)
    .from('jobs')
    .update({ status: 'queued', payment_source: 'card_payment' })
    .eq('id', job.id)
    .eq('status', 'payment_pending');

  if (jobErr) {
    return { ok: false, error: `Failed to queue job: ${jobErr.message}` };
  }

  await runPostFinalizationSteps(db, tx as Record<string, string | number | null>, now, reason, confirmedBy, 'finalized');

  console.log(`[manual-confirm:${txShort}] ✓ Staging bypass finalization complete — job queued`);
  return { ok: true, action: 'finalized', paymentId: tx.id as string, jobId: tx.job_id as string, jobStatus: 'queued' };
}

// ─── Post-finalization steps (same in all cases) ──────────────────────────────
// These mirror what the callback/reconcile routes do after finalize_halyk_payment.

async function runPostFinalizationSteps(
  db: ReturnType<typeof createClient>,
  tx: Record<string, string | number | null>,
  now: string,
  reason: string,
  confirmedBy: string,
  action: string,
): Promise<void> {
  const txShort = (tx.id as string).slice(0, 8);

  // Mark quote paid + commit cost reservations
  if (tx.quote_id) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (db as any)
        .from('price_quotes')
        .update({ status: 'paid', paid_at: now, price_locked_at: now, updated_at: now })
        .eq('id', tx.quote_id)
        .in('status', ['quoted', 'requires_operator_review', 'payment_pending', 'confirmed']);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (db as any)
        .from('cost_reservations')
        .update({ status: 'committed', payment_transaction_id: tx.id, updated_at: now })
        .eq('quote_id', tx.quote_id)
        .eq('status', 'reserved');

      console.log(`[manual-confirm:${txShort}] ✓ Quote marked paid: ${tx.quote_id}`);
    } catch (err) {
      console.warn(`[manual-confirm:${txShort}] markQuotePaid failed (non-fatal):`, (err as Error).message);
    }
  }

  // Create fiscal_receipts row (pending_manual — no Webkassa call on staging)
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: existingFiscal } = await (db as any)
      .from('fiscal_receipts')
      .select('id')
      .eq('payment_transaction_id', tx.id)
      .eq('operation_type', 'sale')
      .maybeSingle();

    if (!existingFiscal) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (db as any)
        .from('fiscal_receipts')
        .insert({
          payment_transaction_id: tx.id as string,
          job_id: tx.job_id as string,
          operation_type: 'sale',
          status: 'pending_manual',
          amount_kzt: Number(tx.amount),
          currency: (tx.currency as string) ?? 'KZT',
          provider: 'manual',
          raw_response: { manualOverride: true, environment: 'staging', reason, confirmedBy },
        });
      console.log(`[manual-confirm:${txShort}] ✓ Fiscal receipt row created (pending_manual)`);
    } else {
      console.log(`[manual-confirm:${txShort}] Fiscal receipt already exists — skipping`);
    }
  } catch (err) {
    console.warn(`[manual-confirm:${txShort}] fiscal receipt creation failed (non-fatal):`, (err as Error).message);
  }

  // Audit log
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (db as any)
      .from('job_audit_log')
      .insert({
        job_id: tx.job_id as string,
        actor: 'developer-script',
        source: 'manual_staging_confirm',
        action: `manual_staging_payment_${action}`,
        new_status: 'queued',
        metadata: {
          transactionId: tx.id,
          documentId: tx.document_id,
          jobId: tx.job_id,
          quoteId: tx.quote_id,
          amountKzt: tx.amount,
          reason,
          confirmedBy,
          manualOverride: true,
          environment: process.env.NEXT_PUBLIC_APP_ENV ?? process.env.APP_ENV ?? 'staging',
          timestamp: now,
        },
      });
  } catch (err) {
    console.warn(`[manual-confirm:${txShort}] audit log insert failed (non-fatal):`, (err as Error).message);
  }
}

async function writeAuditLog(
  db: ReturnType<typeof createClient>,
  jobId: string,
  transactionId: string,
  action: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (db as any).from('job_audit_log').insert({
      job_id: jobId,
      actor: 'developer-script',
      source: 'manual_staging_confirm',
      action,
      metadata: { transactionId, ...metadata },
    });
  } catch {
    // audit is best-effort
  }
}
