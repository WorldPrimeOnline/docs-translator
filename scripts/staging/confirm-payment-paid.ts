#!/usr/bin/env npx tsx
/**
 * Manual staging payment confirmation — for developer/operator use only.
 *
 * Follows the same downstream finalization flow as a real Halyk ePay callback:
 *   payment_transactions → paid, jobs → queued, quote → paid, audit log written.
 *
 * SAFETY: refuses to run on production (checked via APP_ENV/NEXT_PUBLIC_APP_ENV).
 * Requires ALLOW_STAGING_PAYMENT_OVERRIDE=true to be set explicitly.
 *
 * Usage:
 *   npx tsx scripts/staging/confirm-payment-paid.ts --transaction-id <uuid>
 *   npx tsx scripts/staging/confirm-payment-paid.ts --transaction-id <uuid> --reason "Jira flow test"
 *
 * Required env vars (from .env.local or shell):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   ALLOW_STAGING_PAYMENT_OVERRIDE=true
 *
 * Do NOT use in production. Do NOT use for real customer transactions.
 */

import { finalizePaymentForStaging, checkStagingGuards } from '../../src/lib/payments/finalize-payment';

// ─── CLI arg parsing ──────────────────────────────────────────────────────────

function parseArgs(): { transactionId: string; reason: string } {
  const args = process.argv.slice(2);
  let transactionId = '';
  let reason = 'Manual staging payment confirmation for developer testing';

  for (let i = 0; i < args.length; i++) {
    if ((args[i] === '--transaction-id' || args[i] === '-t') && args[i + 1]) {
      transactionId = args[++i];
    } else if (args[i] === '--reason' && args[i + 1]) {
      reason = args[++i];
    }
  }

  return { transactionId, reason };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { transactionId, reason } = parseArgs();

  if (!transactionId) {
    console.error('Error: --transaction-id is required');
    console.error('Usage: npx tsx scripts/staging/confirm-payment-paid.ts --transaction-id <uuid>');
    process.exit(1);
  }

  // Validate UUID format (basic)
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(transactionId)) {
    console.error(`Error: invalid transaction ID format: "${transactionId}"`);
    console.error('Expected UUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx');
    process.exit(1);
  }

  // Pre-flight guard check
  const guard = checkStagingGuards();
  if (!guard.allowed) {
    console.error(`\n[BLOCKED] ${guard.reason}\n`);
    process.exit(1);
  }

  const appEnv = process.env.NEXT_PUBLIC_APP_ENV ?? process.env.APP_ENV ?? 'unknown';
  console.log(`\n[staging-confirm] Starting manual payment confirmation`);
  console.log(`  Transaction ID : ${transactionId}`);
  console.log(`  Reason         : ${reason}`);
  console.log(`  APP_ENV        : ${appEnv}`);
  console.log(`  Override flag  : ALLOW_STAGING_PAYMENT_OVERRIDE=true`);
  console.log('');

  const result = await finalizePaymentForStaging(transactionId, {
    reason,
    confirmedBy: 'developer-script',
  });

  if (!result.ok) {
    console.error(`\n[staging-confirm] FAILED: ${result.error}\n`);
    process.exit(1);
  }

  console.log(`\n[staging-confirm] ✓ SUCCESS`);
  console.log(`  Action     : ${result.action}`);
  console.log(`  Payment ID : ${result.paymentId}`);
  console.log(`  Job ID     : ${result.jobId}`);
  console.log(`  Job status : ${result.jobStatus}`);
  console.log('');
  console.log('Next steps:');
  console.log('  1. Wait a few seconds for the Railway worker to pick up the job');
  console.log('  2. Check jobs.status in Supabase → should progress from queued → ocr_in_progress → ...');
  console.log('  3. Check payment_transactions.paid_at, callback_received_at — should be set');
  console.log('  4. Check price_quotes.status → should be "paid"');
  console.log('  5. If JIRA_* vars are configured: check Jira for the new Заказ issue');
  console.log('  6. If JIRA_PRICE_BREAKDOWN_ISSUE_ENABLED=true: check Jira for linked Price Breakdown Story');
  console.log('  7. Dashboard should no longer show "Ожидает оплаты"');
  console.log('');
}

main().catch((err) => {
  console.error('[staging-confirm] Unexpected error:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
