#!/usr/bin/env npx tsx
/**
 * Manual trigger for ensureJiraIssueForPaidOrder() — recovers a paid,
 * certified/notarized order that is missing its main Jira issue.
 *
 * Safety:
 * - DRY_RUN=true by default. In dry-run, the Jira idempotency search still runs
 *   (read-only) so you can see whether an orphaned issue already exists, but no
 *   Supabase row or Jira issue is written.
 * - Never touches payment_transactions, price_quotes, or documents — only
 *   jobs.jira_* fields and job_audit_log.
 * - Idempotent: searches Jira before creating; adopts an existing issue instead
 *   of duplicating it. Electronic orders and unpaid orders are refused, not
 *   silently "fixed".
 *
 * Usage:
 *   DRY_RUN=true  JOB_ID=<jobs.id uuid> npx tsx scripts/recover-jira-issue.ts
 *   DRY_RUN=false JOB_ID=<jobs.id uuid> npx tsx scripts/recover-jira-issue.ts
 *
 * Required env vars:
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 *   JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN
 *
 * NOTE: this dynamically imports worker/src/lib/integrations.ts, which pulls in
 * worker/src/lib/env.ts — that schema requires R2_*, ANTHROPIC_API_KEY, and
 * MISTRAL_API_KEY too (even though this script never uses them) and will exit(1)
 * if they're missing. Run this with the same env as the Railway worker (or a
 * .env.local that mirrors it), not a bare Supabase+Jira-only .env file.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

const ROOT = path.resolve(process.cwd());

function loadEnvFile(filename: string): boolean {
  const filepath = path.join(ROOT, filename);
  if (fs.existsSync(filepath)) {
    dotenv.config({ path: filepath });
    return true;
  }
  return false;
}

const stagingLoaded = loadEnvFile('.env.staging.local');
const localLoaded = loadEnvFile('.env.local');
dotenv.config();

console.log('[recover-jira] Env files:', [stagingLoaded && '.env.staging.local', localLoaded && '.env.local'].filter(Boolean).join(', ') || '(none)');

const DRY_RUN = process.env.DRY_RUN !== 'false';
const JOB_ID = process.env.JOB_ID;

async function main(): Promise<void> {
  if (!JOB_ID) {
    console.error('[recover-jira] FATAL: set JOB_ID=<jobs.id uuid> (this is the order id, not the R2 key\'s first segment — confirm it with the diagnostic SQL first)');
    process.exit(1);
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[recover-jira] FATAL: Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  console.log('[recover-jira] JOB_ID:', JOB_ID);
  console.log('[recover-jira] DRY_RUN:', DRY_RUN ? 'YES (Jira search only — no writes)' : 'NO — will write to Supabase/Jira if a recovery action is needed');

  const { ensureJiraIssueForPaidOrder } = await import('../worker/src/lib/integrations');
  const result = await ensureJiraIssueForPaidOrder(JOB_ID, DRY_RUN);

  console.log('\n[recover-jira] ─── RESULT ─────────────────────────────────');
  console.log(JSON.stringify(result, null, 2));

  if (result.outcome === 'error') process.exitCode = 1;
}

void main().catch((err: unknown) => {
  console.error('[recover-jira] Fatal error:', (err as Error).message);
  process.exit(1);
});
