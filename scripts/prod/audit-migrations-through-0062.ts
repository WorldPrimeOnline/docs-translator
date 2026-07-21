#!/usr/bin/env npx tsx
/**
 * Read-only PRODUCTION migration audit (2026-07-28, pre-production pricing rollout).
 *
 * For every migration file in supabase/migrations, extracts a schema "marker" (the table it
 * creates, or the column(s) it adds) and checks whether that marker exists on whatever database
 * the loaded Supabase credentials point to — reports APPLIED / MISSING / UNVERIFIABLE per
 * migration, in order, so the exact point production's schema diverges from the current
 * migration history is unambiguous.
 *
 * MUST be run by the operator with real production credentials — this machine intentionally has
 * no production Supabase access (attempted once, 2026-07-28: the platform's own secret-redaction
 * layer replaces credential values with a placeholder before this agent can use them, which is a
 * deliberate safety boundary, not a bug to route around).
 *
 * Never writes anything — every check is `.select(...).limit(1)`.
 *
 * Usage:
 *   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/prod/audit-migrations-through-0062.ts
 *   # or: vercel env pull .env.production.local --environment=production   (then just run this)
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
loadEnvFile('.env.production.local');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceKey) {
  console.error('[audit-migrations] FATAL: Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  console.error('Pull real production credentials yourself first, e.g.:');
  console.error('  vercel env pull .env.production.local --environment=production');
  process.exit(1);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = createClient(supabaseUrl, serviceKey) as any;

interface Marker {
  num: string;
  file: string;
  createTables: string[];
  addColumns: Array<[string, string]>;
}

function extractMarkers(migrationsDir: string): Marker[] {
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort((a, b) => parseInt(a) - parseInt(b));
  return files.map((file) => {
    const num = file.split('_')[0];
    const text = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
    const createTables = [...text.matchAll(/create table(?:\s+if not exists)?\s+(?:public\.)?(\w+)/gi)].map((m) => m[1]);
    const addColumns: Array<[string, string]> = [];
    for (const alterMatch of text.matchAll(/alter table\s+(?:public\.)?(\w+)\s*([\s\S]*?);/gi)) {
      const table = alterMatch[1];
      const body = alterMatch[2];
      for (const colMatch of body.matchAll(/add column(?:\s+if not exists)?\s+(\w+)/gi)) {
        addColumns.push([table, colMatch[1]]);
      }
    }
    return { num, file, createTables: [...new Set(createTables)], addColumns };
  });
}

async function tableExists(table: string): Promise<boolean | string> {
  const { error } = await db.from(table).select('*').limit(1);
  if (error && error.code === 'PGRST205') return false;
  if (error) return `ERROR: ${error.code} ${error.message}`;
  return true;
}

async function columnExists(table: string, column: string): Promise<boolean | string> {
  const { error } = await db.from(table).select(column).limit(1);
  if (error && ['42703', 'PGRST205', 'PGRST204'].includes(error.code)) return false;
  if (error) return `ERROR: ${error.code} ${error.message}`;
  return true;
}

async function main(): Promise<void> {
  console.log(`[audit-migrations] Connected: ${supabaseUrl!.replace(/\/\/.*@/, '//***@')}`);
  console.log(`[audit-migrations] APP_ENV=${process.env.NEXT_PUBLIC_APP_ENV ?? process.env.APP_ENV ?? '(not set)'} — confirm this is really production before trusting the result.\n`);

  const markers = extractMarkers(path.join(ROOT, 'supabase', 'migrations'));
  const rows: Array<{ num: string; file: string; verdict: string; detail?: string }> = [];

  for (const m of markers) {
    if (m.createTables.length > 0) {
      const table = m.createTables[0];
      const exists = await tableExists(table);
      rows.push({
        num: m.num, file: m.file,
        verdict: exists === true ? 'APPLIED' : exists === false ? 'MISSING' : 'ERROR',
        detail: exists === true ? `table ${table}` : exists === false ? `table ${table} not found` : String(exists),
      });
    } else if (m.addColumns.length > 0) {
      const checks = await Promise.all(m.addColumns.map(async ([table, col]) => ({ table, col, exists: await columnExists(table, col) })));
      const allOk = checks.every((c) => c.exists === true);
      const missing = checks.filter((c) => c.exists !== true);
      rows.push({
        num: m.num, file: m.file,
        verdict: allOk ? 'APPLIED' : missing.some((c) => typeof c.exists === 'string') ? 'ERROR' : 'MISSING',
        detail: allOk ? `${checks.length} column(s) present` : missing.map((c) => `${c.table}.${c.col}: ${c.exists}`).join('; '),
      });
    } else {
      rows.push({ num: m.num, file: m.file, verdict: 'UNVERIFIABLE', detail: 'no CREATE TABLE / ADD COLUMN marker (constraint, trigger, function, or data-only migration) — confirm via Supabase migration history instead' });
    }
  }

  for (const r of rows) {
    console.log(`${r.num}  ${r.verdict.padEnd(14)} ${r.file}${r.verdict !== 'APPLIED' ? `\n        ${r.detail}` : ''}`);
  }

  const missing = rows.filter((r) => r.verdict === 'MISSING');
  const errors = rows.filter((r) => r.verdict === 'ERROR');
  const unverifiable = rows.filter((r) => r.verdict === 'UNVERIFIABLE');
  console.log(`\n=== Summary: ${rows.length} migrations checked — ${missing.length} MISSING, ${errors.length} ERROR, ${unverifiable.length} UNVERIFIABLE, ${rows.length - missing.length - errors.length - unverifiable.length} APPLIED ===`);
  if (missing.length > 0) {
    console.log(`\nMISSING (apply these, in order, before activating NEWMODEL): ${missing.map((r) => r.num).join(', ')}`);
  }
}

main().catch((err) => {
  console.error('[audit-migrations] FATAL:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
