#!/usr/bin/env npx tsx
/**
 * Verify (and optionally, on staging only, correct) the active pricing_versions.mrp_value —
 * for developer/operator use only.
 *
 * Background: NOTARY_CONFIG.mrpValueFallbackKzt (src/lib/pricing/config.ts) was updated to
 * 4325 (raw KZT), reflecting the current 2026 MRP tariff — but that fallback is only used
 * when pricing_versions.mrp_value is null. If the active pricing_versions row already has a
 * value set (e.g. the old 3.69), real quotes keep using that OLD figure regardless of the
 * code fallback. This script only reports/updates DATA in pricing_versions — it does not
 * change schema and does not touch any other table.
 *
 * IMPORTANT — units: pricing_versions.mrp_value is stored "in thousands of KZT".
 * 4.325 means 4,325 KZT. Do NOT enter 4325 directly into this column.
 *
 * Default mode is READ-ONLY (lists all pricing_versions rows, flags if the active one is stale).
 * Use --apply to actually update the active row — requires ALL of:
 *   - APP_ENV or NEXT_PUBLIC_APP_ENV = staging (refuses unconditionally on production)
 *   - ALLOW_STAGING_DATA_UPDATE=true
 *   - --apply flag on the command line
 *
 * Usage:
 *   npx tsx scripts/staging/verify-notary-mrp-value.ts                # read-only report
 *   npx tsx scripts/staging/verify-notary-mrp-value.ts --apply        # apply update (staging only, needs env flag too)
 *
 * Do NOT use in production. Do NOT run --apply without explicit operator/finance sign-off
 * that 4.325 (-> 4,325 KZT) is in fact the correct current MRP tariff.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

// ─── Env loading — must happen before reading process.env ──────────────────────

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

// Target value: 4.325 in the "thousands of KZT" column convention == 4,325 KZT.
const EXPECTED_MRP_VALUE = 4.325;

function parseArgs(): { apply: boolean } {
  return { apply: process.argv.includes('--apply') };
}

function printDiagnostics(): void {
  const appEnv = process.env.NEXT_PUBLIC_APP_ENV ?? process.env.APP_ENV ?? '(not set)';
  console.log('[verify-notary-mrp-value] Diagnostics');
  console.log(`  APP_ENV / NEXT_PUBLIC_APP_ENV : ${appEnv}`);
  console.log(`  Supabase host                 : ${(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '(not set)').replace(/\/\/.*@/, '//***@')}`);
  console.log('');
}

async function main(): Promise<void> {
  const { apply } = parseArgs();

  printDiagnostics();

  const appEnv = (process.env.NEXT_PUBLIC_APP_ENV ?? process.env.APP_ENV ?? '').toLowerCase();
  if (appEnv === 'production') {
    console.error('[BLOCKED] APP_ENV=production. This script must never run against production.');
    process.exit(1);
  }

  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error('[verify-notary-mrp-value] FATAL: Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createClient(SUPABASE_URL, SERVICE_KEY) as any;

  const { data: rows, error } = await db
    .from('pricing_versions')
    .select('id, code, status, mrp_value, valid_from, valid_to')
    .order('valid_from', { ascending: false });

  if (error) {
    console.error('[verify-notary-mrp-value] Query failed:', error.message);
    process.exit(1);
  }

  console.log('[verify-notary-mrp-value] pricing_versions (all rows):');
  console.log('| id | code | status | mrp_value | -> KZT | valid_from | valid_to |');
  console.log('|---|---|---|---|---|---|---|');
  for (const r of rows ?? []) {
    const mrpValue = r.mrp_value != null ? Number(r.mrp_value) : null;
    const mrpKzt = mrpValue != null ? mrpValue * 1000 : null;
    console.log(`| ${r.id} | ${r.code} | ${r.status} | ${mrpValue ?? '(null)'} | ${mrpKzt ?? '(fallback: 4325)'} | ${r.valid_from} | ${r.valid_to ?? '—'} |`);
  }
  console.log('');

  const active = (rows ?? []).find((r: { status: string }) => r.status === 'active');
  if (!active) {
    console.warn('[verify-notary-mrp-value] WARNING: no row with status="active" found.');
    return;
  }

  const activeMrpValue = active.mrp_value != null ? Number(active.mrp_value) : null;
  const isStale = activeMrpValue == null || Math.abs(activeMrpValue - EXPECTED_MRP_VALUE) > 1e-9;

  if (!isStale) {
    console.log(`[verify-notary-mrp-value] OK: active version '${active.code}' already has mrp_value=${EXPECTED_MRP_VALUE} (-> 4,325 KZT).`);
    return;
  }

  console.warn(`[verify-notary-mrp-value] STALE: active version '${active.code}' has mrp_value=${activeMrpValue ?? '(null)'}, expected ${EXPECTED_MRP_VALUE} (-> 4,325 KZT).`);
  console.log('');
  console.log('Manual verification SQL (read-only, safe to run anywhere):');
  console.log('```sql');
  console.log('select id, code, status, mrp_value, valid_from, valid_to');
  console.log('from pricing_versions');
  console.log('order by valid_from desc;');
  console.log('```');
  console.log('');
  console.log('Staging-only data update SQL (do NOT run manually against production):');
  console.log('```sql');
  console.log('update pricing_versions');
  console.log(`set mrp_value = ${EXPECTED_MRP_VALUE}`);
  console.log("where status = 'active'");
  console.log(`  and mrp_value <> ${EXPECTED_MRP_VALUE};`);
  console.log('```');
  console.log('');

  if (!apply) {
    console.log('[verify-notary-mrp-value] Read-only mode — no changes made. Re-run with --apply to update (staging only).');
    return;
  }

  if (appEnv !== 'staging') {
    console.error(`[BLOCKED] --apply requires APP_ENV=staging (got "${appEnv || '(not set)'}").`);
    process.exit(1);
  }
  if (process.env.ALLOW_STAGING_DATA_UPDATE !== 'true') {
    console.error('[BLOCKED] --apply requires ALLOW_STAGING_DATA_UPDATE=true to be set explicitly.');
    process.exit(1);
  }

  console.log(`[verify-notary-mrp-value] Applying: setting mrp_value=${EXPECTED_MRP_VALUE} for active version '${active.code}'...`);
  const { error: updateError } = await db
    .from('pricing_versions')
    .update({ mrp_value: EXPECTED_MRP_VALUE })
    .eq('status', 'active')
    .neq('mrp_value', EXPECTED_MRP_VALUE);

  if (updateError) {
    console.error('[verify-notary-mrp-value] Update FAILED:', updateError.message);
    process.exit(1);
  }

  console.log('[verify-notary-mrp-value] ✓ Updated. Re-run without --apply to confirm.');
}

main().catch((err) => {
  console.error('[verify-notary-mrp-value] Unexpected error:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
