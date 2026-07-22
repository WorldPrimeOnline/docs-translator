#!/usr/bin/env npx tsx
/**
 * Read-only lookup: given a jobs.id, finds the order_draft that converted into it
 * (order_drafts.converted_job_id) and reports its file_keys — specifically how many
 * upload records/file keys it contains, and (for drafts completed after the 2026-07-29
 * dedup fix) the sourceUploadCount/sourceUploadIds/sourceContentHashes provenance fields.
 *
 * Built for the 2026-07-29 incident investigation (stale/duplicated draft uploads after
 * a pricing failure). Never writes anything.
 *
 * Usage:
 *   npx tsx scripts/prod/inspect-draft-for-job.ts <jobId>
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

const jobId = process.argv[2];
if (!jobId) {
  console.error('Usage: npx tsx scripts/prod/inspect-draft-for-job.ts <jobId>');
  process.exit(1);
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceKey) {
  console.error('[inspect-draft-for-job] FATAL: Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  console.error('  vercel env pull .env.production.local --environment=production');
  process.exit(1);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = createClient(supabaseUrl, serviceKey) as any;

async function main(): Promise<void> {
  console.log(`[inspect-draft-for-job] Connected: ${supabaseUrl!.replace(/\/\/.*@/, '//***@')}`);

  const { data: job, error: jobError } = await db
    .from('jobs')
    .select('id, document_id, status, service_level, price_kzt, notarized, created_at')
    .eq('id', jobId)
    .maybeSingle();
  if (jobError) { console.error('Could not query jobs:', jobError.message); process.exit(1); }
  console.log('\n=== jobs row ===');
  console.log(job ?? '(not found)');

  const { data: doc, error: docError } = await db
    .from('documents')
    .select('id, file_key, source_language, target_language, status, created_at')
    .eq('id', job?.document_id)
    .maybeSingle();
  if (docError) console.error('Could not query documents:', docError.message);
  console.log('\n=== documents row ===');
  console.log(doc ?? '(not found)');

  const { data: analysis, error: analysisError } = await db
    .from('document_analysis')
    .select('id, revision, status, method, source_character_count_with_spaces, physical_page_count, failure_reason, created_at')
    .eq('document_id', job?.document_id)
    .order('revision', { ascending: true });
  if (analysisError) console.error('Could not query document_analysis:', analysisError.message);
  console.log('\n=== document_analysis rows (all revisions) ===');
  console.log(analysis ?? '(none)');

  const { data: draft, error: draftError } = await db
    .from('order_drafts')
    .select('id, status, file_keys, analysis_snapshot, pricing_snapshot, converted_job_id, converted_document_id, created_at, updated_at')
    .eq('converted_job_id', jobId)
    .maybeSingle();
  if (draftError) { console.error('Could not query order_drafts:', draftError.message); process.exit(1); }

  console.log('\n=== order_drafts row (converted_job_id match) ===');
  if (!draft) {
    console.log('(no draft found with converted_job_id = this job — job may not have originated from the public draft flow)');
    return;
  }
  console.log('draft id:', draft.id, ' status:', draft.status, ' created_at:', draft.created_at, ' updated_at:', draft.updated_at);
  console.log(`\nfile_keys: ${Array.isArray(draft.file_keys) ? draft.file_keys.length : 0} entries`);
  console.log(JSON.stringify(draft.file_keys, null, 2));
  console.log('\nanalysis_snapshot:');
  console.log(JSON.stringify(draft.analysis_snapshot, null, 2));
}

main().catch((err) => {
  console.error('[inspect-draft-for-job] FATAL:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
