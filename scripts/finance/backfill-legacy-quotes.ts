#!/usr/bin/env npx tsx
/**
 * DRY RUN by default. Creates legacy quote records for existing paid payments without quotes.
 * Usage: npx tsx scripts/finance/backfill-legacy-quotes.ts [--apply]
 *
 * --apply: Actually insert records. Without this flag, only prints what would be done.
 */
import { createClient } from '@supabase/supabase-js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!) as any;

async function main() {
  const apply = process.argv.includes('--apply');
  console.log(`Mode: ${apply ? 'APPLY' : 'DRY RUN'}\n`);

  const { data: payments, error } = await supabase
    .from('payment_transactions')
    .select('id, job_id, document_id, user_id, amount, currency, paid_at, amount_source')
    .eq('status', 'paid')
    .is('quote_id', null)
    .limit(200);

  if (error) { console.error(error); process.exit(1); }

  const eligible = (payments ?? []).filter((p: Record<string, unknown>) => p.amount_source !== 'quote');
  console.log(`Found ${eligible.length} paid payments without quotes\n`);

  if (eligible.length === 0) {
    console.log('Nothing to backfill.');
    return;
  }

  const { data: versionData } = await supabase
    .from('pricing_versions')
    .select('id')
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();

  const pricingVersionId = versionData?.id ?? null;
  const farFuture = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();

  for (const p of eligible) {
    console.log(`Payment ${String(p.id).slice(0, 8)}…: ${p.amount} KZT, job: ${p.job_id}, paid_at: ${p.paid_at}`);

    if (apply) {
      const { data: quote, error: qErr } = await supabase.from('price_quotes').insert({
        job_id: p.job_id,
        document_id: p.document_id,
        user_id: p.user_id,
        pricing_version_id: pricingVersionId,
        status: 'paid',
        amount_kzt: p.amount,
        currency: p.currency ?? 'KZT',
        expires_at: farFuture,
        paid_at: p.paid_at,
        price_locked_at: p.paid_at,
        sales_channel: 'direct',
        urgency_level: 'standard',
        pricing_context_json: { note: 'Legacy backfill — original price from payment_transactions.amount' },
        breakdown_json: {},
        internal_cost_json: {},
        margin_json: {},
      }).select('id').single();

      if (qErr) {
        console.error(`  → ERROR creating quote: ${qErr.message}`);
        continue;
      }

      if (quote) {
        await supabase.from('payment_transactions').update({
          quote_id: quote.id,
          amount_source: 'legacy_test',
          price_locked_at: p.paid_at,
        }).eq('id', p.id);
        console.log(`  → Created legacy quote ${quote.id}`);
      }
    }
  }

  if (!apply) {
    console.log('\nRun with --apply to actually create the records.');
  } else {
    console.log('\nBackfill complete.');
  }
}

main().catch(console.error);
