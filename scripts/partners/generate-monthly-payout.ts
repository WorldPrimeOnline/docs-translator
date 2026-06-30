#!/usr/bin/env npx tsx
/**
 * Monthly partner payout generation.
 *
 * Groups confirmed partner referrals by partner for the given period,
 * creates partner_payouts rows, marks referrals as in_payout,
 * and creates Jira Payout issues in project WPO.
 *
 * Usage:
 *   npm run partners:payouts -- --period-start=2026-07-01 --period-end=2026-07-31 --dry-run
 *   npm run partners:payouts -- --period-start=2026-07-01 --period-end=2026-07-31
 *   npm run partners:payouts -- --period-start=2026-07-01 --period-end=2026-07-31 --partner-id=<uuid>
 *   npm run partners:payouts -- --period-start=2026-07-01 --period-end=2026-07-31 --create-jira=false
 *
 * Required env (loaded from .env.local or .env.staging.local):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN  (for Jira issue creation)
 */

import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

// ─── Env loading (before any module reads process.env) ────────────────────────

const ROOT = path.resolve(process.cwd());

function loadEnvFile(filename: string): boolean {
  const filepath = path.join(ROOT, filename);
  if (fs.existsSync(filepath)) {
    dotenv.config({ path: filepath });
    return true;
  }
  return false;
}

loadEnvFile('.env.local');
loadEnvFile('.env.staging.local');

// ─── CLI arg parsing ──────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  let periodStart = '';
  let periodEnd = '';
  let partnerId: string | undefined;
  let dryRun = false;
  let createJira = true;

  for (const arg of args) {
    if (arg.startsWith('--period-start='))   periodStart = arg.slice('--period-start='.length);
    else if (arg.startsWith('--period-end=')) periodEnd   = arg.slice('--period-end='.length);
    else if (arg.startsWith('--partner-id=')) partnerId   = arg.slice('--partner-id='.length);
    else if (arg === '--dry-run')             dryRun = true;
    else if (arg === '--create-jira=false')   createJira = false;
  }

  return { periodStart, periodEnd, partnerId, dryRun, createJira };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error(
      'Error: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.\n' +
      'Load .env.local or .env.staging.local before running.',
    );
    process.exit(1);
  }

  const { periodStart, periodEnd, partnerId, dryRun, createJira } = parseArgs();

  if (!periodStart || !periodEnd) {
    console.error(
      'Error: --period-start and --period-end are required.\n' +
      'Usage: npm run partners:payouts -- --period-start=YYYY-MM-DD --period-end=YYYY-MM-DD [--dry-run]',
    );
    process.exit(1);
  }

  if (isNaN(new Date(periodStart).getTime()) || isNaN(new Date(periodEnd).getTime())) {
    console.error('Error: dates must be valid ISO format (YYYY-MM-DD)');
    process.exit(1);
  }

  if (new Date(periodEnd) < new Date(periodStart)) {
    console.error('Error: period-end must be >= period-start');
    process.exit(1);
  }

  console.log('\n[payout] Partner Monthly Payout Generation');
  console.log(`[payout] Period  : ${periodStart} → ${periodEnd}`);
  console.log(`[payout] Dry run : ${dryRun}`);
  console.log(`[payout] Jira    : ${createJira ? 'enabled' : 'disabled'}`);
  if (partnerId) console.log(`[payout] Partner : ${partnerId}`);
  console.log('');

  // Dynamic import AFTER env loading
  const { generateMonthlyPayouts } = await import('../../src/lib/partners/generate-payout');
  const { createClient } = await import('@supabase/supabase-js');

  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const result = await generateMonthlyPayouts(
    { periodStart, periodEnd, partnerId, dryRun, createJira },
    db,
  );

  console.log('\n[payout] Result:');
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error('[payout] Fatal error:', (err as Error).message);
  process.exit(1);
});
