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
 * Env loading (in priority order — earlier file wins for keys already set in shell):
 *   .env.staging.local  ← preferred for staging credentials
 *   .env.local          ← fallback
 *
 * Required env vars:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   ALLOW_STAGING_PAYMENT_OVERRIDE=true
 *   NEXT_PUBLIC_APP_ENV=staging  (or APP_ENV=staging)
 *
 * Do NOT use in production. Do NOT use for real customer transactions.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

// ─── Env loading — must happen before any module that reads process.env ────────
// dotenv.config() never overwrites keys already set in the shell environment.

const ROOT = path.resolve(process.cwd());

function loadEnvFile(filename: string): boolean {
  const filepath = path.join(ROOT, filename);
  if (fs.existsSync(filepath)) {
    dotenv.config({ path: filepath });
    return true;
  }
  return false;
}

// Load .env.staging.local first (preferred), then .env.local as fallback.
const stagingLoaded = loadEnvFile('.env.staging.local');
const localLoaded   = loadEnvFile('.env.local');

// ─── Masked diagnostics ───────────────────────────────────────────────────────

function maskUrl(url: string | undefined): string {
  if (!url) return '(not set)';
  try {
    const parsed = new URL(url);
    // Show scheme + hostname only (hides path and any embedded credentials)
    return `${parsed.protocol}//${parsed.hostname}`;
  } catch {
    return '(invalid URL)';
  }
}

function printDiagnostics(): void {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;

  console.log('\n[staging-confirm] Environment diagnostics:');
  console.log(`  Env files loaded  : ${[stagingLoaded && '.env.staging.local', localLoaded && '.env.local'].filter(Boolean).join(', ') || '(none)'}`);
  console.log(`  APP_ENV           : ${process.env.APP_ENV ?? '(not set)'}`);
  console.log(`  NEXT_PUBLIC_APP_ENV: ${process.env.NEXT_PUBLIC_APP_ENV ?? '(not set)'}`);
  console.log(`  ALLOW_STAGING_PAYMENT_OVERRIDE: ${process.env.ALLOW_STAGING_PAYMENT_OVERRIDE ?? '(not set)'}`);
  console.log(`  SUPABASE_URL      : ${maskUrl(supabaseUrl)}`);
  console.log(`  SERVICE_ROLE_KEY  : ${serviceKey ? `set (${serviceKey.length} chars, starts ${serviceKey.slice(0, 8)}...)` : '(not set)'}`);
  console.log('');
}

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
  // Dynamic import AFTER env loading so the module reads already-populated process.env
  const { finalizePaymentForStaging, checkStagingGuards } = await import('../../src/lib/payments/finalize-payment');

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

  // Print diagnostics before guard check so missing vars are visible
  printDiagnostics();

  // Pre-flight guard check
  const guard = checkStagingGuards();
  if (!guard.allowed) {
    console.error(`[BLOCKED] ${guard.reason}\n`);
    process.exit(1);
  }

  const appEnv = process.env.NEXT_PUBLIC_APP_ENV ?? process.env.APP_ENV ?? 'unknown';
  console.log(`[staging-confirm] Starting manual payment confirmation`);
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
