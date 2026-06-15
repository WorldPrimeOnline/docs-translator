/**
 * Worker integration helpers: Drive folder creation + Jira issue creation +
 * translator review notification + Telegram.
 *
 * initializeOrderIntegrations — runs BEFORE OCR, creates Drive folder + Jira issue.
 * triggerTranslatorReview     — runs AFTER AI draft, uploads draft to Drive 02_AI_DRAFT.
 *
 * Jira credentials: JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN.
 * Jira project config: JIRA_PROJECT_KEY (default: WO), JIRA_ISSUE_TYPE_NAME (default: Заказ).
 * Drive config: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN, GOOGLE_DRIVE_ROOT_FOLDER_ID.
 *
 * All Jira-internal transitions (assignee, security level, status, notifications) are
 * handled by Jira Automation — WPO does NOT call those APIs.
 */

import { supabase } from './supabase';
import {
  createOrderFolder,
  uploadFileToDrive,
  getSubfolderId,
  isDriveConfigured,
  DRIVE_SUBFOLDER_NAMES,
} from './google-drive';
import { downloadFile } from './r2';
import type { ServiceLevel } from './output-plan';
import { buildJiraIssueFields } from './jira/order-fields';

// ─── Jira helpers ─────────────────────────────────────────────────────────────

function getJiraAuth(): { baseUrl: string; authHeader: string } | null {
  const baseUrl = process.env.JIRA_BASE_URL;
  const email = process.env.JIRA_EMAIL;
  const token = process.env.JIRA_API_TOKEN;
  if (!baseUrl || !email || !token) return null;
  return {
    baseUrl: baseUrl.replace(/\/$/, ''),
    authHeader: 'Basic ' + Buffer.from(`${email}:${token}`).toString('base64'),
  };
}

async function jiraFetch(path: string, options: RequestInit = {}): Promise<Response | null> {
  const auth = getJiraAuth();
  if (!auth) return null;
  try {
    return fetch(`${auth.baseUrl}/rest/api/3${path}`, {
      ...options,
      headers: {
        Authorization: auth.authHeader,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(options.headers as Record<string, string> ?? {}),
      },
    });
  } catch (e) {
    console.error(`[worker-jira] fetch ${path} error:`, e instanceof Error ? e.message : e);
    return null;
  }
}

function serviceLevelLabel(level: ServiceLevel): string {
  if (level === 'notarization_through_partners') return 'notarized';
  if (level === 'official_with_translator_signature_and_provider_stamp') return 'certified';
  return 'electronic';
}

async function createJiraIssue(params: {
  jobId: string;
  customerId: string | null;
  serviceLevel: ServiceLevel;
  sourceLang: string;
  targetLang: string;
  documentType: string;
  notaryCity?: string | null;
  fulfillmentMethod?: 'pickup' | 'delivery' | null;
  deliveryPhone?: string | null;
  deliveryAddress?: string | null;
  paymentSource?: 'card_payment' | 'subscription' | null;
  driveUrl?: string | null;
  wpoUrl: string;
  createdAt?: string;
}): Promise<{ issueKey: string; issueId: string; issueUrl: string } | null> {
  const auth = getJiraAuth();
  if (!auth) {
    console.log('[worker-jira] Jira not configured — skipping issue creation');
    return null;
  }

  const projectKey = process.env.JIRA_PROJECT_KEY ?? 'WO';

  // Safe description (no PII, no document content)
  const descLines: string[] = [
    `Job ID: ${params.jobId}`,
    `Service: ${serviceLevelLabel(params.serviceLevel)}`,
    `Languages: ${params.sourceLang} → ${params.targetLang}`,
    `Document type: ${params.documentType.split('|')[0] ?? params.documentType}`,
    params.notaryCity ? `Notary city: ${params.notaryCity}` : null,
    params.fulfillmentMethod ? `Fulfillment: ${params.fulfillmentMethod}` : null,
    params.driveUrl ? `Drive: ${params.driveUrl}` : null,
    `WPO order: ${params.wpoUrl}`,
    params.createdAt ? `Created: ${params.createdAt}` : null,
  ].filter((x): x is string => x !== null);

  const customFields = buildJiraIssueFields({
    orderId: params.jobId,
    customerId: params.customerId,
    sourceLang: params.sourceLang,
    targetLang: params.targetLang,
    documentType: params.documentType,
    serviceLevel: params.serviceLevel,
    paymentSource: params.paymentSource ?? null,
    fulfillmentMethod: params.fulfillmentMethod ?? null,
    deliveryPhone: params.deliveryPhone ?? null,
    deliveryAddress: params.deliveryAddress ?? null,
    driveUrl: params.driveUrl ?? null,
  });

  const body = {
    fields: {
      project: { key: projectKey },
      issuetype: { name: 'Заказ' },
      summary: params.jobId,
      description: {
        type: 'doc',
        version: 1,
        content: descLines.map((text) => ({
          type: 'paragraph',
          content: [{ type: 'text', text }],
        })),
      },
      ...customFields,
    },
  };

  const res = await jiraFetch('/issue', { method: 'POST', body: JSON.stringify(body) });
  if (!res) return null;

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Jira createIssue failed: ${res.status} ${text.slice(0, 300)}`);
  }

  const data = (await res.json()) as { id: string; key: string };
  return {
    issueId: data.id,
    issueKey: data.key,
    issueUrl: `${auth.baseUrl}/browse/${data.key}`,
  };
}

// ─── Telegram helper ──────────────────────────────────────────────────────────

async function sendTelegram(chatId: string, text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
    });
    if (!res.ok) console.error(`[worker-telegram] sendMessage failed: ${res.status}`);
  } catch (e) {
    console.error('[worker-telegram] sendMessage threw:', e instanceof Error ? e.message : e);
  }
}

// ─── Supabase update helpers ───────────────────────────────────────────────────

async function updateJobIntegration(jobId: string, fields: Record<string, unknown>): Promise<void> {
  const { error } = await supabase
    .from('jobs')
    .update({ ...fields, last_synced_at: new Date().toISOString() })
    .eq('id', jobId);
  if (error) console.error('[worker-integration] job update failed:', error.message);
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface InitResult {
  jiraIssueKey: string | null;
  jiraIssueUrl: string | null;
  driveFolderId: string | null;
  driveUrl: string | null;
  /** ID of the 02_AI_DRAFT subfolder for later upload */
  aiDraftFolderId: string | null;
  /** ID of the 01_SOURCE subfolder */
  sourceFolderId: string | null;
}

/**
 * Initialize Drive folder + Jira issue for a certified/notarized order.
 * Called by the worker BEFORE OCR to ensure integrations are set up.
 * Idempotent: if folder/issue already exist in DB, skips creation.
 */
export async function initializeOrderIntegrations(params: {
  jobId: string;
  serviceLevel: ServiceLevel;
  sourceLang: string;
  targetLang: string;
  documentType: string;
  notaryCity?: string | null;
  fulfillmentMethod?: 'pickup' | 'delivery' | null;
  deliveryPhone?: string | null;
  deliveryAddress?: string | null;
  paymentSource?: 'card_payment' | 'subscription' | null;
  /** Supabase user ID (documents.user_id) — stored in Jira customfield_10074 */
  customerId?: string | null;
  /** R2 key of the source PDF — uploaded to Drive 01_SOURCE if provided */
  sourceFileKey?: string | null;
}): Promise<InitResult> {
  const tag = `[worker-integration:${params.jobId.slice(0, 8)}]`;
  console.log(`${tag} initializeOrderIntegrations — ${params.serviceLevel}`);

  // Check if already initialized (idempotency guard)
  const { data: existing } = await supabase
    .from('jobs')
    .select('jira_issue_key, jira_issue_url, google_drive_folder_id, google_drive_folder_url')
    .eq('id', params.jobId)
    .single();

  if (existing?.jira_issue_key && existing.google_drive_folder_id) {
    console.log(`${tag} already initialized — jira=${existing.jira_issue_key} drive=${existing.google_drive_folder_id}`);
    const aiDraftFolderId = await getSubfolderId(existing.google_drive_folder_id, DRIVE_SUBFOLDER_NAMES.aiDraft).catch(() => null);
    const sourceFolderId = await getSubfolderId(existing.google_drive_folder_id, DRIVE_SUBFOLDER_NAMES.source).catch(() => null);
    return {
      jiraIssueKey: existing.jira_issue_key,
      jiraIssueUrl: existing.jira_issue_url ?? null,
      driveFolderId: existing.google_drive_folder_id,
      driveUrl: existing.google_drive_folder_url ?? null,
      aiDraftFolderId,
      sourceFolderId,
    };
  }

  let driveFolderId: string | null = existing?.google_drive_folder_id ?? null;
  let driveUrl: string | null = existing?.google_drive_folder_url ?? null;
  let aiDraftFolderId: string | null = null;
  let sourceFolderId: string | null = null;
  let jiraIssueKey: string | null = existing?.jira_issue_key ?? null;
  let jiraIssueUrl: string | null = existing?.jira_issue_url ?? null;

  // ── 1. Create Drive folder ─────────────────────────────────────────────────
  if (!driveFolderId && isDriveConfigured()) {
    try {
      const folder = await createOrderFolder(params.jobId);
      driveFolderId = folder.folderId;
      driveUrl = folder.folderUrl;
      aiDraftFolderId = folder.subfolders.aiDraft;
      sourceFolderId = folder.subfolders.source;

      await updateJobIntegration(params.jobId, {
        google_drive_folder_id: driveFolderId,
        google_drive_folder_url: driveUrl,
        drive_sync_status: 'created',
      });
      console.log(`${tag} ✓ Drive folder created: ${driveUrl}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`${tag} Drive folder creation failed: ${msg}`);
      await updateJobIntegration(params.jobId, { drive_sync_status: 'error', last_integration_error: msg });
      const chatId = process.env.TELEGRAM_OPERATOR_CHAT_ID ?? process.env.TELEGRAM_TRANSLATOR_CHAT_ID;
      if (chatId) await sendTelegram(chatId, `⚠️ Drive folder creation failed\nJob: ${params.jobId.slice(0, 8)}\n${msg}`).catch(() => undefined);
    }
  } else if (!driveFolderId) {
    // Drive env vars not set — record the misconfiguration so the operator can see it
    const msg = 'Google Drive not configured — set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN, GOOGLE_DRIVE_ROOT_FOLDER_ID on Railway';
    console.error(`${tag} ${msg}`);
    await updateJobIntegration(params.jobId, { drive_sync_status: 'error', last_integration_error: msg });
    const chatId = process.env.TELEGRAM_OPERATOR_CHAT_ID ?? process.env.TELEGRAM_TRANSLATOR_CHAT_ID;
    if (chatId) await sendTelegram(chatId, `⚠️ ${msg}\nJob: ${params.jobId.slice(0, 8)}`).catch(() => undefined);
  } else {
    aiDraftFolderId = await getSubfolderId(driveFolderId, DRIVE_SUBFOLDER_NAMES.aiDraft).catch(() => null);
    sourceFolderId = await getSubfolderId(driveFolderId, DRIVE_SUBFOLDER_NAMES.source).catch(() => null);
  }

  // ── 2. Upload source PDF to Drive 01_SOURCE ────────────────────────────────
  if (sourceFolderId && params.sourceFileKey) {
    try {
      const pdfBuf = await downloadFile(params.sourceFileKey);
      await uploadFileToDrive(sourceFolderId, 'source.pdf', pdfBuf, 'application/pdf');
      console.log(`${tag} ✓ source.pdf uploaded to Drive 01_SOURCE`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`${tag} source Drive upload failed (non-fatal): ${msg}`);
    }
  }

  // ── 3. Create Jira issue ───────────────────────────────────────────────────
  if (!jiraIssueKey) {
    if (!getJiraAuth()) {
      // Credentials missing — record the misconfiguration so the operator can see it in Supabase
      const msg = 'Jira credentials not configured — set JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN on Railway';
      console.error(`${tag} ${msg}`);
      await updateJobIntegration(params.jobId, { jira_sync_status: 'error', last_integration_error: msg });
      const chatId = process.env.TELEGRAM_OPERATOR_CHAT_ID ?? process.env.TELEGRAM_TRANSLATOR_CHAT_ID;
      if (chatId) await sendTelegram(chatId, `⚠️ ${msg}\nJob: ${params.jobId.slice(0, 8)}`).catch(() => undefined);
    } else {
      try {
        const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? process.env.SITE_URL ?? 'https://wpotranslations.org';
        const issue = await createJiraIssue({
          jobId: params.jobId,
          customerId: params.customerId ?? null,
          serviceLevel: params.serviceLevel,
          sourceLang: params.sourceLang,
          targetLang: params.targetLang,
          documentType: params.documentType,
          notaryCity: params.notaryCity,
          fulfillmentMethod: params.fulfillmentMethod ?? null,
          deliveryPhone: params.deliveryPhone ?? null,
          deliveryAddress: params.deliveryAddress ?? null,
          paymentSource: params.paymentSource ?? null,
          driveUrl,
          wpoUrl: `${siteUrl}/dashboard`,
          createdAt: new Date().toISOString(),
        });

        if (issue) {
          jiraIssueKey = issue.issueKey;
          jiraIssueUrl = issue.issueUrl;
          await updateJobIntegration(params.jobId, {
            jira_issue_id: issue.issueId,
            jira_issue_key: issue.issueKey,
            jira_issue_url: issue.issueUrl,
            jira_sync_status: 'created',
          });
          console.log(`${tag} ✓ Jira issue created: ${issue.issueKey}`);

          const auth = getJiraAuth();
          const chatId = process.env.TELEGRAM_OPERATOR_CHAT_ID ?? process.env.TELEGRAM_TRANSLATOR_CHAT_ID;
          if (chatId) {
            await sendTelegram(
              chatId,
              [
                `📋 <b>New Order</b> — ${serviceLevelLabel(params.serviceLevel)}`,
                `Job: <code>${params.jobId.slice(0, 8)}</code>`,
                `${params.sourceLang.toUpperCase()} → ${params.targetLang.toUpperCase()} | ${params.documentType.split('|')[0]}`,
                issue.issueKey && auth ? `Jira: <a href="${auth.baseUrl}/browse/${issue.issueKey}">${issue.issueKey}</a>` : null,
                driveUrl ? `Drive: ${driveUrl}` : null,
              ].filter(Boolean).join('\n'),
            ).catch(() => undefined);
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`${tag} Jira issue creation failed: ${msg}`);
        await updateJobIntegration(params.jobId, { jira_sync_status: 'error', last_integration_error: msg });
        const chatId = process.env.TELEGRAM_OPERATOR_CHAT_ID ?? process.env.TELEGRAM_TRANSLATOR_CHAT_ID;
        if (chatId) await sendTelegram(chatId, `⚠️ Jira issue creation failed\nJob: ${params.jobId.slice(0, 8)}\n${msg}`).catch(() => undefined);
      }
    }
  }

  return { jiraIssueKey, jiraIssueUrl, driveFolderId, driveUrl, aiDraftFolderId, sourceFolderId };
}

/**
 * After AI draft is generated: upload to Drive 02_AI_DRAFT.
 * Jira Automation handles all subsequent Jira-side steps (assign, transition, notify).
 */
export async function triggerTranslatorReview(params: {
  jobId: string;
  jiraIssueKey?: string | null;
  serviceLevel: ServiceLevel;
  sourceLang: string;
  targetLang: string;
  documentType: string;
  driveUrl?: string | null;
  driveFolderId?: string | null;
  /** R2 key of the AI draft artifact */
  draftFileKey?: string | null;
  draftFileName?: string | null;
}): Promise<void> {
  const tag = `[worker-integration:${params.jobId.slice(0, 8)}]`;

  // ── 1. Upload AI draft to Drive 02_AI_DRAFT ───────────────────────────────
  if (params.draftFileKey && params.driveFolderId && isDriveConfigured()) {
    try {
      const aiDraftFolderId = await getSubfolderId(params.driveFolderId, DRIVE_SUBFOLDER_NAMES.aiDraft);
      if (aiDraftFolderId) {
        const buf = await downloadFile(params.draftFileKey);
        const name = params.draftFileName ?? 'ai_draft.docx';
        const mime = name.endsWith('.docx')
          ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
          : 'text/html';
        await uploadFileToDrive(aiDraftFolderId, name, buf, mime);
        console.log(`${tag} ✓ AI draft uploaded to Drive 02_AI_DRAFT`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`${tag} AI draft Drive upload failed (non-fatal): ${msg}`);
    }
  }

  // ── 2. Update Supabase + notify translator ────────────────────────────────
  await updateJobIntegration(params.jobId, {
    jira_sync_status: 'translator_review',
  });

  const chatId = process.env.TELEGRAM_TRANSLATOR_CHAT_ID;
  if (chatId) {
    const auth = getJiraAuth();
    const jiraLink =
      params.jiraIssueKey && auth
        ? `\nJira: <a href="${auth.baseUrl}/browse/${params.jiraIssueKey}">${params.jiraIssueKey}</a>`
        : '';
    await sendTelegram(
      chatId,
      [
        `📋 <b>New Translation Assignment</b>`,
        `Job: <code>${params.jobId.slice(0, 8)}</code>`,
        `${params.sourceLang.toUpperCase()} → ${params.targetLang.toUpperCase()} | ${params.documentType.split('|')[0]}`,
        jiraLink || null,
        params.driveUrl ? `Drive: ${params.driveUrl}` : null,
      ].filter(Boolean).join('\n'),
    ).catch(() => undefined);
  }

  console.log(`${tag} ✓ translator review triggered — Jira Automation handles assignment`);
}
