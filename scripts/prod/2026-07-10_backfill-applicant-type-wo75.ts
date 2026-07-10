#!/usr/bin/env npx tsx
/**
 * One-time backfill: add the customer's applicant type (individual vs legal
 * entity) to the main Jira issue for job 16a6e84d-6d3d-4728-9938-83ca93970001
 * (Jira WO-75) as a comment. 2026-07-10.
 *
 * Root cause: the applicant type is captured on the order form and used as a
 * pricing input (src/lib/pricing/calculator.ts — determines the notary official
 * fee tier via NOTARY_APPLICANT_MRP_COEFFICIENT), but was only ever persisted
 * to order_drafts.applicant_type (migration 0044) — never copied into jobs, so
 * it never reached the worker's Jira issue creation. Fixed going forward via
 * migration 0046 (jobs.applicant_type) + worker/src/lib/integrations.ts (now
 * includes "Тип заказчика для нотариального тарифа: ..." in the description of
 * every newly-created notarized Jira issue, via
 * worker/src/lib/jira/order-fields.ts buildApplicantTypeDescriptionLine()).
 *
 * WO-75 was created before this fix, so its jobs.applicant_type is NULL even
 * after migration 0046 runs — this script recovers the original value from
 * order_drafts (the draft that converted into this job) and, only if found,
 * backfills jobs.applicant_type and adds a comment to the Jira issue. It never
 * fabricates a value — if no recorded choice exists anywhere, it reports that
 * and does nothing.
 *
 * SAFETY:
 *   - Default mode is DRY RUN — prints every action it would take, writes nothing.
 *   - Requires --apply AND the env var CONFIRM_PRODUCTION_WRITE=true to write anything.
 *   - Idempotent: checks existing Jira comments for this exact line before
 *     posting — never adds a duplicate comment on rerun.
 *   - Does not touch price_quotes, payment_transactions, pricing, Drive, R2, or
 *     any other Jira field.
 *
 * Usage:
 *   npx tsx scripts/prod/2026-07-10_backfill-applicant-type-wo75.ts --env-file <path>
 *   npx tsx scripts/prod/2026-07-10_backfill-applicant-type-wo75.ts --env-file <path> --apply
 *   npx tsx scripts/prod/2026-07-10_backfill-applicant-type-wo75.ts --job-id <uuid> --env-file <path>
 *
 * Required env vars:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN
 *
 * Do NOT run --apply until the dry-run output has been reviewed and approved.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

const WO75_JOB_ID_DEFAULT = '16a6e84d-6d3d-4728-9938-83ca93970001';

function parseArgs(): { jobId: string; apply: boolean; envFile: string | null } {
  const args = process.argv.slice(2);
  let jobId = WO75_JOB_ID_DEFAULT;
  let apply = false;
  let envFile: string | null = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--job-id' && args[i + 1]) jobId = args[++i]!;
    if (args[i] === '--apply') apply = true;
    if (args[i] === '--env-file' && args[i + 1]) envFile = args[++i]!;
  }
  return { jobId, apply, envFile };
}

const { jobId: JOB_ID, apply: APPLY, envFile: ENV_FILE } = parseArgs();

if (ENV_FILE && fs.existsSync(path.resolve(ENV_FILE))) {
  dotenv.config({ path: path.resolve(ENV_FILE) });
  console.log(`[backfill-applicant-type] loaded env from ${ENV_FILE}`);
} else {
  console.log('[backfill-applicant-type] no --env-file given — relying on shell environment only');
}

if (APPLY && process.env.CONFIRM_PRODUCTION_WRITE !== 'true') {
  console.error(
    '[backfill-applicant-type] REFUSED: --apply requires CONFIRM_PRODUCTION_WRITE=true to be set explicitly. ' +
    'Run without --apply first and review the dry-run output.',
  );
  process.exit(1);
}

type ApplicantType = 'individual' | 'legal_entity' | 'unknown';

async function main(): Promise<void> {
  const { buildApplicantTypeDescriptionLine } = await import('../../worker/src/lib/jira/order-fields');
  const { createClient } = await import('@supabase/supabase-js');

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    console.error('[backfill-applicant-type] FATAL: Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createClient(supabaseUrl, serviceKey) as any;

  const jiraBaseUrl = process.env.JIRA_BASE_URL?.replace(/\/$/, '');
  const jiraEmail = process.env.JIRA_EMAIL;
  const jiraToken = process.env.JIRA_API_TOKEN;
  if (!jiraBaseUrl || !jiraEmail || !jiraToken) {
    console.error('[backfill-applicant-type] FATAL: JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN must be set');
    process.exit(1);
  }
  const authHeader = 'Basic ' + Buffer.from(`${jiraEmail}:${jiraToken}`).toString('base64');

  async function jiraFetch(urlPath: string, options: RequestInit = {}): Promise<Response> {
    return fetch(`${jiraBaseUrl}/rest/api/3${urlPath}`, {
      ...options,
      headers: {
        Authorization: authHeader,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(options.headers as Record<string, string> ?? {}),
      },
    });
  }

  console.log(`\n[backfill-applicant-type] job=${JOB_ID} mode=${APPLY ? 'APPLY' : 'DRY RUN'}\n`);

  const { data: job, error: jobErr } = await db
    .from('jobs')
    .select('id, service_level, applicant_type, jira_issue_key')
    .eq('id', JOB_ID)
    .maybeSingle();

  if (jobErr || !job) {
    console.error('[backfill-applicant-type] job not found:', jobErr?.message ?? JOB_ID);
    process.exit(1);
  }

  console.log('════════════════════════════════════════════════════════════');
  console.log('SECTION 1 — CURRENT DB STATE');
  console.log('════════════════════════════════════════════════════════════');
  console.log({
    jobId: job.id,
    serviceLevel: job.service_level,
    jobsApplicantType: job.applicant_type,
    jiraIssueKey: job.jira_issue_key,
  });
  console.log('');

  if (!job.jira_issue_key) {
    console.error('[backfill-applicant-type] job has no jira_issue_key — nothing to comment on.');
    process.exit(1);
  }

  let applicantType: ApplicantType | null = job.applicant_type ?? null;
  let source = 'jobs.applicant_type';

  if (!applicantType) {
    const { data: draft } = await db
      .from('order_drafts')
      .select('id, applicant_type')
      .eq('converted_job_id', JOB_ID)
      .maybeSingle();

    console.log('════════════════════════════════════════════════════════════');
    console.log('SECTION 2 — FALLBACK LOOKUP (order_drafts)');
    console.log('════════════════════════════════════════════════════════════');
    console.log({ draftId: draft?.id ?? null, draftApplicantType: draft?.applicant_type ?? null });
    console.log('');

    if (draft?.applicant_type) {
      applicantType = draft.applicant_type as ApplicantType;
      source = `order_drafts.applicant_type (draft ${draft.id})`;
    }
  }

  console.log('════════════════════════════════════════════════════════════');
  console.log('SECTION 3 — PLAN');
  console.log('════════════════════════════════════════════════════════════');

  if (!applicantType) {
    console.log('plan: NO-OP — no recorded applicant type found in jobs or order_drafts. Not fabricating a value. Nothing to add to Jira.');
    return;
  }

  console.log(`resolved applicantType: ${applicantType} (source: ${source})`);

  const line = buildApplicantTypeDescriptionLine(job.service_level, applicantType);
  if (!line) {
    console.log(`plan: NO-OP — service_level="${job.service_level}" is not notarization_through_partners; the two-tier notary fee (and this line) does not apply.`);
    return;
  }
  console.log(`comment text: "${line}"`);

  const needsJobsBackfill = !job.applicant_type;
  console.log(`jobs.applicant_type would be backfilled: ${needsJobsBackfill} (${needsJobsBackfill ? `null → "${applicantType}"` : 'already set, no write needed'})`);

  // ── Idempotency: check existing comments before posting ────────────────────
  const commentsRes = await jiraFetch(`/issue/${job.jira_issue_key}/comment?maxResults=100`);
  if (!commentsRes.ok) {
    const text = await commentsRes.text().catch(() => '');
    console.error(`\n[backfill-applicant-type] FATAL: could not read existing comments — ${commentsRes.status} ${text.slice(0, 300)}`);
    console.error('[backfill-applicant-type] Refusing to post without verifying idempotency first (same reasoning as the price breakdown search fix).');
    process.exit(1);
  }
  const commentsData = await commentsRes.json() as { comments: Array<{ body: unknown }> };
  const alreadyPresent = commentsData.comments.some((c) => JSON.stringify(c.body).includes('Тип заказчика для нотариального тарифа'));

  console.log(`existing comment with this line already present: ${alreadyPresent}`);

  if (alreadyPresent) {
    console.log('plan: NO-OP — a comment with this line already exists on the issue.');
    return;
  }
  console.log(`plan: ${needsJobsBackfill ? 'BACKFILL jobs.applicant_type + ' : ''}ADD COMMENT to ${job.jira_issue_key}`);

  if (!APPLY) {
    console.log('\n[backfill-applicant-type] DRY RUN — stopping here. No writes performed.\n');
    return;
  }

  if (needsJobsBackfill) {
    const { error: updateErr } = await db
      .from('jobs')
      .update({ applicant_type: applicantType })
      .eq('id', JOB_ID)
      .is('applicant_type', null); // idempotency guard even under --apply
    if (updateErr) {
      console.error('[backfill-applicant-type] FAILED to update jobs.applicant_type:', updateErr.message);
      process.exit(1);
    }
    console.log(`[backfill-applicant-type] ✓ jobs.applicant_type set to "${applicantType}"`);
  }

  const commentRes = await jiraFetch(`/issue/${job.jira_issue_key}/comment`, {
    method: 'POST',
    body: JSON.stringify({
      body: {
        type: 'doc',
        version: 1,
        content: [{ type: 'paragraph', content: [{ type: 'text', text: line }] }],
      },
    }),
  });
  if (!commentRes.ok) {
    const text = await commentRes.text().catch(() => '');
    console.error(`[backfill-applicant-type] FAILED to add comment: ${commentRes.status} ${text.slice(0, 300)}`);
    process.exit(1);
  }
  console.log(`[backfill-applicant-type] ✓ comment added to ${job.jira_issue_key}`);
}

main().catch((err) => {
  console.error('[backfill-applicant-type] FATAL:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
