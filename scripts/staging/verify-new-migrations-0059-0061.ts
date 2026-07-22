#!/usr/bin/env npx tsx
/**
 * Read-only verification that migrations 0059-0061 (checkout-integration pass, 2026-07-22)
 * were applied correctly on staging. Never writes anything. Safe to run repeatedly.
 * Mirrors the exact pattern of verify-new-pricing-schema.ts.
 *
 * Usage:
 *   npx tsx scripts/staging/verify-new-migrations-0059-0061.ts
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
console.log(`[verify-0059-0061] APP_ENV: ${appEnv}`);
if (appEnv === 'production') {
  console.error('[verify-0059-0061] REFUSED: this script must never run against production.');
  process.exit(1);
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceKey) {
  console.error('[verify-0059-0061] FATAL: Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
console.log(`[verify-0059-0061] Supabase host: ${supabaseUrl.replace(/\/\/.*@/, '//***@')}`);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = createClient(supabaseUrl, serviceKey) as any;

async function main(): Promise<void> {
  console.log('\n=== 1. price_quotes.formula_version (migration 0059) ===');
  const { error: fvErr } = await db.from('price_quotes').select('formula_version').limit(1);
  console.log(fvErr ? `  ERROR: ${fvErr.message}` : '  column selectable (OK)');

  console.log('\n=== 2. price_quotes immutability trigger (migration 0060) ===');
  console.log('  PostgREST cannot introspect triggers directly. Read-only functional check:');
  console.log('  find the most recent status=paid quote (if any) and confirm its price_locked_at is set.');
  const { data: paidQuotes, error: paidErr } = await db
    .from('price_quotes')
    .select('id, status, amount_kzt, paid_at, price_locked_at, formula_version')
    .eq('status', 'paid')
    .order('paid_at', { ascending: false })
    .limit(3);
  if (paidErr) {
    console.error('  ERROR:', paidErr.message);
  } else if (!paidQuotes || paidQuotes.length === 0) {
    console.log('  no paid quotes found yet on this environment — trigger presence cannot be functionally confirmed from data alone.');
    console.log('  to confirm the trigger itself exists, run this SQL manually in the Supabase SQL editor (read-only):');
    console.log("    select tgname from pg_trigger where tgrelid = 'public.price_quotes'::regclass and tgname = 'trg_prevent_paid_price_quote_mutation';");
  } else {
    for (const q of paidQuotes) {
      const ok = q.price_locked_at != null;
      console.log(`  quote ${q.id}: status=${q.status} price_locked_at=${q.price_locked_at} ${ok ? '(OK — locked)' : '*** MISSING price_locked_at ***'}`);
    }
    console.log('  NOTE: this only confirms price_locked_at is set on paid quotes, not that the trigger blocks mutation.');
    console.log('  To confirm actual enforcement, attempt (in a throwaway transaction you ROLLBACK, never COMMIT):');
    console.log(`    begin; update price_quotes set amount_kzt = amount_kzt + 1 where id = '${paidQuotes[0].id}'; -- expect: ERROR from prevent_paid_price_quote_mutation()`);
    console.log('    rollback;');
  }

  console.log('\n=== 3. order_drafts.analysis_snapshot (migration 0061) ===');
  const { error: asErr } = await db.from('order_drafts').select('analysis_snapshot').limit(1);
  console.log(asErr ? `  ERROR: ${asErr.message}` : '  column selectable (OK)');

  console.log('\n=== Done. No writes performed (except the optional manual ROLLBACK-only check above, run by hand). ===');
}

main().catch((err) => {
  console.error('[verify-0059-0061] FATAL:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
