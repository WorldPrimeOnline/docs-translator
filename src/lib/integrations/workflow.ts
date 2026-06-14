// Integration workflow orchestrator: Jira + Drive + Telegram + Audit log
//
// Architecture:
//  • WPO creates ONE Jira issue per order via REST API (initializeOrderIntegrations).
//  • WPO updates that issue after AI draft is ready (transitionToTranslatorReview).
//  • Jira Automation handles all subsequent transitions within Jira
//    (assignee, security level, status) when translator/notary act.
//  • Jira Automation sends a callback to /api/webhooks/jira for reverse sync:
//    WPO only updates Supabase, writes audit, and sends Telegram/email notifications.
//    The callback does NOT create a new issue or perform Jira API transitions.

import { supabaseServer } from '../supabase/server';
import {
  createJiraIssue,
  assignJiraIssue,
  setJiraSecurityLevel,
  transitionJiraIssue,
  addJiraComment,
} from '../jira/client';
import { getJiraCredentials } from '../jira/config';
import { resolveJiraIds } from '../jira/resolver';
import { JIRA_PROJECT_CONFIG } from '../jira/project-config';
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

async function getResolvedIds() {
  const creds = getJiraCredentials();
  if (!creds || !JIRA_PROJECT_CONFIG.projectKey) return null;
  return resolveJiraIds(creds.baseUrl, creds.email, creds.apiToken);
}

function jiraUrl(issueKey: string): string | null {
  const creds = getJiraCredentials();
  if (!creds) return null;
  return `${creds.baseUrl}/browse/${issueKey}`;
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

// ─── 2. Upload AI draft to Drive 02_AI_DRAFT + move issue to translator ───────

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

  // Jira transitions
  try {
    const ids = await getResolvedIds();

    if (ids?.translatorAccountId) {
      await assignJiraIssue(params.jiraIssueKey, ids.translatorAccountId);
    }
    if (ids?.securityLevelTranslatorId) {
      await setJiraSecurityLevel(params.jiraIssueKey, ids.securityLevelTranslatorId);
    }
    await transitionJiraIssue(params.jiraIssueKey, JIRA_PROJECT_CONFIG.transitionNames.toTranslator);
    await addJiraComment(params.jiraIssueKey, 'AI draft ready. Assigned for translator review.');

    await updateJobIntegration(params.jobId, {
      jira_sync_status: 'translator_review',
      workflow_status: 'awaiting_translator_review',
    });

    await audit({
      jobId: params.jobId,
      actor: 'system',
      source: 'worker',
      action: 'assigned_to_translator',
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

    console.log(`${tag} ✓ transitioned to translator review`);
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
}): Promise<void> {
  const tag = `[integration:${params.jobId.slice(0, 8)}]`;
  try {
    await updateJobIntegration(params.jobId, {
      jira_sync_status: 'operator_review',
      workflow_status: 'awaiting_signature_stamp',
    });
    await audit({
      jobId: params.jobId,
      actor: 'translator',
      source: 'jira_webhook',
      action: 'translator_completed_certified',
      newStatus: 'awaiting_signature_stamp',
      jiraIssueKey: params.jiraIssueKey,
    });
    void notifyOperatorTranslatorDone({
      jobId: params.jobId,
      jiraUrl: jiraUrl(params.jiraIssueKey),
      nextStep: 'operator_review',
    }).catch(() => undefined);
    console.log(`${tag} ✓ certified: Supabase synced, operator notified`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${tag} syncTranslatorDoneCertified failed: ${msg}`);
    await updateJobIntegration(params.jobId, { jira_sync_status: 'error', last_integration_error: msg });
    void notifyOperatorError({ jobId: params.jobId, error: msg, context: 'certified_to_operator' }).catch(() => undefined);
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
}): Promise<void> {
  const tag = `[integration:${params.jobId.slice(0, 8)}]`;
  try {
    await updateJobIntegration(params.jobId, {
      jira_sync_status: 'notary_review',
      workflow_status: 'awaiting_notary_review',
    });
    await audit({
      jobId: params.jobId,
      actor: 'system',
      source: 'jira_webhook',
      action: 'forwarded_to_notary',
      newStatus: 'awaiting_notary_review',
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
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${tag} syncTranslatorDoneNotarized failed: ${msg}`);
    await updateJobIntegration(params.jobId, { jira_sync_status: 'error', last_integration_error: msg });
    void notifyOperatorError({ jobId: params.jobId, error: msg, context: 'to_notary' }).catch(() => undefined);
  }
}

// Keep old export as alias
export const transitionToNotary = syncTranslatorDoneNotarized;

export async function syncNotaryDone(params: {
  jobId: string;
  jiraIssueKey: string;
}): Promise<void> {
  const tag = `[integration:${params.jobId.slice(0, 8)}]`;
  try {
    await updateJobIntegration(params.jobId, {
      jira_sync_status: 'final_qa',
      workflow_status: 'awaiting_final_qa',
    });
    await audit({
      jobId: params.jobId,
      actor: 'notary',
      source: 'jira_webhook',
      action: 'notary_completed',
      newStatus: 'awaiting_final_qa',
      jiraIssueKey: params.jiraIssueKey,
    });
    void notifyOperatorNotaryDone({ jobId: params.jobId, jiraUrl: jiraUrl(params.jiraIssueKey) }).catch(() => undefined);
    console.log(`${tag} ✓ notary done: Supabase synced, operator notified`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${tag} syncNotaryDone failed: ${msg}`);
    await updateJobIntegration(params.jobId, { jira_sync_status: 'error', last_integration_error: msg });
    void notifyOperatorError({ jobId: params.jobId, error: msg, context: 'notary_to_operator' }).catch(() => undefined);
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
    await updateJobIntegration(params.jobId, {
      jira_sync_status: 'ready_for_delivery',
      workflow_status: 'ready_for_delivery',
    });
    await audit({
      jobId: params.jobId,
      actor: 'operator',
      source: 'jira_webhook',
      action: 'ready_for_delivery',
      newStatus: 'ready_for_delivery',
      jiraIssueKey: params.jiraIssueKey,
    });
    // Customer delivery email is triggered separately by the operator or an automated email flow.
    console.log(`${tag} ✓ ready for delivery: Supabase synced`);
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
