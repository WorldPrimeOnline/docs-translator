// Jira → WPO reverse-sync webhook.
//
// Architecture:
//  • WPO creates ONE Jira issue per order (via Railway worker initializeOrderIntegrations).
//  • Jira Automation handles all Jira-side transitions.
//  • This endpoint is called by Jira Automation for REVERSE SYNC only —
//    it updates Supabase workflow_status, writes audit, and sends Telegram notifications.
//    It NEVER creates a Jira issue and NEVER calls Jira transitions.
//
// Authentication: X-WPO-Webhook-Secret header must match JIRA_WEBHOOK_SECRET env var.
//
// Payload contract (Jira Automation "Send web request" body):
//   { eventId, eventType, issueKey, orderId, jiraStatus?, occurredAt? }
// orderId = customfield_10073 = job UUID in Supabase.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase/server';
import {
  syncTranslatorDoneCertified,
  syncTranslatorDoneNotarized,
  syncNotaryInProgress,
  syncNotaryDone,
  syncTranslatorDeclined,
  syncNotaryDeclined,
  syncOrderReady,
  syncOutForDelivery,
  syncDelivered,
  syncJobTerminated,
  syncInformational,
} from '@/lib/integrations/workflow';

// ─── Payload schema ───────────────────────────────────────────────────────────

const JiraWebhookSchema = z.object({
  /** Unique ID for this event — used for idempotency */
  eventId: z.string().min(1),
  /** Event name sent by Jira Automation rule (fixed string per rule). */
  eventType: z.enum([
    // Translator lifecycle
    'TRANSLATOR_ACCEPTED',    // informational
    'TRANSLATOR_IN_PROGRESS', // informational
    'TRANSLATOR_COMPLETED',   // sets workflow_status
    'TRANSLATOR_DECLINED',
    // Notary lifecycle
    'NOTARY_ACCEPTED',        // informational
    'NOTARY_IN_PROGRESS',     // sets workflow_status = notarization_in_progress
    'NOTARY_COMPLETED',       // sets workflow_status = notarized
    'NOTARY_DECLINED',
    // Order delivery lifecycle
    'ORDER_READY',            // sets ready_for_delivery or ready_for_pickup
    'OUT_FOR_DELIVERY',       // sets out_for_delivery
    'DELIVERED',              // terminal: sets delivered
    'PICKED_UP',              // terminal: sets delivered (pickup path)
    // Order terminal events
    'JOB_FAILED',
    'JOB_CANCELED',
  ]),
  /** Jira issue key, e.g. "WO-42" */
  issueKey: z.string().min(1),
  /** WPO order/job UUID from customfield_10073 — used to locate the Supabase row */
  orderId: z.string().uuid(),
  /** Jira status name at the time of the transition (informational) */
  jiraStatus: z.string().optional(),
  /** ISO timestamp from Jira Automation {{now}} */
  occurredAt: z.string().optional(),
  /** Optional correlation ID for tracing */
  correlationId: z.string().optional(),
});

type JiraWebhookPayload = z.infer<typeof JiraWebhookSchema>;

// Simple in-process idempotency guard (supplements the Supabase audit-log check)
const processedEventIds = new Set<string>();

export async function POST(request: NextRequest): Promise<NextResponse> {
  // ── 1. Authenticate ─────────────────────────────────────────────────────────
  const secret = process.env.JIRA_WEBHOOK_SECRET;
  if (secret) {
    const header = request.headers.get('x-wpo-webhook-secret');
    if (header !== secret) {
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

  const { eventId, eventType, issueKey, orderId, correlationId } = payload;
  const jobId = orderId; // orderId === job UUID

  // ── 3. In-memory idempotency guard ──────────────────────────────────────────
  if (processedEventIds.has(eventId)) {
    return NextResponse.json({ ok: true, skipped: 'duplicate' });
  }

  // ── 4. Persisted idempotency guard ──────────────────────────────────────────
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

  const isNotaryEvent = eventType === 'NOTARY_COMPLETED' || eventType === 'NOTARY_IN_PROGRESS' ||
    eventType === 'NOTARY_ACCEPTED' || eventType === 'NOTARY_DECLINED';
  if (isNotaryEvent && serviceLevel !== 'notarization_through_partners') {
    return NextResponse.json(
      { error: `${eventType} received for non-notarization job` },
      { status: 422 },
    );
  }

  // ── 7. Write idempotency record before executing ────────────────────────────
  await supabaseServer.from('job_audit_log').insert({
    job_id: jobId,
    actor: 'webhook',
    source: 'jira_webhook',
    action: `webhook_received_${eventType.toLowerCase()}`,
    jira_issue_key: issueKey,
    correlation_id: eventId,
    metadata: { eventType, issueKey, correlationId: correlationId ?? null },
  });

  processedEventIds.add(eventId);

  // ── 8. Sync WPO state ───────────────────────────────────────────────────────
  try {
    switch (eventType) {
      // Informational only — write audit, no workflow_status change
      case 'TRANSLATOR_ACCEPTED':
      case 'TRANSLATOR_IN_PROGRESS':
      case 'NOTARY_ACCEPTED':
        await syncInformational({ jobId, jiraIssueKey: issueKey, event: eventType });
        break;

      case 'TRANSLATOR_COMPLETED': {
        if (serviceLevel === 'notarization_through_partners') {
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

      case 'NOTARY_IN_PROGRESS':
        await syncNotaryInProgress({ jobId, jiraIssueKey: issueKey });
        break;

      case 'NOTARY_COMPLETED':
        await syncNotaryDone({ jobId, jiraIssueKey: issueKey });
        break;

      case 'NOTARY_DECLINED':
        await syncNotaryDeclined({ jobId, jiraIssueKey: issueKey });
        break;

      case 'ORDER_READY':
        await syncOrderReady({ jobId, jiraIssueKey: issueKey, fulfillmentMethod: job.fulfillment_method ?? null });
        break;

      case 'OUT_FOR_DELIVERY':
        await syncOutForDelivery({ jobId, jiraIssueKey: issueKey });
        break;

      case 'DELIVERED':
      case 'PICKED_UP':
        await syncDelivered({ jobId, jiraIssueKey: issueKey });
        break;

      case 'JOB_FAILED':
        await syncJobTerminated({ jobId, jiraIssueKey: issueKey, reason: 'failed' });
        break;

      case 'JOB_CANCELED':
        await syncJobTerminated({ jobId, jiraIssueKey: issueKey, reason: 'canceled' });
        break;
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[jira-webhook] sync failed:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
