#!/usr/bin/env npx tsx
/**
 * One-time backfill: retroactively show notary urgency (same_day, multiplier
 * 1.0, 0 KZT surcharge) on the main Jira issue (WO-77) and the Price Breakdown
 * Story (WO-79) for job 023955c9-5d88-43c6-bf34-0be2a4912a86. 2026-07-15.
 *
 * Root cause: the customer's same-day notary urgency selection was priced
 * CORRECTLY (multiplier 1.0, 0 KZT surcharge — before the 12:00 Almaty cutoff),
 * but only ever persisted to price_quotes.pricing_context_json.notaryCutoff —
 * jobs had no column for it and the worker's Jira issue creation never read it.
 * Fixed going forward via migration 0048 (jobs.notary_urgency_*) +
 * worker/src/lib/integrations.ts (now includes 5 explicit
 * "Срочность нотариального оформления: ..." lines in the description of every
 * newly-created notarized Jira issue, and the Price Breakdown Story now shows
 * General translation urgency / Notary urgency / Effective window / Multiplier
 * / Surcharge as distinct rows — see worker/src/lib/jira/order-fields.ts
 * buildNotaryUrgencyDescriptionLines() and worker/src/lib/jira/price-breakdown.ts).
 *
 * WO-77/WO-79 were created before this fix, so jobs.notary_urgency_* is NULL
 * even after migration 0048 runs. This script:
 *   1. Resolves the immutable urgency snapshot from price_quotes (never
 *      recomputes via getNotaryCutoffWindow() — that would use the CURRENT
 *      time, not the time the order was actually quoted).
 *   2. Backfills jobs.notary_urgency_* from that snapshot (only if still NULL).
 *   3. Adds a COMMENT (never edits the existing description — same reasoning
 *      as the WO-75 applicant-type backfill: a comment can never corrupt
 *      existing content) with the 5 urgency lines to the main Jira issue.
 *   4. Adds a COMMENT with the urgency breakdown to the Price Breakdown Story,
 *      if jobs.price_jira_issue_key is set.
 *
 * SAFETY:
 *   - Default mode is DRY RUN — prints every action it would take, writes nothing.
 *   - Requires --apply AND the env var CONFIRM_PRODUCTION_WRITE=true to write anything.
 *   - Idempotent: checks existing Jira comments on each issue for the exact
 *     first urgency line before posting — never adds a duplicate comment on rerun.
 *   - Only ever writes jobs.notary_urgency_* (guarded by `.is(..., null)`, so it
 *     can never overwrite an already-backfilled value) and posts comments.
 *     Never touches price_kzt, payment_transactions, workflow_status, jira_sync_status,
 *     or any existing Jira field (assignee, status, custom fields, description).
 *
 * Usage:
 *   npx tsx scripts/prod/2026-07-15_backfill-notary-urgency-wo77.ts --env-file <path>
 *   npx tsx scripts/prod/2026-07-15_backfill-notary-urgency-wo77.ts --env-file <path> --apply
 *   npx tsx scripts/prod/2026-07-15_backfill-notary-urgency-wo77.ts --job-id <uuid> --env-file <path>
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

const WO77_JOB_ID_DEFAULT = '023955c9-5d88-43c6-bf34-0be2a4912a86';

function parseArgs(): { jobId: string; apply: boolean; envFile: string | null } {
  const args = process.argv.slice(2);
  let jobId = WO77_JOB_ID_DEFAULT;
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
  console.log(`[backfill-notary-urgency] loaded env from ${ENV_FILE}`);
} else {
  console.log('[backfill-notary-urgency] no --env-file given — relying on shell environment only');
}

if (APPLY && process.env.CONFIRM_PRODUCTION_WRITE !== 'true') {
  console.error(
    '[backfill-notary-urgency] REFUSED: --apply requires CONFIRM_PRODUCTION_WRITE=true to be set explicitly. ' +
    'Run without --apply first and review the dry-run output.',
  );
  process.exit(1);
}

async function main(): Promise<void> {
  const { resolveNotaryUrgencySnapshot } = await import('../../worker/src/lib/notary-urgency');
  const { buildNotaryUrgencyDescriptionLines } = await import('../../worker/src/lib/jira/order-fields');
  const { createClient } = await import('@supabase/supabase-js');

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    console.error('[backfill-notary-urgency] FATAL: Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createClient(supabaseUrl, serviceKey) as any;

  const jiraBaseUrl = process.env.JIRA_BASE_URL?.replace(/\/$/, '');
  const jiraEmail = process.env.JIRA_EMAIL;
  const jiraToken = process.env.JIRA_API_TOKEN;
  if (!jiraBaseUrl || !jiraEmail || !jiraToken) {
    console.error('[backfill-notary-urgency] FATAL: JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN must be set');
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

  console.log(`\n[backfill-notary-urgency] job=${JOB_ID} mode=${APPLY ? 'APPLY' : 'DRY RUN'}\n`);

  const { data: job, error: jobErr } = await db
    .from('jobs')
    .select('id, service_level, jira_issue_key, price_jira_issue_key, notary_urgency_level, notary_urgency_window, notary_urgency_multiplier, notary_urgency_cutoff_at, notary_urgency_fee_kzt')
    .eq('id', JOB_ID)
    .maybeSingle();

  if (jobErr || !job) {
    console.error('[backfill-notary-urgency] job not found (or migration 0048 not yet applied in this environment):', jobErr?.message ?? JOB_ID);
    process.exit(1);
  }

  console.log('════════════════════════════════════════════════════════════');
  console.log('SECTION 1 — CURRENT DB STATE');
  console.log('════════════════════════════════════════════════════════════');
  console.log({
    jobId: job.id,
    serviceLevel: job.service_level,
    jiraIssueKey: job.jira_issue_key,
    priceJiraIssueKey: job.price_jira_issue_key,
    jobsNotaryUrgencyLevel: job.notary_urgency_level,
  });
  console.log('');

  if (job.service_level !== 'notarization_through_partners') {
    console.log(`[backfill-notary-urgency] plan: NO-OP — service_level="${job.service_level}" is not notarization_through_partners; notary urgency does not apply.`);
    return;
  }

  if (!job.jira_issue_key) {
    console.error('[backfill-notary-urgency] job has no jira_issue_key — nothing to comment on. Use the missing-issue recovery tool first if the main issue itself is missing.');
    process.exit(1);
  }

  const { data: quoteRow } = await db
    .from('price_quotes')
    .select('id, pricing_context_json, breakdown_json')
    .eq('job_id', JOB_ID)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  console.log('════════════════════════════════════════════════════════════');
  console.log('SECTION 2 — QUOTE SNAPSHOT (immutable, read-only)');
  console.log('════════════════════════════════════════════════════════════');
  console.log({ quoteId: quoteRow?.id ?? null, notaryCutoff: quoteRow?.pricing_context_json?.notaryCutoff ?? null });
  console.log('');

  const snapshot = resolveNotaryUrgencySnapshot(
    {
      notary_urgency_level: job.notary_urgency_level,
      notary_urgency_window: job.notary_urgency_window,
      notary_urgency_multiplier: job.notary_urgency_multiplier,
      notary_urgency_cutoff_at: job.notary_urgency_cutoff_at,
      notary_urgency_fee_kzt: job.notary_urgency_fee_kzt,
    },
    quoteRow ? { pricingContextJson: quoteRow.pricing_context_json ?? {}, breakdownJson: quoteRow.breakdown_json ?? {} } : null,
  );

  console.log('════════════════════════════════════════════════════════════');
  console.log('SECTION 3 — RESOLVED SNAPSHOT + PLAN');
  console.log('════════════════════════════════════════════════════════════');

  if (!snapshot) {
    console.log('plan: NO-OP — no notary urgency data found in jobs or price_quotes. Not fabricating a value. Nothing to add to Jira.');
    return;
  }
  console.log('resolved snapshot:', snapshot);

  const lines = buildNotaryUrgencyDescriptionLines('notarization_through_partners', snapshot);
  console.log('comment lines (main issue):');
  lines.forEach((l) => console.log(`  ${l}`));

  const needsJobsBackfill = job.notary_urgency_level == null;
  console.log(`jobs.notary_urgency_* would be backfilled: ${needsJobsBackfill} (${needsJobsBackfill ? 'null → resolved snapshot' : 'already set, no write needed'})`);

  // ── Idempotency: check existing comments on the main issue before posting ──
  const commentsRes = await jiraFetch(`/issue/${job.jira_issue_key}/comment?maxResults=100`);
  if (!commentsRes.ok) {
    const text = await commentsRes.text().catch(() => '');
    console.error(`\n[backfill-notary-urgency] FATAL: could not read existing comments on ${job.jira_issue_key} — ${commentsRes.status} ${text.slice(0, 300)}`);
    console.error('[backfill-notary-urgency] Refusing to post without verifying idempotency first.');
    process.exit(1);
  }
  const commentsData = await commentsRes.json() as { comments: Array<{ body: unknown }> };
  const mainAlreadyPresent = commentsData.comments.some((c) => JSON.stringify(c.body).includes('Срочность нотариального оформления'));
  console.log(`existing comment with this line already present on ${job.jira_issue_key}: ${mainAlreadyPresent}`);

  // ── Price Breakdown Story (WO-79) — separate idempotency check ─────────────
  let priceBreakdownAlreadyPresent = true;
  let priceBreakdownLines: string[] = [];
  if (job.price_jira_issue_key) {
    priceBreakdownLines = [
      `Notary urgency: ${snapshot.level}`,
      `Effective notary window: ${snapshot.window}`,
      `Notary urgency multiplier: ×${snapshot.multiplier.toFixed(1)}`,
      `Notary urgency surcharge: ${snapshot.feeKzt.toFixed(2)} KZT`,
    ];
    const pbCommentsRes = await jiraFetch(`/issue/${job.price_jira_issue_key}/comment?maxResults=100`);
    if (!pbCommentsRes.ok) {
      const text = await pbCommentsRes.text().catch(() => '');
      console.error(`\n[backfill-notary-urgency] FATAL: could not read existing comments on ${job.price_jira_issue_key} — ${pbCommentsRes.status} ${text.slice(0, 300)}`);
      process.exit(1);
    }
    const pbCommentsData = await pbCommentsRes.json() as { comments: Array<{ body: unknown }> };
    priceBreakdownAlreadyPresent = pbCommentsData.comments.some((c) => JSON.stringify(c.body).includes('Notary urgency multiplier'));
    console.log(`existing comment with this line already present on ${job.price_jira_issue_key}: ${priceBreakdownAlreadyPresent}`);
  } else {
    console.log('job.price_jira_issue_key is not set — no Price Breakdown Story to comment on.');
  }

  console.log('');
  console.log(`plan: ${needsJobsBackfill ? 'BACKFILL jobs.notary_urgency_* + ' : ''}${mainAlreadyPresent ? 'SKIP comment on ' : 'ADD COMMENT to '}${job.jira_issue_key}${job.price_jira_issue_key ? (priceBreakdownAlreadyPresent ? ` + SKIP comment on ${job.price_jira_issue_key}` : ` + ADD COMMENT to ${job.price_jira_issue_key}`) : ''}`);

  if (!APPLY) {
    console.log('\n[backfill-notary-urgency] DRY RUN — stopping here. No writes performed.\n');
    return;
  }

  if (needsJobsBackfill) {
    const { error: updateErr } = await db
      .from('jobs')
      .update({
        notary_urgency_level: snapshot.level,
        notary_urgency_window: snapshot.window,
        notary_urgency_multiplier: snapshot.multiplier,
        notary_urgency_cutoff_at: snapshot.cutoffAt,
        notary_urgency_fee_kzt: snapshot.feeKzt,
      })
      .eq('id', JOB_ID)
      .is('notary_urgency_level', null); // idempotency guard even under --apply
    if (updateErr) {
      console.error('[backfill-notary-urgency] FAILED to update jobs.notary_urgency_*:', updateErr.message);
      process.exit(1);
    }
    console.log('[backfill-notary-urgency] ✓ jobs.notary_urgency_* backfilled');
  }

  if (!mainAlreadyPresent) {
    const commentRes = await jiraFetch(`/issue/${job.jira_issue_key}/comment`, {
      method: 'POST',
      body: JSON.stringify({
        body: {
          type: 'doc',
          version: 1,
          content: lines.map((text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })),
        },
      }),
    });
    if (!commentRes.ok) {
      const text = await commentRes.text().catch(() => '');
      console.error(`[backfill-notary-urgency] FAILED to add comment to ${job.jira_issue_key}: ${commentRes.status} ${text.slice(0, 300)}`);
      process.exit(1);
    }
    console.log(`[backfill-notary-urgency] ✓ comment added to ${job.jira_issue_key}`);
  }

  if (job.price_jira_issue_key && !priceBreakdownAlreadyPresent) {
    const pbCommentRes = await jiraFetch(`/issue/${job.price_jira_issue_key}/comment`, {
      method: 'POST',
      body: JSON.stringify({
        body: {
          type: 'doc',
          version: 1,
          content: priceBreakdownLines.map((text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })),
        },
      }),
    });
    if (!pbCommentRes.ok) {
      const text = await pbCommentRes.text().catch(() => '');
      console.error(`[backfill-notary-urgency] FAILED to add comment to ${job.price_jira_issue_key}: ${pbCommentRes.status} ${text.slice(0, 300)}`);
      process.exit(1);
    }
    console.log(`[backfill-notary-urgency] ✓ comment added to ${job.price_jira_issue_key}`);
  }
}

main().catch((err) => {
  console.error('[backfill-notary-urgency] FATAL:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
