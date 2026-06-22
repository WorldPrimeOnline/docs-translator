#!/usr/bin/env npx tsx
/**
 * Read-only: inspect financial state for a job.
 * Usage: npx tsx scripts/finance/inspect-job-finance.ts <jobId>
 * Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in environment.
 */
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function main() {
  const jobId = process.argv[2];
  if (!jobId) {
    console.error('Usage: npx tsx scripts/finance/inspect-job-finance.ts <jobId>');
    process.exit(1);
  }

  const [job, quotes, payments] = await Promise.all([
    supabase.from('jobs').select('id, status, price_kzt, service_level, workflow_status, payment_source').eq('id', jobId).maybeSingle(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).from('price_quotes').select('id, status, amount_kzt, service_level, language_pair, sales_channel, urgency_level, expires_at, paid_at, pricing_version_id').eq('job_id', jobId),
    supabase.from('payment_transactions').select('id, status, amount, quote_id, amount_source, paid_at, provider_transaction_id, card_mask').eq('job_id', jobId),
  ]);

  const paymentIds = (payments.data ?? []).map((p: { id: string }) => p.id);

  const [fiscals, refunds, reservations] = await Promise.all([
    paymentIds.length > 0
      ? supabase.from('fiscal_receipts').select('id, status, amount_kzt, operation_type, provider, created_at').in('payment_transaction_id', paymentIds)
      : Promise.resolve({ data: [] }),
    supabase.from('refund_transactions').select('id, status, refund_amount_kzt, refund_policy_case, approval_status, requested_at').eq('job_id', jobId),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).from('cost_reservations').select('cost_type, amount_kzt, status, payable_to_type').eq('job_id', jobId),
  ]);

  console.log('\n=== JOB FINANCE INSPECTION ===\n');
  console.log('Job:', JSON.stringify(job.data, null, 2));
  console.log('\nPrice Quotes:', JSON.stringify(quotes.data, null, 2));
  console.log('\nPayment Transactions:', JSON.stringify(payments.data, null, 2));
  console.log('\nFiscal Receipts:', JSON.stringify(fiscals.data, null, 2));
  console.log('\nRefund Transactions:', JSON.stringify(refunds.data, null, 2));
  console.log('\nCost Reservations:', JSON.stringify(reservations.data, null, 2));
}

main().catch(console.error);
