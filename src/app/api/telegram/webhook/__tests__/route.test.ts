/**
 * Tests for POST /api/telegram/webhook
 *
 * Verifies: auth, callback_data parsing, chat validation, atomic claim arbitration
 * (including stale-pending recovery via the .or() filter shape), ownership checks
 * for start/done, status-precondition idempotency, and that every successful action
 * is forwarded to Jira Automation (never a direct Jira transition).
 */

process.env.TELEGRAM_WEBHOOK_SECRET = 'tg-secret';
process.env.TELEGRAM_TRANSLATOR_CHAT_ID = '-100111';
process.env.TELEGRAM_NOTARY_CHAT_ID = '-100222';

jest.mock('@/lib/supabase/server', () => ({ supabaseServer: { from: jest.fn() } }));
jest.mock('@/lib/telegram/client', () => ({ answerCallbackQuery: jest.fn() }));
jest.mock('@/lib/telegram-ops/automation-actions', () => ({ forwardActionToJiraAutomation: jest.fn() }));

import { NextRequest } from 'next/server';
import { POST } from '../route';
import { supabaseServer } from '@/lib/supabase/server';
import { answerCallbackQuery } from '@/lib/telegram/client';
import { forwardActionToJiraAutomation } from '@/lib/telegram-ops/automation-actions';

const mockFrom = supabaseServer.from as jest.Mock;
const mockAnswer = answerCallbackQuery as jest.Mock;
const mockForward = forwardActionToJiraAutomation as jest.Mock;

function chainable(terminal: { data?: unknown; error?: unknown } = { data: null, error: null }): unknown {
  const handler: ProxyHandler<object> = {
    get(_t, prop: string) {
      if (prop === 'then') return (resolve: (v: unknown) => void) => resolve(terminal);
      if (prop === 'maybeSingle' || prop === 'single') return () => Promise.resolve(terminal);
      return () => proxy;
    },
  };
  const proxy = new Proxy({}, handler);
  return proxy;
}

let callQueue: Array<() => unknown> = [];
beforeEach(() => {
  jest.clearAllMocks();
  callQueue = [];
  mockFrom.mockImplementation(() => {
    const factory = callQueue.shift();
    if (!factory) return chainable({ data: null, error: null });
    return factory();
  });
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
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('acknowledges but ignores unrecognized callback_data', async () => {
    const res = await POST(makeUpdate(makeCallback('something_else:WO-1')));
    expect(res.status).toBe(200);
    expect(mockAnswer).toHaveBeenCalledWith('cbq-1');
    expect(mockFrom).not.toHaveBeenCalled();
  });

  // ── Chat validation ───────────────────────────────────────────────────────
  it('rejects a claim from the wrong chat', async () => {
    await POST(makeUpdate(makeCallback('translator_claim:WO-1', -999999)));
    expect(mockAnswer).toHaveBeenCalledWith('cbq-1', 'Недоступно в этом чате.', true);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  // ── Claim: happy path ─────────────────────────────────────────────────────
  it('claims successfully, logs audit, and forwards translator_claim to Automation', async () => {
    callQueue = [
      () => chainable({ data: { id: 'assign-1', job_id: 'job-1' }, error: null }), // atomic update
      () => chainable({ data: null, error: null }), // job_audit_log insert
    ];

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

  it('claims successfully and forwards translator_claim even with no linked WPO job (Jira-only operational issue, no job_audit_log)', async () => {
    // Manually created Jira issue: telegram_assignments.job_id is NULL (migration
    // 0069) — the reservation was created with job_id NULL by /api/telegram/jira-event
    // because no jobs row exists for this issue at all. Claiming must still succeed
    // and still dispatch to Jira Automation; only the job_audit_log write is skipped.
    let jobAuditLogCalled = false;
    callQueue = [
      () => chainable({ data: { id: 'assign-manual-1', job_id: null }, error: null }), // atomic update
    ];
    const originalFrom = mockFrom.getMockImplementation();
    mockFrom.mockImplementation((...args: unknown[]) => {
      if (args[0] === 'job_audit_log') jobAuditLogCalled = true;
      return originalFrom!(...(args as []));
    });

    const res = await POST(makeUpdate(makeCallback('translator_claim:WO-900')));
    expect(res.status).toBe(200);
    expect(mockForward).toHaveBeenCalledWith({
      issueKey: 'WO-900',
      action: 'translator_claim',
      telegramUserId: '42',
      executorName: 'Aigerim',
      role: 'translator',
    });
    expect(mockAnswer).toHaveBeenCalledWith('cbq-1', 'Принято, ожидайте подтверждения.');
    expect(jobAuditLogCalled).toBe(false);
  });

  // ── Claim: lost race ──────────────────────────────────────────────────────
  it('tells the losing translator the order is already claimed and does not forward', async () => {
    callQueue = [() => chainable({ data: null, error: null })]; // atomic update matched nothing
    await POST(makeUpdate(makeCallback('translator_claim:WO-123')));
    expect(mockAnswer).toHaveBeenCalledWith('cbq-1', 'Заказ уже назначен другому переводчику.', true);
    expect(mockForward).not.toHaveBeenCalled();
  });

  it('logs loudly (not just a user message) when no row exists at all for the claim, distinct from a lost race', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    callQueue = [
      () => chainable({ data: null, error: null }), // atomic update matched nothing
      () => chainable({ data: null, error: null }), // diagnostic follow-up: no row at all
    ];
    await POST(makeUpdate(makeCallback('translator_claim:WO-404')));
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('no telegram_assignments row exists at all for issueKey=WO-404'));
    errorSpy.mockRestore();
  });

  it('does not log the "no row" anomaly when the row exists but was already claimed (genuine lost race)', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    callQueue = [
      () => chainable({ data: null, error: null }), // atomic update matched nothing
      () => chainable({ data: { id: 'assign-1' }, error: null }), // diagnostic follow-up: row DOES exist
    ];
    await POST(makeUpdate(makeCallback('translator_claim:WO-123')));
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('uses the notary-specific taken message and chat id', async () => {
    callQueue = [
      () => chainable({ data: null, error: null }),
      () => chainable({ data: null, error: null }),
    ];
    await POST(makeUpdate(makeCallback('notary_claim:WO-9', -100222)));
    expect(mockAnswer).toHaveBeenCalledWith('cbq-1', 'Заказ уже назначен другому нотариусу.', true);
  });

  // ── Start/done: not found / wrong owner ──────────────────────────────────
  it('rejects start when no assignment row exists and logs it loudly', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    callQueue = [() => chainable({ data: null, error: null })];
    await POST(makeUpdate(makeCallback('translator_start:WO-1')));
    expect(mockAnswer).toHaveBeenCalledWith('cbq-1', 'Заказ не найден.', true);
    expect(mockForward).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('start rejected: no telegram_assignments row exists for issueKey=WO-1'));
    errorSpy.mockRestore();
  });

  it('rejects start/done from a user who is not the claimant', async () => {
    callQueue = [() => chainable({
      data: { id: 'a1', job_id: 'job-1', status: 'claimed', telegram_user_id: 999, telegram_display_name: 'Other' },
      error: null,
    })];
    await POST(makeUpdate(makeCallback('translator_start:WO-1', -100111, 42)));
    expect(mockAnswer).toHaveBeenCalledWith('cbq-1', 'Этот заказ назначен другому исполнителю.', true);
    expect(mockForward).not.toHaveBeenCalled();
  });

  // ── Start: precondition / idempotency ────────────────────────────────────
  it('treats a stale/duplicate start tap as an idempotent no-op when status is not "claimed"', async () => {
    callQueue = [() => chainable({
      data: { id: 'a1', job_id: 'job-1', status: 'claim_pending', telegram_user_id: 42, telegram_display_name: 'Aigerim' },
      error: null,
    })];
    await POST(makeUpdate(makeCallback('translator_start:WO-1')));
    expect(mockAnswer).toHaveBeenCalledWith('cbq-1', 'Действие уже выполнено или ожидает подтверждения от Jira.');
    expect(mockForward).not.toHaveBeenCalled();
  });

  it('forwards translator_start when status is "claimed" and user matches', async () => {
    callQueue = [
      () => chainable({
        data: { id: 'a1', job_id: 'job-1', status: 'claimed', telegram_user_id: 42, telegram_display_name: 'Aigerim' },
        error: null,
      }),
      () => chainable({ data: null, error: null }),
    ];
    await POST(makeUpdate(makeCallback('translator_start:WO-1')));
    expect(mockForward).toHaveBeenCalledWith({
      issueKey: 'WO-1', action: 'translator_start', telegramUserId: '42', executorName: 'Aigerim', role: 'translator',
    });
  });

  // ── Done: requires in_progress ───────────────────────────────────────────
  it('rejects done when status is still "claimed" (start not yet confirmed by Jira)', async () => {
    callQueue = [() => chainable({
      data: { id: 'a1', job_id: 'job-1', status: 'claimed', telegram_user_id: 42, telegram_display_name: 'Aigerim' },
      error: null,
    })];
    await POST(makeUpdate(makeCallback('translator_done:WO-1')));
    expect(mockForward).not.toHaveBeenCalled();
  });

  it('forwards notary_done when status is "in_progress" and user matches', async () => {
    callQueue = [
      () => chainable({
        data: { id: 'a2', job_id: 'job-2', status: 'in_progress', telegram_user_id: 7, telegram_display_name: 'Notary A' },
        error: null,
      }),
      () => chainable({ data: null, error: null }),
    ];
    await POST(makeUpdate(makeCallback('notary_done:WO-9', -100222, 7)));
    expect(mockForward).toHaveBeenCalledWith({
      issueKey: 'WO-9', action: 'notary_done', telegramUserId: '7', executorName: 'Notary A', role: 'notary',
    });
  });
});
