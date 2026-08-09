// Telegram Bot API — server-side only.
// Required env var: TELEGRAM_BOT_TOKEN
// Legacy static chat-ID env vars kept for backward compatibility with existing notifications:
//   TELEGRAM_OPERATOR_CHAT_ID, TELEGRAM_TRANSLATOR_CHAT_ID, TELEGRAM_NOTARY_CHAT_ID
//
// For dynamic per-assignee notifications use sendDirectMessage() / sendDirectMessageWithButtons().

export interface TelegramButton {
  text: string;
  url: string;
}

export interface SendMessageResult {
  ok: boolean;
  messageId: string | null;
  error: string | null;
}

function getToken(): string | null {
  return process.env.TELEGRAM_BOT_TOKEN ?? null;
}

async function sendMessage(chatId: string, text: string): Promise<void> {
  const token = getToken();
  if (!token) {
    console.log('[telegram] TELEGRAM_BOT_TOKEN not set — skipping notification');
    return;
  }

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
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

/**
 * Send a message to a known chat ID with optional URL inline keyboard buttons.
 * Returns a SendMessageResult so callers can log delivery outcome.
 */
export async function sendDirectMessageWithButtons(
  chatId: string,
  text: string,
  buttons: TelegramButton[],
): Promise<SendMessageResult> {
  const token = getToken();
  if (!token) {
    return { ok: false, messageId: null, error: 'TELEGRAM_BOT_TOKEN not set' };
  }

  const body: Record<string, unknown> = {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  };

  if (buttons.length > 0) {
    body.reply_markup = {
      inline_keyboard: buttons.map(btn => [{ text: btn.text, url: btn.url }]),
    };
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const t = await res.text().catch(() => '');
      const errorMsg = `HTTP ${res.status}: ${t.slice(0, 200)}`;
      console.error(`[telegram] sendDirectMessageWithButtons to ${chatId} failed: ${errorMsg}`);
      return { ok: false, messageId: null, error: errorMsg };
    }

    const json = (await res.json()) as { ok: boolean; result?: { message_id: number } };
    const messageId = json.result?.message_id?.toString() ?? null;
    return { ok: true, messageId, error: null };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[telegram] sendDirectMessageWithButtons to ${chatId} threw: ${errorMsg}`);
    return { ok: false, messageId: null, error: errorMsg };
  }
}

// ─── Callback-button messaging (Telegram operations integration) ─────────────
// Used by /api/telegram/jira-event and /api/telegram/webhook. Buttons here carry
// callback_data (routed back through our own webhook), unlike TelegramButton's url
// buttons above which open an external link directly.

export interface TelegramCallbackButton {
  text: string;
  callback_data: string;
}

/** Send a message with inline callback-data buttons. Returns the message_id to store for later edits. */
export async function sendMessageWithCallbackButtons(
  chatId: string | number,
  text: string,
  buttons: TelegramCallbackButton[],
): Promise<SendMessageResult> {
  const token = getToken();
  if (!token) {
    return { ok: false, messageId: null, error: 'TELEGRAM_BOT_TOKEN not set' };
  }

  const body: Record<string, unknown> = {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  };
  if (buttons.length > 0) {
    body.reply_markup = { inline_keyboard: buttons.map((btn) => [{ text: btn.text, callback_data: btn.callback_data }]) };
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const t = await res.text().catch(() => '');
      const errorMsg = `HTTP ${res.status}: ${t.slice(0, 200)}`;
      console.error(`[telegram] sendMessageWithCallbackButtons to ${chatId} failed: ${errorMsg}`);
      return { ok: false, messageId: null, error: errorMsg };
    }

    const json = (await res.json()) as { ok: boolean; result?: { message_id: number } };
    const messageId = json.result?.message_id?.toString() ?? null;
    return { ok: true, messageId, error: null };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[telegram] sendMessageWithCallbackButtons to ${chatId} threw: ${errorMsg}`);
    return { ok: false, messageId: null, error: errorMsg };
  }
}

/**
 * Edit an existing message's text and inline keyboard in place — the Telegram
 * operations UX never posts a new message after the initial broadcast, it edits
 * this one for every confirmed Jira status change. An empty `buttons` array clears
 * the keyboard entirely (used for terminal states).
 *
 * Telegram returns a 400 "message is not modified" error when the new text/markup
 * is identical to the current message — treated as success (idempotent no-op), not
 * a failure, since a duplicate status_changed delivery must not error out.
 */
export async function editMessageWithCallbackButtons(
  chatId: string | number,
  messageId: string | number,
  text: string,
  buttons: TelegramCallbackButton[],
): Promise<SendMessageResult> {
  const token = getToken();
  if (!token) {
    return { ok: false, messageId: null, error: 'TELEGRAM_BOT_TOKEN not set' };
  }

  const body: Record<string, unknown> = {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    reply_markup: { inline_keyboard: buttons.map((btn) => [{ text: btn.text, callback_data: btn.callback_data }]) },
  };

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/editMessageText`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const t = await res.text().catch(() => '');
      if (t.includes('message is not modified')) {
        return { ok: true, messageId: messageId.toString(), error: null };
      }
      const errorMsg = `HTTP ${res.status}: ${t.slice(0, 200)}`;
      console.error(`[telegram] editMessageWithCallbackButtons ${chatId}/${messageId} failed: ${errorMsg}`);
      return { ok: false, messageId: null, error: errorMsg };
    }

    return { ok: true, messageId: messageId.toString(), error: null };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[telegram] editMessageWithCallbackButtons ${chatId}/${messageId} threw: ${errorMsg}`);
    return { ok: false, messageId: null, error: errorMsg };
  }
}

/** Acknowledge a callback_query — required so the tapping user's client stops showing a loading spinner. */
export async function answerCallbackQuery(
  callbackQueryId: string,
  text?: string,
  showAlert = false,
): Promise<void> {
  const token = getToken();
  if (!token) return;

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        callback_query_id: callbackQueryId,
        text: text?.slice(0, 200),
        show_alert: showAlert,
      }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      console.error(`[telegram] answerCallbackQuery failed: ${res.status} ${t.slice(0, 200)}`);
    }
  } catch (err) {
    console.error('[telegram] answerCallbackQuery threw:', err instanceof Error ? err.message : String(err));
  }
}

// ─── Legacy static-chat-ID notifications ──────────────────────────────────────

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

export async function notifyOperatorPaymentAlert(params: {
  paymentId: string;
  invoiceId: string | null;
  jobId: string | null;
  quoteId?: string | null;
  amountKzt: number | null;
  currency: string | null;
  providerStatus: string | null;
  reason: string;
  env: string;
}): Promise<void> {
  const chatId = process.env.TELEGRAM_OPERATOR_CHAT_ID;
  if (!chatId) return;

  const lines = [
    `⚠️ <b>Payment Alert — Manual Review Required</b>`,
    `Env: <b>${params.env}</b>`,
    `Payment: <code>${params.paymentId.slice(0, 8)}</code>`,
    params.invoiceId ? `Invoice: <code>${params.invoiceId}</code>` : null,
    params.jobId ? `Job: <code>${params.jobId.slice(0, 8)}</code>` : null,
    params.quoteId ? `Quote: <code>${params.quoteId.slice(0, 8)}</code>` : null,
    params.amountKzt != null ? `Amount: ${params.amountKzt} KZT` : null,
    params.currency && params.currency !== 'KZT' ? `Currency (unexpected): ${params.currency}` : null,
    params.providerStatus ? `Provider status: ${params.providerStatus}` : null,
    `Reason: ${params.reason}`,
  ].filter(Boolean).join('\n');

  try {
    await sendMessage(chatId, lines);
  } catch (err) {
    console.error('[telegram] notifyOperatorPaymentAlert failed (non-fatal):', (err as Error).message);
  }
}
