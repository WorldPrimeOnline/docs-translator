/**
 * Generic, idempotent production recovery for a single order's Jira
 * integrations: Partner ID (customfield_10121) on the main Jira issue, and the
 * Price Breakdown Story link (jobs.price_jira_issue_key). Order-agnostic —
 * generalized from the 2026-07-15 WO-77 incident tool after the same gap
 * showed up on WO-78; no order-specific values are hardcoded here.
 *
 * Kept separate from scripts/prod/2026-07-15_recover-order-jira-integrations.ts
 * (the CLI entry point) so it lives inside worker's own rootDir/tsconfig —
 * the CLI script lives under scripts/, which is excluded from both
 * tsconfig.json's, so importing it directly from a test file under
 * worker/src/lib/__tests__/ trips a TS6059 rootDir violation under `tsc
 * --noEmit -p worker/tsconfig.json` (ts-jest's isolated per-file transpile
 * doesn't enforce this, so the failure only shows up in the real typecheck
 * command, not in `npm test`).
 *
 * Every Jira/Supabase interaction is passed in via `RecoveryDeps` — this file
 * has no side effects at import time and no direct dependency on worker/src/
 * lib/env.ts, so it's testable with plain fakes and no jest module mocks.
 */

import type { JiraSearchOutcome } from './jira/search';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface RecoveryTarget {
  jobId?: string;
  issueKey?: string;
}

export interface JiraFieldRead {
  ok: boolean;
  status: number;
  fields: Record<string, unknown> | null;
}

export interface BackfillOutcome {
  ok: boolean;
  updatedFields: string[];
  skippedFields: string[];
  error?: string;
}

export interface RecoveryDeps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any;
  jiraGet(issueKey: string, fields: string): Promise<JiraFieldRead>;
  jiraFetchThrowing(path: string, options?: RequestInit): Promise<Response>;
  getPartnerApplicationId(jobId: string): Promise<string | null>;
  backfillJiraOrderFields(issueKey: string, patch: { partnerApplicationId?: string | null }): Promise<BackfillOutcome>;
  searchJiraIssuesByJql(
    jiraFetch: (path: string, options?: RequestInit) => Promise<Response>,
    jql: string,
    fields: string[],
    maxResults: number,
  ): Promise<JiraSearchOutcome>;
  createPriceBreakdownIssue(params: {
    jobId: string;
    mainIssueKey: string;
    serviceLevel: string;
    sourceLanguage: string;
    targetLanguage: string;
    documentType: string;
    paymentSource: string | null;
  }): Promise<string | null>;
  getPriceBreakdownConfig(): { enabled: boolean; projectKey: string; labels: string[] };
  buildPriceBreakdownSummary(mainIssueKey: string): string;
}

type Action = 'NO_OP' | 'RECOVERED' | 'CREATED' | 'FAILED';

export interface SubResult {
  action: Action;
  before: string | null;
  after: string | null;
  detail: string;
}

export interface RecoveryResult {
  jobId: string | null;
  issueKeyInput: string | null;
  apply: boolean;
  jiraIssueKey: string | null;
  hardStop: string | null;
  partnerId: SubResult;
  priceBreakdown: SubResult;
}

const NOT_ATTEMPTED: SubResult = { action: 'FAILED', before: null, after: null, detail: 'not attempted — job-level hard-stop' };

// ─── Target resolution: --issue-key or --job-id, mutually exclusive ────────

export type ResolveJobIdResult = { ok: true; jobId: string } | { ok: false; error: string };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function resolveJobId(target: RecoveryTarget, db: any): Promise<ResolveJobIdResult> {
  if (target.jobId && target.issueKey) {
    return { ok: false, error: 'validation: provide either --job-id or --issue-key, not both' };
  }
  if (!target.jobId && !target.issueKey) {
    return { ok: false, error: 'validation: must provide --job-id or --issue-key' };
  }
  if (target.jobId) {
    return { ok: true, jobId: target.jobId };
  }

  const { data: job, error } = await db.from('jobs').select('id').eq('jira_issue_key', target.issueKey).maybeSingle();
  if (error || !job) {
    return { ok: false, error: `no job found with jira_issue_key=${target.issueKey}` };
  }
  return { ok: true, jobId: job.id as string };
}

// ─── A. Partner ID recovery ─────────────────────────────────────────────────

export async function resolvePartnerId(
  jobId: string,
  jiraIssueKey: string,
  apply: boolean,
  deps: RecoveryDeps,
): Promise<SubResult> {
  const { data: referral } = await deps.db.from('partner_referrals').select('partner_id').eq('job_id', jobId).maybeSingle();
  if (!referral?.partner_id) {
    return { action: 'FAILED', before: null, after: null, detail: 'hard-stop: no partner_referrals row for this job' };
  }

  const before = await deps.jiraGet(jiraIssueKey, 'customfield_10121');
  if (!before.ok) {
    return { action: 'FAILED', before: null, after: null, detail: `hard-stop: Jira GET failed (status ${before.status})` };
  }
  const beforeValue = (before.fields?.customfield_10121 as string | null) ?? null;

  if (beforeValue) {
    return { action: 'NO_OP', before: beforeValue, after: beforeValue, detail: 'already set in Jira — no write needed' };
  }

  // Same lookup initializeOrderIntegrations() uses to build the original
  // create payload — trusting it here for backfill is exactly as safe as
  // trusting it there, no separate expected-value check needed.
  const resolved = await deps.getPartnerApplicationId(jobId);
  if (!resolved) {
    return { action: 'FAILED', before: beforeValue, after: null, detail: 'hard-stop: partner_referrals row exists but partners.application_id is not on file — nothing to backfill' };
  }

  if (!apply) {
    return { action: 'NO_OP', before: beforeValue, after: null, detail: `dry-run — would backfill customfield_10121 to ${resolved}` };
  }

  const patchResult = await deps.backfillJiraOrderFields(jiraIssueKey, { partnerApplicationId: resolved });
  if (!patchResult.ok) {
    return { action: 'FAILED', before: beforeValue, after: null, detail: `backfillJiraOrderFields failed: ${patchResult.error ?? 'unknown error'}` };
  }

  const after = await deps.jiraGet(jiraIssueKey, 'customfield_10121');
  const afterValue = (after.ok ? (after.fields?.customfield_10121 as string | null) : null) ?? null;

  return {
    action: 'RECOVERED',
    before: beforeValue,
    after: afterValue,
    detail: patchResult.updatedFields.includes('partnerApplicationId') ? `backfilled customfield_10121 to ${resolved}` : 'backfillJiraOrderFields made no change (already set concurrently)',
  };
}

// ─── B. Price Breakdown recovery ────────────────────────────────────────────

export async function resolvePriceBreakdown(
  jobId: string,
  jiraIssueKey: string,
  serviceLevel: string,
  paymentSource: string | null,
  documentId: string,
  apply: boolean,
  deps: RecoveryDeps,
): Promise<SubResult> {
  const { data: jobRow } = await deps.db.from('jobs').select('price_jira_issue_key').eq('id', jobId).maybeSingle();
  const before = (jobRow?.price_jira_issue_key as string | null) ?? null;
  if (before) {
    return { action: 'NO_OP', before, after: before, detail: 'jobs.price_jira_issue_key already set' };
  }

  const config = deps.getPriceBreakdownConfig();
  if (!config.enabled) {
    return { action: 'NO_OP', before: null, after: null, detail: 'JIRA_PRICE_BREAKDOWN_ISSUE_ENABLED is not true — feature is off, refusing to create' };
  }

  const expectedSummary = deps.buildPriceBreakdownSummary(jiraIssueKey);
  const label = config.labels[0] ?? 'wpo-price-breakdown';
  const jql = `project = "${config.projectKey}" AND labels = "${label}" AND summary = "${expectedSummary.replace(/"/g, '\\"')}"`;
  const searchResult = await deps.searchJiraIssuesByJql(deps.jiraFetchThrowing, jql, ['summary', 'created'], 5);

  if (!searchResult.ok) {
    return { action: 'FAILED', before: null, after: null, detail: `hard-stop: Jira search failed — ${searchResult.error} — refusing to create` };
  }

  if (searchResult.issues.length > 0) {
    const sorted = [...searchResult.issues].sort(
      (a, b) => new Date(a.fields.created).getTime() - new Date(b.fields.created).getTime(),
    );
    const found = sorted[0];
    const dupeNote = sorted.length > 1 ? ` (${sorted.length - 1} other match(es) found — review manually)` : '';

    if (!apply) {
      return { action: 'NO_OP', before: null, after: null, detail: `dry-run — would adopt existing Story ${found.key} found in Jira${dupeNote}` };
    }

    const { error: updErr } = await deps.db
      .from('jobs')
      .update({ price_jira_issue_id: found.id, price_jira_issue_key: found.key, price_jira_sync_status: 'recovered' })
      .eq('id', jobId);
    if (updErr) return { action: 'FAILED', before: null, after: null, detail: `DB update failed: ${updErr.message}` };

    return { action: 'RECOVERED', before: null, after: found.key, detail: `adopted existing Story${dupeNote}` };
  }

  // Nothing found in Jira — create exactly once.
  if (!apply) {
    return { action: 'NO_OP', before: null, after: null, detail: 'dry-run — no existing Story found in Jira; would create one' };
  }

  const { data: doc } = await deps.db.from('documents').select('source_language, target_language, document_type').eq('id', documentId).maybeSingle();
  if (!doc) {
    return { action: 'FAILED', before: null, after: null, detail: 'document not found — cannot build create payload' };
  }

  const issueKey = await deps.createPriceBreakdownIssue({
    jobId,
    mainIssueKey: jiraIssueKey,
    serviceLevel,
    sourceLanguage: doc.source_language,
    targetLanguage: doc.target_language,
    documentType: doc.document_type,
    paymentSource,
  });

  if (!issueKey) {
    return { action: 'FAILED', before: null, after: null, detail: 'createPriceBreakdownIssue() returned null (Jira not configured or feature disabled)' };
  }

  return { action: 'CREATED', before: null, after: issueKey, detail: 'created new Price Breakdown Story' };
}

// ─── Orchestration ──────────────────────────────────────────────────────────

export async function runRecovery(target: RecoveryTarget, apply: boolean, deps: RecoveryDeps): Promise<RecoveryResult> {
  const resolved = await resolveJobId(target, deps.db);

  const result: RecoveryResult = {
    jobId: target.jobId ?? null,
    issueKeyInput: target.issueKey ?? null,
    apply,
    jiraIssueKey: null,
    hardStop: null,
    partnerId: NOT_ATTEMPTED,
    priceBreakdown: NOT_ATTEMPTED,
  };

  if (!resolved.ok) {
    result.hardStop = resolved.error;
    return result;
  }
  const jobId = resolved.jobId;
  result.jobId = jobId;

  const { data: job, error: jobErr } = await deps.db
    .from('jobs')
    .select('id, jira_issue_key, service_level, payment_source, document_id')
    .eq('id', jobId)
    .maybeSingle();

  if (jobErr || !job) {
    result.hardStop = `job not found: ${jobErr?.message ?? jobId}`;
    return result;
  }
  result.jiraIssueKey = job.jira_issue_key ?? null;

  if (!job.jira_issue_key) {
    result.hardStop = 'no main Jira issue — nothing to recover';
    return result;
  }

  const eligible = job.service_level === 'notarization_through_partners'
    || job.service_level === 'official_with_translator_signature_and_provider_stamp';
  if (!eligible) {
    result.hardStop = `service_level=${job.service_level} is not eligible for Jira integrations`;
    return result;
  }

  let paid = job.payment_source === 'subscription';
  if (!paid) {
    const { data: pay } = await deps.db
      .from('payment_transactions')
      .select('status')
      .eq('job_id', jobId)
      .in('status', ['paid', 'completed'])
      .maybeSingle();
    paid = !!pay;
  }
  if (!paid) {
    result.hardStop = 'order is not paid — refusing to recover integrations for an unpaid order';
    return result;
  }

  result.partnerId = await resolvePartnerId(jobId, job.jira_issue_key, apply, deps);
  result.priceBreakdown = await resolvePriceBreakdown(
    jobId,
    job.jira_issue_key,
    job.service_level,
    job.payment_source ?? null,
    job.document_id,
    apply,
    deps,
  );

  if (apply) {
    if (result.partnerId.action === 'RECOVERED') {
      await deps.db.from('job_audit_log').insert({
        job_id: jobId,
        actor: 'system',
        source: 'manual_recovery',
        action: 'partner_id_backfilled',
        jira_issue_key: job.jira_issue_key,
        metadata: { before: result.partnerId.before, after: result.partnerId.after },
      });
    }
    if (result.priceBreakdown.action === 'RECOVERED' || result.priceBreakdown.action === 'CREATED') {
      await deps.db.from('job_audit_log').insert({
        job_id: jobId,
        actor: 'system',
        source: 'manual_recovery',
        action: result.priceBreakdown.action === 'CREATED' ? 'price_jira_issue_created' : 'price_jira_issue_recovered',
        jira_issue_key: job.jira_issue_key,
        metadata: { before: result.priceBreakdown.before, after: result.priceBreakdown.after },
      });
    }
  }

  return result;
}
