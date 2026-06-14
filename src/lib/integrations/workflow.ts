// Integration workflow orchestrator: Jira + Drive + Telegram + Audit log
// Called by the worker (via HTTP or import) after AI draft is ready,
// and by the Jira webhook handler for subsequent stage transitions.

import { supabaseServer } from '../supabase/server';
import {
  createJiraIssue,
  assignJiraIssue,
  setJiraSecurityLevel,
  transitionJiraIssue,
  addJiraComment,
} from '../jira/client';
import { getJiraConfig } from '../jira/config';
import { createOrderFolder } from '../google-drive/client';
import {
  notifyOperatorNewOrder,
  notifyTranslatorNewAssignment,
  notifyNotaryNewAssignment,
  notifyOperatorTranslatorDone,
  notifyOperatorNotaryDone,
  notifyOperatorError,
} from '../telegram/client';
import type { ServiceLevel } from '../translation-prompts/types';

// ─── Audit log ────────────────────────────────────────────────────────────────

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
    metadata: (params.metadata ?? null) as import('@/types/supabase').Json | null,
  });
  if (error) console.error('[audit] insert failed:', error.message);
}

async function updateJobIntegration(
  jobId: string,
  fields: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabaseServer
    .from('jobs')
    .update({ ...fields, last_synced_at: new Date().toISOString() })
    .eq('id', jobId);
  if (error) console.error('[integration] job update failed:', error.message);
}

// ─── 1. Post-upload: create Jira issue + Drive folder ────────────────────────

export async function initializeOrderIntegrations(params: {
  jobId: string;
  serviceLevel: ServiceLevel;
  sourceLang: string;
  targetLang: string;
  documentType: string;
  notaryCity?: string | null;
  fulfillmentMethod?: 'pickup' | 'delivery' | null;
  siteUrl: string;
}): Promise<void> {
  if (
    params.serviceLevel !== 'official_with_translator_signature_and_provider_stamp' &&
    params.serviceLevel !== 'notarization_through_partners'
  ) {
    return;
  }

  const wpoUrl = `${params.siteUrl}/dashboard`;
  const tag = `[integration:${params.jobId.slice(0, 8)}]`;
  console.log(`${tag} initializing Jira + Drive for ${params.serviceLevel}`);

  // Create Drive folder (non-blocking error)
  let driveUrl: string | null = null;
  try {
    const folder = await createOrderFolder(params.jobId);
    if (folder) {
      driveUrl = folder.folderUrl;
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
        metadata: { folderId: folder.folderId, folderUrl: folder.folderUrl },
      });
      console.log(`${tag} Drive folder created: ${folder.folderUrl}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${tag} Drive folder creation failed: ${msg}`);
    await updateJobIntegration(params.jobId, {
      drive_sync_status: 'error',
      last_integration_error: msg,
    });
    await notifyOperatorError({ jobId: params.jobId, error: msg, context: 'drive_folder_creation' }).catch(() => undefined);
  }

  // Create Jira issue (non-blocking error)
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
        metadata: { issueKey: issue.issueKey, issueUrl: issue.issueUrl },
      });
      console.log(`${tag} Jira issue created: ${issue.issueKey}`);

      // Notify operator
      await notifyOperatorNewOrder({
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
    await updateJobIntegration(params.jobId, {
      jira_sync_status: 'error',
      last_integration_error: msg,
    });
    await notifyOperatorError({ jobId: params.jobId, error: msg, context: 'jira_issue_creation' }).catch(() => undefined);
  }
}

// ─── 2. After AI draft ready: open issue to translator ───────────────────────

export async function transitionToTranslatorReview(params: {
  jobId: string;
  serviceLevel: ServiceLevel;
  sourceLang: string;
  targetLang: string;
  documentType: string;
  driveUrl?: string | null;
  jiraIssueKey: string;
}): Promise<void> {
  const cfg = getJiraConfig();
  const tag = `[integration:${params.jobId.slice(0, 8)}]`;
  console.log(`${tag} transitioning to translator review`);

  try {
    if (cfg?.translatorAccountId) {
      await assignJiraIssue(params.jiraIssueKey, cfg.translatorAccountId);
    }
    if (cfg?.securityLevelTranslatorId) {
      await setJiraSecurityLevel(params.jiraIssueKey, cfg.securityLevelTranslatorId);
    }
    await transitionJiraIssue(params.jiraIssueKey, 'TO_TRANSLATOR');
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
      previousStatus: 'awaiting_translator_review',
      newStatus: 'awaiting_translator_review',
      jiraIssueKey: params.jiraIssueKey,
    });

    // Notify translator
    const jiraUrl = cfg ? `${cfg.baseUrl}/browse/${params.jiraIssueKey}` : null;
    await notifyTranslatorNewAssignment({
      jobId: params.jobId,
      sourceLang: params.sourceLang,
      targetLang: params.targetLang,
      documentType: params.documentType,
      jiraUrl,
      driveUrl: params.driveUrl,
    }).catch((e) => console.error(`${tag} translator Telegram failed:`, e));

    console.log(`${tag} ✓ transitioned to translator review`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${tag} transitionToTranslatorReview failed: ${msg}`);
    await updateJobIntegration(params.jobId, {
      jira_sync_status: 'error',
      last_integration_error: msg,
    });
    await notifyOperatorError({ jobId: params.jobId, error: msg, context: 'transition_to_translator' }).catch(() => undefined);
  }
}

// ─── 3. Translator done → certified: return to operator ──────────────────────

export async function transitionCertifiedToOperator(params: {
  jobId: string;
  jiraIssueKey: string;
}): Promise<void> {
  const cfg = getJiraConfig();
  const tag = `[integration:${params.jobId.slice(0, 8)}]`;

  try {
    if (cfg?.operatorAccountId) {
      await assignJiraIssue(params.jiraIssueKey, cfg.operatorAccountId);
    }
    if (cfg?.securityLevelOperatorId) {
      await setJiraSecurityLevel(params.jiraIssueKey, cfg.securityLevelOperatorId);
    }
    await transitionJiraIssue(params.jiraIssueKey, 'TO_OPERATOR');
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

    const jiraUrl = cfg ? `${cfg.baseUrl}/browse/${params.jiraIssueKey}` : null;
    await notifyOperatorTranslatorDone({
      jobId: params.jobId,
      jiraUrl,
      nextStep: 'operator_review',
    }).catch(() => undefined);

    console.log(`${tag} ✓ certified order returned to operator`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${tag} transitionCertifiedToOperator failed: ${msg}`);
    await updateJobIntegration(params.jobId, { jira_sync_status: 'error', last_integration_error: msg });
    await notifyOperatorError({ jobId: params.jobId, error: msg, context: 'certified_to_operator' }).catch(() => undefined);
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
  const cfg = getJiraConfig();
  const tag = `[integration:${params.jobId.slice(0, 8)}]`;

  try {
    if (cfg?.notaryAccountId) {
      await assignJiraIssue(params.jiraIssueKey, cfg.notaryAccountId);
    }
    if (cfg?.securityLevelNotaryId) {
      await setJiraSecurityLevel(params.jiraIssueKey, cfg.securityLevelNotaryId);
    }
    await transitionJiraIssue(params.jiraIssueKey, 'TO_NOTARY');
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

    const jiraUrl = cfg ? `${cfg.baseUrl}/browse/${params.jiraIssueKey}` : null;

    await Promise.all([
      notifyNotaryNewAssignment({
        jobId: params.jobId,
        sourceLang: params.sourceLang,
        targetLang: params.targetLang,
        notaryCity: params.notaryCity,
        fulfillmentMethod: params.fulfillmentMethod,
        jiraUrl,
        driveUrl: params.driveUrl,
      }),
      notifyOperatorTranslatorDone({ jobId: params.jobId, jiraUrl, nextStep: 'notary' }),
    ]).catch((e) => console.error(`${tag} Telegram notifications failed:`, e));

    console.log(`${tag} ✓ forwarded to notary`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${tag} transitionToNotary failed: ${msg}`);
    await updateJobIntegration(params.jobId, { jira_sync_status: 'error', last_integration_error: msg });
    await notifyOperatorError({ jobId: params.jobId, error: msg, context: 'to_notary' }).catch(() => undefined);
  }
}

// ─── 5. Notary done → return to operator ─────────────────────────────────────

export async function transitionNotaryToOperator(params: {
  jobId: string;
  jiraIssueKey: string;
}): Promise<void> {
  const cfg = getJiraConfig();
  const tag = `[integration:${params.jobId.slice(0, 8)}]`;

  try {
    if (cfg?.operatorAccountId) {
      await assignJiraIssue(params.jiraIssueKey, cfg.operatorAccountId);
    }
    if (cfg?.securityLevelOperatorId) {
      await setJiraSecurityLevel(params.jiraIssueKey, cfg.securityLevelOperatorId);
    }
    await transitionJiraIssue(params.jiraIssueKey, 'TO_OPERATOR');
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

    const jiraUrl = cfg ? `${cfg.baseUrl}/browse/${params.jiraIssueKey}` : null;
    await notifyOperatorNotaryDone({ jobId: params.jobId, jiraUrl }).catch(() => undefined);

    console.log(`${tag} ✓ notary done — returned to operator`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${tag} transitionNotaryToOperator failed: ${msg}`);
    await updateJobIntegration(params.jobId, { jira_sync_status: 'error', last_integration_error: msg });
    await notifyOperatorError({ jobId: params.jobId, error: msg, context: 'notary_to_operator' }).catch(() => undefined);
  }
}
