import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase/server';
import {
  transitionCertifiedToOperator,
  transitionToNotary,
  transitionNotaryToOperator,
} from '@/lib/integrations/workflow';

// ─── Payload schema ───────────────────────────────────────────────────────────
// Jira Automation sends a POST with a custom payload configured in the automation rule.
// Required fields: eventId (idempotency), event, issueKey, jobId
const JiraWebhookSchema = z.object({
  /** Unique ID for this event — used for idempotency */
  eventId: z.string().min(1),
  /** e.g. "TRANSLATOR_DONE", "NOTARY_DONE" */
  event: z.enum(['TRANSLATOR_DONE', 'NOTARY_DONE']),
  /** Jira issue key, e.g. "WPO-42" */
  issueKey: z.string().min(1),
  /** WPO job ID (UUID) stored in the Jira issue description */
  jobId: z.string().uuid(),
  /** Optional correlation ID for tracing */
  correlationId: z.string().optional(),
});

type JiraWebhookPayload = z.infer<typeof JiraWebhookSchema>;

// Simple in-process idempotency guard — survives single instance restarts via Supabase audit log
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

  // Verify issue matches
  if (job.jira_issue_key && job.jira_issue_key !== issueKey) {
    return NextResponse.json(
      { error: 'issueKey does not match job record' },
      { status: 409 },
    );
  }

  // ── 6. Validate allowed transition ─────────────────────────────────────────
  const serviceLevel = job.service_level ?? (job.notarized ? 'notarization_through_partners' : 'electronic');

  if (event === 'NOTARY_DONE' && serviceLevel !== 'notarization_through_partners') {
    return NextResponse.json(
      { error: 'NOTARY_DONE event received for non-notarization job' },
      { status: 422 },
    );
  }

  // ── 7. Insert idempotency record before executing (prevents double-fire) ────
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

  // ── 8. Execute transition ───────────────────────────────────────────────────
  try {
    if (event === 'TRANSLATOR_DONE') {
      if (serviceLevel === 'notarization_through_partners') {
        // Load document for language info
        const { data: docRow } = await supabaseServer
          .from('documents')
          .select('source_language, target_language')
          .eq('id', job.document_id ?? '')
          .maybeSingle();

        await transitionToNotary({
          jobId,
          jiraIssueKey: issueKey,
          sourceLang: docRow?.source_language ?? '',
          targetLang: docRow?.target_language ?? '',
          notaryCity: job.notary_city ?? null,
          fulfillmentMethod: job.fulfillment_method ?? null,
          driveUrl: job.google_drive_folder_url,
        });
      } else {
        await transitionCertifiedToOperator({ jobId, jiraIssueKey: issueKey });
      }
    } else if (event === 'NOTARY_DONE') {
      await transitionNotaryToOperator({ jobId, jiraIssueKey: issueKey });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[jira-webhook] transition failed:', message);
    // 500 → Jira Automation will retry
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
