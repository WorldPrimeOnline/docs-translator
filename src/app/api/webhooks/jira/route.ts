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
  syncPickedUp,
  syncJobTerminated,
  syncInformational,
} from '@/lib/integrations/workflow';
import { handleAssigneeChanged } from '@/lib/notifications/assignee';

// ─── Payload schema ───────────────────────────────────────────────────────────

const JiraWebhookSchema = z.object({
  /** Unique ID for this event — used for idempotency */
  eventId: z.string().min(1),
  /** Event name sent by Jira Automation rule (fixed string per rule). */
  eventType: z.enum([
    // Assignee change — triggers personal Telegram notification
    'ASSIGNEE_CHANGED',
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
  /** Present for ASSIGNEE_CHANGED: Jira accountId of the new assignee */
  assigneeAccountId: z.string().optional(),
  /** Present for ASSIGNEE_CHANGED: display name of the new assignee */
  assigneeDisplayName: z.string().optional(),
});

type JiraWebhookPayload = z.infer<typeof JiraWebhookSchema>;

// Simple in-process idempotency guard (supplements the Supabase audit-log check)
const processedEventIds = new Set<string>();

export async function POST(request: NextRequest): Promise<NextResponse> {
  // ── 1. Authenticate ─────────────────────────────────────────────────────────
  const secret = process.env.JIRA_WEBHOOK_SECRET;
  if (!secret) {
    console.error('[jira-webhook] JIRA_WEBHOOK_SECRET not configured — rejecting request');
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 });
  }
  const header = request.headers.get('x-wpo-webhook-secret');
  if (header !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
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
    .select('id, service_level, notarized, jira_issue_key, google_drive_folder_url, notary_city, fulfillment_method, document_id, workflow_status')
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

  const previousWorkflowStatus = job.workflow_status ?? null;

  // ── 8. Sync WPO state ───────────────────────────────────────────────────────
  try {
    let result: { applied: boolean } = { applied: true };

    switch (eventType) {
      // ── Assignee changed: personal Telegram notification, no workflow change ──
      case 'ASSIGNEE_CHANGED': {
        if (!payload.assigneeAccountId) {
          // Unassigned (no assignee in payload) — record no-op and return success
          await supabaseServer.from('job_audit_log').insert({
            job_id: jobId,
            actor: 'webhook',
            source: 'jira_webhook',
            action: 'webhook_assignee_unassigned',
            jira_issue_key: issueKey,
            correlation_id: `${eventId}-noop`,
            metadata: { eventType, issueKey, note: 'no assigneeAccountId — unassigned' },
          });
        } else {
          // Load language data from the linked document
          const { data: docRow } = await supabaseServer
            .from('documents')
            .select('source_language, target_language, document_type')
            .eq('id', job.document_id ?? '')
            .maybeSingle();

          await handleAssigneeChanged({
            jobId,
            issueKey,
            eventId,
            jiraStatus: payload.jiraStatus,
            assigneeAccountId: payload.assigneeAccountId,
            assigneeDisplayName: payload.assigneeDisplayName,
            driveUrl: job.google_drive_folder_url,
            notaryCity: job.notary_city,
            fulfillmentMethod: job.fulfillment_method,
            sourceLang: docRow?.source_language ?? '',
            targetLang: docRow?.target_language ?? '',
            documentType: docRow?.document_type ?? '',
            serviceLevel: job.service_level,
          });
        }
        break;
      }

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
          result = await syncTranslatorDoneNotarized({
            jobId,
            jiraIssueKey: issueKey,
            sourceLang: docRow?.source_language ?? '',
            targetLang: docRow?.target_language ?? '',
            notaryCity: job.notary_city ?? null,
            fulfillmentMethod: job.fulfillment_method ?? null,
            driveUrl: job.google_drive_folder_url,
          });
        } else {
          result = await syncTranslatorDoneCertified({ jobId, jiraIssueKey: issueKey });
        }
        break;
      }

      case 'TRANSLATOR_DECLINED':
        await syncTranslatorDeclined({ jobId, jiraIssueKey: issueKey });
        break;

      case 'NOTARY_IN_PROGRESS':
        result = await syncNotaryInProgress({ jobId, jiraIssueKey: issueKey });
        break;

      case 'NOTARY_COMPLETED':
        result = await syncNotaryDone({ jobId, jiraIssueKey: issueKey });
        break;

      case 'NOTARY_DECLINED':
        await syncNotaryDeclined({ jobId, jiraIssueKey: issueKey });
        break;

      case 'ORDER_READY':
        result = await syncOrderReady({
          jobId,
          jiraIssueKey: issueKey,
          fulfillmentMethod: job.fulfillment_method ?? null,
          serviceLevel: job.service_level ?? null,
        });
        break;

      case 'OUT_FOR_DELIVERY':
        result = await syncOutForDelivery({ jobId, jiraIssueKey: issueKey });
        break;

      case 'DELIVERED':
        result = await syncDelivered({ jobId, jiraIssueKey: issueKey });
        break;

      case 'PICKED_UP':
        result = await syncPickedUp({ jobId, jiraIssueKey: issueKey });
        break;

      case 'JOB_FAILED':
        await syncJobTerminated({ jobId, jiraIssueKey: issueKey, reason: 'failed' });
        break;

      case 'JOB_CANCELED':
        await syncJobTerminated({ jobId, jiraIssueKey: issueKey, reason: 'canceled' });
        break;
    }

    return NextResponse.json({
      ok: true,
      eventType,
      orderId: jobId,
      previousWorkflowStatus,
      transitionApplied: result.applied,
      reasonIfIgnored: result.applied ? null : 'backward_transition_rejected',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[jira-webhook] sync failed:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
