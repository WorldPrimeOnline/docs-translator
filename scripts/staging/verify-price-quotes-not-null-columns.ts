#!/usr/bin/env npx tsx
/**
 * Read-only staging check (2026-07-27 incident): saveQuote() failed with
 * "null value in column "included_word_count" of relation "price_quotes" violates
 * not-null constraint" on a real 7400 KZT Official quote.
 *
 * PostgREST does not expose information_schema by default (confirmed — this project has no
 * DATABASE_URL / direct Postgres connection string, only the Supabase REST/service-role client),
 * so this fetches one real row from the live staging price_quotes table and prints its full
 * column set for a side-by-side comparison against the NOT NULL columns declared across
 * migrations 0020/0053/0059/0060 (the only migrations that touch price_quotes' column
 * definitions — verified by grepping every migration file for `ALTER TABLE public.price_quotes`).
 * Never writes anything.
 *
 * Usage:
 *   npx tsx scripts/staging/verify-price-quotes-not-null-columns.ts
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
  console.error('[verify-price-quotes-not-null] REFUSED: this script must never run against production.');
  process.exit(1);
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceKey) {
  console.error('[verify-price-quotes-not-null] FATAL: Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = createClient(supabaseUrl, serviceKey) as any;

// Declared directly from migrations 0020 (original CREATE TABLE), 0053 (new-model fields),
// 0059 (formula_version), 0060 (trigger only, no new columns) — no other migration touches
// price_quotes' column definitions (grepped exhaustively).
const NOT_NULL_COLUMNS_FROM_MIGRATIONS: Array<{ column: string; hasDefault: boolean; migration: string }> = [
  { column: 'status', hasDefault: false, migration: '0020' },
  { column: 'amount_kzt', hasDefault: false, migration: '0020' },
  { column: 'currency', hasDefault: true, migration: '0020' },
  { column: 'quoted_at', hasDefault: true, migration: '0020' },
  { column: 'expires_at', hasDefault: false, migration: '0020' },
  { column: 'included_word_count', hasDefault: true, migration: '0020' },
  { column: 'included_page_count', hasDefault: true, migration: '0020' },
  { column: 'urgency_level', hasDefault: true, migration: '0020' },
  { column: 'delivery_required', hasDefault: true, migration: '0020' },
  { column: 'sales_channel', hasDefault: true, migration: '0020' },
  { column: 'pricing_context_json', hasDefault: true, migration: '0020' },
  { column: 'breakdown_json', hasDefault: true, migration: '0020' },
  { column: 'internal_cost_json', hasDefault: true, migration: '0020' },
  { column: 'margin_json', hasDefault: true, migration: '0020' },
  { column: 'created_at', hasDefault: true, migration: '0020' },
  { column: 'updated_at', hasDefault: true, migration: '0020' },
  { column: 'manual_adjustment_kzt', hasDefault: true, migration: '0053' },
  { column: 'wpo_financial_breakdown_json', hasDefault: true, migration: '0053' },
];

async function main(): Promise<void> {
  console.log('[verify-price-quotes-not-null] Fetching one real row from staging public.price_quotes...');
  const { data: rows, error } = await db.from('price_quotes').select('*').limit(1);
  if (error) {
    console.error('[verify-price-quotes-not-null] FATAL:', error.message);
    process.exit(1);
  }
  const liveColumns = new Set(rows && rows.length > 0 ? Object.keys(rows[0]) : []);
  if (liveColumns.size === 0) {
    console.log('[verify-price-quotes-not-null] Table has no rows yet — cannot confirm live column set this way. Falling back to migration-declared list only.');
  }

  console.log(`\nNOT NULL columns (declared in migrations, cross-checked against a live row when available):`);
  for (const c of NOT_NULL_COLUMNS_FROM_MIGRATIONS) {
    const presence = liveColumns.size > 0 ? (liveColumns.has(c.column) ? 'OK' : 'MISSING FROM LIVE TABLE') : '(no live row to check)';
    console.log(`  - ${c.column.padEnd(32)} default=${String(c.hasDefault).padEnd(5)} migration=${c.migration}  [${presence}]`);
  }

  console.log(`\n[verify-price-quotes-not-null] Done. Cross-reference this list against saveQuote()'s insert payload in src/lib/pricing/service.ts —`);
  console.log(`any column here set via "field ?? null" (rather than omitted, or "field ?? <real default>") will violate NOT NULL despite having a DB-level DEFAULT,`);
  console.log(`because an explicit NULL in an INSERT always overrides DEFAULT.`);
}

main().catch((err) => {
  console.error('[verify-price-quotes-not-null] FATAL:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
