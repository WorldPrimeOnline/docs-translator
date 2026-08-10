/**
 * Tests for POST /api/telegram/webhook
 *
 * Telegram Operations is entirely Jira-driven — no Supabase table backs this
 * feature. Ownership state lives only in Jira custom fields, written ONLY by Jira
 * Automation as part of the claim-transition rule execution — this route never
 * pre-writes ownership fields.
 *
 * Claim (translator_claim / notary_claim): Jira Automation is the SOLE authority
 * for claim acceptance. WO-122 production incident (2026-08-10) — a local status
 * precheck here rejected a legitimately-claimable OPEN issue before Automation was
 * ever contacted. Fixed by removing the local check entirely: this route never
 * calls getJiraIssue for a claim and always dispatches once the Telegram-side
 * envelope (secret, chat, action shape) is valid.
 *
 * Start/done: ownership checks against the stored Jira user-id field, and
 * status-precondition idempotency, are unchanged and still verified here.
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
  mockForward.mockResolvedValue({ ok: true, error: null, httpStatus: 200 });
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
    expect(mockForward).not.toHaveBeenCalled();
  });

  it('acknowledges but ignores unrecognized callback_data', async () => {
    const res = await POST(makeUpdate(makeCallback('something_else:WO-1')));
    expect(res.status).toBe(200);
    expect(mockAnswer).toHaveBeenCalledWith('cbq-1');
    expect(mockForward).not.toHaveBeenCalled();
  });

  // ── Chat validation ───────────────────────────────────────────────────────
  it('rejects a claim from the wrong chat', async () => {
    await POST(makeUpdate(makeCallback('translator_claim:WO-1', -999999)));
    expect(mockAnswer).toHaveBeenCalledWith('cbq-1', 'Недоступно в этом чате.', true);
    expect(mockForward).not.toHaveBeenCalled();
  });

  // ── Claim: Jira Automation is the sole authority — no local Jira read/check ──
  it('never calls getJiraIssue for a claim — no local status precheck exists', async () => {
    await POST(makeUpdate(makeCallback('translator_claim:WO-123')));
    expect(mockGetJiraIssue).not.toHaveBeenCalled();
  });

  it('always dispatches translator_claim to Jira Automation once the Telegram envelope is valid, regardless of Jira state', async () => {
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

  // Regression test for the WO-122 production incident: an OPEN issue with no
  // claimant fields set yet must always be dispatched to Jira Automation for
  // translator_claim — this route must never independently decide the issue is
  // "already claimed" or otherwise unclaimable.
  it('regression WO-122: OPEN issue with empty claimant fields always dispatches translator_claim to Jira Automation', async () => {
    // Even though nothing stubs getJiraIssue to be consulted, assert dispatch
    // happens unconditionally by never wiring a status/fields lookup at all.
    mockGetJiraIssue.mockResolvedValue(issueWithStatus('OPEN', {
      [F.telegramTranslatorUserId]: '',
      [F.telegramTranslatorName]: '',
    }));

    const res = await POST(makeUpdate(makeCallback('translator_claim:WO-122')));

    expect(res.status).toBe(200);
    expect(mockGetJiraIssue).not.toHaveBeenCalled();
    expect(mockForward).toHaveBeenCalledTimes(1);
    expect(mockForward).toHaveBeenCalledWith(expect.objectContaining({
      issueKey: 'WO-122',
      action: 'translator_claim',
    }));
    expect(mockAnswer).toHaveBeenCalledWith('cbq-1', 'Принято, ожидайте подтверждения.');
  });

  it('always dispatches notary_claim to Jira Automation once the Telegram envelope is valid', async () => {
    const res = await POST(makeUpdate(makeCallback('notary_claim:WO-9', -100222)));
    expect(res.status).toBe(200);
    expect(mockGetJiraIssue).not.toHaveBeenCalled();
    expect(mockForward).toHaveBeenCalledWith(expect.objectContaining({ issueKey: 'WO-9', action: 'notary_claim', role: 'notary' }));
  });

  it('claims successfully for a manually created Jira issue with no corresponding WPO order at all', async () => {
    // This route never touches Supabase or a WPO job in any way — a Jira issue
    // created purely to test the integration works identically to a real order.
    const res = await POST(makeUpdate(makeCallback('translator_claim:WO-900')));
    expect(res.status).toBe(200);
    expect(mockForward).toHaveBeenCalledWith(expect.objectContaining({ issueKey: 'WO-900', action: 'translator_claim' }));
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
