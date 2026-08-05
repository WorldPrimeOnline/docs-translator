#!/usr/bin/env npx tsx
/**
 * Rolls back an activated '2026-Q3-KZ-NEWMODEL-COORD-TIERS' (WO-98 progressive WPO
 * coordination, 2026-08-04) on staging: atomically restores '2026-Q3-KZ-NEWMODEL' to
 * active and sets COORD-TIERS back to 'draft' — never deletes, never archives
 * COORD-TIERS, never touches price_quotes/pricing history.
 *
 * 2026-08-06 security/concurrency audit corrective fix: same default-deny environment
 * check, --apply + --confirm-staging requirement, explicit before/after printing, and
 * post-RPC DB re-read as activate-progressive-coordination-version.ts (see that file's
 * doc comment for the full rationale).
 *
 * This is the ONLY correct way to undo an activation. A plain DELETE of the
 * COORD-TIERS row is a DIFFERENT operation that is only ever safe BEFORE it was ever
 * activated (see migration 0064's rollback note) — once activated, price_quotes rows
 * may reference it, and deleting it would orphan that quote history. This script
 * never deletes anything.
 *
 * PREPARED, NOT RUN by the assistant. Requires migration 0065 (the RPC functions,
 * with their REVOKE/GRANT) to have been applied.
 *
 * Usage:
 *   npx tsx scripts/staging/rollback-progressive-coordination-version.ts --dry-run
 *   npx tsx scripts/staging/rollback-progressive-coordination-version.ts --apply --confirm-staging
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
if (appEnv !== 'staging') {
  console.error(`[rollback-progressive-coordination] REFUSED: APP_ENV/NEXT_PUBLIC_APP_ENV is '${appEnv}', not 'staging'. This script only ever runs against staging.`);
  process.exit(1);
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceKey) {
  console.error('[rollback-progressive-coordination] FATAL: Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = createClient(supabaseUrl, serviceKey) as any;

const RESTORE_CODE = '2026-Q3-KZ-NEWMODEL';
const DEACTIVATE_CODE = '2026-Q3-KZ-NEWMODEL-COORD-TIERS';

async function readActiveVersions(): Promise<Array<{ code: string; status: string }>> {
  const { data, error } = await db.from('pricing_versions').select('code, status').eq('status', 'active');
  if (error) { console.error('FATAL reading active versions:', error.message); process.exit(1); }
  return data ?? [];
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const confirmStaging = process.argv.includes('--confirm-staging');
  const willApply = apply && confirmStaging;

  console.log(`[rollback-progressive-coordination] APP_ENV: ${appEnv}`);
  if (apply && !confirmStaging) {
    console.log('[rollback-progressive-coordination] --apply given without --confirm-staging — treating as DRY RUN. Pass both flags together to actually roll back.');
  }
  console.log(`[rollback-progressive-coordination] mode: ${willApply ? 'APPLY' : 'DRY RUN'}`);

  const { data: allVersions, error: listErr } = await db.from('pricing_versions').select('id, code, status');
  if (listErr) { console.error('FATAL:', listErr); process.exit(1); }

  const restoreRow = (allVersions ?? []).find((v: { code: string }) => v.code === RESTORE_CODE);
  const deactivateRow = (allVersions ?? []).find((v: { code: string }) => v.code === DEACTIVATE_CODE);
  const activeVersions = (allVersions ?? []).filter((v: { status: string }) => v.status === 'active');

  console.log(`\nBEFORE:`);
  console.log(`  ${RESTORE_CODE}: ${restoreRow ? restoreRow.status : '(not found)'}`);
  console.log(`  ${DEACTIVATE_CODE}: ${deactivateRow ? deactivateRow.status : '(not found)'}`);
  console.log(`  Active version(s): ${activeVersions.map((v: { code: string }) => v.code).join(', ') || '(none)'} (count: ${activeVersions.length})`);

  if (!restoreRow) { console.error(`\nFATAL: ${RESTORE_CODE} row not found — cannot roll back to it.`); process.exit(1); }
  if (!deactivateRow) { console.error(`\nFATAL: ${DEACTIVATE_CODE} row not found.`); process.exit(1); }
  if (restoreRow.status === 'active') { console.log(`\n${RESTORE_CODE} is already active — nothing to do.`); return; }
  if (activeVersions.length !== 1 || activeVersions[0].code !== DEACTIVATE_CODE) {
    console.error(`\nFATAL: expected exactly one active version with code ${DEACTIVATE_CODE} — found ${JSON.stringify(activeVersions)}. Refusing to roll back an unexpected state.`);
    process.exit(1);
  }

  console.log(`\nPlanned change (atomic — rollback_pricing_version() RPC, migration 0065):`);
  console.log(`  before_active_code: ${DEACTIVATE_CODE}`);
  console.log(`  after_active_code:  ${RESTORE_CODE}`);
  console.log(`  ${DEACTIVATE_CODE} -> draft (never deleted, never archived — price_quotes history untouched)`);

  if (!willApply) {
    console.log('\nDry run — no changes made. Re-run with BOTH --apply and --confirm-staging to actually roll back.');
    return;
  }

  const { data: rpcResult, error: rpcError } = await db.rpc('rollback_pricing_version', {
    p_restore_code: RESTORE_CODE,
    p_deactivate_code: DEACTIVATE_CODE,
  });
  if (rpcError) {
    console.error('\nFATAL: rollback_pricing_version() raised — nothing was changed (full transaction rollback):', rpcError.message);
    process.exit(1);
  }
  console.log('\nRPC result:', rpcResult);

  // Never trust the RPC's own return value alone — re-read the DB independently.
  const finalActive = await readActiveVersions();
  console.log(`\nAFTER (re-read from DB): ${JSON.stringify(finalActive)}`);
  if (finalActive.length !== 1 || finalActive[0].code !== RESTORE_CODE) {
    console.error(`FATAL: post-rollback verification failed — expected exactly one active version with code ${RESTORE_CODE}. Investigate immediately.`);
    process.exit(1);
  }
  console.log(`Verified: exactly one active version, code=${RESTORE_CODE}.`);

  const { count: quoteCount } = await db.from('price_quotes').select('id', { count: 'exact', head: true }).eq('pricing_version_id', deactivateRow.id);
  console.log(`Pricing history preserved: ${quoteCount ?? 0} price_quotes row(s) still reference ${DEACTIVATE_CODE} untouched.`);
}

main();
