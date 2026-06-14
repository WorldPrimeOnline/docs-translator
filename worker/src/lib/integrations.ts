/**
 * Worker integration helpers: Drive folder creation + Jira issue creation +
 * translator review transition + Telegram notifications.
 *
 * initializeOrderIntegrations — runs BEFORE OCR, creates Drive folder + Jira issue.
 * triggerTranslatorReview     — runs AFTER AI draft, uploads draft + Jira transition.
 *
 * All Jira credentials come from env: JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN.
 * All project config comes from env:  JIRA_PROJECT_KEY, JIRA_ISSUE_TYPE_NAME,
 *   JIRA_OPERATOR_QUERY, JIRA_TRANSLATOR_QUERY, JIRA_NOTARY_QUERY,
 *   JIRA_SECURITY_LEVEL_TRANSLATOR_NAME, JIRA_TRANSITION_TO_TRANSLATOR.
 * Drive config from env: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET,
 *   GOOGLE_REFRESH_TOKEN, GOOGLE_DRIVE_ROOT_FOLDER_ID.
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

async function resolveUserAccountId(query: string): Promise<string | null> {
  if (!query) return null;
  const res = await jiraFetch(`/users/search?query=${encodeURIComponent(query)}&maxResults=10`);
  if (!res?.ok) return null;
  const users = (await res.json()) as { accountId: string; displayName: string; emailAddress?: string }[];
  if (!users.length) return null;
  const exact = users.find(
    (u) =>
      u.emailAddress?.toLowerCase() === query.toLowerCase() ||
      u.displayName.toLowerCase() === query.toLowerCase(),
  );
  return (exact ?? users[0])!.accountId;
}

async function resolveSecurityLevelId(projectKey: string, levelName: string): Promise<string | null> {
  if (!levelName || !projectKey) return null;
  const res = await jiraFetch(`/project/${projectKey}/securitylevel`);
  if (!res?.ok) return null;
  const data = (await res.json()) as { levels: { id: string; name: string }[] };
  return data.levels.find((l) => l.name.toLowerCase() === levelName.toLowerCase())?.id ?? null;
}

async function resolveTransitionId(issueKey: string, transitionName: string): Promise<string | null> {
  const res = await jiraFetch(`/issue/${issueKey}/transitions`);
  if (!res?.ok) return null;
  const data = (await res.json()) as { transitions: { id: string; name: string }[] };
  const found = data.transitions.find((t) => t.name.toLowerCase() === transitionName.toLowerCase());
  if (!found) {
    console.warn(
      `[worker-jira] Transition "${transitionName}" not available for ${issueKey}. Available: ` +
        data.transitions.map((t) => t.name).join(', '),
    );
  }
  return found?.id ?? null;
}

async function assignJiraIssue(issueKey: string, accountId: string): Promise<void> {
  const res = await jiraFetch(`/issue/${issueKey}/assignee`, {
    method: 'PUT',
    body: JSON.stringify({ accountId }),
  });
  if (res && !res.ok) console.error(`[worker-jira] assign ${issueKey} failed: ${res.status}`);
}

async function setJiraSecurityLevel(issueKey: string, levelId: string): Promise<void> {
  const res = await jiraFetch(`/issue/${issueKey}`, {
    method: 'PUT',
    body: JSON.stringify({ fields: { security: { id: levelId } } }),
  });
  if (res && !res.ok) console.error(`[worker-jira] setSecurityLevel ${issueKey} failed: ${res.status}`);
}

async function transitionJiraIssue(issueKey: string, transitionName: string): Promise<void> {
  const transitionId = await resolveTransitionId(issueKey, transitionName);
  if (!transitionId) return;
  const res = await jiraFetch(`/issue/${issueKey}/transitions`, {
    method: 'POST',
    body: JSON.stringify({ transition: { id: transitionId } }),
  });
  if (res && !res.ok) console.error(`[worker-jira] transition "${transitionName}" failed: ${res.status}`);
}

async function addJiraComment(issueKey: string, text: string): Promise<void> {
  const res = await jiraFetch(`/issue/${issueKey}/comment`, {
    method: 'POST',
    body: JSON.stringify({
      body: { version: 1, type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] },
    }),
  });
  if (res && !res.ok) console.error(`[worker-jira] comment on ${issueKey} failed: ${res.status}`);
}

function serviceLevelLabel(level: ServiceLevel): string {
  if (level === 'notarization_through_partners') return 'Notarization';
  if (level === 'official_with_translator_signature_and_provider_stamp') return 'Certified';
  return 'Electronic';
}

async function createJiraIssue(params: {
  jobId: string;
  serviceLevel: ServiceLevel;
  sourceLang: string;
  targetLang: string;
  documentType: string;
  notaryCity?: string | null;
  fulfillmentMethod?: string | null;
  driveUrl?: string | null;
  wpoUrl: string;
}): Promise<{ issueKey: string; issueId: string; issueUrl: string } | null> {
  const auth = getJiraAuth();
  const projectKey = process.env.JIRA_PROJECT_KEY;
  if (!auth || !projectKey) {
    console.log('[worker-jira] Jira not configured (missing JIRA_BASE_URL/EMAIL/API_TOKEN/PROJECT_KEY)');
    return null;
  }

  const issueTypeName = process.env.JIRA_ISSUE_TYPE_NAME ?? 'Task';
  const label = serviceLevelLabel(params.serviceLevel);
  const docType = params.documentType.split('|')[0] ?? params.documentType;
  const summary = `WPO-${params.jobId.slice(0, 8)} | ${params.sourceLang.toUpperCase()} → ${params.targetLang.toUpperCase()} | ${docType} | ${label}`;

  const descriptionLines = [
    `WPO Job ID: ${params.jobId}`,
    `Service Level: ${params.serviceLevel}`,
    `Languages: ${params.sourceLang} → ${params.targetLang}`,
    `Document Type: ${docType}`,
    params.notaryCity ? `City: ${params.notaryCity}` : null,
    params.fulfillmentMethod ? `Fulfillment: ${params.fulfillmentMethod}` : null,
    params.driveUrl ? `Drive: ${params.driveUrl}` : null,
    `WPO Order: ${params.wpoUrl}`,
  ].filter(Boolean).join('\n');

  // Resolve operator account for initial assignment
  const operatorQuery = process.env.JIRA_OPERATOR_QUERY ?? '';
  let operatorAccountId: string | null = null;
  if (operatorQuery) {
    operatorAccountId = await resolveUserAccountId(operatorQuery).catch(() => null);
  }

  const body: Record<string, unknown> = {
    fields: {
      project: { key: projectKey },
      issuetype: { name: issueTypeName },
      summary,
      ...(operatorAccountId ? { assignee: { accountId: operatorAccountId } } : {}),
      description: {
        type: 'doc',
        version: 1,
        content: [{ type: 'paragraph', content: [{ type: 'text', text: descriptionLines }] }],
      },
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
  fulfillmentMethod?: string | null;
  /** R2 key of the source PDF — uploaded to Drive 01_SOURCE if provided */
  sourceFileKey?: string | null;
}): Promise<InitResult> {
  const tag = `[worker-integration:${params.jobId.slice(0, 8)}]`;
  console.log(`${tag} initializeOrderIntegrations — ${params.serviceLevel}`);

  // Check if already initialized
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
      // Notify operator
      const chatId = process.env.TELEGRAM_OPERATOR_CHAT_ID ?? process.env.TELEGRAM_TRANSLATOR_CHAT_ID;
      if (chatId) await sendTelegram(chatId, `⚠️ Drive folder creation failed\nJob: ${params.jobId.slice(0, 8)}\n${msg}`).catch(() => undefined);
    }
  } else if (driveFolderId) {
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
    try {
      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? process.env.SITE_URL ?? 'https://wpotranslations.org';
      const issue = await createJiraIssue({
        jobId: params.jobId,
        serviceLevel: params.serviceLevel,
        sourceLang: params.sourceLang,
        targetLang: params.targetLang,
        documentType: params.documentType,
        notaryCity: params.notaryCity,
        fulfillmentMethod: params.fulfillmentMethod,
        driveUrl,
        wpoUrl: `${siteUrl}/dashboard`,
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

        // Notify operator
        const chatId = process.env.TELEGRAM_OPERATOR_CHAT_ID ?? process.env.TELEGRAM_TRANSLATOR_CHAT_ID;
        if (chatId) {
          const auth = getJiraAuth();
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

  return { jiraIssueKey, jiraIssueUrl, driveFolderId, driveUrl, aiDraftFolderId, sourceFolderId };
}

/**
 * After AI draft is generated: upload to Drive 02_AI_DRAFT + assign Jira to translator.
 * Called by the worker after rendering the DOCX/PDF draft.
 */
export async function triggerTranslatorReview(params: {
  jobId: string;
  jiraIssueKey: string;
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
  const auth = getJiraAuth();
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

  // ── 2. Jira: assign to translator + security level + transition ────────────
  if (!auth) {
    console.log(`${tag} Jira not configured — skipping translator review transition`);
    return;
  }

  const toTranslatorName = process.env.JIRA_TRANSITION_TO_TRANSLATOR ?? 'In Progress';
  const translatorQuery = process.env.JIRA_TRANSLATOR_QUERY ?? '';
  const translatorSecLevelName = process.env.JIRA_SECURITY_LEVEL_TRANSLATOR_NAME ?? '';
  const projectKey = process.env.JIRA_PROJECT_KEY ?? params.jiraIssueKey.split('-')[0] ?? '';

  try {
    const [translatorAccountId, translatorSecLevelId] = await Promise.all([
      translatorQuery ? resolveUserAccountId(translatorQuery) : Promise.resolve(null),
      translatorSecLevelName && projectKey
        ? resolveSecurityLevelId(projectKey, translatorSecLevelName)
        : Promise.resolve(null),
    ]);

    if (translatorAccountId) await assignJiraIssue(params.jiraIssueKey, translatorAccountId);
    if (translatorSecLevelId) await setJiraSecurityLevel(params.jiraIssueKey, translatorSecLevelId);
    await transitionJiraIssue(params.jiraIssueKey, toTranslatorName);
    await addJiraComment(params.jiraIssueKey, 'AI draft ready. Assigned for translator review.');

    await updateJobIntegration(params.jobId, {
      jira_sync_status: 'translator_review',
    });

    // Notify translator
    const chatId = process.env.TELEGRAM_TRANSLATOR_CHAT_ID;
    if (chatId) {
      const jiraUrl = `${auth.baseUrl}/browse/${params.jiraIssueKey}`;
      await sendTelegram(
        chatId,
        [
          `📋 <b>New Translation Assignment</b>`,
          `Job: <code>${params.jobId.slice(0, 8)}</code>`,
          `${params.sourceLang.toUpperCase()} → ${params.targetLang.toUpperCase()} | ${params.documentType.split('|')[0]}`,
          `Jira: <a href="${jiraUrl}">${params.jiraIssueKey}</a>`,
          params.driveUrl ? `Drive: ${params.driveUrl}` : null,
        ].filter(Boolean).join('\n'),
      ).catch(() => undefined);
    }

    console.log(`${tag} ✓ translator review triggered (${params.jiraIssueKey})`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${tag} triggerTranslatorReview Jira steps failed: ${msg}`);
    await updateJobIntegration(params.jobId, { jira_sync_status: 'error', last_integration_error: msg });
    // Don't throw — let the main pipeline continue; operator is notified via Telegram
    const chatId = process.env.TELEGRAM_OPERATOR_CHAT_ID ?? process.env.TELEGRAM_TRANSLATOR_CHAT_ID;
    if (chatId) await sendTelegram(chatId, `⚠️ Translator review transition failed\nJob: ${params.jobId.slice(0, 8)}\n${msg}`).catch(() => undefined);
  }
}
