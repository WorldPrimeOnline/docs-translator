#!/usr/bin/env npx tsx
/**
 * Generic, idempotent production recovery for a single order's Jira
 * integrations: Partner ID (customfield_10121) on the main Jira issue, and
 * jobs.price_jira_issue_key (the Price Breakdown Story link).
 *
 * Generalized from the 2026-07-15 WO-77 incident tool (which hardcoded that
 * one job id and its expected partners.application_id) after the identical
 * gap showed up on WO-78 — this version takes any order via --issue-key or
 * --job-id and hardcodes nothing.
 *
 * The recovery logic itself (validation, hard-stops, idempotency) lives in
 * worker/src/lib/jira-order-recovery.ts — kept separate from this CLI so its
 * tests can live inside worker's own rootDir (see that file's header comment
 * for why). This file only does argv parsing, env loading, and wiring real
 * Supabase/Jira clients into the RecoveryDeps interface.
 *
 * SAFETY
 *   - Default: DRY RUN. Performs every read/validation check and prints what
 *     it would do. No writes of any kind.
 *   - --apply requires CONFIRM_PRODUCTION_WRITE=true, or it refuses outright.
 *   - Touches only: the Jira issue's customfield_10121, and jobs.price_jira_
 *     issue_id/key/sync_status. Never touches payment_transactions,
 *     price_quotes, documents, jobs.status, jobs.workflow_status, Google
 *     Drive, or any other Jira field.
 *   - Hard-stops (no partial fixes) when: --issue-key and --job-id are both
 *     given, neither is given, the issue key doesn't resolve to a job, the
 *     job isn't paid, service_level isn't eligible (electronic orders are
 *     refused — they never get a main Jira issue by design), there is no
 *     main Jira issue, there is no partner_referrals row, no application_id
 *     is on file for the resolved partner, or a Jira GET/search call fails. A
 *     failed read is "unknown", never treated as "empty" — nothing is ever
 *     created or written on an unknown state.
 *   - Idempotent: a second run after a successful recovery reports NO_OP for
 *     both checks.
 *   - Reuses existing, already-tested project functions instead of
 *     reimplementing Jira logic: worker/src/lib/integrations.ts
 *     (getPartnerApplicationId, backfillJiraOrderFields, createPriceBreakdownIssue),
 *     worker/src/lib/jira/search.ts (searchJiraIssuesByJql),
 *     worker/src/lib/jira/price-breakdown.ts (getPriceBreakdownConfig,
 *     buildPriceBreakdownSummary). Only the raw Jira field GET (needed for the
 *     before/after report) and the Supabase client are self-contained here,
 *     matching the convention already used by scripts/prod/2026-07-10_backfill-
 *     applicant-type-wo75.ts and scripts/prod/2026-07-09_repair-wo75-drive-jira.ts.
 *
 * Usage:
 *   npx tsx scripts/prod/2026-07-15_recover-order-jira-integrations.ts --issue-key WO-78
 *   npx tsx scripts/prod/2026-07-15_recover-order-jira-integrations.ts --job-id <uuid>
 *   npx tsx scripts/prod/2026-07-15_recover-order-jira-integrations.ts --issue-key WO-78 --env-file <path>
 *   CONFIRM_PRODUCTION_WRITE=true npx tsx scripts/prod/2026-07-15_recover-order-jira-integrations.ts --issue-key WO-78 --apply
 *
 * Via Railway CLI (env pulled from the linked service/environment, no
 * --env-file or manual export needed):
 *   railway run --service docs-translator --environment production -- \
 *     npx tsx scripts/prod/2026-07-15_recover-order-jira-integrations.ts --issue-key WO-78
 *
 * Required env vars: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 * JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN. JIRA_PRICE_BREAKDOWN_ISSUE_ENABLED
 * is only required to actually CREATE a missing Story — reading and adopting
 * an existing one works without it.
 *
 * NOTE: dynamically imports worker/src/lib/integrations.ts, which pulls in
 * worker/src/lib/env.ts — that schema also requires R2_*, ANTHROPIC_API_KEY,
 * MISTRAL_API_KEY even though this script never uses them, and exits(1) if
 * they're missing. Run with the same env as the Railway worker (which the
 * `railway run --service docs-translator ...` invocation above already is).
 */

import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { runRecovery, type RecoveryDeps, type RecoveryTarget, type JiraFieldRead } from '../../worker/src/lib/jira-order-recovery';

// ─── CLI ────────────────────────────────────────────────────────────────────

interface CliArgs {
  target: RecoveryTarget;
  apply: boolean;
  envFile: string | null;
}

function parseArgs(argv: string[]): CliArgs {
  let jobId: string | undefined;
  let issueKey: string | undefined;
  let apply = false;
  let envFile: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--job-id' && argv[i + 1]) jobId = argv[++i]!;
    if (argv[i] === '--issue-key' && argv[i + 1]) issueKey = argv[++i]!;
    if (argv[i] === '--apply') apply = true;
    if (argv[i] === '--dry-run') apply = false;
    if (argv[i] === '--env-file' && argv[i + 1]) envFile = argv[++i]!;
  }
  return { target: { jobId, issueKey }, apply, envFile };
}

async function main(): Promise<void> {
  const { target, apply, envFile } = parseArgs(process.argv.slice(2));

  if (envFile && fs.existsSync(path.resolve(envFile))) {
    dotenv.config({ path: path.resolve(envFile) });
    console.log(`[recover-order-jira] loaded env from ${envFile}`);
  } else {
    console.log('[recover-order-jira] no --env-file given (or not found) — relying on shell/Railway-injected environment');
  }

  console.log(`[recover-order-jira] target=${JSON.stringify(target)} mode=${apply ? 'APPLY' : 'DRY RUN'}`);

  if (target.jobId && target.issueKey) {
    console.error('[recover-order-jira] REFUSED: provide either --job-id or --issue-key, not both.');
    process.exit(1);
  }
  if (!target.jobId && !target.issueKey) {
    console.error('[recover-order-jira] REFUSED: must provide --job-id <uuid> or --issue-key <WO-XX>.');
    process.exit(1);
  }

  if (apply && process.env.CONFIRM_PRODUCTION_WRITE !== 'true') {
    console.error('[recover-order-jira] REFUSED: --apply requires CONFIRM_PRODUCTION_WRITE=true to be set explicitly.');
    process.exit(1);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    console.error('[recover-order-jira] FATAL: Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  const jiraBaseUrlRaw = process.env.JIRA_BASE_URL;
  const jiraEmail = process.env.JIRA_EMAIL;
  const jiraToken = process.env.JIRA_API_TOKEN;
  if (!jiraBaseUrlRaw || !jiraEmail || !jiraToken) {
    console.error('[recover-order-jira] FATAL: Missing JIRA_BASE_URL, JIRA_EMAIL, or JIRA_API_TOKEN');
    process.exit(1);
  }
  const jiraBaseUrl = jiraBaseUrlRaw.replace(/\/$/, '');
  const authHeader = 'Basic ' + Buffer.from(`${jiraEmail}:${jiraToken}`).toString('base64');

  async function jiraFetchThrowing(reqPath: string, options: RequestInit = {}): Promise<Response> {
    return fetch(`${jiraBaseUrl}/rest/api/3${reqPath}`, {
      ...options,
      headers: {
        Authorization: authHeader,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(options.headers as Record<string, string> ?? {}),
      },
    });
  }

  async function jiraGet(issueKey: string, fields: string): Promise<JiraFieldRead> {
    try {
      const res = await jiraFetchThrowing(`/issue/${issueKey}?fields=${fields}`);
      if (!res.ok) return { ok: false, status: res.status, fields: null };
      const data = await res.json() as { fields: Record<string, unknown> };
      return { ok: true, status: res.status, fields: data.fields };
    } catch {
      return { ok: false, status: 0, fields: null };
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { createClient } = await import('@supabase/supabase-js') as any;
  const db = createClient(supabaseUrl, serviceKey);

  const { getPartnerApplicationId, backfillJiraOrderFields, createPriceBreakdownIssue } =
    await import('../../worker/src/lib/integrations');
  const { searchJiraIssuesByJql } = await import('../../worker/src/lib/jira/search');
  const { getPriceBreakdownConfig, buildPriceBreakdownSummary } =
    await import('../../worker/src/lib/jira/price-breakdown');

  const deps: RecoveryDeps = {
    db,
    jiraGet,
    jiraFetchThrowing,
    getPartnerApplicationId,
    backfillJiraOrderFields,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    createPriceBreakdownIssue: createPriceBreakdownIssue as any,
    searchJiraIssuesByJql,
    getPriceBreakdownConfig,
    buildPriceBreakdownSummary,
  };

  const result = await runRecovery(target, apply, deps);

  console.log('\n[recover-order-jira] ─── RESULT ─────────────────────────────────');
  console.log(JSON.stringify(result, null, 2));

  if (result.hardStop || result.partnerId.action === 'FAILED' || result.priceBreakdown.action === 'FAILED') {
    process.exitCode = 1;
  }
}

void main().catch((err: unknown) => {
  console.error('[recover-order-jira] Fatal error:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
