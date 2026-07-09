#!/usr/bin/env npx tsx
/**
 * Read-only audit: how many production jobs would reconcilePendingPriceBreakdownIssues()
 * (worker/src/lib/integrations.ts) pick up if JIRA_PRICE_BREAKDOWN_ISSUE_ENABLED
 * were set to 'true'? Run this BEFORE flipping that flag in production, so the
 * first reconciliation cycle doesn't surprise you with an unknown-size backlog
 * of Jira issue creations. WO-75 incident, 2026-07-09.
 *
 * Mirrors the reconciliation sweep's exact selection criteria:
 *   - jobs.jira_issue_key IS NOT NULL   (main Jira issue exists — this alone
 *     already excludes electronic orders, since those never get one)
 *   - jobs.price_jira_issue_key IS NULL (no price breakdown issue yet)
 *   - jobs.created_at < now() - 15 minutes (same throttle window the sweep uses,
 *     so it doesn't race an order's own in-flight fire-and-forget attempt)
 *
 * Unlike the sweep itself, this script does NOT apply the sweep's per-cycle
 * LIMIT — it reports the TRUE total backlog size, and separately shows how many
 * 15-minute cycles it would take to drain at the sweep's configured batch size
 * (PRICE_BREAKDOWN_RECONCILE_BATCH_SIZE env var, default 10).
 *
 * SAFETY: 100% read-only. No --apply flag exists — there is nothing this
 * script could write even by mistake. It does not touch the feature flag,
 * Jira, Drive, R2, or any DB row.
 *
 * Usage:
 *   npx tsx scripts/prod/2026-07-09_audit-price-breakdown-backlog.ts --env-file <path>
 *
 * Required env vars:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

function parseArgs(): { envFile: string | null } {
  const args = process.argv.slice(2);
  let envFile: string | null = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--env-file' && args[i + 1]) envFile = args[++i]!;
  }
  return { envFile };
}

const { envFile: ENV_FILE } = parseArgs();

if (ENV_FILE && fs.existsSync(path.resolve(ENV_FILE))) {
  dotenv.config({ path: path.resolve(ENV_FILE) });
  console.log(`[price-breakdown-audit] loaded env from ${ENV_FILE}`);
} else {
  console.log('[price-breakdown-audit] no --env-file given — relying on shell environment only');
}

const RETRY_AFTER_MINUTES = 15; // must match PRICE_BREAKDOWN_RETRY_AFTER_MINUTES in worker/src/lib/integrations.ts

async function main(): Promise<void> {
  const { createClient } = await import('@supabase/supabase-js');

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    console.error('[price-breakdown-audit] FATAL: Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createClient(supabaseUrl, serviceKey) as any;

  const cutoff = new Date(Date.now() - RETRY_AFTER_MINUTES * 60 * 1000).toISOString();

  const { data: candidates, error } = await db
    .from('jobs')
    .select('id, jira_issue_key, status, workflow_status, service_level, created_at')
    .not('jira_issue_key', 'is', null)
    .is('price_jira_issue_key', null)
    .lt('created_at', cutoff)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[price-breakdown-audit] FATAL: DB error:', error.message);
    process.exit(1);
  }

  const rows = candidates ?? [];

  console.log('\n════════════════════════════════════════════════════════════');
  console.log(`TOTAL CANDIDATES: ${rows.length}`);
  console.log('════════════════════════════════════════════════════════════');
  console.log(`(jobs with a main Jira issue, no price breakdown issue yet, created before ${cutoff})\n`);

  if (rows.length === 0) {
    console.log('[price-breakdown-audit] No backlog. Safe to enable JIRA_PRICE_BREAKDOWN_ISSUE_ENABLED=true with no immediate reconciliation burst.');
    return;
  }

  interface CandidateJob {
    id: string; jira_issue_key: string; status: string;
    workflow_status: string | null; service_level: string | null; created_at: string;
  }

  const enriched = await Promise.all((rows as CandidateJob[]).map(async (job) => {
    const { data: quote } = await db
      .from('price_quotes')
      .select('id, amount_kzt, status')
      .eq('job_id', job.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    return { job, quote: quote as { id: string; amount_kzt: number; status: string } | null };
  }));

  console.log('CANDIDATE LIST (oldest first):\n');
  for (const { job, quote } of enriched) {
    console.log([
      `job_id=${job.id}`,
      `jira=${job.jira_issue_key}`,
      `quote_id=${quote?.id ?? '(none)'}`,
      `amount_kzt=${quote?.amount_kzt ?? '(none)'}`,
      `quote_status=${quote?.status ?? '(none)'}`,
      `created_at=${job.created_at}`,
      `job_status=${job.status}`,
      `workflow_status=${job.workflow_status ?? '(none)'}`,
      `service_level=${job.service_level ?? '(none)'}`,
    ].join(' | '));
  }

  const batchSizeEnv = process.env.PRICE_BREAKDOWN_RECONCILE_BATCH_SIZE;
  const batchSize = batchSizeEnv && Number.isFinite(Number.parseInt(batchSizeEnv, 10)) && Number.parseInt(batchSizeEnv, 10) > 0
    ? Number.parseInt(batchSizeEnv, 10)
    : 10;
  const cyclesNeeded = Math.ceil(rows.length / batchSize);

  console.log('\n════════════════════════════════════════════════════════════');
  console.log('ROLLOUT GUIDANCE');
  console.log('════════════════════════════════════════════════════════════');
  console.log(`At the current sweep batch size (PRICE_BREAKDOWN_RECONCILE_BATCH_SIZE=${batchSizeEnv ?? '(unset, default 10)'}): `);
  console.log(`  ${rows.length} candidate(s) ÷ ${batchSize} per cycle = ${cyclesNeeded} reconciliation cycle(s) (every 15 min) to fully drain the backlog once the flag is on.`);
  console.log(`  That's roughly ${Math.ceil((cyclesNeeded * 15) / 60)} hour(s) of Jira issue creation traffic once enabled, spread out automatically — not a single burst.`);
  console.log('');
  console.log('Safe rollout options:');
  console.log('  1. Enable for future orders only, ignore this backlog:');
  console.log('     Not supported today — the sweep has no "only jobs created after X" cutoff. It would pick up');
  console.log('     every candidate above the first time it runs after the flag goes on. If you want this option,');
  console.log('     say so and I\'ll add a PRICE_BREAKDOWN_RECONCILE_MIN_CREATED_AT env var gate before you enable the flag.');
  console.log('  2. Backfill only selected jobs, keep the flag OFF:');
  console.log('     Run scripts/prod/2026-07-09_backfill-price-breakdown-wo75.ts (or');
  console.log('     scripts/staging/rebuild-jira-price-breakdown.ts) with --job-id for specific jobs you choose, one at a time.');
  console.log('     The automatic sweep never runs while the flag stays off.');
  console.log('  3. Enable the flag, but throttle the backlog drain:');
  console.log('     Set PRICE_BREAKDOWN_RECONCILE_BATCH_SIZE=1 (or another small number) on Railway before flipping the flag —');
  console.log('     the sweep will drain the backlog gradually (that many jobs per 15-minute cycle) instead of up to 10 at once.');
  console.log('     Raise it back up (or unset it) once the backlog above is cleared.');
}

main().catch((err) => {
  console.error('[price-breakdown-audit] FATAL:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
