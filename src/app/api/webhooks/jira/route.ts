// Jira → WPO reverse-sync webhook.
//
// Purpose: sync WPO Supabase state and send Telegram/email notifications
// when Jira Automation fires at key workflow milestones.
//
// Architecture reminder:
//  • WPO creates the Jira issue via REST API on order creation.
//  • Jira Automation handles all Jira-side transitions (assignee, security level, status).
//  • This endpoint is for SYNC ONLY — it never creates a new Jira issue
//    and never calls Jira transitions in response to an inbound callback.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase/server';
import {
  syncTranslatorDoneCertified,
  syncTranslatorDoneNotarized,
  syncNotaryDone,
  syncTranslatorDeclined,
  syncNotaryDeclined,
  syncReadyForDelivery,
  syncJobTerminated,
  syncInformational,
} from '@/lib/integrations/workflow';

// ─── Payload schema ───────────────────────────────────────────────────────────

const JiraWebhookSchema = z.object({
  /** Unique ID for this event — used for idempotency */
  eventId: z.string().min(1),
  /**
   * Event name sent by Jira Automation.
   * Configure your Jira Automation rules to send these values.
   */
  event: z.enum([
    // Translator lifecycle
    'TRANSLATOR_ACCEPTED',    // translator accepted the assignment
    'TRANSLATOR_IN_PROGRESS', // translator has started working
    'TRANSLATOR_COMPLETED',   // translator completed the translation (preferred)
    'TRANSLATOR_DONE',        // backward-compat alias for TRANSLATOR_COMPLETED
    'TRANSLATOR_DECLINED',    // translator declined / returned the assignment
    // Notary lifecycle
    'NOTARY_ACCEPTED',        // notary accepted the assignment
    'NOTARY_IN_PROGRESS',     // notary has started working
    'NOTARY_COMPLETED',       // notary completed the notarization (preferred)
    'NOTARY_DONE',            // backward-compat alias for NOTARY_COMPLETED
    'NOTARY_DECLINED',        // notary declined / returned the assignment
    // Order terminal events
    'JOB_FAILED',             // job marked failed in Jira
    'JOB_CANCELED',           // job canceled
    'READY_FOR_DELIVERY',     // operator approved — ready for customer delivery
  ]),
  /** Jira issue key, e.g. "WPO-42" */
  issueKey: z.string().min(1),
  /** WPO job ID (UUID) stored in the Jira issue — used to locate the Supabase row */
  jobId: z.string().uuid(),
  /** Optional correlation ID for tracing */
  correlationId: z.string().optional(),
});

type JiraWebhookPayload = z.infer<typeof JiraWebhookSchema>;

// Simple in-process idempotency guard (survives single-instance restarts via Supabase audit log)
const processedEventIds = new Set<string>();

export async function POST(request: NextRequest): Promise<NextResponse> {
  // ── 1. Authenticate ─────────────────────────────────────────────────────────
  const secret = process.env.JIRA_WEBHOOK_SECRET;
  if (secret) {
    const authHeader = request.headers.get('x-jira-webhook-secret');
    if (authHeader !== secret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  // ── 2. Parse & validate ─────────────────────────────────────────────────────
  let payload: JiraWebhookPayload;
  try {
    const raw: unknown = await request.json();
    const parsed = JiraWebhookSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid payload', details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    payload = parsed.data;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { eventId, event, issueKey, jobId, correlationId } = payload;

  // ── 3. Idempotency — in-memory guard ────────────────────────────────────────
  if (processedEventIds.has(eventId)) {
    return NextResponse.json({ ok: true, skipped: 'duplicate' });
  }

  // ── 4. Check idempotency in audit log (persisted guard) ────────────────────
  const { data: existing } = await supabaseServer
    .from('job_audit_log')
    .select('id')
    .eq('job_id', jobId)
    .eq('correlation_id', eventId)
    .maybeSingle();

  if (existing) {
    processedEventIds.add(eventId);
    return NextResponse.json({ ok: true, skipped: 'already_processed' });
  }

  // ── 5. Load job ─────────────────────────────────────────────────────────────
  const { data: job, error: jobErr } = await supabaseServer
    .from('jobs')
    .select('id, service_level, notarized, jira_issue_key, google_drive_folder_url, notary_city, fulfillment_method, document_id')
    .eq('id', jobId)
    .maybeSingle();

  if (jobErr || !job) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  }

  // Verify the Jira issue key matches what we have on record
  if (job.jira_issue_key && job.jira_issue_key !== issueKey) {
    return NextResponse.json(
      { error: 'issueKey does not match job record' },
      { status: 409 },
    );
  }

  // ── 6. Validate allowed event for this job's service level ─────────────────
  const serviceLevel = job.service_level ?? (job.notarized ? 'notarization_through_partners' : 'electronic');

  const isNotaryEvent = event === 'NOTARY_DONE' || event === 'NOTARY_COMPLETED' ||
    event === 'NOTARY_ACCEPTED' || event === 'NOTARY_IN_PROGRESS' || event === 'NOTARY_DECLINED';
  if (isNotaryEvent && serviceLevel !== 'notarization_through_partners') {
    return NextResponse.json(
      { error: `${event} received for non-notarization job` },
      { status: 422 },
    );
  }

  // ── 7. Write idempotency record before executing ────────────────────────────
  await supabaseServer.from('job_audit_log').insert({
    job_id: jobId,
    actor: 'webhook',
    source: 'jira_webhook',
    action: `webhook_received_${event.toLowerCase()}`,
    jira_issue_key: issueKey,
    correlation_id: eventId,
    metadata: { event, issueKey, correlationId: correlationId ?? null },
  });

  processedEventIds.add(eventId);

  // ── 8. Sync WPO state (Supabase + audit + Telegram) ────────────────────────
  // Jira Automation has already handled the Jira-side changes.
  // These functions ONLY update Supabase and send notifications.
  try {
    switch (event) {
      // Informational events — write audit only; no workflow_status change
      case 'TRANSLATOR_ACCEPTED':
      case 'TRANSLATOR_IN_PROGRESS':
      case 'NOTARY_ACCEPTED':
      case 'NOTARY_IN_PROGRESS':
        await syncInformational({ jobId, jiraIssueKey: issueKey, event });
        break;

      case 'TRANSLATOR_COMPLETED':
      case 'TRANSLATOR_DONE': {
        if (serviceLevel === 'notarization_through_partners') {
          // Load document for language pair (needed for notary notification)
          const { data: docRow } = await supabaseServer
            .from('documents')
            .select('source_language, target_language')
            .eq('id', job.document_id ?? '')
            .maybeSingle();

          await syncTranslatorDoneNotarized({
            jobId,
            jiraIssueKey: issueKey,
            sourceLang: docRow?.source_language ?? '',
            targetLang: docRow?.target_language ?? '',
            notaryCity: job.notary_city ?? null,
            fulfillmentMethod: job.fulfillment_method ?? null,
            driveUrl: job.google_drive_folder_url,
          });
        } else {
          await syncTranslatorDoneCertified({ jobId, jiraIssueKey: issueKey });
        }
        break;
      }

      case 'TRANSLATOR_DECLINED':
        await syncTranslatorDeclined({ jobId, jiraIssueKey: issueKey });
        break;

      case 'NOTARY_COMPLETED':
      case 'NOTARY_DONE':
        await syncNotaryDone({ jobId, jiraIssueKey: issueKey });
        break;

      case 'NOTARY_DECLINED':
        await syncNotaryDeclined({ jobId, jiraIssueKey: issueKey });
        break;

      case 'JOB_FAILED':
        await syncJobTerminated({ jobId, jiraIssueKey: issueKey, reason: 'failed' });
        break;

      case 'JOB_CANCELED':
        await syncJobTerminated({ jobId, jiraIssueKey: issueKey, reason: 'canceled' });
        break;

      case 'READY_FOR_DELIVERY':
        await syncReadyForDelivery({ jobId, jiraIssueKey: issueKey });
        break;
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[jira-webhook] sync failed:', message);
    // 500 → Jira Automation will retry
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
