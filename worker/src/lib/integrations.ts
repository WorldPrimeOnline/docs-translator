/**
 * Worker-local integration helpers: Jira transitions + Drive upload + Telegram.
 * Called after the AI draft is ready to move the Jira issue to the translator stage.
 * Keep in sync with src/lib/integrations/workflow.ts in the web app.
 *
 * Jira credentials come from env vars: JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN
 * Transition names (not IDs) come from env vars: JIRA_TRANSITION_TO_TRANSLATOR (default: "In Progress")
 * User queries come from env vars: JIRA_TRANSLATOR_QUERY (email or display name)
 */

import { supabase } from './supabase';
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
  return exact?.accountId ?? users[0]!.accountId;
}

async function resolveSecurityLevelId(issueKey: string, levelName: string): Promise<string | null> {
  if (!levelName) return null;
  // Derive project key from issue key (e.g. "WPO-42" → "WPO")
  const projectKey = issueKey.split('-')[0];
  if (!projectKey) return null;
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

// ─── Public API ───────────────────────────────────────────────────────────────

export async function triggerTranslatorReview(params: {
  jobId: string;
  jiraIssueKey: string;
  serviceLevel: ServiceLevel;
  sourceLang: string;
  targetLang: string;
  documentType: string;
  driveUrl?: string | null;
}): Promise<void> {
  const auth = getJiraAuth();
  const tag = `[worker-integration:${params.jobId.slice(0, 8)}]`;

  if (!auth) {
    console.log(`${tag} Jira not configured — skipping translator review transition`);
    return;
  }

  const toTranslatorName = process.env.JIRA_TRANSITION_TO_TRANSLATOR ?? 'In Progress';
  const translatorQuery = process.env.JIRA_TRANSLATOR_QUERY ?? '';
  const translatorSecLevelName = process.env.JIRA_SECURITY_LEVEL_TRANSLATOR_NAME ?? '';

  try {
    const [translatorAccountId, translatorSecLevelId] = await Promise.all([
      translatorQuery ? resolveUserAccountId(translatorQuery) : Promise.resolve(null),
      translatorSecLevelName
        ? resolveSecurityLevelId(params.jiraIssueKey, translatorSecLevelName)
        : Promise.resolve(null),
    ]);

    if (translatorAccountId) {
      await assignJiraIssue(params.jiraIssueKey, translatorAccountId);
    }
    if (translatorSecLevelId) {
      await setJiraSecurityLevel(params.jiraIssueKey, translatorSecLevelId);
    }
    await transitionJiraIssue(params.jiraIssueKey, toTranslatorName);
    await addJiraComment(params.jiraIssueKey, 'AI draft ready. Assigned for translator review.');

    await supabase
      .from('jobs')
      .update({ jira_sync_status: 'translator_review', last_synced_at: new Date().toISOString() })
      .eq('id', params.jobId);

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
      );
    }

    console.log(`${tag} ✓ translator review triggered (${params.jiraIssueKey})`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${tag} triggerTranslatorReview failed: ${msg}`);
    throw err;
  }
}
