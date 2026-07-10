#!/usr/bin/env npx tsx
/**
 * One-time backfill for a missing Jira Price Breakdown issue (WO-75 incident,
 * 2026-07-09 — follow-up found after the Drive/Jira/quote repair).
 *
 * Root cause: worker/src/lib/integrations.ts initializeOrderIntegrations() creates
 * the price breakdown issue fire-and-forget (`void (async () => {...})()`) right
 * after the main Jira issue, deliberately non-blocking so a slow/failed Jira call
 * never delays OCR start. That's normally safe in a long-running worker process
 * (unlike a Vercel serverless function, there's no "response returned, promise
 * frozen" risk) — but if the worker process restarts while that promise is still
 * in flight, the side effect is lost with nothing else ever retrying it. That's
 * exactly what happened to WO-75: the worker was restarted during the Drive OAuth
 * incident response while WO-75 was mid-pipeline, so its main issue (WO-75) got
 * created but the price breakdown issue never did.
 *
 * Fix going forward: worker/src/lib/integrations.ts now exports
 * reconcilePendingPriceBreakdownIssues(), run every 15 minutes from
 * worker/src/index.ts, which finds jobs with a main Jira issue but no price
 * breakdown issue and retries via the same idempotent createPriceBreakdownIssue().
 * This script is the one-off manual repair for WO-75 specifically (and reusable
 * for any other job via --job-id), for right now rather than waiting on the
 * next reconciliation cycle.
 *
 * Reuses the exact same pure mapping/description/payload-building functions as
 * production (worker/src/lib/jira/price-breakdown.ts) and the exact idempotency
 * strategy already proven in scripts/staging/rebuild-jira-price-breakdown.ts:
 * DB check (jobs.price_jira_issue_key) first, then Jira search by
 * label=wpo-price-breakdown + summary="Price Breakdown for WO-XXX" as a fallback,
 * before ever creating a new issue.
 *
 * SAFETY:
 *   - Default mode is DRY RUN — prints every action it would take, writes nothing.
 *   - Requires --apply AND the env var CONFIRM_PRODUCTION_WRITE=true to write anything.
 *   - Idempotent: adopts an existing issue (DB or Jira search) instead of creating
 *     a duplicate; never deletes issues.
 *   - Does not touch payment_transactions, price_quotes, jobs.status, Drive, or R2.
 *
 * Usage:
 *   npx tsx scripts/prod/2026-07-09_backfill-price-breakdown-wo75.ts --env-file <path>
 *   npx tsx scripts/prod/2026-07-09_backfill-price-breakdown-wo75.ts --env-file <path> --apply
 *   npx tsx scripts/prod/2026-07-09_backfill-price-breakdown-wo75.ts --job-id <uuid> --env-file <path>
 *
 * Required env vars:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN
 *   JIRA_PRICE_BREAKDOWN_ISSUE_ENABLED=true (same flag production checks — if this
 *     isn't 'true' the script still runs, since a manual one-off repair shouldn't
 *     be silently gated by the same feature flag that controls the automatic path,
 *     but it prints a warning so you know the automatic path is off)
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
  console.log(`[backfill-price-breakdown] loaded env from ${ENV_FILE}`);
} else {
  console.log('[backfill-price-breakdown] no --env-file given — relying on shell environment only');
}

if (APPLY && process.env.CONFIRM_PRODUCTION_WRITE !== 'true') {
  console.error(
    '[backfill-price-breakdown] REFUSED: --apply requires CONFIRM_PRODUCTION_WRITE=true to be set explicitly. ' +
    'Run without --apply first and review the dry-run output.',
  );
  process.exit(1);
}

async function main(): Promise<void> {
  const {
    mapPriceQuote,
    mapPriceQuoteItem,
    mapCostReservation,
    buildPriceBreakdownDescription,
    getPriceBreakdownConfig,
    buildPriceBreakdownSummary,
  } = await import('../../worker/src/lib/jira/price-breakdown');
  const { searchJiraIssuesByJql } = await import('../../worker/src/lib/jira/search');
  const { createClient } = await import('@supabase/supabase-js');

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    console.error('[backfill-price-breakdown] FATAL: Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createClient(supabaseUrl, serviceKey) as any;

  const jiraBaseUrl = process.env.JIRA_BASE_URL?.replace(/\/$/, '');
  const jiraEmail = process.env.JIRA_EMAIL;
  const jiraToken = process.env.JIRA_API_TOKEN;
  if (!jiraBaseUrl || !jiraEmail || !jiraToken) {
    console.error('[backfill-price-breakdown] FATAL: JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN must be set');
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

  const config = getPriceBreakdownConfig();
  console.log(`\n[backfill-price-breakdown] job=${JOB_ID} mode=${APPLY ? 'APPLY' : 'DRY RUN'}`);
  console.log(`[backfill-price-breakdown] JIRA_PRICE_BREAKDOWN_ISSUE_ENABLED=${config.enabled} (informational — this manual repair proceeds regardless)\n`);

  // ── Load job + main issue key ────────────────────────────────────────────
  const { data: job, error: jobErr } = await db
    .from('jobs')
    .select('id, document_id, service_level, payment_source, jira_issue_key, price_jira_issue_key, price_jira_issue_url, price_jira_sync_status')
    .eq('id', JOB_ID)
    .maybeSingle();

  if (jobErr || !job) {
    console.error('[backfill-price-breakdown] job not found:', jobErr?.message ?? JOB_ID);
    process.exit(1);
  }

  const mainIssueKey: string | null = job.jira_issue_key ?? null;

  console.log('════════════════════════════════════════════════════════════');
  console.log('SECTION 1 — CURRENT DB STATE');
  console.log('════════════════════════════════════════════════════════════');
  console.log({
    jobId: job.id,
    mainIssueKey,
    priceJiraIssueKey: job.price_jira_issue_key,
    priceJiraIssueUrl: job.price_jira_issue_url,
    priceJiraSyncStatus: job.price_jira_sync_status,
  });
  console.log('');

  if (job.price_jira_issue_key) {
    console.log(`plan: NO-OP — jobs.price_jira_issue_key is already set to ${job.price_jira_issue_key}. Nothing to do.`);
    return;
  }

  if (!mainIssueKey) {
    console.error('[backfill-price-breakdown] job has no jira_issue_key (main issue) — cannot create/link a price breakdown issue without it.');
    process.exit(1);
  }

  // ── Load quote / items / reservations / payment tx ──────────────────────
  const { data: quoteRow } = await db
    .from('price_quotes')
    .select('id, document_id, amount_kzt, currency, status, source_language, target_language, language_pair, document_type, service_level, physical_page_count, included_page_count, included_word_count, source_word_count, urgency_level, sales_channel, fulfillment_method, pricing_version_id, pricing_context_json, internal_cost_json, margin_json, breakdown_json')
    .eq('job_id', JOB_ID)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!quoteRow) {
    console.error('[backfill-price-breakdown] no price_quotes row found for this job — cannot build a price breakdown without it.');
    process.exit(1);
  }

  const quote = mapPriceQuote(quoteRow as Record<string, unknown>);
  const documentId = (quoteRow.document_id as string | null) ?? null;

  const { data: itemRows } = await db
    .from('price_quote_items')
    .select('id, item_type, label, quantity, unit_price_kzt, amount_kzt, is_client_visible, is_cost, sort_order, metadata_json')
    .eq('quote_id', quote.id)
    .order('sort_order', { ascending: true });
  const items = ((itemRows as Record<string, unknown>[] | null) ?? []).map(mapPriceQuoteItem);

  const { data: resRows } = await db
    .from('cost_reservations')
    .select('id, cost_type, amount_kzt, status, payable_to_type, payable_to_id, notes')
    .eq('quote_id', quote.id)
    .order('created_at', { ascending: true });
  const reservations = ((resRows as Record<string, unknown>[] | null) ?? []).map(mapCostReservation);

  const { data: txRow } = await db
    .from('payment_transactions')
    .select('id, status')
    .eq('job_id', JOB_ID)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const paymentTransactionId = (txRow as Record<string, unknown> | null)?.id as string | null ?? null;

  console.log('════════════════════════════════════════════════════════════');
  console.log('SECTION 2 — PRICING DATA THAT WOULD BE INCLUDED');
  console.log('════════════════════════════════════════════════════════════');
  console.log({
    quoteId: quote.id,
    quoteStatus: quote.status,
    quoteAmountKzt: quote.amountKzt,
    revenueItems: items.filter((i) => !i.isCost).length,
    costItems: items.filter((i) => i.isCost).length,
    costReservations: reservations.length,
    paymentTransactionId,
    paymentTransactionStatus: txRow?.status ?? null,
  });
  if (items.length === 0) {
    console.warn('[backfill-price-breakdown] ⚠ price_quote_items is empty — the built description will show a warning block instead of line items.');
  }
  console.log('');

  // ── Idempotency: search Jira as a fallback (DB already checked above) ───
  // SAFETY: a failed search is a HARD STOP — never proceed as if nothing was
  // found. Doing so risks creating a duplicate price breakdown issue. This is
  // exactly the bug this script had until 2026-07-09 (Jira Cloud returned 410
  // for the deprecated GET /rest/api/3/search endpoint, and the script logged
  // a warning and continued as if the search had found zero issues).
  console.log('════════════════════════════════════════════════════════════');
  console.log('SECTION 3 — JIRA IDEMPOTENCY CHECK');
  console.log('════════════════════════════════════════════════════════════');
  const expectedSummary = buildPriceBreakdownSummary(mainIssueKey);
  const jql = `project = "${config.projectKey}" AND labels = "wpo-price-breakdown" AND summary = "${expectedSummary.replace(/"/g, '\\"')}"`;
  console.log(`jql: ${jql}`);

  const searchResult = await searchJiraIssuesByJql(jiraFetch, jql, ['summary', 'created'], 20);
  console.log(`endpoint: POST ${searchResult.endpoint}`);
  console.log(`httpStatus: ${searchResult.httpStatus ?? '(request did not complete)'}`);

  if (!searchResult.ok) {
    console.error(`\n[backfill-price-breakdown] FATAL: ${searchResult.error}`);
    console.error('[backfill-price-breakdown] Jira idempotency search failed — refusing to produce a CREATE/ADOPT plan.');
    console.error('[backfill-price-breakdown] Creating an issue without a successful search first risks a duplicate. No plan generated. No writes possible.');
    process.exit(1);
  }

  const jiraFoundIssues = searchResult.issues;
  console.log(`found: ${jiraFoundIssues.length} matching issue(s)`);
  console.log('');

  const fullParams = {
    jobId: JOB_ID,
    mainIssueKey,
    paymentTransactionId,
    paymentSource: job.payment_source ?? null,
    documentId,
    serviceLevel: quote.serviceLevel ?? job.service_level ?? 'unknown',
    sourceLanguage: quote.sourceLanguage ?? 'unknown',
    targetLanguage: quote.targetLanguage ?? 'unknown',
    documentType: quote.documentType ?? 'unknown',
    quote,
    items,
    reservations,
  };
  const description = buildPriceBreakdownDescription(fullParams);

  console.log('════════════════════════════════════════════════════════════');
  console.log('SECTION 4 — PLAN');
  console.log('════════════════════════════════════════════════════════════');

  if (jiraFoundIssues.length > 0) {
    const sorted = [...jiraFoundIssues].sort((a, b) => new Date(a.fields.created).getTime() - new Date(b.fields.created).getTime());
    const canonical = sorted[0]!;
    console.log(`plan: ADOPT existing Jira issue ${canonical.key} (found by search, not recorded in DB) — would sync jobs.price_jira_issue_key/url and ensure link to ${mainIssueKey}, would NOT create a new issue.`);
    if (sorted.length > 1) {
      console.warn(`⚠ ${sorted.length - 1} duplicate(s) also found: ${sorted.slice(1).map((i) => i.key).join(', ')} — not touched, review manually.`);
    }
    if (!APPLY) {
      console.log('\n[backfill-price-breakdown] DRY RUN — stopping here. No writes performed.\n');
      return;
    }
    await db.from('jobs').update({
      price_jira_issue_id: canonical.id,
      price_jira_issue_key: canonical.key,
      price_jira_issue_url: `${jiraBaseUrl}/browse/${canonical.key}`,
      price_jira_sync_status: 'synced',
      price_jira_synced_at: new Date().toISOString(),
    } as Record<string, unknown>).eq('id', JOB_ID);
    console.log(`[backfill-price-breakdown] ✓ adopted ${canonical.key}, jobs row updated`);
    const linkRes = await jiraFetch('/issueLink', {
      method: 'POST',
      body: JSON.stringify({ type: { name: 'Relates' }, inwardIssue: { key: canonical.key }, outwardIssue: { key: mainIssueKey } }),
    });
    console.log(linkRes.ok ? `[backfill-price-breakdown] ✓ link to ${mainIssueKey} ensured` : `[backfill-price-breakdown] link to ${mainIssueKey} returned ${linkRes.status} (may already be linked, non-fatal)`);
    return;
  }

  const summary = expectedSummary;
  console.log('plan: CREATE new Jira issue');
  console.log(`  project     : ${config.projectKey}`);
  console.log(`  issuetype   : ${config.issueType}`);
  console.log(`  summary     : "${summary}"`);
  console.log(`  labels      : ${config.labels.join(', ')}`);
  console.log(`  descriptionChars : ${JSON.stringify(description).length}`);
  console.log(`  would link to    : ${mainIssueKey}`);
  console.log(`  would store back : jobs.price_jira_issue_id/key/url, price_jira_sync_status='synced', price_jira_synced_at`);

  if (!APPLY) {
    console.log('\n[backfill-price-breakdown] DRY RUN — stopping here. No writes performed.\n');
    return;
  }

  const payload = { fields: { project: { key: config.projectKey }, summary, issuetype: { name: config.issueType }, labels: config.labels, description } };
  const res = await jiraFetch('/issue', { method: 'POST', body: JSON.stringify(payload) });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.error(`[backfill-price-breakdown] Jira create failed: ${res.status} ${text.slice(0, 300)}`);
    process.exit(1);
  }
  const data = await res.json() as { id: string; key: string };
  const issueUrl = `${jiraBaseUrl}/browse/${data.key}`;
  console.log(`[backfill-price-breakdown] ✓ created ${data.key}`);
  console.log(`  View: ${issueUrl}`);

  await db.from('jobs').update({
    price_jira_issue_id: data.id,
    price_jira_issue_key: data.key,
    price_jira_issue_url: issueUrl,
    price_jira_sync_status: 'synced',
    price_jira_synced_at: new Date().toISOString(),
  } as Record<string, unknown>).eq('id', JOB_ID);
  console.log('[backfill-price-breakdown] ✓ jobs row updated');

  const linkRes = await jiraFetch('/issueLink', {
    method: 'POST',
    body: JSON.stringify({ type: { name: 'Relates' }, inwardIssue: { key: data.key }, outwardIssue: { key: mainIssueKey } }),
  });
  console.log(linkRes.ok ? `[backfill-price-breakdown] ✓ linked to ${mainIssueKey}` : `[backfill-price-breakdown] link to ${mainIssueKey} failed (non-fatal): ${linkRes.status}`);
}

main().catch((err) => {
  console.error('[backfill-price-breakdown] FATAL:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
