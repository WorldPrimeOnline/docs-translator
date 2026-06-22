#!/usr/bin/env npx tsx
/**
 * Read-only: list paid payments with remaining refundable amount.
 * Usage: npx tsx scripts/finance/list-refundable-payments.ts [--limit <n>]
 */
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  const args = process.argv.slice(2);
  const limitIdx = args.indexOf('--limit');
  const limit = limitIdx !== -1 ? parseInt(args[limitIdx + 1] ?? '20', 10) : 20;

  const { data: payments, error } = await supabase
    .from('payment_transactions')
    .select('id, job_id, amount, status, paid_at, amount_source, quote_id, provider_transaction_id')
    .eq('status', 'paid')
    .order('paid_at', { ascending: false })
    .limit(limit);

  if (error) { console.error(error); process.exit(1); }

  console.log(`\n=== PAID PAYMENTS — REFUNDABLE AMOUNTS (${payments?.length ?? 0} records) ===\n`);

  for (const p of payments ?? []) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: refundData } = await (supabase as any).rpc('get_refundable_amount', { p_payment_transaction_id: p.id });
    const refundable = (refundData as { refundable?: number } | null)?.refundable ?? p.amount;
    const source = p.amount_source ?? 'legacy';
    const qId = p.quote_id ? String(p.quote_id).slice(0, 8) + '…' : 'none';
    console.log(`${String(p.id).slice(0, 8)}… | paid: ${p.amount} KZT | refundable: ${refundable} KZT | source: ${source} | quote: ${qId} | paid_at: ${p.paid_at}`);
  }
}

main().catch(console.error);
