#!/usr/bin/env npx tsx
/**
 * Read-only staging E2E verification for the two checkout-integration scenarios
 * (2026-07-22): E2E-1 Official Direct, E2E-2 Notary delivery+urgency+Referral.
 *
 * Run this AFTER manually completing an order through the real staging site (upload -> select
 * Official or Notary -> complete Halyk sandbox payment). Prints the resulting job/quote/Jira
 * state so you can eyeball every acceptance criterion in one place. Never writes anything.
 *
 * Usage:
 *   npx tsx scripts/staging/verify-e2e-quote.ts --job-id <uuid>
 *   npx tsx scripts/staging/verify-e2e-quote.ts --email you@example.com   # most recent job for that user
 */
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const ROOT = path.resolve(process.cwd());
function loadEnvFile(filename: string): boolean {
  const filepath = path.join(ROOT, filename);
  if (fs.existsSync(filepath)) { dotenv.config({ path: filepath }); return true; }
  return false;
}
loadEnvFile('.env.staging.local');
loadEnvFile('.env.local');

const appEnv = process.env.NEXT_PUBLIC_APP_ENV ?? process.env.APP_ENV ?? '(not set)';
if (appEnv === 'production') {
  console.error('[verify-e2e-quote] REFUSED: this script must never run against production.');
  process.exit(1);
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceKey) {
  console.error('[verify-e2e-quote] FATAL: Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = createClient(supabaseUrl, serviceKey) as any;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

async function resolveJobId(): Promise<string> {
  const jobId = arg('job-id');
  if (jobId) return jobId;

  const email = arg('email');
  if (!email) {
    console.error('Usage: npx tsx scripts/staging/verify-e2e-quote.ts --job-id <uuid> | --email <email>');
    process.exit(1);
  }
  const { data: user } = await db.from('users').select('id').eq('email', email).maybeSingle();
  if (!user) { console.error(`No user found for ${email}`); process.exit(1); }
  const { data: doc } = await db.from('documents').select('id').eq('user_id', user.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (!doc) { console.error(`No documents found for ${email}`); process.exit(1); }
  const { data: job } = await db.from('jobs').select('id').eq('document_id', doc.id).maybeSingle();
  if (!job) { console.error(`No job found for that document`); process.exit(1); }
  return job.id as string;
}

async function main(): Promise<void> {
  const jobId = await resolveJobId();
  console.log(`\n=== Job ${jobId} ===`);

  const { data: job } = await db.from('jobs').select('*').eq('id', jobId).maybeSingle();
  if (!job) { console.error('Job not found'); process.exit(1); }
  console.log(`status: ${job.status}  service_level: ${job.service_level}  fulfillment_method: ${job.fulfillment_method}`);
  console.log(`price_kzt: ${job.price_kzt}  notary_urgency_level: ${job.notary_urgency_level}  notary_urgency_window: ${job.notary_urgency_window}  notary_urgency_multiplier: ${job.notary_urgency_multiplier}`);
  console.log(`price_jira_issue_key: ${job.price_jira_issue_key ?? '(none)'}  price_jira_sync_status: ${job.price_jira_sync_status ?? '(none)'}`);

  const { data: quote } = await db
    .from('price_quotes')
    .select('*')
    .eq('job_id', jobId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!quote) { console.log('\nNo price_quotes row found for this job.'); return; }

  console.log(`\n=== Quote ${quote.id} ===`);
  console.log(`status: ${quote.status}  amount_kzt: ${quote.amount_kzt}  formula_version: ${quote.formula_version ?? '(null)'}`);
  console.log(`paid_at: ${quote.paid_at}  price_locked_at: ${quote.price_locked_at}`);
  console.log(`analysis_id: ${quote.analysis_id}  physical_page_count: ${quote.physical_page_count}  source_character_count_with_spaces: ${quote.source_character_count_with_spaces}`);

  const nm = quote.wpo_financial_breakdown_json as Record<string, unknown> | null;
  if (!nm || Object.keys(nm).length === 0) {
    console.log('\n*** wpo_financial_breakdown_json is empty — this quote did not go through the new formula. ***');
    return;
  }

  console.log('\n=== Acceptance criteria checklist ===');
  console.log(`billableTranslationPages / translationPageBasis: ${nm.billableTranslationPages} / ${nm.translationPageBasis}`);
  console.log(`courierAmountKzt: ${nm.courierAmountKzt} (expect 5000 if delivery, 0 if pickup)`);
  console.log(`standardRetailKzt: ${nm.standardRetailKzt}  urgencyMultiplier: ${nm.urgencyMultiplier}  retailKzt: ${nm.retailKzt}`);
  console.log(`  -> retailKzt should equal standardRetailKzt * urgencyMultiplier: ${(nm.standardRetailKzt as number) * (nm.urgencyMultiplier as number)}`);
  console.log(`clientDiscountKzt: ${nm.clientDiscountKzt}  actualPaymentKzt: ${nm.actualPaymentKzt}  partnerCommissionKzt: ${nm.partnerCommissionKzt}`);
  console.log(`  -> referral: discount should be computed from retailKzt (post-urgency), partner commission from actualPaymentKzt`);
  console.log(`reconciliationDifferenceKzt: ${nm.reconciliationDifferenceKzt} (expect 0)`);

  if (job.price_jira_issue_key) {
    console.log(`\nOpen the Jira issue ${job.price_jira_issue_key} and confirm it shows the Russian report (6 blocks) if ENABLE_NEW_JIRA_PRICING_REPORT=true was set on the worker at creation time.`);
  } else {
    console.log('\nNo Jira price breakdown issue key recorded yet — check JIRA_PRICE_BREAKDOWN_ISSUE_ENABLED on the worker, or the worker may not have processed this job yet.');
  }

  console.log('\n=== Done. No writes performed. ===');
}

main().catch((err) => {
  console.error('[verify-e2e-quote] FATAL:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
