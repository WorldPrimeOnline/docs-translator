import { env } from './lib/env';
import { supabase, type JobRow, type PaymentTransactionRow } from './lib/supabase';
import { processJob } from './processor';
import { closeBrowser } from './lib/pdf';
import { reconcileFiscalAndRefunds, triggerReconcilePayments, triggerReconcileRefunds } from './lib/fiscal-reconciliation';
import { processPendingFiscalReceipts } from './lib/fiscal-processor';
import { diagnoseWebkassaConnectivity } from './lib/webkassa-client';
import { logDriveAuthModeWithHealthCheck } from './lib/google-drive';

// ── State ──────────────────────────────────────────────────────────────────
let running = false;   // true while we are processing a job
let shuttingDown = false;
let pollCycles = 0;

// ── Graceful shutdown ──────────────────────────────────────────────────────
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[worker] received ${signal} — shutting down gracefully…`);

  // Wait up to 120s for the current job to finish
  const deadline = Date.now() + 120_000;
  while (running && Date.now() < deadline) {
    await sleep(1000);
  }
  if (running) console.warn('[worker] timed out waiting for current job — forcing exit');

  await closeBrowser();
  console.log('[worker] bye');
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT',  () => void shutdown('SIGINT'));

// ── Helpers ────────────────────────────────────────────────────────────────
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Determine if a job is eligible for processing (i.e. payment received).
 *
 * - payment_source = 'subscription'  → eligible immediately
 * - payment_source = 'card_payment'  → eligible when a completed payment_transaction exists
 * - payment_source = null            → check payment_transactions as fallback
 */
async function isEligible(job: JobRow): Promise<boolean> {
  if (job.payment_source === 'subscription') return true;

  // Accept both 'paid' (Halyk ePay, current) and 'completed' (legacy TON-era, historical rows).
  const { data: payment } = await supabase
    .from('payment_transactions')
    .select('status')
    .eq('job_id', job.id)
    .in('status', ['paid', 'completed'])
    .maybeSingle<PaymentTransactionRow>();

  return !!payment;
}

/**
 * Try to atomically claim one queued eligible job.
 * Returns the claimed job, or null if nothing available.
 */
async function claimNextJob(): Promise<{ jobId: string; documentId: string } | null> {
  // Fetch a batch of queued jobs ordered by priority desc, then age asc
  const { data: jobs, error } = await supabase
    .from('jobs')
    .select('id, document_id, payment_source, priority, created_at')
    .eq('status', 'queued')
    .order('priority', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(20)
    .returns<JobRow[]>();

  if (error) {
    console.error('[worker] supabase query error:', error.message);
    return null;
  }

  for (const job of jobs ?? []) {
    if (!(await isEligible(job))) continue;

    // Atomic claim: only succeeds if status is still 'queued'
    const { data: updated } = await supabase
      .from('jobs')
      .update({
        status: 'ocr_in_progress',
        started_at: new Date().toISOString(),
      })
      .eq('id', job.id)
      .eq('status', 'queued')   // ← guard: prevents double-processing
      .select('id')
      .maybeSingle();

    if (!updated) {
      // Another worker (or Vercel's setTimeout) claimed it first
      continue;
    }

    console.info('[worker] job claimed', {
      jobId: job.id,
      paymentSource: job.payment_source,
      priority: job.priority,
    });
    return { jobId: job.id, documentId: job.document_id };
  }

  return null;
}

// ── Main poll loop ─────────────────────────────────────────────────────────
async function pollOnce(): Promise<void> {
  if (running || shuttingDown) return;

  pollCycles++;
  const claimed = await claimNextJob();
  if (!claimed) {
    // Log heartbeat every ~5 min (30 cycles × 10s default interval)
    if (pollCycles % 30 === 0) {
      console.info('[worker] poll heartbeat', { cycle: pollCycles, status: 'idle' });
    }
    return;
  }

  running = true;
  try {
    await processJob(claimed.jobId, claimed.documentId);
  } catch (err) {
    // processJob catches its own errors; this is a safety net
    console.error('[worker] unexpected error in processJob:', err);
  } finally {
    running = false;
  }
}

function resolveWebkassaHost(): string {
  const explicit = env.WEBKASSA_API_BASE_URL;
  if (explicit) { try { return new URL(explicit).hostname; } catch { return explicit; } }
  return env.FISCAL_PROVIDER_ENV === 'production' ? 'api.webkassa.kz' : 'devkkm.webkassa.kz';
}

function runStartupSafetyChecks(): void {
  const supabaseHost = (() => {
    try {
      return new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname;
    } catch {
      return env.NEXT_PUBLIC_SUPABASE_URL;
    }
  })();

  console.log('[worker:env] ─────────────────────────────────────────');
  console.log(`[worker:env] APP_ENV              = ${env.APP_ENV}`);
  console.log(`[worker:env] Supabase host        = ${supabaseHost}`);
  console.log(`[worker:env] R2_BUCKET_NAME       = ${env.R2_BUCKET_NAME}`);
  console.log(`[worker:env] EMAILS_ENABLED       = ${env.EMAILS_ENABLED}`);
  console.log(`[worker:env] EMAIL_REDIRECT_ALL_TO = ${env.EMAIL_REDIRECT_ALL_TO ?? '(not set)'}`);
  console.log(`[worker:env] PAYMENTS_MODE        = ${env.PAYMENTS_MODE}`);
  console.log(`[worker:env] OFFICIAL_WORKFLOW    = ${env.OFFICIAL_WORKFLOW_ENABLED}`);
  console.log('[worker:env] ─── Fiscal (Webkassa) ──────────────────');
  const webkassaHost = resolveWebkassaHost();
  console.log(`[worker:env] WEBKASSA_ENABLED     = ${env.WEBKASSA_ENABLED ?? '(not set)'}`);
  console.log(`[worker:env] FISCAL_PROVIDER_ENV  = ${env.FISCAL_PROVIDER_ENV}`);
  console.log(`[worker:env] WEBKASSA_ALLOW_REAL  = ${env.WEBKASSA_ALLOW_REAL_RECEIPTS ?? '(not set)'}`);
  console.log(`[worker:env] WEBKASSA_API_HOST    = ${webkassaHost}${env.WEBKASSA_API_BASE_URL ? ' (explicit)' : ' (default)'}`);
  console.log(`[worker:env] WEBKASSA_CASHBOX     = ${env.WEBKASSA_CASHBOX_SERIAL_NUMBER ?? '(not set)'}`);
  console.log(`[worker:env] hasApiKey            = ${!!env.WEBKASSA_API_KEY}`);
  console.log('[worker:env] ─────────────────────────────────────────');

  const isStaging = env.APP_ENV === 'staging';
  const isProduction = env.APP_ENV === 'production';

  // --- Staging guards ---
  if (isStaging) {
    if (env.PAYMENTS_MODE !== 'test') {
      console.error('[worker:safety] FATAL: APP_ENV=staging but PAYMENTS_MODE is not "test". Refusing to start.');
      process.exit(1);
    }
    // Heuristic: production bucket names won't contain "staging"
    if (!env.R2_BUCKET_NAME.includes('staging')) {
      console.error(
        `[worker:safety] FATAL: APP_ENV=staging but R2_BUCKET_NAME="${env.R2_BUCKET_NAME}" does not look like a staging bucket.`,
        'Expected a bucket name containing "staging" (e.g. wpo-staging-documents).',
      );
      process.exit(1);
    }
    if (env.EMAILS_ENABLED && !env.EMAIL_REDIRECT_ALL_TO) {
      console.warn(
        '[worker:safety] WARNING: APP_ENV=staging with EMAILS_ENABLED=true but no EMAIL_REDIRECT_ALL_TO set.',
        'Real customer emails may be sent. Set EMAILS_ENABLED=false or provide EMAIL_REDIRECT_ALL_TO.',
      );
    }
  }

  // --- Production guards ---
  if (isProduction) {
    if (env.R2_BUCKET_NAME.includes('staging')) {
      console.error(
        `[worker:safety] FATAL: APP_ENV=production but R2_BUCKET_NAME="${env.R2_BUCKET_NAME}" looks like a staging bucket. Refusing to start.`,
      );
      process.exit(1);
    }
    if (env.PAYMENTS_MODE === 'test') {
      console.warn(
        '[worker:safety] WARNING: APP_ENV=production but PAYMENTS_MODE=test. Payments will not be processed in live mode.',
      );
    }
  }
}

async function main(): Promise<void> {
  runStartupSafetyChecks();
  console.log(
    `[worker] started — poll every ${env.POLL_INTERVAL_MS}ms, concurrency ${env.WORKER_CONCURRENCY}`,
  );
  // Real token-refresh probe (not just env-var presence) — catches an invalid/
  // expired/revoked refresh token or a mismatched client_id/client_secret pair
  // even when isDriveConfigured() reports "configured: true". Never logs secrets.
  await logDriveAuthModeWithHealthCheck().catch((err: unknown) => {
    console.error('[drive] token refresh health check errored:', (err as Error).message);
  });

  // One-time DNS/TCP reachability check — isolates network-layer failures
  // (DNS, firewall, TLS) from actual Webkassa auth failures before the real
  // Authorize call. No credentials sent.
  await diagnoseWebkassaConnectivity(resolveWebkassaHost()).catch((err: unknown) => {
    console.error('[worker] webkassa connectivity diagnostic error:', (err as Error).message);
  });
  console.info('[worker] eligibility config', {
    selectableJobStatuses: ['queued'],
    eligiblePaymentStatuses: ['paid', 'completed'],
    subscriptionJobsEligibleImmediately: true,
    cardPaymentJobsRequireConfirmedPayment: true,
  });

  // Initial poll immediately on startup (catch jobs queued while worker was down)
  await pollOnce();

  setInterval(() => {
    void pollOnce();
  }, env.POLL_INTERVAL_MS);

  // ── Fiscal processor — independent of job processing and reconciliation ──────
  // Polls every 30 seconds for pending fiscal_receipts and calls Webkassa.
  // Also called once on startup to recover any receipts stuck while worker was down.
  const FISCAL_PROCESSOR_INTERVAL_MS = 30_000;

  // Startup: process immediately so receipts created before worker restart don't wait.
  void processPendingFiscalReceipts().catch((err: unknown) => {
    console.error('[worker] fiscal processor startup error:', (err as Error).message);
  });

  setInterval(() => {
    void processPendingFiscalReceipts().catch((err: unknown) => {
      console.error('[worker] fiscal processor error:', (err as Error).message);
    });
  }, FISCAL_PROCESSOR_INTERVAL_MS);

  // ── Fiscal reconciliation — 5-minute stuck-alert and Z-report ────────────────
  // Does NOT call Webkassa; only logs stale receipts and triggers Z-report.
  const FISCAL_RECONCILE_INTERVAL_MS = 5 * 60 * 1000;
  setInterval(() => {
    void reconcileFiscalAndRefunds().catch((err: unknown) => {
      console.error('[worker] fiscal reconciliation error:', (err as Error).message);
    });
  }, FISCAL_RECONCILE_INTERVAL_MS);

  // Reconcile pending Halyk payments (payment_pending → paid) every 15 minutes.
  // Runs the Next.js /api/cron/reconcile-payments endpoint since vercel.json
  // cannot host additional crons on the Vercel Hobby plan.
  const PAYMENTS_RECONCILE_INTERVAL_MS = 15 * 60 * 1000;
  setInterval(() => {
    void triggerReconcilePayments().catch((err: unknown) => {
      console.error('[worker] reconcile-payments trigger error:', (err as Error).message);
    });
  }, PAYMENTS_RECONCILE_INTERVAL_MS);

  // Reconcile Halyk cabinet refunds (paid → refunded) every 30 minutes.
  // Detects manual refunds issued by the operator in the Halyk merchant cabinet.
  const REFUNDS_RECONCILE_INTERVAL_MS = 30 * 60 * 1000;
  setInterval(() => {
    void triggerReconcileRefunds().catch((err: unknown) => {
      console.error('[worker] reconcile-refunds trigger error:', (err as Error).message);
    });
  }, REFUNDS_RECONCILE_INTERVAL_MS);
}

void main();
