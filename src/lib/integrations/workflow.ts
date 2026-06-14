// Integration workflow orchestrator: Jira + Drive + Telegram + Audit log
// Called by the upload route (post-upload) and the Jira webhook handler (stage transitions).

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

// ─── 3. Translator done → certified: return to operator ──────────────────────

export async function transitionCertifiedToOperator(params: {
  jobId: string;
  jiraIssueKey: string;
}): Promise<void> {
  const tag = `[integration:${params.jobId.slice(0, 8)}]`;

  try {
    const ids = await getResolvedIds();

    if (ids?.operatorAccountId) {
      await assignJiraIssue(params.jiraIssueKey, ids.operatorAccountId);
    }
    if (ids?.securityLevelOperatorId) {
      await setJiraSecurityLevel(params.jiraIssueKey, ids.securityLevelOperatorId);
    }
    await transitionJiraIssue(params.jiraIssueKey, JIRA_PROJECT_CONFIG.transitionNames.toOperator);
    await addJiraComment(params.jiraIssueKey, 'Translator review complete. Returned to operator for signature/stamp/final QA.');

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

    console.log(`${tag} ✓ certified returned to operator`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${tag} transitionCertifiedToOperator failed: ${msg}`);
    await updateJobIntegration(params.jobId, { jira_sync_status: 'error', last_integration_error: msg });
    void notifyOperatorError({ jobId: params.jobId, error: msg, context: 'certified_to_operator' }).catch(() => undefined);
  }
}

// ─── 4. Translator done → notarization: forward to notary ────────────────────

export async function transitionToNotary(params: {
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
    const ids = await getResolvedIds();

    if (ids?.notaryAccountId) {
      await assignJiraIssue(params.jiraIssueKey, ids.notaryAccountId);
    }
    if (ids?.securityLevelNotaryId) {
      await setJiraSecurityLevel(params.jiraIssueKey, ids.securityLevelNotaryId);
    }
    await transitionJiraIssue(params.jiraIssueKey, JIRA_PROJECT_CONFIG.transitionNames.toNotary);
    await addJiraComment(
      params.jiraIssueKey,
      [
        'Translator review complete. Forwarded to notary.',
        params.notaryCity ? `City: ${params.notaryCity}` : null,
        params.fulfillmentMethod ? `Fulfillment: ${params.fulfillmentMethod}` : null,
        params.driveUrl ? `Drive: ${params.driveUrl}` : null,
      ].filter(Boolean).join('\n'),
    );

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

    console.log(`${tag} ✓ forwarded to notary`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${tag} transitionToNotary failed: ${msg}`);
    await updateJobIntegration(params.jobId, { jira_sync_status: 'error', last_integration_error: msg });
    void notifyOperatorError({ jobId: params.jobId, error: msg, context: 'to_notary' }).catch(() => undefined);
  }
}

// ─── 5. Notary done → return to operator ─────────────────────────────────────

export async function transitionNotaryToOperator(params: {
  jobId: string;
  jiraIssueKey: string;
}): Promise<void> {
  const tag = `[integration:${params.jobId.slice(0, 8)}]`;

  try {
    const ids = await getResolvedIds();

    if (ids?.operatorAccountId) {
      await assignJiraIssue(params.jiraIssueKey, ids.operatorAccountId);
    }
    if (ids?.securityLevelOperatorId) {
      await setJiraSecurityLevel(params.jiraIssueKey, ids.securityLevelOperatorId);
    }
    await transitionJiraIssue(params.jiraIssueKey, JIRA_PROJECT_CONFIG.transitionNames.toOperator);
    await addJiraComment(params.jiraIssueKey, 'Notarization complete. Returned to operator for final QA / delivery.');

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

    console.log(`${tag} ✓ notary done — returned to operator`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${tag} transitionNotaryToOperator failed: ${msg}`);
    await updateJobIntegration(params.jobId, { jira_sync_status: 'error', last_integration_error: msg });
    void notifyOperatorError({ jobId: params.jobId, error: msg, context: 'notary_to_operator' }).catch(() => undefined);
  }
}
