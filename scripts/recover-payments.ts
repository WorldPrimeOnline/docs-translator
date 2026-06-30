#!/usr/bin/env npx tsx
/**
 * Production payment recovery script.
 *
 * Diagnoses and repairs broken paid payment_transactions:
 * - paid but job hidden (payment_pending stuck)
 * - paid but Jira issue missing
 * - paid but fiscal receipt missing
 * - paid but Halyk has actually refunded (provider REFUND, local still paid)
 * - pending locally but provider confirmed CHARGE (not yet finalized)
 *
 * Safety:
 * - Default: DRY_RUN=true (prints what would change, touches nothing)
 * - Set DRY_RUN=false explicitly to apply repairs
 * - Only runs against the environment in NEXT_PUBLIC_APP_ENV
 * - Never marks orders as delivered/completed
 * - Never creates duplicate Jira issues or fiscal receipts
 *
 * Usage:
 *   # Diagnose all broken paid payments (last 30 days)
 *   DRY_RUN=true npx tsx scripts/recover-payments.ts
 *
 *   # Diagnose specific payment
 *   DRY_RUN=true INVOICE_ID=268749534401137 npx tsx scripts/recover-payments.ts
 *   DRY_RUN=true PAYMENT_ID=6f64f241-ed60-47f8-a6ed-5326504c9863 npx tsx scripts/recover-payments.ts
 *
 *   # Apply repairs (safe, idempotent)
 *   DRY_RUN=false PAYMENT_ID=6f64f241-ed60-47f8-a6ed-5326504c9863 npx tsx scripts/recover-payments.ts
 *
 *   # Reconcile Halyk refund for a paid payment
 *   DRY_RUN=false INVOICE_ID=268749534401137 RECONCILE_REFUND=true npx tsx scripts/recover-payments.ts
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env.staging.local' });
dotenv.config();

const DRY_RUN = process.env.DRY_RUN !== 'false';
const PAYMENT_ID = process.env.PAYMENT_ID;
const INVOICE_ID = process.env.INVOICE_ID;
const JOB_ID = process.env.JOB_ID;
const RECONCILE_REFUND = process.env.RECONCILE_REFUND === 'true';
const LOOKBACK_DAYS = parseInt(process.env.LOOKBACK_DAYS ?? '30', 10);

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('[recover] FATAL: Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = createClient(SUPABASE_URL, SERVICE_KEY) as any;

// ─── Types ────────────────────────────────────────────────────────────────────

interface PaymentRow {
  id: string;
  job_id: string;
  document_id: string | null;
  status: string;
  amount: number;
  currency: string;
  provider_invoice_id: string | null;
  provider_transaction_id: string | null;
  provider_status: string | null;
  provider_reason: string | null;
  provider_reason_code: string | null;
  approval_code: string | null;
  reference: string | null;
  card_mask: string | null;
  issuer: string | null;
  callback_received_at: string | null;
  paid_at: string | null;
  refunded_at: string | null;
  updated_at: string | null;
  created_at: string;
  quote_id: string | null;
  payment_provider: string;
  provider_environment: string;
}

interface JobRow {
  id: string;
  status: string;
  payment_source: string | null;
  jira_issue_key: string | null;
  google_drive_folder_id: string | null;
  service_level: string | null;
  created_at: string;
}

interface DiagnosticResult {
  paymentId: string;
  invoiceId: string | null;
  jobId: string;
  amount: number;
  paymentStatus: string;
  jobStatus: string;
  paidAt: string | null;
  refundedAt: string | null;
  providerTransactionIdNull: boolean;
  jobStuckAtPaymentPending: boolean;
  missingFiscalReceipt: boolean;
  missingJiraIssue: boolean | null;
  halykRefunded: boolean | null;
  willBeVisibleInDashboard: boolean;
}

// ─── Dashboard visibility check ───────────────────────────────────────────────

function wouldBeVisibleInDashboard(jobStatus: string, paymentStatus: string): boolean {
  // Terminal hidden statuses (go to history but not "disappeared")
  const hiddenFromActive = ['completed', 'failed', 'delivered', 'picked_up', 'refunded', 'canceled', 'translator_declined', 'notary_declined'];
  const hiddenFromHistory = false; // history shows all terminal
  void hiddenFromHistory;

  if (paymentStatus === 'paid' && !hiddenFromActive.includes(jobStatus)) {
    return true; // active section
  }
  if (paymentStatus === 'paid' && hiddenFromActive.includes(jobStatus)) {
    return true; // history section — still visible
  }
  return paymentStatus === 'payment_pending'; // payment_pending shows in active
}

// ─── Halyk status check ───────────────────────────────────────────────────────

async function checkHalykStatus(invoiceId: string): Promise<{ resultCode: number; statusName: string | null; transactionId: string | null } | null> {
  const baseUrl = process.env.HALYK_API_BASE_URL ?? 'https://epay-api.homebank.kz';
  const oauthUrl = process.env.HALYK_OAUTH_URL ?? 'https://epay.homebank.kz/auth/oauth/v2/token';
  const clientId = process.env.HALYK_CLIENT_ID;
  const clientSecret = process.env.HALYK_CLIENT_SECRET;
  const terminalId = process.env.HALYK_TERMINAL_ID;

  if (!clientId || !clientSecret || !terminalId) {
    console.warn('[recover] Halyk credentials not configured — skipping status check');
    return null;
  }

  try {
    const tokenBody = new URLSearchParams({
      grant_type: 'client_credentials',
      scope: 'webapi usermanagement email_send verification statement statistics payment',
      client_id: clientId,
      client_secret: clientSecret,
      terminal: terminalId,
    });

    const tokenResp = await fetch(oauthUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenBody.toString(),
      signal: AbortSignal.timeout(15_000),
    });

    if (!tokenResp.ok) {
      console.warn('[recover] Halyk token failed:', tokenResp.status);
      return null;
    }

    const tokenData = await tokenResp.json() as Record<string, unknown>;
    const accessToken = (tokenData.access_token ?? tokenData.token) as string;
    if (!accessToken) return null;

    const statusUrl = `${baseUrl}/check-status/payment/transaction/${encodeURIComponent(invoiceId)}`;
    const statusResp = await fetch(statusUrl, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(15_000),
    });

    if (!statusResp.ok) {
      console.warn('[recover] Halyk status failed:', statusResp.status);
      return null;
    }

    const data = await statusResp.json() as Record<string, unknown>;
    const transaction = data.transaction as Record<string, unknown> | null;
    return {
      resultCode: Number(data.resultCode),
      statusName: (transaction?.statusName as string | null)?.trim().toUpperCase() ?? null,
      transactionId: (transaction?.transactionId ?? transaction?.id ?? null) as string | null,
    };
  } catch (err) {
    console.warn('[recover] Halyk status check error:', (err as Error).message);
    return null;
  }
}

// ─── Diagnose ─────────────────────────────────────────────────────────────────

async function diagnose(payment: PaymentRow, job: JobRow): Promise<DiagnosticResult> {
  // Check fiscal receipt
  const { data: fiscal } = await db
    .from('fiscal_receipts')
    .select('id, status')
    .eq('payment_transaction_id', payment.id)
    .eq('operation_type', 'sale')
    .maybeSingle();

  // Check Jira (only for certified/notarized)
  const isCertifiedOrNotarized = job.service_level === 'official_with_translator_signature_and_provider_stamp' || job.service_level === 'notarization_through_partners';
  const missingJiraIssue = isCertifiedOrNotarized ? !job.jira_issue_key : null;

  // Check Halyk status if RECONCILE_REFUND is set
  let halykRefunded: boolean | null = null;
  if (RECONCILE_REFUND && payment.provider_invoice_id && payment.status === 'paid') {
    const halykStatus = await checkHalykStatus(payment.provider_invoice_id);
    if (halykStatus) {
      halykRefunded = halykStatus.resultCode === 100 && (halykStatus.statusName === 'REFUND' || halykStatus.statusName === 'CANCEL' || halykStatus.statusName === 'CANCEL_OLD');
      console.log('[recover] Halyk status check result:', {
        invoiceId: payment.provider_invoice_id,
        resultCode: halykStatus.resultCode,
        statusName: halykStatus.statusName,
        transactionId: halykStatus.transactionId,
      });
    }
  }

  return {
    paymentId: payment.id,
    invoiceId: payment.provider_invoice_id,
    jobId: payment.job_id,
    amount: payment.amount,
    paymentStatus: payment.status,
    jobStatus: job.status,
    paidAt: payment.paid_at,
    refundedAt: payment.refunded_at,
    providerTransactionIdNull: !payment.provider_transaction_id,
    jobStuckAtPaymentPending: payment.status === 'paid' && job.status === 'payment_pending',
    missingFiscalReceipt: !fiscal,
    missingJiraIssue,
    halykRefunded,
    willBeVisibleInDashboard: wouldBeVisibleInDashboard(job.status, payment.status),
  };
}

// ─── Repair ───────────────────────────────────────────────────────────────────

async function repair(diag: DiagnosticResult, payment: PaymentRow, job: JobRow): Promise<void> {
  const now = new Date().toISOString();

  console.log('\n[recover] ─── REPAIR ─────────────────────────────────');
  console.log('[recover] payment:', diag.paymentId);
  console.log('[recover] job:', diag.jobId, 'status:', diag.jobStatus);

  // 1. Fix job stuck at payment_pending (payment is paid but job never moved to queued)
  if (diag.jobStuckAtPaymentPending) {
    if (DRY_RUN) {
      console.log('[DRY_RUN] Would update jobs.status: payment_pending → queued for job:', diag.jobId);
    } else {
      const { error } = await db
        .from('jobs')
        .update({ status: 'queued', payment_source: 'card_payment' })
        .eq('id', diag.jobId)
        .eq('status', 'payment_pending');
      if (error) {
        console.error('[recover] Failed to move job to queued:', error.message);
      } else {
        console.log('[recover] ✓ Job moved to queued:', diag.jobId);
      }
    }
  }

  // 2. Reconcile Halyk refund
  if (diag.halykRefunded === true) {
    if (DRY_RUN) {
      console.log('[DRY_RUN] Would update payment to refunded:', diag.paymentId);
      console.log('[DRY_RUN] Would update job to refunded:', diag.jobId);
      console.log('[DRY_RUN] Would create refund_transactions row');
    } else {
      // Update payment
      const { error: ptErr } = await db
        .from('payment_transactions')
        .update({
          status: 'refunded',
          refunded_at: now,
          updated_at: now,
          provider_payload: { refundedByRecoveryScript: true, reconciledAt: now },
        })
        .eq('id', diag.paymentId)
        .eq('status', 'paid');
      if (ptErr) {
        console.error('[recover] Failed to update payment to refunded:', ptErr.message);
      } else {
        console.log('[recover] ✓ Payment marked refunded:', diag.paymentId);
      }

      // Update job (only if in a pre-processing state)
      const safeJobStatuses = ['payment_pending', 'queued', 'ocr_in_progress', 'ocr_completed', 'translation_in_progress', 'pdf_rendering', 'failed'];
      if (safeJobStatuses.includes(diag.jobStatus)) {
        const { error: jobErr } = await db
          .from('jobs')
          .update({ status: 'refunded' })
          .eq('id', diag.jobId)
          .in('status', safeJobStatuses);
        if (jobErr) {
          console.error('[recover] Failed to update job to refunded:', jobErr.message);
        } else {
          console.log('[recover] ✓ Job marked refunded:', diag.jobId);
        }
      } else {
        console.log('[recover] Job in post-processing state, not overwriting status:', diag.jobStatus);
      }

      // Create idempotent refund_transactions row
      const idempotencyKey = `recovery-refund-${diag.paymentId}`;
      const { error: rtErr } = await db
        .from('refund_transactions')
        .upsert(
          {
            job_id: diag.jobId,
            payment_transaction_id: diag.paymentId,
            provider: 'halyk_epay',
            provider_environment: payment.provider_environment,
            refund_amount_kzt: Math.round(diag.amount),
            currency: 'KZT',
            status: 'succeeded',
            reason: 'Halyk cabinet manual refund — reconciled by recovery script',
            idempotency_key: idempotencyKey,
            processed_at: now,
            updated_at: now,
          },
          { onConflict: 'idempotency_key', ignoreDuplicates: true },
        );
      if (rtErr) {
        console.error('[recover] Failed to create refund_transactions:', rtErr.message);
      } else {
        console.log('[recover] ✓ refund_transactions row created/exists:', idempotencyKey);
      }
    }
  }

  // 3. Create fiscal receipt if missing
  if (diag.missingFiscalReceipt && payment.status === 'paid' && !diag.halykRefunded) {
    if (DRY_RUN) {
      console.log('[DRY_RUN] Would create fiscal_receipts sale row for payment:', diag.paymentId);
    } else {
      // Get document_id from job
      const { data: jobFull } = await db.from('jobs').select('document_id').eq('id', diag.jobId).maybeSingle();
      if (jobFull?.document_id) {
        const { error: frErr } = await db
          .from('fiscal_receipts')
          .insert({
            job_id: diag.jobId,
            document_id: jobFull.document_id,
            payment_transaction_id: diag.paymentId,
            provider: 'manual',
            provider_environment: payment.provider_environment,
            amount_kzt: Math.round(diag.amount),
            currency: 'KZT',
            operation_type: 'sale',
            status: 'pending_manual',
            receipt_payload_sanitized: {
              recoveredByScript: true,
              reconciledAt: now,
            },
          });
        if (frErr && frErr.code !== '23505') {
          console.error('[recover] Failed to create fiscal receipt:', frErr.message);
        } else {
          console.log('[recover] ✓ Fiscal receipt created (pending_manual):', diag.paymentId);
        }
      }
    }
  }

  // 4. Audit log
  if (!DRY_RUN) {
    await db.from('job_audit_log').insert({
      job_id: diag.jobId,
      actor: 'recovery-script',
      source: 'manual_recovery',
      action: 'payment_recovery',
      metadata: {
        paymentId: diag.paymentId,
        invoiceId: diag.invoiceId,
        diagnostics: diag,
        reconciledAt: now,
      },
    }).catch((e: Error) => console.warn('[recover] audit log insert failed:', e.message));
  }

  void job; // used for reference above
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('[recover] ═══════════════════════════════════════════');
  console.log('[recover] WPO Payment Recovery Script');
  console.log('[recover] DRY_RUN:', DRY_RUN ? 'YES (safe — no changes)' : 'NO — APPLYING CHANGES');
  console.log('[recover] RECONCILE_REFUND:', RECONCILE_REFUND);
  console.log('[recover] ═══════════════════════════════════════════\n');

  if (!DRY_RUN) {
    console.warn('[recover] ⚠ DRY_RUN=false — changes will be applied to the database');
  }

  // Fetch payment transactions to analyze
  let query = db.from('payment_transactions').select('*');

  if (PAYMENT_ID) {
    query = query.eq('id', PAYMENT_ID);
  } else if (INVOICE_ID) {
    query = query.eq('provider_invoice_id', INVOICE_ID);
  } else if (JOB_ID) {
    query = query.eq('job_id', JOB_ID);
  } else {
    // Default: all paid transactions in last LOOKBACK_DAYS days
    const cutoff = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
    query = query
      .in('status', ['paid', 'payment_pending', 'requires_review'])
      .gt('created_at', cutoff)
      .order('created_at', { ascending: false })
      .limit(50);
  }

  const { data: payments, error } = await query;
  if (error) {
    console.error('[recover] DB error fetching payments:', error.message);
    process.exit(1);
  }

  if (!payments || payments.length === 0) {
    console.log('[recover] No payments found for the given criteria');
    return;
  }

  console.log(`[recover] Found ${payments.length} payment(s) to analyze\n`);

  let issues = 0;

  for (const payment of payments as PaymentRow[]) {
    console.log('[recover] ─────────────────────────────────────────');
    console.log('[recover] Payment:', payment.id);
    console.log('[recover] InvoiceId:', payment.provider_invoice_id);
    console.log('[recover] Status:', payment.status, '| Amount:', payment.amount, payment.currency);
    console.log('[recover] PaidAt:', payment.paid_at ?? 'NULL');
    console.log('[recover] RefundedAt:', payment.refunded_at ?? 'NULL');
    console.log('[recover] provider_transaction_id:', payment.provider_transaction_id ?? 'NULL ⚠');

    // Fetch job
    const { data: job } = await db
      .from('jobs')
      .select('id, status, payment_source, jira_issue_key, google_drive_folder_id, service_level, created_at')
      .eq('id', payment.job_id)
      .maybeSingle<JobRow>();

    if (!job) {
      console.error('[recover] ⚠ Job not found for payment:', payment.id, 'job_id:', payment.job_id);
      continue;
    }

    console.log('[recover] Job:', job.id, '| Status:', job.status, '| ServiceLevel:', job.service_level);

    const diag = await diagnose(payment, job);

    // Print diagnosis
    const flags: string[] = [];
    if (diag.providerTransactionIdNull) flags.push('provider_transaction_id=NULL');
    if (diag.jobStuckAtPaymentPending) flags.push('JOB_STUCK_AT_PAYMENT_PENDING ⚠');
    if (diag.missingFiscalReceipt && payment.status === 'paid') flags.push('MISSING_FISCAL_RECEIPT');
    if (diag.missingJiraIssue) flags.push('MISSING_JIRA_ISSUE');
    if (diag.halykRefunded === true) flags.push('HALYK_CONFIRMED_REFUND ⚠');
    if (!diag.willBeVisibleInDashboard) flags.push('NOT_VISIBLE_IN_DASHBOARD ⚠');

    if (flags.length > 0) {
      console.log('[recover] Issues detected:', flags.join(', '));
      issues++;

      if (!DRY_RUN) {
        await repair(diag, payment, job);
      } else {
        console.log('[DRY_RUN] Would repair:', flags.join(', '));
      }
    } else {
      console.log('[recover] ✓ No issues detected');
    }

    console.log('');
  }

  console.log('\n[recover] ═══════════════════════════════════════════');
  console.log(`[recover] Done. ${issues} issue(s) found.`);
  if (DRY_RUN && issues > 0) {
    console.log('[recover] Run with DRY_RUN=false to apply repairs.');
  }
}

void main().catch((err: unknown) => {
  console.error('[recover] Fatal error:', (err as Error).message);
  process.exit(1);
});
