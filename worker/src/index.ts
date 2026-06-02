import { env } from './lib/env';
import { supabase, type JobRow, type PaymentTransactionRow } from './lib/supabase';
import { processJob } from './processor';
import { closeBrowser } from './lib/pdf';

// ── State ──────────────────────────────────────────────────────────────────
let running = false;   // true while we are processing a job
let shuttingDown = false;

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

  const { data: payment } = await supabase
    .from('payment_transactions')
    .select('status')
    .eq('job_id', job.id)
    .eq('status', 'completed')
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

    return { jobId: job.id, documentId: job.document_id };
  }

  return null;
}

// ── Main poll loop ─────────────────────────────────────────────────────────
async function pollOnce(): Promise<void> {
  if (running || shuttingDown) return;

  const claimed = await claimNextJob();
  if (!claimed) return; // Nothing to do this tick

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

async function main(): Promise<void> {
  console.log(
    `[worker] started — poll every ${env.POLL_INTERVAL_MS}ms, concurrency ${env.WORKER_CONCURRENCY}`,
  );

  // Initial poll immediately on startup (catch jobs queued while worker was down)
  await pollOnce();

  setInterval(() => {
    void pollOnce();
  }, env.POLL_INTERVAL_MS);
}

void main();
