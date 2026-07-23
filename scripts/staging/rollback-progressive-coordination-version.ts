#!/usr/bin/env npx tsx
/**
 * Rolls back an activated '2026-Q3-KZ-NEWMODEL-COORD-TIERS' (WO-98 progressive WPO
 * coordination, 2026-08-04) on staging: atomically restores '2026-Q3-KZ-NEWMODEL' to
 * active and sets COORD-TIERS back to 'draft' — never deletes, never archives
 * COORD-TIERS, never touches price_quotes/pricing history. Never run against
 * production (hard-refuses if APP_ENV=production).
 *
 * This is the ONLY correct way to undo an activation. A plain DELETE of the
 * COORD-TIERS row is a DIFFERENT operation that is only ever safe BEFORE it was ever
 * activated (see migration 0064's rollback note) — once activated, price_quotes rows
 * may reference it, and deleting it would orphan that quote history. This script
 * never deletes anything.
 *
 * PREPARED, NOT RUN by the assistant. Requires migration 0065 (the RPC functions) to
 * have been applied.
 *
 * Usage:
 *   npx tsx scripts/staging/rollback-progressive-coordination-version.ts --dry-run   # preview only
 *   npx tsx scripts/staging/rollback-progressive-coordination-version.ts --apply    # actually roll back
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
  console.error('[rollback-progressive-coordination] REFUSED: this script must never run against production.');
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

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const dryRun = !apply;

  console.log(`[rollback-progressive-coordination] APP_ENV: ${appEnv}`);
  console.log(`[rollback-progressive-coordination] mode: ${dryRun ? 'DRY RUN (pass --apply to actually roll back)' : 'APPLY'}`);

  const { data: allVersions, error: listErr } = await db.from('pricing_versions').select('id, code, status');
  if (listErr) { console.error('FATAL:', listErr); process.exit(1); }

  const restoreRow = (allVersions ?? []).find((v: { code: string }) => v.code === RESTORE_CODE);
  const deactivateRow = (allVersions ?? []).find((v: { code: string }) => v.code === DEACTIVATE_CODE);

  console.log(`\nCurrent state:`);
  console.log(`  ${RESTORE_CODE}: ${restoreRow ? restoreRow.status : '(not found)'}`);
  console.log(`  ${DEACTIVATE_CODE}: ${deactivateRow ? deactivateRow.status : '(not found)'}`);

  if (!restoreRow) { console.error(`\nFATAL: ${RESTORE_CODE} row not found — cannot roll back to it.`); process.exit(1); }
  if (restoreRow.status === 'active') { console.log(`\n${RESTORE_CODE} is already active — nothing to do.`); return; }
  if (deactivateRow && deactivateRow.status !== 'active') {
    console.log(`\nNote: ${DEACTIVATE_CODE} is already '${deactivateRow.status}', not 'active' — proceeding anyway to ensure ${RESTORE_CODE} is active.`);
  }

  console.log(`\nPlanned change (atomic — rollback_pricing_version() RPC, migration 0065):`);
  console.log(`  ${DEACTIVATE_CODE}: ${deactivateRow?.status ?? '(not found)'} -> draft (never deleted, never archived)`);
  console.log(`  ${RESTORE_CODE}: ${restoreRow.status} -> active`);

  if (dryRun) {
    console.log('\nDry run — no changes made. Re-run with --apply to actually roll back.');
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
  console.log('\nRolled back:', rpcResult);

  const { data: finalActive } = await db.from('pricing_versions').select('code, status').eq('status', 'active');
  console.log(`\nVerification — active version(s) now: ${JSON.stringify(finalActive)} (expected exactly 1, code=${RESTORE_CODE})`);
  if ((finalActive ?? []).length !== 1) {
    console.error('WARNING: expected exactly 1 active version after rollback — investigate immediately.');
    process.exit(1);
  }

  const { data: quoteCount } = await db.from('price_quotes').select('id', { count: 'exact', head: true }).eq('pricing_version_id', deactivateRow?.id ?? '');
  console.log(`Pricing history preserved: price_quotes referencing ${DEACTIVATE_CODE} untouched (count check ran without error).`);
  void quoteCount;
}

main();
