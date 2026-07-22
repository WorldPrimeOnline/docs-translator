#!/usr/bin/env npx tsx
/**
 * Read-only diagnosis for the "Failed to create job" 500 reported on staging
 * POST /api/documents/upload-card/complete (2026-07-22 incident).
 *
 * Finds the most recent documents rows and prints their full state plus any
 * related jobs/document_analysis/price_quotes rows, so a stuck attempt (document
 * created, job insert failed) is visible even without Vercel runtime logs.
 * Never writes anything.
 *
 * Usage:
 *   npx tsx scripts/staging/diagnose-upload-card-complete-500.ts [--limit 10]
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
console.log(`[diagnose] APP_ENV: ${appEnv}`);
if (appEnv === 'production') {
  console.error('[diagnose] REFUSED: this script must never run against production.');
  process.exit(1);
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceKey) {
  console.error('[diagnose] FATAL: Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
console.log(`[diagnose] Supabase host: ${supabaseUrl.replace(/\/\/.*@/, '//***@')}`);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = createClient(supabaseUrl, serviceKey) as any;

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : fallback;
}

async function main(): Promise<void> {
  const limit = Number(arg('limit', '10'));

  console.log(`\n=== Last ${limit} documents rows ===`);
  const { data: docs, error: docsErr } = await db
    .from('documents')
    .select('id, user_id, filename, source_language, target_language, document_type, status, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (docsErr) { console.error('  ERROR:', docsErr.code, docsErr.message, docsErr.details, docsErr.hint); process.exit(1); }
  if (!docs || docs.length === 0) { console.log('  no documents found.'); return; }

  for (const doc of docs) {
    console.log(`\n--- documents.id=${doc.id} ---`);
    console.log(`  filename=${doc.filename}  status=${doc.status}  service_level(document_type)=${doc.document_type}  created_at=${doc.created_at}`);

    const { data: job, error: jobErr } = await db
      .from('jobs')
      .select('id, status, service_level, price_kzt, created_at')
      .eq('document_id', doc.id)
      .maybeSingle();
    if (jobErr) console.log(`  jobs: ERROR ${jobErr.code} ${jobErr.message}`);
    else console.log(`  jobs: ${job ? `id=${job.id} status=${job.status} service_level=${job.service_level} price_kzt=${job.price_kzt}` : 'NONE — job insert never succeeded for this document'}`);

    const { data: analysisRows, error: analysisErr } = await db
      .from('document_analysis')
      .select('id, revision, status, method, source_character_count_with_spaces, physical_page_count, failure_reason, created_at')
      .eq('document_id', doc.id)
      .order('revision', { ascending: false });
    if (analysisErr) console.log(`  document_analysis: ERROR ${analysisErr.code} ${analysisErr.message}`);
    else if (!analysisRows || analysisRows.length === 0) console.log('  document_analysis: NONE (electronic, or analysis step never ran)');
    else for (const a of analysisRows) console.log(`  document_analysis: revision=${a.revision} status=${a.status} method=${a.method} chars=${a.source_character_count_with_spaces} pages=${a.physical_page_count} failure_reason=${a.failure_reason ?? '(none)'}`);

    if (job) {
      const { data: quote, error: quoteErr } = await db
        .from('price_quotes')
        .select('id, status, amount_kzt, analysis_id, source_character_count_with_spaces, physical_page_count, formula_version')
        .eq('job_id', job.id)
        .maybeSingle();
      if (quoteErr) console.log(`  price_quotes: ERROR ${quoteErr.code} ${quoteErr.message}`);
      else console.log(`  price_quotes: ${quote ? `id=${quote.id} status=${quote.status} amount_kzt=${quote.amount_kzt} analysis_id=${quote.analysis_id} formula_version=${quote.formula_version}` : 'NONE'}`);
    }
  }

  console.log('\n=== Done. No writes performed. ===');
}

main().catch((err) => {
  console.error('[diagnose] FATAL:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
