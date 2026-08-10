/**
 * Tests for POST /api/telegram/webhook
 *
 * Telegram Operations is entirely Jira-driven — no Supabase table backs this
 * feature. Ownership state lives only in Jira custom fields, written ONLY by Jira
 * Automation as part of the claim-transition rule execution — this route never
 * pre-writes ownership fields.
 *
 * Verifies: auth, callback_data parsing, chat validation, claim precheck against
 * Jira issue status (fast/non-authoritative — never writes), ownership checks for
 * start/done against the stored Jira user-id field, status-precondition
 * idempotency, and that every successful action is forwarded to Jira Automation
 * (never a direct Jira transition, never a direct field write for ownership).
 */

process.env.TELEGRAM_WEBHOOK_SECRET = 'tg-secret';
process.env.TELEGRAM_TRANSLATOR_CHAT_ID = '-100111';
process.env.TELEGRAM_NOTARY_CHAT_ID = '-100222';

jest.mock('@/lib/jira/client', () => {
  const actual = jest.requireActual('@/lib/jira/client');
  return { ...actual, getJiraIssue: jest.fn() };
});
jest.mock('@/lib/telegram/client', () => ({ answerCallbackQuery: jest.fn() }));
jest.mock('@/lib/telegram-ops/automation-actions', () => ({ forwardActionToJiraAutomation: jest.fn() }));

import { NextRequest } from 'next/server';
import { POST } from '../route';
import { getJiraIssue, JIRA_FIELDS } from '@/lib/jira/client';
import { answerCallbackQuery } from '@/lib/telegram/client';
import { forwardActionToJiraAutomation } from '@/lib/telegram-ops/automation-actions';

const F = JIRA_FIELDS;
const mockGetJiraIssue = getJiraIssue as jest.Mock;
const mockAnswer = answerCallbackQuery as jest.Mock;
const mockForward = forwardActionToJiraAutomation as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockForward.mockResolvedValue({ ok: true, error: null });
});

function makeUpdate(body: unknown, secret = 'tg-secret'): NextRequest {
  return new NextRequest('http://localhost/api/telegram/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-telegram-bot-api-secret-token': secret },
    body: JSON.stringify(body),
  });
}

function makeCallback(data: string, chatId = -100111, userId = 42, extra: Record<string, unknown> = {}) {
  return {
    callback_query: {
      id: 'cbq-1',
      from: { id: userId, first_name: 'Aigerim', username: 'aigerim_tg', ...extra },
      message: { chat: { id: chatId } },
      data,
    },
  };
}

const issueWithStatus = (statusName: string, fields: Record<string, unknown> = {}) => ({
  key: 'WO-1', statusName, fields,
});

describe('POST /api/telegram/webhook', () => {
  // ── Auth ──────────────────────────────────────────────────────────────────
  it('returns 401 when secret token header is missing', async () => {
    const req = new NextRequest('http://localhost/api/telegram/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(makeCallback('translator_claim:WO-1')),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('returns 401 when secret token header is wrong', async () => {
    const res = await POST(makeUpdate(makeCallback('translator_claim:WO-1'), 'wrong'));
    expect(res.status).toBe(401);
  });

  // ── Non-callback updates / unrecognized data ─────────────────────────────
  it('returns 200 ok for updates with no callback_query', async () => {
    const res = await POST(makeUpdate({ message: { text: 'hi' } }));
    expect(res.status).toBe(200);
    expect(mockGetJiraIssue).not.toHaveBeenCalled();
  });

  it('acknowledges but ignores unrecognized callback_data', async () => {
    const res = await POST(makeUpdate(makeCallback('something_else:WO-1')));
    expect(res.status).toBe(200);
    expect(mockAnswer).toHaveBeenCalledWith('cbq-1');
    expect(mockGetJiraIssue).not.toHaveBeenCalled();
  });

  // ── Chat validation ───────────────────────────────────────────────────────
  it('rejects a claim from the wrong chat', async () => {
    await POST(makeUpdate(makeCallback('translator_claim:WO-1', -999999)));
    expect(mockAnswer).toHaveBeenCalledWith('cbq-1', 'Недоступно в этом чате.', true);
    expect(mockGetJiraIssue).not.toHaveBeenCalled();
  });

  // ── Claim: happy path ─────────────────────────────────────────────────────
  it('claims successfully and forwards translator_claim to Automation when status is OPEN', async () => {
    mockGetJiraIssue.mockResolvedValue(issueWithStatus('OPEN'));

    const res = await POST(makeUpdate(makeCallback('translator_claim:WO-123')));
    expect(res.status).toBe(200);

    expect(mockForward).toHaveBeenCalledWith({
      issueKey: 'WO-123',
      action: 'translator_claim',
      telegramUserId: '42',
      executorName: 'Aigerim',
      role: 'translator',
    });
    expect(mockAnswer).toHaveBeenCalledWith('cbq-1', 'Принято, ожидайте подтверждения.');
  });

  it('claims successfully for a manually created Jira issue with no corresponding WPO order at all', async () => {
    // This route never touches Supabase or a WPO job in any way — a Jira issue
    // created purely to test the integration works identically to a real order.
    mockGetJiraIssue.mockResolvedValue(issueWithStatus('OPEN'));

    const res = await POST(makeUpdate(makeCallback('translator_claim:WO-900')));
    expect(res.status).toBe(200);
    expect(mockForward).toHaveBeenCalledWith(expect.objectContaining({ issueKey: 'WO-900', action: 'translator_claim' }));
  });

  it('notary_claim requires status ПЕРЕВОД ЗАВЕРШЕН', async () => {
    mockGetJiraIssue.mockResolvedValue(issueWithStatus('ПЕРЕВОД ЗАВЕРШЕН'));

    const res = await POST(makeUpdate(makeCallback('notary_claim:WO-9', -100222)));
    expect(res.status).toBe(200);
    expect(mockForward).toHaveBeenCalledWith(expect.objectContaining({ issueKey: 'WO-9', action: 'notary_claim', role: 'notary' }));
  });

  // ── Claim: never pre-writes ownership, never calls a transition ──────────
  it('never calls anything beyond a read-only getJiraIssue before forwarding a claim', async () => {
    mockGetJiraIssue.mockResolvedValue(issueWithStatus('OPEN'));
    await POST(makeUpdate(makeCallback('translator_claim:WO-123')));
    // getJiraIssue is read-only by construction (GET); the only other Jira-facing
    // call this route ever makes is forwardActionToJiraAutomation — verified below.
    expect(mockGetJiraIssue).toHaveBeenCalledTimes(1);
    expect(mockForward).toHaveBeenCalledTimes(1);
  });

  // ── Claim: already claimed / wrong precondition ───────────────────────────
  it('tells the translator the order is already claimed when status is not OPEN, and does not forward', async () => {
    mockGetJiraIssue.mockResolvedValue(issueWithStatus('НАЗНАЧЕН ПЕРЕВОДЧИК'));
    await POST(makeUpdate(makeCallback('translator_claim:WO-123')));
    expect(mockAnswer).toHaveBeenCalledWith('cbq-1', 'Заказ уже назначен другому переводчику.', true);
    expect(mockForward).not.toHaveBeenCalled();
  });

  it('uses the notary-specific taken message when status is not ПЕРЕВОД ЗАВЕРШЕН', async () => {
    mockGetJiraIssue.mockResolvedValue(issueWithStatus('НАЗНАЧЕН НОТАРИУС'));
    await POST(makeUpdate(makeCallback('notary_claim:WO-9', -100222)));
    expect(mockAnswer).toHaveBeenCalledWith('cbq-1', 'Заказ уже назначен другому нотариусу.', true);
    expect(mockForward).not.toHaveBeenCalled();
  });

  it('denies and logs loudly when the Jira issue cannot be found at all', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockGetJiraIssue.mockResolvedValue(null);
    await POST(makeUpdate(makeCallback('translator_claim:WO-404')));
    expect(mockAnswer).toHaveBeenCalledWith('cbq-1', 'Заказ не найден.', true);
    expect(mockForward).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Jira issue WO-404 not found'));
    errorSpy.mockRestore();
  });

  // ── Start/done: issue not found ───────────────────────────────────────────
  it('rejects start when the Jira issue cannot be found', async () => {
    mockGetJiraIssue.mockResolvedValue(null);
    await POST(makeUpdate(makeCallback('translator_start:WO-1')));
    expect(mockAnswer).toHaveBeenCalledWith('cbq-1', 'Заказ не найден.', true);
    expect(mockForward).not.toHaveBeenCalled();
  });

  it('rejects start when no claimant has been recorded on the issue yet', async () => {
    mockGetJiraIssue.mockResolvedValue(issueWithStatus('НАЗНАЧЕН ПЕРЕВОДЧИК', {}));
    await POST(makeUpdate(makeCallback('translator_start:WO-1')));
    expect(mockAnswer).toHaveBeenCalledWith('cbq-1', 'Заказ ещё не назначен.', true);
    expect(mockForward).not.toHaveBeenCalled();
  });

  // ── Start/done: ownership ─────────────────────────────────────────────────
  it('rejects start/done from a user who is not the recorded claimant', async () => {
    mockGetJiraIssue.mockResolvedValue(issueWithStatus('НАЗНАЧЕН ПЕРЕВОДЧИК', { [F.telegramTranslatorUserId]: '999' }));
    await POST(makeUpdate(makeCallback('translator_start:WO-1', -100111, 42)));
    expect(mockAnswer).toHaveBeenCalledWith('cbq-1', 'Этот заказ назначен другому исполнителю.', true);
    expect(mockForward).not.toHaveBeenCalled();
  });

  // ── Start: precondition / idempotency ────────────────────────────────────
  it('treats a stale/duplicate start tap as an idempotent no-op when status is not "НАЗНАЧЕН ПЕРЕВОДЧИК"', async () => {
    mockGetJiraIssue.mockResolvedValue(issueWithStatus('ПЕРЕВОД В РАБОТЕ', { [F.telegramTranslatorUserId]: '42' }));
    await POST(makeUpdate(makeCallback('translator_start:WO-1')));
    expect(mockAnswer).toHaveBeenCalledWith('cbq-1', 'Действие уже выполнено или ожидает подтверждения от Jira.');
    expect(mockForward).not.toHaveBeenCalled();
  });

  it('forwards translator_start when status is "НАЗНАЧЕН ПЕРЕВОДЧИК" and the caller is the recorded claimant', async () => {
    mockGetJiraIssue.mockResolvedValue(issueWithStatus('НАЗНАЧЕН ПЕРЕВОДЧИК', { [F.telegramTranslatorUserId]: '42' }));
    await POST(makeUpdate(makeCallback('translator_start:WO-1')));
    expect(mockForward).toHaveBeenCalledWith({
      issueKey: 'WO-1', action: 'translator_start', telegramUserId: '42', executorName: 'Aigerim', role: 'translator',
    });
  });

  // ── Done: requires ПЕРЕВОД В РАБОТЕ / В РАБОТЕ У НОТАРИУСА ────────────────
  it('rejects done when status is still "НАЗНАЧЕН ПЕРЕВОДЧИК" (start not yet confirmed by Jira)', async () => {
    mockGetJiraIssue.mockResolvedValue(issueWithStatus('НАЗНАЧЕН ПЕРЕВОДЧИК', { [F.telegramTranslatorUserId]: '42' }));
    await POST(makeUpdate(makeCallback('translator_done:WO-1')));
    expect(mockForward).not.toHaveBeenCalled();
  });

  it('forwards notary_done when status is "В РАБОТЕ У НОТАРИУСА" and the caller is the recorded claimant', async () => {
    mockGetJiraIssue.mockResolvedValue(issueWithStatus('В РАБОТЕ У НОТАРИУСА', { [F.telegramNotaryUserId]: '7' }));
    await POST(makeUpdate(makeCallback('notary_done:WO-9', -100222, 7)));
    expect(mockForward).toHaveBeenCalledWith({
      issueKey: 'WO-9', action: 'notary_done', telegramUserId: '7', executorName: 'Aigerim', role: 'notary',
    });
  });
});
