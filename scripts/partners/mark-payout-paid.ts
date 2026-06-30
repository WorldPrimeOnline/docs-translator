#!/usr/bin/env npx tsx
/**
 * Mark a partner payout batch as paid.
 *
 * Updates partner_payouts.status = paid and sets paid_at/payment_reference.
 * Updates all included partner_referrals.status = paid.
 * Optionally adds a Jira comment to the Payout issue (best-effort).
 *
 * Usage:
 *   npm run partners:mark-paid -- --payout-id=<uuid> --payment-reference="Halyk 2026-08-05"
 *   npm run partners:mark-paid -- --payout-id=<uuid> --payment-reference="ref" --paid-at=2026-08-05T10:00:00Z
 *   npm run partners:mark-paid -- --payout-id=<uuid> --payment-reference="ref" --note="Processed by Alina"
 *
 * Required env:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN  (optional; for Jira comment)
 */

import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

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

function parseArgs() {
  const args = process.argv.slice(2);
  let payoutId = '';
  let paymentReference = '';
  let paidAt: string | undefined;
  let note: string | undefined;

  for (const arg of args) {
    if (arg.startsWith('--payout-id='))           payoutId          = arg.slice('--payout-id='.length);
    else if (arg.startsWith('--payment-reference=')) paymentReference = arg.slice('--payment-reference='.length);
    else if (arg.startsWith('--paid-at='))         paidAt            = arg.slice('--paid-at='.length);
    else if (arg.startsWith('--note='))            note              = arg.slice('--note='.length);
  }

  return { payoutId, paymentReference, paidAt, note };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function main() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Error: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.');
    process.exit(1);
  }

  const { payoutId, paymentReference, paidAt, note } = parseArgs();

  if (!payoutId) {
    console.error(
      'Error: --payout-id is required.\n' +
      'Usage: npm run partners:mark-paid -- --payout-id=<uuid> --payment-reference="<ref>"',
    );
    process.exit(1);
  }

  if (!UUID_RE.test(payoutId)) {
    console.error(`Error: invalid payout-id format: "${payoutId}". Expected UUID.`);
    process.exit(1);
  }

  if (!paymentReference) {
    console.error('Error: --payment-reference is required (e.g. "Halyk transfer 2026-08-05")');
    process.exit(1);
  }

  if (paidAt && isNaN(new Date(paidAt).getTime())) {
    console.error(`Error: invalid paid-at value: "${paidAt}". Expected ISO timestamp.`);
    process.exit(1);
  }

  console.log('\n[mark-paid] Marking payout as paid');
  console.log(`[mark-paid] Payout ID          : ${payoutId}`);
  console.log(`[mark-paid] Payment reference  : ${paymentReference}`);
  console.log(`[mark-paid] Paid at            : ${paidAt ?? '(now)'}`);
  if (note) console.log(`[mark-paid] Note              : ${note}`);
  console.log('');

  const { markPayoutPaid } = await import('../../src/lib/partners/mark-payout');
  const { createClient } = await import('@supabase/supabase-js');

  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const result = await markPayoutPaid({ payoutId, paymentReference, paidAt, note }, db);

  if (result.alreadyPaid) {
    console.log(`[mark-paid] Payout ${payoutId} is already marked as paid — no changes made.`);
  } else {
    console.log(`[mark-paid] Payout updated: status=paid, paid_at=${result.paidAt}`);
    console.log(`[mark-paid] Referrals updated: ${result.referralsUpdated}`);
    if (result.jiraCommentAdded) console.log('[mark-paid] Jira comment added.');
    if (result.jiraCommentError) console.warn(`[mark-paid] Jira comment failed: ${result.jiraCommentError}`);
  }

  console.log('\n[mark-paid] Result:');
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error('[mark-paid] Fatal error:', (err as Error).message);
  process.exit(1);
});
