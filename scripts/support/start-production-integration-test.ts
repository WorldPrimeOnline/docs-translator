#!/usr/bin/env npx tsx
/**
 * Production integration-test support script (2026-08-08).
 *
 * Bridges a real, already-quoted, UNPAID production order into the same
 * post-payment orchestration a real Halyk payment would trigger — WITHOUT ever
 * touching payment_transactions, fiscal_receipts, price_quotes.status, or
 * workflow_status, and WITHOUT using payment_source='subscription'.
 *
 * Why this is safe (full trace done before writing this script):
 *   - initializeOrderIntegrations() / createPriceBreakdownIssue() /
 *     uploadSourceFilesToDriveFolder() (worker/src/lib/integrations.ts) contain NO
 *     payment check at all. The only payment gate in the whole pipeline is
 *     worker/src/index.ts's isEligible(), which only decides what the LIVE poll
 *     loop picks up — calling these functions directly, here, never touches it.
 *   - The customer dashboard's deriveCustomerStatus() (src/lib/translation-workflow/
 *     customer-order-state.ts) returns 'payment_pending' immediately whenever
 *     jobs.status === 'payment_pending', before ever looking at workflow_status. The
 *     ONLY field that needs to change for the dashboard to start reading
 *     workflow_status (the real Jira-driven progress) is jobs.status itself ->
 *     'completed'. This script changes exactly that one field.
 *   - reconcile-payments (src/app/api/cron/reconcile-payments/route.ts) and the
 *     Webkassa fiscal processor (worker/src/lib/fiscal-processor.ts) both operate
 *     exclusively on payment_transactions/fiscal_receipts rows. This script never
 *     creates either, so neither can ever pick this job up.
 *
 * SAFETY
 *   - Operates on exactly ONE job (--job-id). No bulk mode exists.
 *   - Default: DRY RUN — full read-only precheck, no writes.
 *   - --apply requires CONFIRM_PRODUCTION_INTEGRATION_TEST=true, or refuses outright.
 *   - HARD REFUSES (even under --apply, before any write) if: job/document/quote not
 *     found, quote has no wpo_financial_breakdown_json, ANY payment_transactions row
 *     for this job has status in ('paid','completed'), or ANY fiscal_receipts row
 *     already exists for this job.
 *   - The ONLY Supabase writes under --apply are: jobs.status ('payment_pending' ->
 *     'completed', guarded by .eq('status','payment_pending')) and one
 *     job_audit_log insert. Never payment_transactions, fiscal_receipts,
 *     price_quotes, or workflow_status. Jira/Drive writes go through the exact same
 *     production functions a real paid order uses — never a fabricated payload.
 *   - Idempotent: initializeOrderIntegrations()/createPriceBreakdownIssue() have
 *     their own idempotency checks (return the existing issue/folder instead of
 *     duplicating); uploadSourceFilesToDriveFolder() lists the Drive folder first
 *     and skips files that already exist; the jobs.status update only fires while
 *     status is still 'payment_pending'.
 *   - Test marker: NOT written into customerComment or any customer-facing field
 *     (would pollute real business data). Instead: a job_audit_log row
 *     (action='production_integration_test_started') and, on first creation only,
 *     a Jira label ("production-integration-test") on the main issue — both purely
 *     additive, neither read by payment reconciliation.
 *
 * Usage:
 *   npx tsx scripts/support/start-production-integration-test.ts --job-id <uuid>
 *   npx tsx scripts/support/start-production-integration-test.ts --job-id <uuid> --apply
 *
 * Required env (same as the Railway worker — this dynamically imports
 * worker/src/lib/integrations.ts, which pulls in worker/src/lib/env.ts's schema):
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 *   JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN,
 *   GOOGLE_AUTH_MODE + matching Drive credentials, GOOGLE_DRIVE_ROOT_FOLDER_ID,
 *   R2_*, ANTHROPIC_API_KEY, MISTRAL_API_KEY (required by worker/src/lib/env.ts's
 *   zod schema even though this script never calls OCR/translation).
 */

import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

// ─── Env loading (existing project convention — see inspect-customer-order.ts) ──
const ROOT = path.resolve(process.cwd());
function loadEnvFile(filename: string): boolean {
  const filepath = path.join(ROOT, filename);
  if (fs.existsSync(filepath)) { dotenv.config({ path: filepath, quiet: true }); return true; }
  return false;
}
loadEnvFile('.env.production.local');
loadEnvFile('.env.local');
process.env.NODE_ENV = (process.env.NODE_ENV as 'development' | 'test' | 'production' | undefined) ?? 'production';

const TEST_LABEL = 'production-integration-test';

// ─── CLI args ────────────────────────────────────────────────────────────────
function parseArgs(): { jobId: string | null; apply: boolean } {
  const args = process.argv.slice(2);
  let jobId: string | null = null;
  let apply = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--job-id' && args[i + 1]) jobId = args[++i]!;
    else if (args[i] === '--apply') apply = true;
  }
  return { jobId, apply };
}

function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

async function main(): Promise<void> {
  const { jobId, apply } = parseArgs();

  if (!jobId || !isUuid(jobId)) {
    console.error('[start-integration-test] FATAL: --job-id <uuid> is required');
    console.error('Usage: npx tsx scripts/support/start-production-integration-test.ts --job-id <uuid> [--apply]');
    process.exit(1);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    console.error('[start-integration-test] FATAL: Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createClient(supabaseUrl, serviceKey) as any;

  console.log('[start-integration-test] ─────────────────────────────────────');
  console.log(`[start-integration-test] Job ID : ${jobId}`);
  console.log(`[start-integration-test] Mode   : ${apply ? 'APPLY (will write)' : 'DRY RUN (no writes)'}`);
  console.log('[start-integration-test] ─────────────────────────────────────\n');

  // ─── PRECHECK (always runs, read-only) ────────────────────────────────────
  const problems: string[] = [];

  const { data: job } = await db.from('jobs').select('*').eq('id', jobId).maybeSingle();
  if (!job) problems.push(`job ${jobId} not found`);

  let doc: Record<string, unknown> | null = null;
  if (job) {
    const { data } = await db.from('documents').select('*').eq('id', job.document_id).maybeSingle();
    doc = data;
    if (!doc) problems.push(`document ${job.document_id} not found`);
  }

  const { data: sourceRowsRaw } = await db
    .from('job_source_files')
    .select('*')
    .eq('job_id', jobId)
    .order('sequence', { ascending: true });
  const sourceRows = sourceRowsRaw ?? [];
  if (sourceRows.length === 0 && !doc?.file_key) {
    problems.push('no job_source_files rows AND no documents.file_key — nothing to sync to Drive 01_SOURCE');
  }

  const { data: quote } = await db
    .from('price_quotes')
    .select('id, status, amount_kzt, wpo_financial_breakdown_json, service_level')
    .eq('job_id', jobId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!quote) problems.push('no price_quotes row found for this job');
  const breakdownEmpty = !quote?.wpo_financial_breakdown_json || Object.keys(quote.wpo_financial_breakdown_json).length === 0;
  if (quote && breakdownEmpty) problems.push('price_quotes.wpo_financial_breakdown_json is missing/empty');

  const { data: payments } = await db.from('payment_transactions').select('id, status').eq('job_id', jobId);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const paidPayments = (payments ?? []).filter((p: any) => p.status === 'paid' || p.status === 'completed');
  if (paidPayments.length > 0) {
    problems.push(`CRITICAL: ${paidPayments.length} payment_transactions row(s) already paid/completed for this job — refusing to touch a real paid order`);
  }

  const { data: fiscalRows } = await db.from('fiscal_receipts').select('id, status').eq('job_id', jobId);
  if ((fiscalRows ?? []).length > 0) {
    problems.push(`CRITICAL: ${fiscalRows.length} fiscal_receipts row(s) already exist for this job`);
  }

  // ─── Report current state ──────────────────────────────────────────────────
  console.log('[precheck] job.status                :', job?.status ?? '(n/a)');
  console.log('[precheck] job.workflow_status        :', job?.workflow_status ?? '(n/a)');
  console.log('[precheck] job.service_level          :', job?.service_level ?? '(n/a)');
  console.log('[precheck] job.jira_issue_key         :', job?.jira_issue_key ?? '(none yet)');
  console.log('[precheck] job.price_jira_issue_key   :', job?.price_jira_issue_key ?? '(none yet)');
  console.log('[precheck] job.google_drive_folder_id :', job?.google_drive_folder_id ?? '(none yet)');
  console.log('[precheck] job_source_files count     :', sourceRows.length, sourceRows.length === 0 ? '(legacy single-file path)' : '');
  console.log('[precheck] quote.id                   :', quote?.id ?? '(none)');
  console.log('[precheck] quote.status               :', quote?.status ?? '(n/a)');
  console.log('[precheck] quote.amount_kzt            :', quote?.amount_kzt ?? '(n/a)');
  console.log('[precheck] payment_transactions        :', (payments ?? []).length, 'row(s), paid/completed:', paidPayments.length);
  console.log('[precheck] fiscal_receipts             :', (fiscalRows ?? []).length, 'row(s)');
  console.log('');

  if (problems.length > 0) {
    console.error('[precheck] BLOCKED — cannot proceed:');
    for (const p of problems) console.error(`  ✗ ${p}`);
    process.exit(1);
  }
  console.log('[precheck] ✓ all checks passed\n');

  const wasAlreadyCreated = !!job.jira_issue_key && !!job.google_drive_folder_id;
  if (wasAlreadyCreated) {
    console.log('[start-integration-test] Job already has jira_issue_key + google_drive_folder_id —');
    console.log('  initializeOrderIntegrations() will detect this and return the existing ones (idempotent), not create duplicates.\n');
  }

  if (!apply) {
    console.log('[start-integration-test] DRY RUN — would now:');
    console.log(`  1. Call initializeOrderIntegrations() for job ${jobId} (service_level=${job.service_level})`);
    console.log(`  2. Upload ${sourceRows.length || 1} source file(s) to Drive 01_SOURCE`);
    console.log(`  3. Add Jira label "${TEST_LABEL}" to the main issue (new issue only)`);
    console.log(`  4. UPDATE jobs SET status='completed' WHERE id='${jobId}' AND status='payment_pending'`);
    console.log(`  5. INSERT job_audit_log action='production_integration_test_started'`);
    console.log('\nRe-run with --apply and CONFIRM_PRODUCTION_INTEGRATION_TEST=true to execute.');
    return;
  }

  if (process.env.CONFIRM_PRODUCTION_INTEGRATION_TEST !== 'true') {
    console.error('[start-integration-test] FATAL: --apply requires CONFIRM_PRODUCTION_INTEGRATION_TEST=true');
    process.exit(1);
  }

  console.log('[start-integration-test] ═══ APPLYING ═══\n');

  const { initializeOrderIntegrations, uploadSourceFilesToDriveFolder, addJiraIssueLabel } =
    await import('../../worker/src/lib/integrations');

  const resolvedServiceLevel = job.service_level ?? (job.notarized ? 'notarization_through_partners' : 'electronic');

  const integrationResult = await initializeOrderIntegrations({
    jobId,
    serviceLevel: resolvedServiceLevel,
    sourceLang: doc!.source_language as string,
    targetLang: doc!.target_language as string,
    documentType: doc!.document_type as string,
    notaryCity: job.notary_city ?? null,
    applicantType: job.applicant_type ?? null,
    fulfillmentMethod: job.fulfillment_method ?? null,
    deliveryPhone: job.delivery_phone ?? null,
    deliveryAddress: job.delivery_address ?? null,
    paymentSource: job.payment_source ?? null,
    customerId: doc!.user_id as string,
    sourceFileKey: (doc!.file_key as string | undefined) ?? null,
    skipMergedSourceUpload: sourceRows.length > 0,
    customerComment: job.customer_comment ?? null, // real value only — never overwritten with a test marker
  });

  console.log('[start-integration-test] initializeOrderIntegrations() result:', integrationResult);

  if (sourceRows.length > 0 && integrationResult.sourceFolderId) {
    await uploadSourceFilesToDriveFolder(integrationResult.sourceFolderId, sourceRows, `[integration-test:${jobId.slice(0, 8)}]`);
    console.log(`[start-integration-test] ✓ source file sync done (${sourceRows.length} file(s), idempotent — skips files already in Drive)`);
  }

  if (integrationResult.jiraIssueKey && !wasAlreadyCreated) {
    await addJiraIssueLabel(integrationResult.jiraIssueKey, TEST_LABEL);
    console.log(`[start-integration-test] ✓ label "${TEST_LABEL}" added to ${integrationResult.jiraIssueKey}`);
  }

  // createPriceBreakdownIssue() runs fire-and-forget inside initializeOrderIntegrations —
  // poll briefly for jobs.price_jira_issue_key so this script's own summary is accurate.
  let priceJiraIssueKey: string | null = null;
  for (let i = 0; i < 8; i++) {
    const { data: refreshed } = await db.from('jobs').select('price_jira_issue_key').eq('id', jobId).maybeSingle();
    if (refreshed?.price_jira_issue_key) { priceJiraIssueKey = refreshed.price_jira_issue_key; break; }
    await new Promise((r) => setTimeout(r, 2000));
  }
  console.log(`[start-integration-test] price breakdown issue: ${priceJiraIssueKey ?? '(not yet visible after ~16s — check inspect-customer-order.ts shortly)'}`);

  const previousJobStatus = job.status as string;
  let resultingJobStatus = previousJobStatus;
  if (previousJobStatus === 'payment_pending') {
    const { data: updated, error: updateErr } = await db
      .from('jobs')
      .update({ status: 'completed' })
      .eq('id', jobId)
      .eq('status', 'payment_pending')
      .select('status')
      .maybeSingle();
    if (updateErr) {
      console.error('[start-integration-test] FAILED to update jobs.status:', updateErr.message);
    } else if (updated) {
      resultingJobStatus = updated.status;
      console.log(`[start-integration-test] ✓ jobs.status: payment_pending -> ${resultingJobStatus}`);
    } else {
      console.warn('[start-integration-test] jobs.status update matched 0 rows (changed concurrently?) — re-checking');
      const { data: recheck } = await db.from('jobs').select('status').eq('id', jobId).maybeSingle();
      resultingJobStatus = recheck?.status ?? previousJobStatus;
    }
  } else {
    console.log(`[start-integration-test] jobs.status is already '${previousJobStatus}' (not 'payment_pending') — leaving unchanged`);
  }

  await db.from('job_audit_log').insert({
    job_id: jobId,
    actor: 'support-script',
    source: 'start-production-integration-test',
    action: 'production_integration_test_started',
    previous_status: previousJobStatus,
    new_status: resultingJobStatus,
    jira_issue_key: integrationResult.jiraIssueKey,
    metadata: {
      previous_job_status: previousJobStatus,
      resulting_job_status: resultingJobStatus,
      quote_id: quote.id,
      jira_issue_key: integrationResult.jiraIssueKey,
      drive_folder_id: integrationResult.driveFolderId,
      timestamp: new Date().toISOString(),
      marker: 'production_integration_test',
    },
  });
  console.log('[start-integration-test] ✓ job_audit_log entry written\n');

  console.log('[start-integration-test] ═══ SUMMARY ═══');
  console.log('  jira_issue_key       :', integrationResult.jiraIssueKey);
  console.log('  jira_issue_url       :', integrationResult.jiraIssueUrl);
  console.log('  price_jira_issue_key :', priceJiraIssueKey);
  console.log('  drive_folder_id      :', integrationResult.driveFolderId);
  console.log('  drive_url            :', integrationResult.driveUrl);
  console.log('  jobs.status          :', previousJobStatus, '->', resultingJobStatus);
  console.log('\nNever touched: payment_transactions, fiscal_receipts, price_quotes.status, workflow_status.');
}

main().catch((err) => {
  console.error('[start-integration-test] Unexpected error:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
