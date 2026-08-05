#!/usr/bin/env npx tsx
/**
 * Activates '2026-Q3-KZ-NEWMODEL-COORD-TIERS' (WO-98 progressive WPO coordination,
 * 2026-08-04) on staging — the "one controlled step" the operator performs manually.
 *
 * 2026-08-06 security/concurrency audit corrective fix:
 *   - Default-deny environment check (was: refuse only if APP_ENV==='production';
 *     now: refuse unless APP_ENV/NEXT_PUBLIC_APP_ENV is explicitly 'staging' — an
 *     unset/misconfigured env var no longer silently proceeds).
 *   - Requires BOTH --apply AND --confirm-staging together to make any change —
 *     --apply alone is treated as a dry run, forcing the operator to affirmatively
 *     type out that this targets staging in the command itself.
 *   - Prints the exact before/after active version code explicitly, and re-reads the
 *     DB after the RPC call (never trusts the RPC's own return value alone) to verify
 *     exactly one active version exists, with its code.
 *
 * Calls the atomic activate_pricing_version() Postgres function (migration 0065,
 * prepared, not applied) — one transaction, serialized via a session-wide advisory
 * lock, service_role-only (REVOKEd from anon/authenticated/PUBLIC — never reachable
 * via the client Supabase API). The function itself re-verifies every precondition
 * (exactly one active version beforehand and it must be the expected old code; new
 * version must be status='draft'; new version's active language-rate count must match
 * the active version's) and the postcondition (exactly one active version afterward),
 * raising — and rolling back the whole transaction — on any violation.
 *
 * PREPARED, NOT RUN by the assistant. Requires BOTH migration 0064 (creates the draft
 * row + its cloned pricing_language_rates) AND migration 0065 (the RPC functions,
 * with their REVOKE/GRANT) to have been applied first.
 *
 * Usage:
 *   npx tsx scripts/staging/activate-progressive-coordination-version.ts --dry-run
 *   npx tsx scripts/staging/activate-progressive-coordination-version.ts --apply --confirm-staging
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
// Default-deny: only an EXPLICIT 'staging' proceeds. An unset/blank/unexpected value
// (e.g. a misconfigured shell, or accidentally sourcing production env vars) refuses
// exactly like 'production' would — "not staging" is refused, not just "is production".
if (appEnv !== 'staging') {
  console.error(`[activate-progressive-coordination] REFUSED: APP_ENV/NEXT_PUBLIC_APP_ENV is '${appEnv}', not 'staging'. This script only ever runs against staging.`);
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

async function readActiveVersions(): Promise<Array<{ code: string; status: string }>> {
  const { data, error } = await db.from('pricing_versions').select('code, status').eq('status', 'active');
  if (error) { console.error('FATAL reading active versions:', error.message); process.exit(1); }
  return data ?? [];
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const confirmStaging = process.argv.includes('--confirm-staging');
  const willApply = apply && confirmStaging;

  console.log(`[activate-progressive-coordination] APP_ENV: ${appEnv}`);
  if (apply && !confirmStaging) {
    console.log('[activate-progressive-coordination] --apply given without --confirm-staging — treating as DRY RUN. Pass both flags together to actually activate.');
  }
  console.log(`[activate-progressive-coordination] mode: ${willApply ? 'APPLY' : 'DRY RUN'}`);

  const { data: allVersions, error: listErr } = await db.from('pricing_versions').select('id, code, status');
  if (listErr) { console.error('FATAL:', listErr); process.exit(1); }

  const oldRow = (allVersions ?? []).find((v: { code: string }) => v.code === OLD_CODE);
  const newRow = (allVersions ?? []).find((v: { code: string }) => v.code === NEW_CODE);
  const activeVersions = (allVersions ?? []).filter((v: { status: string }) => v.status === 'active');

  console.log(`\nBEFORE:`);
  console.log(`  ${OLD_CODE}: ${oldRow ? oldRow.status : '(not found)'}`);
  console.log(`  ${NEW_CODE}: ${newRow ? newRow.status : '(not found — apply migration 0064 first)'}`);
  console.log(`  Active version(s): ${activeVersions.map((v: { code: string }) => v.code).join(', ') || '(none)'} (count: ${activeVersions.length})`);

  if (!newRow) { console.error(`\nFATAL: ${NEW_CODE} row not found — apply migration 0064 first.`); process.exit(1); }
  if (newRow.status === 'active') { console.log(`\n${NEW_CODE} is already active — nothing to do.`); return; }
  if (activeVersions.length !== 1 || activeVersions[0].code !== OLD_CODE) {
    console.error(`\nFATAL: expected exactly one active version with code ${OLD_CODE} — found ${JSON.stringify(activeVersions)}. This is a pre-existing data problem; investigate manually before activating.`);
    process.exit(1);
  }
  if (newRow.status !== 'draft') {
    console.error(`\nFATAL: ${NEW_CODE} has status '${newRow.status}' (expected 'draft'). Refusing.`);
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

  // Language-rate parity is also enforced INSIDE activate_pricing_version() itself —
  // checked here too so a dry run surfaces the same problem before anyone tries --apply.
  const { count: oldRateCount } = await db.from('pricing_language_rates').select('id', { count: 'exact', head: true }).eq('pricing_version_id', oldRow.id).eq('active', true);
  const { count: newRateCount } = await db.from('pricing_language_rates').select('id', { count: 'exact', head: true }).eq('pricing_version_id', newRow.id).eq('active', true);
  console.log(`  Active language rates — ${OLD_CODE}: ${oldRateCount}, ${NEW_CODE}: ${newRateCount}`);
  if (oldRateCount !== newRateCount) {
    console.error(`\nFATAL: language-rate count mismatch (${OLD_CODE}=${oldRateCount}, ${NEW_CODE}=${newRateCount}) — refusing.`);
    process.exit(1);
  }

  console.log(`\nPlanned change (atomic — activate_pricing_version() RPC, migration 0065):`);
  console.log(`  before_active_code: ${OLD_CODE}`);
  console.log(`  after_active_code:  ${NEW_CODE}`);

  if (!willApply) {
    console.log('\nDry run — no changes made. Re-run with BOTH --apply and --confirm-staging to actually activate.');
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
  console.log('\nRPC result:', rpcResult);

  // Never trust the RPC's own return value alone — re-read the DB independently.
  const finalActive = await readActiveVersions();
  console.log(`\nAFTER (re-read from DB): ${JSON.stringify(finalActive)}`);
  if (finalActive.length !== 1 || finalActive[0].code !== NEW_CODE) {
    console.error(`FATAL: post-activation verification failed — expected exactly one active version with code ${NEW_CODE}. Investigate immediately.`);
    process.exit(1);
  }
  console.log(`Verified: exactly one active version, code=${NEW_CODE}.`);
}

main();
