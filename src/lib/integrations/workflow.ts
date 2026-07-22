// Integration workflow orchestrator: Jira + Drive + Telegram + Audit log
//
// Architecture:
//  • WPO creates ONE Jira issue per order via REST API (initializeOrderIntegrations).
//  • Jira Automation handles ALL subsequent transitions within Jira
//    (assignee, security level, status transitions, notifications).
//  • Jira Automation sends a callback to /api/webhooks/jira for reverse sync:
//    WPO only updates Supabase, writes audit, and sends Telegram/email notifications.
//    The callback does NOT create a new issue or perform Jira API transitions.

import { supabaseServer } from '../supabase/server';
import { createJiraIssue } from '../jira/client';
import { getJiraCredentials } from '../jira/config';
import { createOrderFolder, uploadFileToDrive } from '../google-drive/client';
import { downloadFile } from '../r2/client';
import {
  notifyOperatorNewOrder,
  notifyTranslatorNewAssignment,
  notifyNotaryNewAssignment,
  notifyOperatorTranslatorDone,
  notifyOperatorNotaryDone,
  notifyOperatorError,
} from '../telegram/client';
import type { ServiceLevel } from '../translation-prompts/types';
import type { Json } from '@/types/supabase';

// ─── Workflow rank: defines the canonical forward order of workflow statuses.
// A transition from status A → B is backward (and rejected) when rank(B) <= rank(A).
// Error/terminal statuses (declined, failed, canceled) always override rank logic.
const WORKFLOW_RANK: Record<string, number> = {
  awaiting_translator_review: 1,
  translator_review_in_progress: 2,
  translator_approved: 3,
  assigned_to_notary: 3,        // same level as translator_approved
  awaiting_signature_stamp: 3,  // certified path
  notarization_in_progress: 4,
  notarized: 5,
  ready_for_delivery: 6,
  ready_for_pickup: 6,
  out_for_delivery: 7,
  delivered: 8,
  picked_up: 8,
  // Error/canceled — always allowed regardless of rank
  translator_declined: 99,
  notary_declined: 99,
  failed: 99,
  canceled: 99,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function audit(params: {
  jobId: string;
  actor: string;
  source: string;
  action: string;
  previousStatus?: string | null;
  newStatus?: string | null;
  jiraIssueKey?: string | null;
  correlationId?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const { error } = await supabaseServer.from('job_audit_log').insert({
    job_id: params.jobId,
    actor: params.actor,
    source: params.source,
    action: params.action,
    previous_status: params.previousStatus ?? null,
    new_status: params.newStatus ?? null,
    jira_issue_key: params.jiraIssueKey ?? null,
    correlation_id: params.correlationId ?? null,
    metadata: (params.metadata ?? null) as Json | null,
  });
  if (error) console.error('[audit] insert failed:', error.message);
}

async function updateJobIntegration(jobId: string, fields: Record<string, unknown>): Promise<void> {
  const { error } = await supabaseServer
    .from('jobs')
    .update({ ...fields, last_synced_at: new Date().toISOString() })
    .eq('id', jobId);
  if (error) console.error('[integration] job update failed:', error.message);
}

/**
 * Guard against backward transitions.
 * Fetches current workflow_status, compares ranks, and either applies the update
 * or skips it with an audit warning.
 * Returns { applied: true } if update was written, { applied: false, currentStatus } if rejected.
 */
async function safeUpdateWorkflowStatus(params: {
  jobId: string;
  newStatus: string;
  fields: Record<string, unknown>;
  jiraIssueKey: string;
  eventType: string;
}): Promise<{ applied: boolean; currentStatus: string | null }> {
  const { data } = await supabaseServer
    .from('jobs')
    .select('workflow_status')
    .eq('id', params.jobId)
    .single();

  const currentStatus = data?.workflow_status ?? null;

  if (currentStatus && currentStatus !== params.newStatus) {
    const currentRank = WORKFLOW_RANK[currentStatus] ?? 0;
    const newRank = WORKFLOW_RANK[params.newStatus] ?? 0;

    // Error/terminal transitions always go through (rank 99)
    if (newRank !== 99 && newRank <= currentRank) {
      console.warn(
        `[integration] backward transition rejected: ${currentStatus} → ${params.newStatus} ` +
        `(ranks ${currentRank} → ${newRank}) for job ${params.jobId} event ${params.eventType}`,
      );
      await audit({
        jobId: params.jobId,
        actor: 'jira_automation',
        source: 'jira_webhook',
        action: 'backward_transition_rejected',
        previousStatus: currentStatus,
        newStatus: params.newStatus,
        jiraIssueKey: params.jiraIssueKey,
        metadata: { eventType: params.eventType, reason: 'backward_transition' },
      });
      return { applied: false, currentStatus };
    }
  }

  await updateJobIntegration(params.jobId, params.fields);
  return { applied: true, currentStatus };
}

function jiraUrl(issueKey: string): string | null {
  const creds = getJiraCredentials();
  if (!creds) return null;
  return `${creds.baseUrl}/browse/${issueKey}`;
}

/**
 * 2026-08-01 multi-file fulfillment decision: marks the document completed for a
 * multi-source (job_source_files rows exist) notarized order once physical delivery
 * is confirmed. No-op for legacy single-file jobs (job_source_files empty) — their
 * documents.status handling is completely unchanged. Non-fatal: a failure here must
 * never fail the DELIVERED webhook itself, since workflow_status has already been
 * durably updated by the time this runs.
 */
async function completeDocumentIfMultiSourceNotarized(jobId: string, tag: string): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { count: totalSources } = await (supabaseServer as any)
      .from('job_source_files')
      .select('id', { count: 'exact', head: true })
      .eq('job_id', jobId);
    if (!totalSources || totalSources === 0) return;

    const { data: jobRow } = await supabaseServer
      .from('jobs')
      .select('document_id, service_level')
      .eq('id', jobId)
      .single();
    if (jobRow?.service_level !== 'notarization_through_partners' || !jobRow.document_id) return;

    const { error } = await supabaseServer
      .from('documents')
      .update({ status: 'completed' })
      .eq('id', jobRow.document_id);
    if (error) console.error(`${tag} multi-source notarized document completion failed:`, error.message);
  } catch (err) {
    console.error(`${tag} multi-source notarized document completion error (non-fatal):`, err instanceof Error ? err.message : String(err));
  }
}

// ─── 1. Post-upload: create Drive folder + upload source + create Jira issue ──

export async function initializeOrderIntegrations(params: {
  jobId: string;
  serviceLevel: ServiceLevel;
  sourceLang: string;
  targetLang: string;
  documentType: string;
  notaryCity?: string | null;
  fulfillmentMethod?: 'pickup' | 'delivery' | null;
  siteUrl: string;
  /** R2 key of the source PDF — uploaded to Drive 01_SOURCE if provided */
  sourceFileKey?: string | null;
}): Promise<void> {
  if (
    params.serviceLevel !== 'official_with_translator_signature_and_provider_stamp' &&
    params.serviceLevel !== 'notarization_through_partners'
  ) {
    return;
  }

  const wpoUrl = `${params.siteUrl}/dashboard`;
  const tag = `[integration:${params.jobId.slice(0, 8)}]`;
  console.log(`${tag} initializing Drive + Jira for ${params.serviceLevel}`);

  // ── 1a. Create Drive folder ────────────────────────────────────────────────
  let driveUrl: string | null = null;
  let sourceFolderId: string | null = null;

  try {
    const folder = await createOrderFolder(params.jobId);
    if (folder) {
      driveUrl = folder.folderUrl;
      sourceFolderId = folder.subfolders.source;
      await updateJobIntegration(params.jobId, {
        google_drive_folder_id: folder.folderId,
        google_drive_folder_url: folder.folderUrl,
        drive_sync_status: 'created',
      });
      await audit({
        jobId: params.jobId,
        actor: 'system',
        source: 'upload',
        action: 'drive_folder_created',
        metadata: { folderId: folder.folderId },
      });
      console.log(`${tag} Drive folder: ${folder.folderUrl}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${tag} Drive folder creation failed: ${msg}`);
    await updateJobIntegration(params.jobId, { drive_sync_status: 'error', last_integration_error: msg });
    void notifyOperatorError({ jobId: params.jobId, error: msg, context: 'drive_folder_creation' }).catch(() => undefined);
  }

  // ── 1b. Upload source PDF to Drive 01_SOURCE ───────────────────────────────
  if (sourceFolderId && params.sourceFileKey) {
    try {
      const pdfBuf = await downloadFile(params.sourceFileKey);
      await uploadFileToDrive(sourceFolderId, 'source.pdf', pdfBuf, 'application/pdf');
      console.log(`${tag} source uploaded to Drive 01_SOURCE`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`${tag} source Drive upload failed (non-fatal): ${msg}`);
      await updateJobIntegration(params.jobId, { last_integration_error: msg });
    }
  }

  // ── 1c. Create Jira issue ─────────────────────────────────────────────────
  try {
    const issue = await createJiraIssue({
      jobId: params.jobId,
      serviceLevel: params.serviceLevel,
      sourceLang: params.sourceLang,
      targetLang: params.targetLang,
      documentType: params.documentType,
      notaryCity: params.notaryCity,
      fulfillmentMethod: params.fulfillmentMethod,
      driveUrl,
      wpoUrl,
      createdAt: new Date().toISOString(),
    });
    if (issue) {
      await updateJobIntegration(params.jobId, {
        jira_issue_id: issue.issueId,
        jira_issue_key: issue.issueKey,
        jira_issue_url: issue.issueUrl,
        jira_sync_status: 'created',
      });
      await audit({
        jobId: params.jobId,
        actor: 'system',
        source: 'upload',
        action: 'jira_issue_created',
        jiraIssueKey: issue.issueKey,
        metadata: { issueKey: issue.issueKey },
      });
      console.log(`${tag} Jira issue: ${issue.issueKey}`);

      void notifyOperatorNewOrder({
        jobId: params.jobId,
        serviceLevel: params.serviceLevel,
        sourceLang: params.sourceLang,
        targetLang: params.targetLang,
        documentType: params.documentType,
        notaryCity: params.notaryCity,
        fulfillmentMethod: params.fulfillmentMethod,
        jiraUrl: issue.issueUrl,
        driveUrl,
        wpoUrl,
      }).catch((e) => console.error(`${tag} operator Telegram failed:`, e));
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${tag} Jira issue creation failed: ${msg}`);
    await updateJobIntegration(params.jobId, { jira_sync_status: 'error', last_integration_error: msg });
    void notifyOperatorError({ jobId: params.jobId, error: msg, context: 'jira_issue_creation' }).catch(() => undefined);
  }
}

// ─── 2. Upload AI draft to Drive 02_AI_DRAFT ──────────────────────────────────
// Jira Automation handles all subsequent Jira-side steps (assignee, transitions,
// security level, notifications). WPO only uploads the file to Drive.

export async function transitionToTranslatorReview(params: {
  jobId: string;
  jiraIssueKey: string;
  serviceLevel: ServiceLevel;
  sourceLang: string;
  targetLang: string;
  documentType: string;
  driveUrl?: string | null;
  /** R2 key of the AI draft artifact */
  draftFileKey?: string | null;
  draftFileName?: string | null;
  /** Subfolder ID for 02_AI_DRAFT if available */
  aiDraftFolderId?: string | null;
}): Promise<void> {
  const tag = `[integration:${params.jobId.slice(0, 8)}]`;

  // Upload draft to Drive 02_AI_DRAFT
  if (params.draftFileKey && params.aiDraftFolderId) {
    try {
      const buf = await downloadFile(params.draftFileKey);
      const name = params.draftFileName ?? 'ai_draft.docx';
      const mime = name.endsWith('.docx')
        ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        : 'text/html';
      await uploadFileToDrive(params.aiDraftFolderId, name, buf, mime);
      console.log(`${tag} AI draft uploaded to Drive 02_AI_DRAFT`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`${tag} AI draft Drive upload failed (non-fatal): ${msg}`);
    }
  }

  // Update Supabase and send Telegram notification.
  // All Jira-side transitions are handled by Jira Automation.
  try {
    await updateJobIntegration(params.jobId, {
      jira_sync_status: 'translator_review',
      workflow_status: 'awaiting_translator_review',
    });

    await audit({
      jobId: params.jobId,
      actor: 'system',
      source: 'worker',
      action: 'ai_draft_ready_for_translator',
      newStatus: 'awaiting_translator_review',
      jiraIssueKey: params.jiraIssueKey,
    });

    void notifyTranslatorNewAssignment({
      jobId: params.jobId,
      sourceLang: params.sourceLang,
      targetLang: params.targetLang,
      documentType: params.documentType,
      jiraUrl: jiraUrl(params.jiraIssueKey),
      driveUrl: params.driveUrl,
    }).catch((e) => console.error(`${tag} translator Telegram failed:`, e));

    console.log(`${tag} ✓ AI draft ready — translator assignment handled by Jira Automation`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${tag} transitionToTranslatorReview failed: ${msg}`);
    await updateJobIntegration(params.jobId, { jira_sync_status: 'error', last_integration_error: msg });
    void notifyOperatorError({ jobId: params.jobId, error: msg, context: 'transition_to_translator' }).catch(() => undefined);
  }
}

// ─── 3–7. Jira → WPO reverse sync (Supabase update + audit + Telegram only)
//
// Jira Automation has already completed the Jira-side changes (assignee, security level,
// status transition, comments). These functions only sync WPO's Supabase state and
// send Telegram notifications. They must NOT call Jira API.

export async function syncTranslatorDoneCertified(params: {
  jobId: string;
  jiraIssueKey: string;
}): Promise<{ applied: boolean }> {
  const tag = `[integration:${params.jobId.slice(0, 8)}]`;
  try {
    const { applied } = await safeUpdateWorkflowStatus({
      jobId: params.jobId,
      newStatus: 'translator_approved',
      fields: { jira_sync_status: 'translator_approved', workflow_status: 'translator_approved' },
      jiraIssueKey: params.jiraIssueKey,
      eventType: 'TRANSLATOR_COMPLETED',
    });
    if (!applied) return { applied: false };
    await audit({
      jobId: params.jobId,
      actor: 'translator',
      source: 'jira_webhook',
      action: 'translator_completed_certified',
      newStatus: 'translator_approved',
      jiraIssueKey: params.jiraIssueKey,
    });
    void notifyOperatorTranslatorDone({
      jobId: params.jobId,
      jiraUrl: jiraUrl(params.jiraIssueKey),
      nextStep: 'operator_review',
    }).catch(() => undefined);
    console.log(`${tag} ✓ certified: Supabase synced, operator notified`);
    return { applied: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${tag} syncTranslatorDoneCertified failed: ${msg}`);
    await updateJobIntegration(params.jobId, { jira_sync_status: 'error', last_integration_error: msg });
    void notifyOperatorError({ jobId: params.jobId, error: msg, context: 'certified_to_operator' }).catch(() => undefined);
    return { applied: false };
  }
}

// Keep old export as alias for backward compat with tests/webhook
export const transitionCertifiedToOperator = syncTranslatorDoneCertified;

export async function syncTranslatorDoneNotarized(params: {
  jobId: string;
  jiraIssueKey: string;
  sourceLang: string;
  targetLang: string;
  notaryCity?: string | null;
  fulfillmentMethod?: string | null;
  driveUrl?: string | null;
}): Promise<{ applied: boolean }> {
  const tag = `[integration:${params.jobId.slice(0, 8)}]`;
  try {
    const { applied } = await safeUpdateWorkflowStatus({
      jobId: params.jobId,
      newStatus: 'assigned_to_notary',
      fields: { jira_sync_status: 'assigned_to_notary', workflow_status: 'assigned_to_notary' },
      jiraIssueKey: params.jiraIssueKey,
      eventType: 'TRANSLATOR_COMPLETED',
    });
    if (!applied) return { applied: false };
    await audit({
      jobId: params.jobId,
      actor: 'system',
      source: 'jira_webhook',
      action: 'forwarded_to_notary',
      newStatus: 'assigned_to_notary',
      jiraIssueKey: params.jiraIssueKey,
    });
    const jUrl = jiraUrl(params.jiraIssueKey);
    void Promise.all([
      notifyNotaryNewAssignment({
        jobId: params.jobId,
        sourceLang: params.sourceLang,
        targetLang: params.targetLang,
        notaryCity: params.notaryCity,
        fulfillmentMethod: params.fulfillmentMethod,
        jiraUrl: jUrl,
        driveUrl: params.driveUrl,
      }),
      notifyOperatorTranslatorDone({ jobId: params.jobId, jiraUrl: jUrl, nextStep: 'notary' }),
    ]).catch((e) => console.error(`${tag} Telegram failed:`, e));
    console.log(`${tag} ✓ notarized: Supabase synced, notary notified`);
    return { applied: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${tag} syncTranslatorDoneNotarized failed: ${msg}`);
    await updateJobIntegration(params.jobId, { jira_sync_status: 'error', last_integration_error: msg });
    void notifyOperatorError({ jobId: params.jobId, error: msg, context: 'to_notary' }).catch(() => undefined);
    return { applied: false };
  }
}

// Keep old export as alias
export const transitionToNotary = syncTranslatorDoneNotarized;

export async function syncNotaryDone(params: {
  jobId: string;
  jiraIssueKey: string;
}): Promise<{ applied: boolean }> {
  const tag = `[integration:${params.jobId.slice(0, 8)}]`;
  try {
    const { applied } = await safeUpdateWorkflowStatus({
      jobId: params.jobId,
      newStatus: 'notarized',
      fields: { jira_sync_status: 'notarized', workflow_status: 'notarized' },
      jiraIssueKey: params.jiraIssueKey,
      eventType: 'NOTARY_COMPLETED',
    });
    if (!applied) return { applied: false };
    await audit({
      jobId: params.jobId,
      actor: 'notary',
      source: 'jira_webhook',
      action: 'notary_completed',
      newStatus: 'notarized',
      jiraIssueKey: params.jiraIssueKey,
    });
    void notifyOperatorNotaryDone({ jobId: params.jobId, jiraUrl: jiraUrl(params.jiraIssueKey) }).catch(() => undefined);
    console.log(`${tag} ✓ notary done: Supabase synced, operator notified`);
    return { applied: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${tag} syncNotaryDone failed: ${msg}`);
    await updateJobIntegration(params.jobId, { jira_sync_status: 'error', last_integration_error: msg });
    void notifyOperatorError({ jobId: params.jobId, error: msg, context: 'notary_to_operator' }).catch(() => undefined);
    return { applied: false };
  }
}

// Keep old export as alias
export const transitionNotaryToOperator = syncNotaryDone;

export async function syncTranslatorDeclined(params: {
  jobId: string;
  jiraIssueKey: string;
}): Promise<void> {
  const tag = `[integration:${params.jobId.slice(0, 8)}]`;
  try {
    await updateJobIntegration(params.jobId, {
      jira_sync_status: 'translator_declined',
      workflow_status: 'translator_declined',
    });
    await audit({
      jobId: params.jobId,
      actor: 'translator',
      source: 'jira_webhook',
      action: 'translator_declined',
      newStatus: 'translator_declined',
      jiraIssueKey: params.jiraIssueKey,
    });
    void notifyOperatorError({
      jobId: params.jobId,
      error: 'Translator declined the assignment',
      context: 'translator_declined',
    }).catch(() => undefined);
    console.log(`${tag} ✓ translator declined: Supabase synced, operator notified`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${tag} syncTranslatorDeclined failed: ${msg}`);
  }
}

export async function syncNotaryDeclined(params: {
  jobId: string;
  jiraIssueKey: string;
}): Promise<void> {
  const tag = `[integration:${params.jobId.slice(0, 8)}]`;
  try {
    await updateJobIntegration(params.jobId, {
      jira_sync_status: 'notary_declined',
      workflow_status: 'notary_declined',
    });
    await audit({
      jobId: params.jobId,
      actor: 'notary',
      source: 'jira_webhook',
      action: 'notary_declined',
      newStatus: 'notary_declined',
      jiraIssueKey: params.jiraIssueKey,
    });
    void notifyOperatorError({
      jobId: params.jobId,
      error: 'Notary declined the assignment',
      context: 'notary_declined',
    }).catch(() => undefined);
    console.log(`${tag} ✓ notary declined: Supabase synced, operator notified`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${tag} syncNotaryDeclined failed: ${msg}`);
  }
}

export async function syncReadyForDelivery(params: {
  jobId: string;
  jiraIssueKey: string;
}): Promise<void> {
  const tag = `[integration:${params.jobId.slice(0, 8)}]`;
  try {
    // Lookup document_id to release the document to the customer
    const { data: jobRow } = await supabaseServer
      .from('jobs')
      .select('document_id')
      .eq('id', params.jobId)
      .single();

    await updateJobIntegration(params.jobId, {
      jira_sync_status: 'ready_for_delivery',
      workflow_status: 'ready_for_delivery',
    });

    // Release: move documents.status from 'in_review' → 'completed' so the
    // dashboard shows the download button.
    if (jobRow?.document_id) {
      const { error } = await supabaseServer
        .from('documents')
        .update({ status: 'completed' })
        .eq('id', jobRow.document_id);
      if (error) console.error(`${tag} document release failed:`, error.message);
    }

    await audit({
      jobId: params.jobId,
      actor: 'operator',
      source: 'jira_webhook',
      action: 'ready_for_delivery',
      newStatus: 'ready_for_delivery',
      jiraIssueKey: params.jiraIssueKey,
    });
    console.log(`${tag} ✓ ready for delivery: document released, Supabase synced`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${tag} syncReadyForDelivery failed: ${msg}`);
  }
}

export async function syncJobTerminated(params: {
  jobId: string;
  jiraIssueKey: string;
  reason: 'failed' | 'canceled';
}): Promise<void> {
  const tag = `[integration:${params.jobId.slice(0, 8)}]`;
  try {
    await updateJobIntegration(params.jobId, {
      jira_sync_status: params.reason,
      workflow_status: params.reason,
    });
    await audit({
      jobId: params.jobId,
      actor: 'system',
      source: 'jira_webhook',
      action: `job_${params.reason}`,
      newStatus: params.reason,
      jiraIssueKey: params.jiraIssueKey,
    });
    void notifyOperatorError({
      jobId: params.jobId,
      error: `Job ${params.reason} via Jira`,
      context: `job_${params.reason}`,
    }).catch(() => undefined);
    console.log(`${tag} ✓ job ${params.reason}: Supabase synced`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${tag} syncJobTerminated(${params.reason}) failed: ${msg}`);
  }
}

export async function syncInformational(params: {
  jobId: string;
  jiraIssueKey: string;
  event: string;
}): Promise<void> {
  const tag = `[integration:${params.jobId.slice(0, 8)}]`;
  try {
    await audit({
      jobId: params.jobId,
      actor: 'jira_automation',
      source: 'jira_webhook',
      action: params.event.toLowerCase(),
      jiraIssueKey: params.jiraIssueKey,
    });
    console.log(`${tag} ✓ informational event recorded: ${params.event}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${tag} syncInformational(${params.event}) failed: ${msg}`);
  }
}

export async function syncNotaryInProgress(params: {
  jobId: string;
  jiraIssueKey: string;
}): Promise<{ applied: boolean }> {
  const tag = `[integration:${params.jobId.slice(0, 8)}]`;
  try {
    const { applied } = await safeUpdateWorkflowStatus({
      jobId: params.jobId,
      newStatus: 'notarization_in_progress',
      fields: { jira_sync_status: 'notarization_in_progress', workflow_status: 'notarization_in_progress' },
      jiraIssueKey: params.jiraIssueKey,
      eventType: 'NOTARY_IN_PROGRESS',
    });
    if (!applied) return { applied: false };
    await audit({
      jobId: params.jobId,
      actor: 'notary',
      source: 'jira_webhook',
      action: 'notary_in_progress',
      newStatus: 'notarization_in_progress',
      jiraIssueKey: params.jiraIssueKey,
    });
    console.log(`${tag} ✓ notary in progress: Supabase synced`);
    return { applied: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${tag} syncNotaryInProgress failed: ${msg}`);
    return { applied: false };
  }
}

export async function syncOrderReady(params: {
  jobId: string;
  jiraIssueKey: string;
  fulfillmentMethod: 'pickup' | 'delivery' | null;
  serviceLevel?: string | null;
}): Promise<{ applied: boolean }> {
  const tag = `[integration:${params.jobId.slice(0, 8)}]`;
  const isDelivery = params.fulfillmentMethod === 'delivery';
  const newStatus = isDelivery ? 'ready_for_delivery' : 'ready_for_pickup';
  try {
    const { applied } = await safeUpdateWorkflowStatus({
      jobId: params.jobId,
      newStatus,
      fields: { jira_sync_status: newStatus, workflow_status: newStatus },
      jiraIssueKey: params.jiraIssueKey,
      eventType: 'ORDER_READY',
    });
    if (!applied) return { applied: false };

    // Release the document only for certified orders (digital delivery).
    // Notarized physical orders deliver a paper document — do NOT release digital download.
    const isPhysicalNotarized = params.serviceLevel === 'notarization_through_partners' &&
      (params.fulfillmentMethod === 'delivery' || params.fulfillmentMethod === 'pickup');

    if (!isPhysicalNotarized) {
      const { data: jobRow } = await supabaseServer
        .from('jobs')
        .select('document_id')
        .eq('id', params.jobId)
        .single();
      if (jobRow?.document_id) {
        const { error } = await supabaseServer
          .from('documents')
          .update({ status: 'completed' })
          .eq('id', jobRow.document_id);
        if (error) console.error(`${tag} document release failed:`, error.message);
      }
    }

    await audit({
      jobId: params.jobId,
      actor: 'operator',
      source: 'jira_webhook',
      action: isDelivery ? 'ready_for_delivery' : 'ready_for_pickup',
      newStatus,
      jiraIssueKey: params.jiraIssueKey,
    });
    console.log(`${tag} ✓ order ready (${newStatus}): Supabase synced${isPhysicalNotarized ? ' [physical — download NOT released]' : ' [digital released]'}`);
    return { applied: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${tag} syncOrderReady failed: ${msg}`);
    await updateJobIntegration(params.jobId, { jira_sync_status: 'error', last_integration_error: msg });
    return { applied: false };
  }
}

export async function syncOutForDelivery(params: {
  jobId: string;
  jiraIssueKey: string;
}): Promise<{ applied: boolean }> {
  const tag = `[integration:${params.jobId.slice(0, 8)}]`;
  try {
    const { applied } = await safeUpdateWorkflowStatus({
      jobId: params.jobId,
      newStatus: 'out_for_delivery',
      fields: { jira_sync_status: 'out_for_delivery', workflow_status: 'out_for_delivery' },
      jiraIssueKey: params.jiraIssueKey,
      eventType: 'OUT_FOR_DELIVERY',
    });
    if (!applied) return { applied: false };
    await audit({
      jobId: params.jobId,
      actor: 'operator',
      source: 'jira_webhook',
      action: 'out_for_delivery',
      newStatus: 'out_for_delivery',
      jiraIssueKey: params.jiraIssueKey,
    });
    console.log(`${tag} ✓ out for delivery: Supabase synced`);
    return { applied: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${tag} syncOutForDelivery failed: ${msg}`);
    return { applied: false };
  }
}

export async function syncDelivered(params: {
  jobId: string;
  jiraIssueKey: string;
}): Promise<{ applied: boolean }> {
  const tag = `[integration:${params.jobId.slice(0, 8)}]`;
  try {
    const { applied } = await safeUpdateWorkflowStatus({
      jobId: params.jobId,
      newStatus: 'delivered',
      fields: { jira_sync_status: 'delivered', workflow_status: 'delivered' },
      jiraIssueKey: params.jiraIssueKey,
      eventType: 'DELIVERED',
    });
    if (!applied) return { applied: false };

    // 2026-08-01 multi-file fulfillment decision: for a multi-source notarized order
    // with delivery fulfillment, digital access already opened as soon as the notary
    // result finished syncing (see canCustomerDownload's hasReadyResultFiles input) —
    // but the order itself only completes now, once physical delivery is confirmed
    // ("не завершать заказ до доставки"). Scoped to multi-source jobs only — legacy
    // single-file notarized jobs never get digital access regardless, so their
    // documents.status is intentionally left untouched here, unchanged from before.
    await completeDocumentIfMultiSourceNotarized(params.jobId, tag);

    await audit({
      jobId: params.jobId,
      actor: 'operator',
      source: 'jira_webhook',
      action: 'delivered',
      newStatus: 'delivered',
      jiraIssueKey: params.jiraIssueKey,
    });
    console.log(`${tag} ✓ delivered: Supabase synced`);
    return { applied: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${tag} syncDelivered failed: ${msg}`);
    return { applied: false };
  }
}

export async function syncPickedUp(params: {
  jobId: string;
  jiraIssueKey: string;
}): Promise<{ applied: boolean }> {
  const tag = `[integration:${params.jobId.slice(0, 8)}]`;
  try {
    const { applied } = await safeUpdateWorkflowStatus({
      jobId: params.jobId,
      newStatus: 'picked_up',
      fields: { jira_sync_status: 'picked_up', workflow_status: 'picked_up' },
      jiraIssueKey: params.jiraIssueKey,
      eventType: 'PICKED_UP',
    });
    if (!applied) return { applied: false };
    await audit({
      jobId: params.jobId,
      actor: 'operator',
      source: 'jira_webhook',
      action: 'picked_up',
      newStatus: 'picked_up',
      jiraIssueKey: params.jiraIssueKey,
    });
    console.log(`${tag} ✓ picked up: Supabase synced`);
    return { applied: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${tag} syncPickedUp failed: ${msg}`);
    return { applied: false };
  }
}
