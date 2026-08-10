/**
 * Tests for POST /api/telegram/jira-event
 *
 * Telegram Operations is entirely Jira-driven — jira_issue_key + role is the sole
 * operational identity. No Supabase table backs this feature; all persistence is
 * Jira custom fields, hardcoded in JIRA_FIELDS (src/lib/jira/client.ts, mirrored
 * in worker/src/lib/jira/order-fields.ts) — no env vars for field IDs. A Jira
 * issue with no corresponding WPO order at all (e.g. one created manually purely
 * to test this integration) is a fully valid Telegram Operations issue.
 *
 * Verifies: auth, payload validation, broadcast from Jira fields only, idempotency
 * via the message-id field already being set, message-id field write after send,
 * text-serialized page-count/payout parsing, status_changed message projection
 * reading message-id/display-name fields, and that no Jira transition is ever
 * attempted (getJiraIssue/updateJiraIssue are the only Jira calls this route
 * makes — updateJiraIssue only ever sets the deterministic message-id field,
 * never ownership state).
 */

process.env.JIRA_WEBHOOK_SECRET = 'test-secret';
process.env.TELEGRAM_TRANSLATOR_CHAT_ID = '-100111';
process.env.TELEGRAM_NOTARY_CHAT_ID = '-100222';

jest.mock('@/lib/jira/client', () => {
  const actual = jest.requireActual('@/lib/jira/client');
  return { ...actual, getJiraIssue: jest.fn(), updateJiraIssue: jest.fn() };
});
jest.mock('@/lib/telegram/client', () => ({
  sendMessageWithCallbackButtons: jest.fn(),
  editMessageWithCallbackButtons: jest.fn(),
}));

import { NextRequest } from 'next/server';
import { POST } from '../route';
import { getJiraIssue, updateJiraIssue, JIRA_FIELDS } from '@/lib/jira/client';
import { sendMessageWithCallbackButtons, editMessageWithCallbackButtons } from '@/lib/telegram/client';

const F = JIRA_FIELDS;
const mockGetJiraIssue = getJiraIssue as jest.Mock;
const mockUpdateJiraIssue = updateJiraIssue as jest.Mock;
const mockSend = sendMessageWithCallbackButtons as jest.Mock;
const mockEdit = editMessageWithCallbackButtons as jest.Mock;

function makeRequest(body: unknown, secret = 'test-secret'): NextRequest {
  return new NextRequest('http://localhost/api/telegram/jira-event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-wpo-webhook-secret': secret },
    body: JSON.stringify(body),
  });
}

const issueWithFields = (fields: Record<string, unknown>, key = 'WO-123') => ({
  key,
  statusName: 'OPEN',
  fields,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockUpdateJiraIssue.mockResolvedValue(undefined);
});

describe('POST /api/telegram/jira-event', () => {
  // ── Auth ──────────────────────────────────────────────────────────────────
  it('returns 401 when secret header is missing', async () => {
    const req = new NextRequest('http://localhost/api/telegram/jira-event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'translator_order_created', issueKey: 'WO-1' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('returns 401 when secret header is wrong', async () => {
    const res = await POST(makeRequest({ event: 'translator_order_created', issueKey: 'WO-1' }, 'wrong'));
    expect(res.status).toBe(401);
  });

  // ── Payload validation ───────────────────────────────────────────────────
  it('returns 400 for an unrecognized event', async () => {
    const res = await POST(makeRequest({ event: 'bogus_event', issueKey: 'WO-1' }));
    expect(res.status).toBe(400);
  });

  it('returns 400 for status_changed missing jiraStatus', async () => {
    const res = await POST(makeRequest({ event: 'status_changed', issueKey: 'WO-1' }));
    expect(res.status).toBe(400);
  });

  // ── translator_order_created ─────────────────────────────────────────────

  it('broadcasts purely from Jira fields — including a manually created issue with no WPO order at all', async () => {
    mockGetJiraIssue.mockResolvedValue(issueWithFields({
      [F.translationType]: { value: 'Нотариально заверенный' },
      [F.documentType]: { value: 'Доверенность' },
      [F.languagePair]: 'RU → EN',
      [F.documentsLink]: 'https://drive.example/x',
      [F.payablePageCount]: '3',
      [F.translatorPayout]: '4500',
      // message-id field intentionally empty — never broadcast yet
    }, 'WO-900'));
    mockSend.mockResolvedValue({ ok: true, messageId: '999', error: null });

    const res = await POST(makeRequest({ event: 'translator_order_created', issueKey: 'WO-900' }));
    expect(res.status).toBe(200);
    const body = await res.json() as { action: string };
    expect(body.action).toBe('broadcast_sent');

    expect(mockSend).toHaveBeenCalledWith(
      '-100111',
      expect.stringContaining('Оплачиваемые страницы: 3'),
      expect.arrayContaining([expect.objectContaining({ callback_data: 'translator_claim:WO-900' })]),
    );
    expect(mockSend.mock.calls[0][1]).toContain('Выплата переводчику: 4 500 ₸');

    // The returned Telegram message_id is persisted directly onto the Jira issue.
    expect(mockUpdateJiraIssue).toHaveBeenCalledWith('WO-900', { [F.telegramTranslatorMessageId]: '999' });
  });

  it('reads the notary-specific payout field (not the translator one) when broadcasting for role=notary', async () => {
    mockGetJiraIssue.mockResolvedValue(issueWithFields({
      [F.payablePageCount]: '2',
      [F.translatorPayout]: '999999', // must NOT leak into a notary broadcast
      [F.notaryPayout]: '6000',
    }, 'WO-9'));
    mockSend.mockResolvedValue({ ok: true, messageId: '2000', error: null });

    await POST(makeRequest({ event: 'notary_required', issueKey: 'WO-9' }));
    const text = mockSend.mock.calls[0][1] as string;
    expect(text).toContain('Выплата нотариусу: 6 000 ₸');
    expect(text).not.toContain('999999');
  });

  it('is idempotent — skips broadcasting when the message-id field is already set', async () => {
    mockGetJiraIssue.mockResolvedValue(issueWithFields({ [F.telegramTranslatorMessageId]: '555' }));
    const res = await POST(makeRequest({ event: 'translator_order_created', issueKey: 'WO-123' }));
    const body = await res.json() as { skipped: string };
    expect(body.skipped).toBe('already_broadcast');
    expect(mockSend).not.toHaveBeenCalled();
    expect(mockUpdateJiraIssue).not.toHaveBeenCalled();
  });

  it('skips gracefully when the role chat id is not configured', async () => {
    const original = process.env.TELEGRAM_TRANSLATOR_CHAT_ID;
    delete process.env.TELEGRAM_TRANSLATOR_CHAT_ID;

    const res = await POST(makeRequest({ event: 'translator_order_created', issueKey: 'WO-123' }));
    const body = await res.json() as { skipped: string };
    expect(body.skipped).toBe('chat_not_configured');
    expect(mockGetJiraIssue).not.toHaveBeenCalled();

    process.env.TELEGRAM_TRANSLATOR_CHAT_ID = original;
  });

  it('returns 404 when the Jira issue cannot be found', async () => {
    mockGetJiraIssue.mockResolvedValue(null);
    const res = await POST(makeRequest({ event: 'translator_order_created', issueKey: 'WO-404' }));
    expect(res.status).toBe(404);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('omits page count and payout lines when the Jira text fields are empty (never fabricated)', async () => {
    mockGetJiraIssue.mockResolvedValue(issueWithFields({}));
    mockSend.mockResolvedValue({ ok: true, messageId: '1000', error: null });

    await POST(makeRequest({ event: 'translator_order_created', issueKey: 'WO-777' }));
    const text = mockSend.mock.calls[0][1] as string;
    expect(text).not.toContain('Оплачиваемые страницы');
    expect(text).not.toContain('Выплата переводчику');
  });

  it('omits the payout line when the field holds a non-numeric value (never fabricated)', async () => {
    mockGetJiraIssue.mockResolvedValue(issueWithFields({ [F.translatorPayout]: 'TBD' }));
    mockSend.mockResolvedValue({ ok: true, messageId: '1001', error: null });

    await POST(makeRequest({ event: 'translator_order_created', issueKey: 'WO-778' }));
    const text = mockSend.mock.calls[0][1] as string;
    expect(text).not.toContain('Выплата переводчику');
  });

  // ── notary_required ───────────────────────────────────────────────────────

  it('broadcasts a notary order to the notary chat and writes the notary message-id field', async () => {
    mockGetJiraIssue.mockResolvedValue(issueWithFields({}, 'WO-9'));
    mockSend.mockResolvedValue({ ok: true, messageId: '2000', error: null });

    const res = await POST(makeRequest({ event: 'notary_required', issueKey: 'WO-9' }));
    expect(res.status).toBe(200);
    expect(mockSend).toHaveBeenCalledWith(
      '-100222',
      expect.any(String),
      expect.arrayContaining([expect.objectContaining({ callback_data: 'notary_claim:WO-9' })]),
    );
    expect(mockUpdateJiraIssue).toHaveBeenCalledWith('WO-9', { [F.telegramNotaryMessageId]: '2000' });
  });

  // ── Send / persist failure handling — must never silently succeed ──────────

  it('returns 502 without persisting anything when the Telegram send fails', async () => {
    mockGetJiraIssue.mockResolvedValue(issueWithFields({}));
    mockSend.mockResolvedValue({ ok: false, messageId: null, error: 'Telegram down' });

    const res = await POST(makeRequest({ event: 'translator_order_created', issueKey: 'WO-1' }));
    expect(res.status).toBe(502);
    expect(mockUpdateJiraIssue).not.toHaveBeenCalled();
  });

  it('returns 500 (not 200) when the message was sent but the Jira field write fails', async () => {
    mockGetJiraIssue.mockResolvedValue(issueWithFields({}));
    mockSend.mockResolvedValue({ ok: true, messageId: '555', error: null });
    mockUpdateJiraIssue.mockRejectedValue(new Error('Jira down'));

    const res = await POST(makeRequest({ event: 'translator_order_created', issueKey: 'WO-1' }));
    expect(res.status).toBe(500);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('Jira field update failed');
  });

  // ── status_changed ────────────────────────────────────────────────────────

  it('no-ops on an unrelated Jira status without calling getJiraIssue', async () => {
    const res = await POST(makeRequest({ event: 'status_changed', issueKey: 'WO-1', jiraStatus: 'OUT_FOR_DELIVERY' }));
    const body = await res.json() as { action: string };
    expect(body.action).toBe('no_op');
    expect(mockGetJiraIssue).not.toHaveBeenCalled();
  });

  it('edits the stored Telegram message when a recognized status is confirmed', async () => {
    mockGetJiraIssue.mockResolvedValue(issueWithFields({
      [F.telegramTranslatorMessageId]: '999',
      [F.telegramTranslatorName]: 'Aigerim',
    }));
    mockEdit.mockResolvedValue({ ok: true, messageId: '999', error: null });

    const res = await POST(makeRequest({ event: 'status_changed', issueKey: 'WO-123', jiraStatus: 'НАЗНАЧЕН ПЕРЕВОДЧИК' }));
    expect(res.status).toBe(200);
    const body = await res.json() as { action: string };
    expect(body.action).toBe('message_updated');
    expect(mockEdit).toHaveBeenCalledWith(
      '-100111', 999,
      expect.stringContaining('Исполнитель: Aigerim'),
      expect.arrayContaining([expect.objectContaining({ callback_data: 'translator_start:WO-123' })]),
    );
  });

  it('returns no_broadcast and does not call Telegram when the message-id field is empty', async () => {
    mockGetJiraIssue.mockResolvedValue(issueWithFields({}, 'WO-999'));
    const res = await POST(makeRequest({ event: 'status_changed', issueKey: 'WO-999', jiraStatus: 'НАЗНАЧЕН НОТАРИУС' }));
    const body = await res.json() as { action: string };
    expect(body.action).toBe('no_broadcast');
    expect(mockEdit).not.toHaveBeenCalled();
  });

  it('sends an empty button list for terminal statuses', async () => {
    mockGetJiraIssue.mockResolvedValue(issueWithFields({
      [F.telegramNotaryMessageId]: '555',
      [F.telegramNotaryName]: 'Notary A',
    }, 'WO-5'));
    mockEdit.mockResolvedValue({ ok: true, messageId: '555', error: null });

    await POST(makeRequest({ event: 'status_changed', issueKey: 'WO-5', jiraStatus: 'ПЕРЕВОД ЗАВЕРЕН' }));
    expect(mockEdit).toHaveBeenCalledWith('-100222', 555, expect.any(String), []);
  });

  it('falls back to "не назначен" when the display-name field is empty', async () => {
    mockGetJiraIssue.mockResolvedValue(issueWithFields({ [F.telegramTranslatorMessageId]: '111' }));
    mockEdit.mockResolvedValue({ ok: true, messageId: '111', error: null });

    await POST(makeRequest({ event: 'status_changed', issueKey: 'WO-123', jiraStatus: 'ПЕРЕВОД В РАБОТЕ' }));
    expect(mockEdit.mock.calls[0][2]).toContain('Исполнитель: не назначен');
  });
});
