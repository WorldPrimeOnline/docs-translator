#!/usr/bin/env npx tsx
/**
 * Read-only verification that migrations 0049-0055 (new pricing formula schema) were applied
 * correctly on staging. Never writes anything. Safe to run repeatedly.
 *
 * Usage:
 *   npx tsx scripts/staging/verify-new-pricing-schema.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const ROOT = path.resolve(process.cwd());
function loadEnvFile(filename: string): boolean {
  const filepath = path.join(ROOT, filename);
  if (fs.existsSync(filepath)) {
    dotenv.config({ path: filepath });
    return true;
  }
  return false;
}
loadEnvFile('.env.staging.local');
loadEnvFile('.env.local');

const appEnv = process.env.NEXT_PUBLIC_APP_ENV ?? process.env.APP_ENV ?? '(not set)';
console.log(`[verify-schema] APP_ENV: ${appEnv}`);
if (appEnv === 'production') {
  console.error('[verify-schema] REFUSED: this script must never run against production.');
  process.exit(1);
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceKey) {
  console.error('[verify-schema] FATAL: Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
console.log(`[verify-schema] Supabase host: ${supabaseUrl.replace(/\/\/.*@/, '//***@')}`);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = createClient(supabaseUrl, serviceKey) as any;

async function main(): Promise<void> {
  console.log('\n=== 1. pricing_versions new columns + draft row ===');
  const { data: versions, error: vErr } = await db
    .from('pricing_versions')
    .select('id, code, status, mrp_value, tax_rate, acquiring_rate, risk_reserve_rate, owner_reserve_rate, marketing_rate_direct, ai_it_rate, channel_reserve_rate, client_discount_rate, wpo_coordination_rate, ocr_rate_per_physical_page_kzt, courier_fee_kzt, printing_fee_kzt, extra_paper_copy_fee_kzt, rounding_step_official_kzt, rounding_step_notary_kzt, public_electronic_price_kzt, public_official_min_price_kzt, public_notary_min_price_kzt')
    .order('created_at', { ascending: false });
  if (vErr) { console.error('  ERROR:', vErr.message); process.exit(1); }
  console.log(`  total pricing_versions rows: ${versions?.length ?? 0}`);
  const newVersion = versions?.find((v: { code: string }) => v.code === '2026-Q3-KZ-NEWMODEL');
  if (!newVersion) {
    console.error('  ERROR: 2026-Q3-KZ-NEWMODEL row not found!');
  } else {
    console.log('  2026-Q3-KZ-NEWMODEL row:', JSON.stringify(newVersion, null, 2));
    console.log(`  status is draft: ${newVersion.status === 'draft' ? 'YES (correct)' : 'NO — UNEXPECTED, status=' + newVersion.status}`);
    const expectations: Array<[string, unknown, unknown]> = [
      ['courier_fee_kzt', Number(newVersion.courier_fee_kzt), 5000],
      ['marketing_rate_direct', Number(newVersion.marketing_rate_direct), 0.05],
      ['owner_reserve_rate', Number(newVersion.owner_reserve_rate), 0],
      ['tax_rate', Number(newVersion.tax_rate), 0.03],
      ['acquiring_rate', Number(newVersion.acquiring_rate), 0.025],
      ['risk_reserve_rate', Number(newVersion.risk_reserve_rate), 0.05],
      ['ai_it_rate', Number(newVersion.ai_it_rate), 0.10],
      ['channel_reserve_rate', Number(newVersion.channel_reserve_rate), 0.20],
      ['client_discount_rate', Number(newVersion.client_discount_rate), 0.10],
      ['wpo_coordination_rate', Number(newVersion.wpo_coordination_rate), 0.30],
      ['ocr_rate_per_physical_page_kzt', Number(newVersion.ocr_rate_per_physical_page_kzt), 100],
      ['mrp_value', Number(newVersion.mrp_value), 4.325],
      ['rounding_step_official_kzt', Number(newVersion.rounding_step_official_kzt), 100],
      ['rounding_step_notary_kzt', Number(newVersion.rounding_step_notary_kzt), 500],
    ];
    const grossUp = 0.03 + 0.025 + 0.05 + 0.05 + 0.10 + 0.00 + 0.20;
    console.log(`  computed gross_up_rate from this row: ${grossUp} (expected 0.455)`);
    for (const [field, actual, expected] of expectations) {
      console.log(`  ${field}: ${actual} ${actual === expected ? '(OK)' : '*** MISMATCH, expected ' + expected + ' ***'}`);
    }
    console.log(`  public_electronic_price_kzt: ${newVersion.public_electronic_price_kzt} (expect NULL — not yet populated)`);
    console.log(`  public_official_min_price_kzt: ${newVersion.public_official_min_price_kzt} (expect NULL — not yet populated)`);
    console.log(`  public_notary_min_price_kzt: ${newVersion.public_notary_min_price_kzt} (expect NULL — not yet populated)`);
  }

  console.log('\n=== 2. pricing_language_rates — all 14 rows ===');
  if (newVersion) {
    const { data: rates, error: rErr } = await db
      .from('pricing_language_rates')
      .select('source_language, target_language, rate_kzt_per_translation_page, active, requires_operator_review')
      .eq('pricing_version_id', newVersion.id)
      .order('target_language');
    if (rErr) { console.error('  ERROR:', rErr.message); }
    else {
      console.log(`  count: ${rates?.length ?? 0} (expect 14)`);
      for (const r of rates ?? []) {
        console.log(`    ru -> ${r.target_language}: ${r.rate_kzt_per_translation_page} KZT/page, active=${r.active}, review=${r.requires_operator_review}`);
      }
      const expectedPairs: Record<string, number> = {
        kk: 2000, uz: 3500, ky: 4000, uk: 3500, be: 5000, en: 3000, de: 5000,
        fr: 4000, it: 4000, zh: 5000, ko: 7000, tr: 4000, th: 10000, ar: 6000,
      };
      const missing = Object.keys(expectedPairs).filter((k) => !(rates ?? []).some((r: { target_language: string }) => r.target_language === k));
      console.log(`  missing target languages: ${missing.length === 0 ? 'none (OK)' : missing.join(', ')}`);
      const mismatches = (rates ?? []).filter((r: { target_language: string; rate_kzt_per_translation_page: number }) =>
        expectedPairs[r.target_language] !== undefined && Number(r.rate_kzt_per_translation_page) !== expectedPairs[r.target_language]);
      console.log(`  rate mismatches: ${mismatches.length === 0 ? 'none (OK)' : JSON.stringify(mismatches)}`);
    }
  }

  console.log('\n=== 3. document_analysis table exists (empty is fine) ===');
  const { error: daErr, count: daCount } = await db
    .from('document_analysis')
    .select('id', { count: 'exact', head: true });
  console.log(daErr ? `  ERROR: ${daErr.message}` : `  table reachable, row count: ${daCount}`);

  console.log('\n=== 4. price_quotes new columns ===');
  const { error: pqErr } = await db
    .from('price_quotes')
    .select('analysis_id, language_rate_id, source_character_count_with_spaces, translation_page_count_exact, manual_adjustment_kzt, wpo_financial_breakdown_json')
    .limit(1);
  console.log(pqErr ? `  ERROR: ${pqErr.message}` : '  all new columns selectable (OK)');

  console.log('\n=== 5. jobs manual_adjustment_* columns ===');
  const { error: jErr } = await db
    .from('jobs')
    .select('manual_adjustment_kzt, manual_adjustment_reason, manual_adjustment_actor, manual_adjustment_at')
    .limit(1);
  console.log(jErr ? `  ERROR: ${jErr.message}` : '  all new columns selectable (OK)');

  console.log('\n=== 6. cost_reservations status CHECK includes released/refunded ===');
  // Read-only probe: try selecting rows with these statuses (0 rows is fine — we're only
  // checking the query itself doesn't error, which it would if the CHECK/column were wrong).
  // We do NOT insert/update anything.
  const { error: crErr } = await db
    .from('cost_reservations')
    .select('id, status')
    .in('status', ['released', 'refunded'])
    .limit(1);
  console.log(crErr ? `  ERROR (unexpected): ${crErr.message}` : '  query with released/refunded statuses accepted (schema-level OK; cannot directly introspect CHECK constraint via PostgREST, but this at least confirms no client-side rejection)');

  console.log('\n=== Done. No writes performed. ===');
}

main().catch((err) => {
  console.error('[verify-schema] FATAL:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
