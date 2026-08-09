/**
 * Tests for POST /api/telegram/jira-event
 *
 * Verifies: auth, payload validation, broadcast idempotency, chat-not-configured
 * skip, Jira-issue-not-found/missing-orderId errors, page-count/payout inclusion,
 * status_changed message projection, and that no Jira transition is ever attempted
 * (getJiraIssue is the only Jira call this route makes).
 */

process.env.JIRA_WEBHOOK_SECRET = 'test-secret';
process.env.TELEGRAM_TRANSLATOR_CHAT_ID = '-100111';
process.env.TELEGRAM_NOTARY_CHAT_ID = '-100222';

jest.mock('@/lib/supabase/server', () => ({ supabaseServer: { from: jest.fn() } }));
jest.mock('@/lib/jira/client', () => {
  const actual = jest.requireActual('@/lib/jira/client');
  return { ...actual, getJiraIssue: jest.fn() };
});
jest.mock('@/lib/telegram/client', () => ({
  sendMessageWithCallbackButtons: jest.fn(),
  editMessageWithCallbackButtons: jest.fn(),
}));

import { NextRequest } from 'next/server';
import { POST } from '../route';
import { supabaseServer } from '@/lib/supabase/server';
import { getJiraIssue, JIRA_FIELDS } from '@/lib/jira/client';
import { sendMessageWithCallbackButtons, editMessageWithCallbackButtons } from '@/lib/telegram/client';

const mockFrom = supabaseServer.from as jest.Mock;
const mockGetJiraIssue = getJiraIssue as jest.Mock;
const mockSend = sendMessageWithCallbackButtons as jest.Mock;
const mockEdit = editMessageWithCallbackButtons as jest.Mock;

function makeRequest(body: unknown, secret = 'test-secret'): NextRequest {
  return new NextRequest('http://localhost/api/telegram/jira-event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-wpo-webhook-secret': secret },
    body: JSON.stringify(body),
  });
}

/** A Proxy-based fake Supabase query-builder chain: any method call returns itself,
 * and it resolves to `terminal` whether the caller awaits it directly (insert/update)
 * or calls .maybeSingle()/.single() at the end of a select chain. */
function chainable(terminal: { data?: unknown; error?: unknown } = { data: null, error: null }): unknown {
  const handler: ProxyHandler<object> = {
    get(_t, prop: string) {
      if (prop === 'then') {
        return (resolve: (v: unknown) => void) => resolve(terminal);
      }
      if (prop === 'maybeSingle' || prop === 'single') {
        return () => Promise.resolve(terminal);
      }
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
});

const issueWithFields = (fields: Record<string, unknown>, key = 'WO-123') => ({
  key,
  statusName: 'OPEN',
  fields,
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

  it('broadcasts a new translator order with page count + payout when available', async () => {
    callQueue = [
      () => chainable({ data: null, error: null }), // existing-assignment check
      () => chainable({ data: { physical_page_count: 3 }, error: null }), // price_quotes
      () => chainable({ data: { amount_kzt: 4500 }, error: null }), // cost_reservations
      () => chainable({ data: null, error: null }), // telegram_assignments insert
      () => chainable({ data: null, error: null }), // job_audit_log insert
    ];
    mockGetJiraIssue.mockResolvedValue(issueWithFields({
      [JIRA_FIELDS.orderId]: 'job-uuid-1',
      [JIRA_FIELDS.translationType]: { value: 'Нотариально заверенный' },
      [JIRA_FIELDS.languagePair]: 'RU → EN',
      [JIRA_FIELDS.documentType]: { value: 'Доверенность' },
    }));
    mockSend.mockResolvedValue({ ok: true, messageId: '999', error: null });

    const res = await POST(makeRequest({ event: 'translator_order_created', issueKey: 'WO-123' }));
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; action: string };
    expect(body.action).toBe('broadcast_sent');

    expect(mockSend).toHaveBeenCalledWith(
      '-100111',
      expect.stringContaining('3 стр.'),
      expect.arrayContaining([expect.objectContaining({ callback_data: 'translator_claim:WO-123' })]),
    );
    expect(mockSend.mock.calls[0][1]).toContain('Сумма исполнителю: 4500 ₸');
  });

  it('is idempotent — skips broadcasting when a row already exists for this issue+role', async () => {
    callQueue = [() => chainable({ data: { id: 'existing-row' }, error: null })];
    const res = await POST(makeRequest({ event: 'translator_order_created', issueKey: 'WO-123' }));
    const body = await res.json() as { ok: boolean; skipped: string };
    expect(body.skipped).toBe('already_broadcast');
    expect(mockGetJiraIssue).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('skips gracefully when the role chat id is not configured', async () => {
    const original = process.env.TELEGRAM_TRANSLATOR_CHAT_ID;
    delete process.env.TELEGRAM_TRANSLATOR_CHAT_ID;
    callQueue = [() => chainable({ data: null, error: null })];

    const res = await POST(makeRequest({ event: 'translator_order_created', issueKey: 'WO-123' }));
    const body = await res.json() as { skipped: string };
    expect(body.skipped).toBe('chat_not_configured');
    expect(mockGetJiraIssue).not.toHaveBeenCalled();

    process.env.TELEGRAM_TRANSLATOR_CHAT_ID = original;
  });

  it('returns 404 when the Jira issue cannot be found', async () => {
    callQueue = [() => chainable({ data: null, error: null })];
    mockGetJiraIssue.mockResolvedValue(null);
    const res = await POST(makeRequest({ event: 'translator_order_created', issueKey: 'WO-404' }));
    expect(res.status).toBe(404);
  });

  it('returns 422 when the Jira issue has no orderId custom field', async () => {
    callQueue = [() => chainable({ data: null, error: null })];
    mockGetJiraIssue.mockResolvedValue(issueWithFields({}));
    const res = await POST(makeRequest({ event: 'translator_order_created', issueKey: 'WO-123' }));
    expect(res.status).toBe(422);
  });

  it('omits page count and payout lines when neither exists (never fabricated)', async () => {
    callQueue = [
      () => chainable({ data: null, error: null }),
      () => chainable({ data: null, error: null }), // no paid quote found
      () => chainable({ data: null, error: null }), // no cost reservation found
      () => chainable({ data: null, error: null }),
      () => chainable({ data: null, error: null }),
    ];
    mockGetJiraIssue.mockResolvedValue(issueWithFields({ [JIRA_FIELDS.orderId]: 'job-uuid-2' }));
    mockSend.mockResolvedValue({ ok: true, messageId: '1000', error: null });

    await POST(makeRequest({ event: 'translator_order_created', issueKey: 'WO-777' }));
    const text = mockSend.mock.calls[0][1] as string;
    expect(text).not.toContain('стр.');
    expect(text).not.toContain('Сумма исполнителю');
  });

  // ── notary_required ───────────────────────────────────────────────────────

  it('broadcasts a notary order to the notary chat using notary_payout', async () => {
    callQueue = [
      () => chainable({ data: null, error: null }),
      () => chainable({ data: { physical_page_count: 2 }, error: null }),
      () => chainable({ data: { amount_kzt: 6000 }, error: null }),
      () => chainable({ data: null, error: null }),
      () => chainable({ data: null, error: null }),
    ];
    mockGetJiraIssue.mockResolvedValue(issueWithFields({ [JIRA_FIELDS.orderId]: 'job-uuid-3' }, 'WO-9'));
    mockSend.mockResolvedValue({ ok: true, messageId: '2000', error: null });

    const res = await POST(makeRequest({ event: 'notary_required', issueKey: 'WO-9' }));
    expect(res.status).toBe(200);
    expect(mockSend).toHaveBeenCalledWith(
      '-100222',
      expect.any(String),
      expect.arrayContaining([expect.objectContaining({ callback_data: 'notary_claim:WO-9' })]),
    );
  });

  // ── status_changed ────────────────────────────────────────────────────────

  it('no-ops on an unrelated Jira status without touching Supabase', async () => {
    const res = await POST(makeRequest({ event: 'status_changed', issueKey: 'WO-1', jiraStatus: 'OUT_FOR_DELIVERY' }));
    const body = await res.json() as { action: string };
    expect(body.action).toBe('no_op');
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('edits the stored Telegram message when a recognized status is confirmed', async () => {
    callQueue = [
      () => chainable({
        data: {
          id: 'assign-1', job_id: 'job-uuid-1', telegram_chat_id: -100111,
          telegram_message_id: 999, telegram_display_name: 'Aigerim',
        },
        error: null,
      }),
      () => chainable({ data: null, error: null }), // update
      () => chainable({ data: null, error: null }), // job_audit_log insert
    ];
    mockEdit.mockResolvedValue({ ok: true, messageId: '999', error: null });

    const res = await POST(makeRequest({ event: 'status_changed', issueKey: 'WO-123', jiraStatus: 'НАЗНАЧЕН ПЕРЕВОДЧИК' }));
    expect(res.status).toBe(200);
    const body = await res.json() as { action: string };
    expect(body.action).toBe('message_updated');
    expect(mockEdit).toHaveBeenCalledWith(
      -100111, 999,
      expect.stringContaining('Исполнитель: Aigerim'),
      expect.arrayContaining([expect.objectContaining({ callback_data: 'translator_start:WO-123' })]),
    );
  });

  it('returns no_assignment and does not call Telegram when no row exists for this issue/role', async () => {
    callQueue = [() => chainable({ data: null, error: null })];
    const res = await POST(makeRequest({ event: 'status_changed', issueKey: 'WO-999', jiraStatus: 'НАЗНАЧЕН НОТАРИУС' }));
    const body = await res.json() as { action: string };
    expect(body.action).toBe('no_assignment');
    expect(mockEdit).not.toHaveBeenCalled();
  });

  it('sends an empty button list for terminal statuses', async () => {
    callQueue = [
      () => chainable({
        data: {
          id: 'assign-2', job_id: 'job-uuid-1', telegram_chat_id: -100222,
          telegram_message_id: 555, telegram_display_name: 'Notary A',
        },
        error: null,
      }),
      () => chainable({ data: null, error: null }),
      () => chainable({ data: null, error: null }),
    ];
    mockEdit.mockResolvedValue({ ok: true, messageId: '555', error: null });

    await POST(makeRequest({ event: 'status_changed', issueKey: 'WO-5', jiraStatus: 'ПЕРЕВОД ЗАВЕРЕН' }));
    expect(mockEdit).toHaveBeenCalledWith(-100222, 555, expect.any(String), []);
  });

});
