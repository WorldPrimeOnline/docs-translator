/**
 * Backfill script: creates pending_manual fiscal receipt rows for paid
 * payment_transactions that have no fiscal_receipts entry.
 *
 * Safe to run multiple times (idempotent via unique constraint).
 * Does NOT call any OFD provider API — always uses manual mode.
 *
 * Usage:
 *   npx tsx scripts/backfill-missing-fiscal-receipts.ts          # dry-run (default)
 *   npx tsx scripts/backfill-missing-fiscal-receipts.ts --apply  # create missing rows
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in env.
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env.local') });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const DRY_RUN = !process.argv.includes('--apply');
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

interface PaidPayment {
  id: string;
  job_id: string;
  document_id: string;
  amount: number;
  currency: string;
  provider_environment: string;
  paid_at: string;
}

async function getCustomerEmail(jobId: string, documentId: string): Promise<string | undefined> {
  const { data: doc } = await supabase
    .from('documents')
    .select('user_id')
    .eq('id', documentId)
    .maybeSingle();
  if (!doc) return undefined;

  const { data: user } = await supabase
    .from('users')
    .select('email')
    .eq('id', doc.user_id)
    .maybeSingle();
  return user?.email ?? undefined;
}

async function main(): Promise<void> {
  console.log(`Backfill fiscal receipts — mode: ${DRY_RUN ? 'DRY RUN' : 'APPLY'}`);
  console.log('Supabase URL:', SUPABASE_URL.replace(/\/\/.*@/, '//<credentials>@'));

  // Find all paid payment_transactions
  const { data: paidPayments, error: fetchError } = await supabase
    .from('payment_transactions')
    .select('id, job_id, document_id, amount, currency, provider_environment, paid_at')
    .eq('status', 'paid')
    .order('paid_at', { ascending: true });

  if (fetchError) {
    console.error('DB error fetching paid payments:', fetchError.message);
    process.exit(1);
  }

  if (!paidPayments || paidPayments.length === 0) {
    console.log('No paid payments found.');
    return;
  }

  console.log(`Found ${paidPayments.length} paid payment(s). Checking for missing fiscal receipts...`);

  const missing: PaidPayment[] = [];

  for (const pt of paidPayments as PaidPayment[]) {
    const { data: fr } = await supabase
      .from('fiscal_receipts')
      .select('id, status')
      .eq('payment_transaction_id', pt.id)
      .eq('operation_type', 'sale')
      .maybeSingle();

    if (!fr) {
      missing.push(pt);
    }
  }

  console.log(`${missing.length} payment(s) are missing fiscal receipt rows.`);

  if (missing.length === 0) {
    console.log('Nothing to backfill.');
    return;
  }

  if (DRY_RUN) {
    console.log('\n[DRY RUN] Would create the following pending_manual fiscal receipts:');
    for (const pt of missing) {
      console.log(`  payment_transaction_id=${pt.id}  job_id=${pt.job_id}  amount=${pt.amount} KZT  paid_at=${pt.paid_at}`);
    }
    console.log('\nRun with --apply to create these rows.');
    return;
  }

  // Apply mode: create missing fiscal receipt rows
  let created = 0;
  let skipped = 0;
  let failed = 0;

  for (const pt of missing) {
    const orderNumber = pt.id.slice(0, 8).toUpperCase();
    const amountKzt = Math.round(Number(pt.amount));
    const customerEmail = await getCustomerEmail(pt.job_id, pt.document_id);

    const { data: inserted, error: insertErr } = await supabase
      .from('fiscal_receipts')
      .insert({
        job_id: pt.job_id,
        document_id: pt.document_id,
        payment_transaction_id: pt.id,
        provider: 'manual',
        provider_environment: pt.provider_environment ?? 'test',
        amount_kzt: amountKzt,
        currency: 'KZT',
        operation_type: 'sale',
        status: 'pending_manual',
        customer_email: customerEmail ?? null,
        receipt_payload_sanitized: {
          orderNumber,
          amountKzt,
          description: `Перевод документа #${orderNumber}`,
          backfill: true,
          backfilled_at: new Date().toISOString(),
        },
      })
      .select('id')
      .single();

    if (insertErr) {
      if (insertErr.code === '23505') {
        console.log(`  SKIP (already exists): payment_transaction_id=${pt.id}`);
        skipped++;
      } else {
        console.error(`  ERROR: payment_transaction_id=${pt.id} — ${insertErr.message}`);
        failed++;
      }
    } else {
      console.log(`  CREATED: fiscal_receipt id=${inserted.id}  payment_transaction_id=${pt.id}  status=pending_manual  amount=${amountKzt} KZT`);
      created++;
    }
  }

  console.log(`\nBackfill complete: created=${created} skipped=${skipped} failed=${failed}`);

  if (failed > 0) {
    console.error(`${failed} receipt(s) failed to create — check errors above.`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
