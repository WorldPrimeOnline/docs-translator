/**
 * Worker-local integration helpers for Jira and Telegram.
 * Called after the AI draft is ready to notify the translator.
 * Keep in sync with src/lib/integrations/workflow.ts in the web app.
 */

import { supabase } from './supabase';
import type { ServiceLevel } from './output-plan';

function getJiraHeaders(): Headers | null {
  const token = process.env.JIRA_API_TOKEN;
  const email = process.env.JIRA_USER_EMAIL;
  if (!token || !email) return null;
  const h = new Headers();
  h.set('Authorization', `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`);
  h.set('Content-Type', 'application/json');
  h.set('Accept', 'application/json');
  return h;
}

async function assignJiraIssue(issueKey: string, accountId: string): Promise<void> {
  const baseUrl = process.env.JIRA_BASE_URL;
  const headers = getJiraHeaders();
  if (!baseUrl || !headers) return;
  const res = await fetch(`${baseUrl}/rest/api/3/issue/${issueKey}/assignee`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ accountId }),
  });
  if (!res.ok) console.error(`[integrations] assignJiraIssue failed: ${res.status}`);
}

async function setJiraSecurityLevel(issueKey: string, securityLevelId: string): Promise<void> {
  const baseUrl = process.env.JIRA_BASE_URL;
  const headers = getJiraHeaders();
  if (!baseUrl || !headers) return;
  const res = await fetch(`${baseUrl}/rest/api/3/issue/${issueKey}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ fields: { security: { id: securityLevelId } } }),
  });
  if (!res.ok) console.error(`[integrations] setJiraSecurityLevel failed: ${res.status}`);
}

function getTransitionId(name: string): string | null {
  const raw = process.env.JIRA_TRANSITION_MAP_JSON;
  if (!raw) return null;
  try {
    const map = JSON.parse(raw) as Record<string, string>;
    return map[name] ?? null;
  } catch {
    return null;
  }
}

async function transitionJiraIssue(issueKey: string, transitionName: string): Promise<void> {
  const baseUrl = process.env.JIRA_BASE_URL;
  const headers = getJiraHeaders();
  if (!baseUrl || !headers) return;
  const transitionId = getTransitionId(transitionName);
  if (!transitionId) {
    console.warn(`[integrations] No transition ID for "${transitionName}" — skipping transition`);
    return;
  }
  const res = await fetch(`${baseUrl}/rest/api/3/issue/${issueKey}/transitions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ transition: { id: transitionId } }),
  });
  if (!res.ok) console.error(`[integrations] transitionJiraIssue(${transitionName}) failed: ${res.status}`);
}

async function addJiraComment(issueKey: string, body: string): Promise<void> {
  const baseUrl = process.env.JIRA_BASE_URL;
  const headers = getJiraHeaders();
  if (!baseUrl || !headers) return;
  const res = await fetch(`${baseUrl}/rest/api/3/issue/${issueKey}/comment`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ body: { version: 1, type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: body }] }] } }),
  });
  if (!res.ok) console.error(`[integrations] addJiraComment failed: ${res.status}`);
}

async function sendTelegram(chatId: string, text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
  });
  if (!res.ok) console.error(`[integrations] Telegram sendMessage failed: ${res.status}`);
}

export async function triggerTranslatorReview(params: {
  jobId: string;
  jiraIssueKey: string;
  serviceLevel: ServiceLevel;
  sourceLang: string;
  targetLang: string;
  documentType: string;
  driveUrl?: string | null;
}): Promise<void> {
  const tag = `[integrations:${params.jobId.slice(0, 8)}]`;
  console.log(`${tag} triggering translator review`);

  try {
    const translatorAccountId = process.env.JIRA_TRANSLATOR_ACCOUNT_ID;
    const securityLevelId = process.env.JIRA_SECURITY_LEVEL_TRANSLATOR_ID;
    const baseUrl = process.env.JIRA_BASE_URL;

    if (translatorAccountId) {
      await assignJiraIssue(params.jiraIssueKey, translatorAccountId);
    }
    if (securityLevelId) {
      await setJiraSecurityLevel(params.jiraIssueKey, securityLevelId);
    }
    await transitionJiraIssue(params.jiraIssueKey, 'TO_TRANSLATOR');
    await addJiraComment(params.jiraIssueKey, 'AI draft ready. Assigned for translator review.');

    await supabase
      .from('jobs')
      .update({ jira_sync_status: 'translator_review', last_synced_at: new Date().toISOString() })
      .eq('id', params.jobId);

    // Notify translator
    const translatorChatId = process.env.TELEGRAM_TRANSLATOR_CHAT_ID;
    if (translatorChatId) {
      const jiraUrl = baseUrl ? `${baseUrl}/browse/${params.jiraIssueKey}` : null;
      const driveInfo = params.driveUrl ? `\nDrive: ${params.driveUrl}` : '';
      const jiraInfo = jiraUrl ? `\nJira: <a href="${jiraUrl}">${params.jiraIssueKey}</a>` : '';
      const msg = [
        `📋 <b>New translation assignment</b>`,
        `Job: <code>${params.jobId.slice(0, 8)}</code>`,
        `${params.sourceLang.toUpperCase()} → ${params.targetLang.toUpperCase()} | ${params.documentType}`,
        `Level: ${params.serviceLevel}`,
        driveInfo,
        jiraInfo,
      ].filter(Boolean).join('\n');
      await sendTelegram(translatorChatId, msg);
    }

    console.log(`${tag} ✓ translator review triggered`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${tag} triggerTranslatorReview failed: ${msg}`);
    throw err;
  }
}
