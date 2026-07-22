#!/usr/bin/env npx tsx
/**
 * Activates 2026-Q3-KZ-NEWMODEL on staging: archives the currently-active row (2026-Q3-KZ-MVP)
 * and flips NEWMODEL to active — the "one controlled step" the operator performs manually.
 * Never run against production (hard-refuses if APP_ENV=production).
 *
 * This does NOT touch public_electronic_price_kzt/public_official_min_price_kzt/
 * public_notary_min_price_kzt (still NULL) — those only feed public marketing "from X ₸" pages,
 * not checkout pricing itself (computeQuoteForJob always computes live from real
 * characterCount/pages), so they don't block using this version for real quotes on staging.
 * Populate them separately before a real production launch if the marketing pages need them.
 *
 * Usage:
 *   npx tsx scripts/staging/activate-newmodel-pricing-version.ts --dry-run   # preview only
 *   npx tsx scripts/staging/activate-newmodel-pricing-version.ts --apply    # actually activate
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
  console.error('[activate-newmodel] REFUSED: this script must never run against production.');
  process.exit(1);
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceKey) {
  console.error('[activate-newmodel] FATAL: Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = createClient(supabaseUrl, serviceKey) as any;

const OLD_CODE = '2026-Q3-KZ-MVP';
const NEW_CODE = '2026-Q3-KZ-NEWMODEL';
const EXPECTED_FORMULA_VERSION = 'new_2026_07_21';

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const dryRun = !apply;

  console.log(`[activate-newmodel] APP_ENV: ${appEnv}`);
  console.log(`[activate-newmodel] mode: ${dryRun ? 'DRY RUN (pass --apply to actually activate)' : 'APPLY'}`);

  const { data: oldRow, error: oldErr } = await db.from('pricing_versions').select('id, code, status').eq('code', OLD_CODE).maybeSingle();
  const { data: newRow, error: newErr } = await db.from('pricing_versions').select('id, code, status, metadata').eq('code', NEW_CODE).maybeSingle();

  if (oldErr || newErr) { console.error('FATAL:', oldErr ?? newErr); process.exit(1); }
  if (!newRow) { console.error(`FATAL: ${NEW_CODE} row not found.`); process.exit(1); }

  console.log(`\nCurrent state:`);
  console.log(`  ${OLD_CODE}: ${oldRow ? oldRow.status : '(not found)'}`);
  console.log(`  ${NEW_CODE}: ${newRow.status}, formula_version=${newRow.metadata?.formula_version ?? '(none)'}`);

  if (newRow.status === 'active') {
    console.log(`\n${NEW_CODE} is already active — nothing to do.`);
    return;
  }
  if (newRow.metadata?.formula_version !== EXPECTED_FORMULA_VERSION) {
    console.error(`\nFATAL: ${NEW_CODE}.metadata.formula_version is '${newRow.metadata?.formula_version}', expected '${EXPECTED_FORMULA_VERSION}'. Refusing to activate — this must match what src/lib/pricing/service.ts's computeQuoteForJob() checks, or every gated request will get PRICING_VERSION_MISMATCH anyway.`);
    process.exit(1);
  }

  console.log(`\nPlanned change:`);
  if (oldRow && oldRow.status === 'active') {
    console.log(`  ${OLD_CODE}: active -> archived`);
  }
  console.log(`  ${NEW_CODE}: ${newRow.status} -> active`);

  if (dryRun) {
    console.log('\nDry run — no changes made. Re-run with --apply to actually activate.');
    return;
  }

  if (oldRow && oldRow.status === 'active') {
    const { error } = await db.from('pricing_versions').update({ status: 'archived', valid_to: new Date().toISOString() }).eq('id', oldRow.id);
    if (error) { console.error('FATAL archiving old version:', error); process.exit(1); }
    console.log(`  ${OLD_CODE} archived.`);
  }

  const { error: activateErr } = await db.from('pricing_versions').update({ status: 'active', valid_from: new Date().toISOString() }).eq('id', newRow.id);
  if (activateErr) { console.error('FATAL activating new version:', activateErr); process.exit(1); }
  console.log(`  ${NEW_CODE} activated.`);

  const { data: check } = await db.from('pricing_versions').select('code, status').eq('status', 'active').maybeSingle();
  console.log(`\nVerification — active version is now: ${check?.code} (${check?.status})`);
}

main();
