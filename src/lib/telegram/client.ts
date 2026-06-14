// Telegram Bot API — server-side only.
// Required env vars: TELEGRAM_BOT_TOKEN, TELEGRAM_OPERATOR_CHAT_ID
// Optional: TELEGRAM_TRANSLATOR_CHAT_ID, TELEGRAM_NOTARY_CHAT_ID

function getBot(): { token: string } | null {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  return token ? { token } : null;
}

async function sendMessage(chatId: string, text: string): Promise<void> {
  const bot = getBot();
  if (!bot) {
    console.log('[telegram] TELEGRAM_BOT_TOKEN not set — skipping notification');
    return;
  }

  const res = await fetch(`https://api.telegram.org/bot${bot.token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => '');
    console.error(`[telegram] sendMessage to ${chatId} failed: ${res.status} ${t.slice(0, 200)}`);
  }
}

export async function notifyOperatorNewOrder(params: {
  jobId: string;
  serviceLevel: string;
  sourceLang: string;
  targetLang: string;
  documentType: string;
  notaryCity?: string | null;
  fulfillmentMethod?: string | null;
  jiraUrl?: string | null;
  driveUrl?: string | null;
  wpoUrl: string;
}): Promise<void> {
  const chatId = process.env.TELEGRAM_OPERATOR_CHAT_ID;
  if (!chatId) return;

  const lines = [
    `🆕 <b>New ${params.serviceLevel === 'notarization_through_partners' ? 'Notarization' : 'Certified'} Order</b>`,
    `Job: <code>${params.jobId.slice(0, 8)}</code>`,
    `Languages: ${params.sourceLang.toUpperCase()} → ${params.targetLang.toUpperCase()}`,
    `Document: ${params.documentType.split('|')[0]}`,
    params.notaryCity ? `City: ${params.notaryCity}` : null,
    params.fulfillmentMethod ? `Fulfillment: ${params.fulfillmentMethod}` : null,
    params.jiraUrl ? `Jira: ${params.jiraUrl}` : null,
    params.driveUrl ? `Drive: ${params.driveUrl}` : null,
    `Order: ${params.wpoUrl}`,
  ].filter(Boolean).join('\n');

  await sendMessage(chatId, lines);
}

export async function notifyTranslatorNewAssignment(params: {
  jobId: string;
  sourceLang: string;
  targetLang: string;
  documentType: string;
  jiraUrl?: string | null;
  driveUrl?: string | null;
  deadline?: string | null;
}): Promise<void> {
  const chatId = process.env.TELEGRAM_TRANSLATOR_CHAT_ID;
  if (!chatId) return;

  const lines = [
    `📋 <b>New Translation Assignment</b>`,
    `Job: <code>${params.jobId.slice(0, 8)}</code>`,
    `Languages: ${params.sourceLang.toUpperCase()} → ${params.targetLang.toUpperCase()}`,
    `Document: ${params.documentType.split('|')[0]}`,
    params.deadline ? `Deadline: ${params.deadline}` : null,
    params.jiraUrl ? `Jira: ${params.jiraUrl}` : null,
    params.driveUrl ? `Drive: ${params.driveUrl}` : null,
  ].filter(Boolean).join('\n');

  await sendMessage(chatId, lines);
}

export async function notifyNotaryNewAssignment(params: {
  jobId: string;
  sourceLang: string;
  targetLang: string;
  notaryCity?: string | null;
  fulfillmentMethod?: string | null;
  jiraUrl?: string | null;
  driveUrl?: string | null;
  deadline?: string | null;
}): Promise<void> {
  const chatId = process.env.TELEGRAM_NOTARY_CHAT_ID;
  if (!chatId) return;

  const lines = [
    `⚖️ <b>New Notarization Assignment</b>`,
    `Job: <code>${params.jobId.slice(0, 8)}</code>`,
    `Languages: ${params.sourceLang.toUpperCase()} → ${params.targetLang.toUpperCase()}`,
    params.notaryCity ? `City: ${params.notaryCity}` : null,
    params.fulfillmentMethod ? `Fulfillment: ${params.fulfillmentMethod}` : null,
    params.deadline ? `Deadline: ${params.deadline}` : null,
    params.jiraUrl ? `Jira: ${params.jiraUrl}` : null,
    params.driveUrl ? `Drive: ${params.driveUrl}` : null,
  ].filter(Boolean).join('\n');

  await sendMessage(chatId, lines);
}

export async function notifyOperatorTranslatorDone(params: {
  jobId: string;
  jiraUrl?: string | null;
  nextStep: 'operator_review' | 'notary';
}): Promise<void> {
  const chatId = process.env.TELEGRAM_OPERATOR_CHAT_ID;
  if (!chatId) return;

  const nextLabel =
    params.nextStep === 'notary' ? 'Forwarded to notary' : 'Returned for signature/stamp';

  const lines = [
    `✅ <b>Translator completed</b>`,
    `Job: <code>${params.jobId.slice(0, 8)}</code>`,
    `Next: ${nextLabel}`,
    params.jiraUrl ? `Jira: ${params.jiraUrl}` : null,
  ].filter(Boolean).join('\n');

  await sendMessage(chatId, lines);
}

export async function notifyOperatorNotaryDone(params: {
  jobId: string;
  jiraUrl?: string | null;
}): Promise<void> {
  const chatId = process.env.TELEGRAM_OPERATOR_CHAT_ID;
  if (!chatId) return;

  const lines = [
    `⚖️ <b>Notary completed</b>`,
    `Job: <code>${params.jobId.slice(0, 8)}</code>`,
    `Next: Final QA / Ready for delivery`,
    params.jiraUrl ? `Jira: ${params.jiraUrl}` : null,
  ].filter(Boolean).join('\n');

  await sendMessage(chatId, lines);
}

export async function notifyOperatorError(params: {
  jobId: string;
  error: string;
  context: string;
}): Promise<void> {
  const chatId = process.env.TELEGRAM_OPERATOR_CHAT_ID;
  if (!chatId) return;

  const lines = [
    `❌ <b>Integration Error</b>`,
    `Job: <code>${params.jobId.slice(0, 8)}</code>`,
    `Context: ${params.context}`,
    `Error: ${params.error.slice(0, 300)}`,
  ].join('\n');

  await sendMessage(chatId, lines);
}
