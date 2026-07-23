#!/usr/bin/env npx tsx
/**
 * Activates '2026-Q3-KZ-NEWMODEL-COORD-TIERS' (WO-98 progressive WPO coordination,
 * 2026-08-04) on staging — the "one controlled step" the operator performs manually.
 * Never run against production (hard-refuses if APP_ENV=production).
 *
 * 2026-08-05 correction: the previous version of this script did two separate
 * .update() calls (archive old, then activate new) — NOT atomic. A crash/network
 * failure between them could leave ZERO active pricing versions, breaking every
 * quote ("no active pricing version"). Now calls the atomic
 * activate_pricing_version() Postgres function (migration 0065, prepared, not
 * applied) — one transaction: either both status flips happen, or neither does. The
 * function itself also verifies at most one active version exists BEFORE acting and
 * exactly one active version exists AFTER acting, raising (full rollback) otherwise.
 *
 * PREPARED, NOT RUN by the assistant. Requires BOTH migration 0064 (creates the draft
 * row + its cloned pricing_language_rates) AND migration 0065 (the RPC functions) to
 * have been applied first — this script's own pre-checks refuse otherwise.
 *
 * Usage:
 *   npx tsx scripts/staging/activate-progressive-coordination-version.ts --dry-run   # preview only
 *   npx tsx scripts/staging/activate-progressive-coordination-version.ts --apply    # actually activate
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
  console.error('[activate-progressive-coordination] REFUSED: this script must never run against production.');
  process.exit(1);
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceKey) {
  console.error('[activate-progressive-coordination] FATAL: Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = createClient(supabaseUrl, serviceKey) as any;

const OLD_CODE = '2026-Q3-KZ-NEWMODEL';
const NEW_CODE = '2026-Q3-KZ-NEWMODEL-COORD-TIERS';
const EXPECTED_FORMULA_VERSION = 'new_2026_07_21';

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const dryRun = !apply;

  console.log(`[activate-progressive-coordination] APP_ENV: ${appEnv}`);
  console.log(`[activate-progressive-coordination] mode: ${dryRun ? 'DRY RUN (pass --apply to actually activate)' : 'APPLY'}`);

  const { data: allVersions, error: listErr } = await db.from('pricing_versions').select('id, code, status');
  if (listErr) { console.error('FATAL:', listErr); process.exit(1); }

  const oldRow = (allVersions ?? []).find((v: { code: string }) => v.code === OLD_CODE);
  const newRow = (allVersions ?? []).find((v: { code: string }) => v.code === NEW_CODE);
  const activeVersions = (allVersions ?? []).filter((v: { status: string }) => v.status === 'active');

  console.log(`\nCurrent state:`);
  console.log(`  ${OLD_CODE}: ${oldRow ? oldRow.status : '(not found)'}`);
  console.log(`  ${NEW_CODE}: ${newRow ? newRow.status : '(not found — apply migration 0064 first)'}`);
  console.log(`  Active versions right now: ${activeVersions.length} (${activeVersions.map((v: { code: string }) => v.code).join(', ') || 'none'})`);

  if (!newRow) { console.error(`\nFATAL: ${NEW_CODE} row not found — apply migration 0064 first.`); process.exit(1); }
  if (newRow.status === 'active') { console.log(`\n${NEW_CODE} is already active — nothing to do.`); return; }
  if (activeVersions.length > 1) {
    console.error(`\nFATAL: ${activeVersions.length} active pricing versions found (expected 0 or 1) — this is a pre-existing data integrity problem. Refusing to activate on top of it; investigate manually first.`);
    process.exit(1);
  }

  const { data: newRowFull } = await db.from('pricing_versions').select('metadata').eq('code', NEW_CODE).maybeSingle();
  if (newRowFull?.metadata?.formula_version !== EXPECTED_FORMULA_VERSION) {
    console.error(`\nFATAL: ${NEW_CODE}.metadata.formula_version is '${newRowFull?.metadata?.formula_version}', expected '${EXPECTED_FORMULA_VERSION}'. Refusing to activate.`);
    process.exit(1);
  }
  if (!Array.isArray(newRowFull?.metadata?.coordinationVolumeTiers) || newRowFull.metadata.coordinationVolumeTiers.length === 0) {
    console.error(`\nFATAL: ${NEW_CODE}.metadata.coordinationVolumeTiers is missing/empty. Refusing to activate a "coordination tiers" version with no tiers configured.`);
    process.exit(1);
  }

  console.log(`\nPlanned change (atomic — activate_pricing_version() RPC, migration 0065):`);
  if (oldRow && oldRow.status === 'active') console.log(`  ${OLD_CODE}: active -> archived`);
  console.log(`  ${NEW_CODE}: ${newRow.status} -> active`);

  if (dryRun) {
    console.log('\nDry run — no changes made. Re-run with --apply to actually activate.');
    return;
  }

  const { data: rpcResult, error: rpcError } = await db.rpc('activate_pricing_version', {
    p_new_code: NEW_CODE,
    p_old_code: OLD_CODE,
  });
  if (rpcError) {
    console.error('\nFATAL: activate_pricing_version() raised — nothing was changed (full transaction rollback):', rpcError.message);
    process.exit(1);
  }
  console.log('\nActivated:', rpcResult);

  const { data: finalActive } = await db.from('pricing_versions').select('code, status').eq('status', 'active');
  console.log(`\nVerification — active version(s) now: ${JSON.stringify(finalActive)} (expected exactly 1, code=${NEW_CODE})`);
  if ((finalActive ?? []).length !== 1) {
    console.error('WARNING: expected exactly 1 active version after activation — investigate immediately.');
    process.exit(1);
  }
}

main();
