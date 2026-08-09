/**
 * Tests for POST /api/telegram/jira-event
 *
 * Verifies: auth, payload validation, broadcast idempotency, chat-not-configured
 * skip, Jira-issue-not-found errors, page-count/payout inclusion, status_changed
 * message projection, and that no Jira transition is ever attempted (getJiraIssue
 * is the only Jira call this route makes).
 *
 * WO-120 production regression (2026-08-09): customfield_10073 held "1" instead of
 * a UUID, crashing the telegram_assignments insert and leaving an orphaned Telegram
 * message. job_id must always be resolved via jobs.jira_issue_key, never trusted
 * directly from the Jira custom field — see the dedicated section below.
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
 * or calls .maybeSingle()/.single() at the end of a select chain. `onCall` (optional)
 * fires for every chain method invocation with (methodName, args) — used to capture
 * exactly what a caller passed to e.g. .insert({...}). */
function chainable(
  terminal: { data?: unknown; error?: unknown } = { data: null, error: null },
  onCall?: (method: string, args: unknown[]) => void,
): unknown {
  const handler: ProxyHandler<object> = {
    get(_t, prop: string) {
      if (prop === 'then') {
        return (resolve: (v: unknown) => void) => resolve(terminal);
      }
      if (prop === 'maybeSingle' || prop === 'single') {
        return () => Promise.resolve(terminal);
      }
      return (...args: unknown[]) => {
        onCall?.(prop, args);
        return proxy;
      };
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

/** Standard success-path queue: existing-check(null) -> jobs lookup -> reserve insert
 * -> price_quotes -> cost_reservations -> message_id update -> audit log insert. */
function successQueue(opts: {
  jobId: string;
  reservedId?: string;
  pageCount?: number | null;
  payoutKzt?: number | null;
  onReserveInsert?: (args: unknown[]) => void;
}): Array<() => unknown> {
  const reservedId = opts.reservedId ?? 'assign-1';
  return [
    () => chainable({ data: null, error: null }), // existing-assignment check
    () => chainable({ data: { id: opts.jobId }, error: null }), // jobs lookup by jira_issue_key
    () => chainable({ data: { id: reservedId }, error: null }, (method, args) => {
      if (method === 'insert' && opts.onReserveInsert) opts.onReserveInsert(args);
    }), // reservation insert
    () => chainable({ data: { physical_page_count: opts.pageCount ?? null }, error: null }), // price_quotes
    () => chainable({ data: opts.payoutKzt != null ? { amount_kzt: opts.payoutKzt } : null, error: null }), // cost_reservations
    () => chainable({ data: null, error: null }), // message_id update
    () => chainable({ data: null, error: null }), // job_audit_log insert
  ];
}

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
    callQueue = successQueue({ jobId: 'job-uuid-1', pageCount: 3, payoutKzt: 4500 });
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
      expect.stringContaining('Количество страниц: 3'),
      expect.arrayContaining([expect.objectContaining({ callback_data: 'translator_claim:WO-123' })]),
    );
    expect(mockSend.mock.calls[0][1]).toContain('Выплата переводчику: 4 500 ₸');
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

  it('returns 404 and deletes the reservation when the Jira issue cannot be found', async () => {
    let deleteCalled = false;
    callQueue = [
      () => chainable({ data: null, error: null }), // existing check
      () => chainable({ data: { id: 'job-uuid-1' }, error: null }), // jobs lookup
      () => chainable({ data: { id: 'assign-1' }, error: null }), // reserve insert
      () => chainable({ data: null, error: null }, (method) => { if (method === 'delete') deleteCalled = true; }), // cleanup delete
    ];
    mockGetJiraIssue.mockResolvedValue(null);
    const res = await POST(makeRequest({ event: 'translator_order_created', issueKey: 'WO-404' }));
    expect(res.status).toBe(404);
    expect(deleteCalled).toBe(true);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('omits page count and payout lines when neither exists (never fabricated)', async () => {
    callQueue = successQueue({ jobId: 'job-uuid-2', pageCount: null, payoutKzt: null });
    mockGetJiraIssue.mockResolvedValue(issueWithFields({ [JIRA_FIELDS.orderId]: 'job-uuid-2' }));
    mockSend.mockResolvedValue({ ok: true, messageId: '1000', error: null });

    await POST(makeRequest({ event: 'translator_order_created', issueKey: 'WO-777' }));
    const text = mockSend.mock.calls[0][1] as string;
    expect(text).not.toContain('Количество страниц');
    expect(text).not.toContain('Выплата переводчику');
  });

  // ── notary_required ───────────────────────────────────────────────────────

  it('broadcasts a notary order to the notary chat using notary_payout', async () => {
    callQueue = successQueue({ jobId: 'job-uuid-3', pageCount: 2, payoutKzt: 6000 });
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

  // ── job_id resolution — WO-120 regression coverage ───────────────────────

  describe('job_id resolution (WO-120 regression: customfield_10073 held "1", not a UUID)', () => {
    it('returns 422 without ever contacting Jira/Telegram when jobs.jira_issue_key has no match', async () => {
      callQueue = [
        () => chainable({ data: null, error: null }), // existing check
        () => chainable({ data: null, error: null }), // jobs lookup: no match
      ];
      const res = await POST(makeRequest({ event: 'translator_order_created', issueKey: 'WO-120' }));
      expect(res.status).toBe(422);
      expect(mockGetJiraIssue).not.toHaveBeenCalled();
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('resolves job_id via jobs.jira_issue_key and never inserts the raw non-UUID customfield_10073 value', async () => {
      let insertedJobId: unknown;
      callQueue = successQueue({
        jobId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', // the real jobs.id
        onReserveInsert: (args) => { insertedJobId = (args[0] as { job_id: unknown }).job_id; },
      });
      // The Jira field holds "1" — exactly the WO-120 production value — not a UUID.
      mockGetJiraIssue.mockResolvedValue(issueWithFields({ [JIRA_FIELDS.orderId]: '1' }, 'WO-120'));
      mockSend.mockResolvedValue({ ok: true, messageId: '4242', error: null });

      const res = await POST(makeRequest({ event: 'translator_order_created', issueKey: 'WO-120' }));
      expect(res.status).toBe(200);
      const body = await res.json() as { action: string };
      expect(body.action).toBe('broadcast_sent');
      // The row inserted must carry the real UUID resolved from jobs.jira_issue_key —
      // never the literal "1" that crashed the original production insert.
      expect(insertedJobId).toBe('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11');
    });

    it('logs a warning (non-fatal) when customfield_10073 disagrees with the jobs.jira_issue_key resolution', async () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      callQueue = successQueue({ jobId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' });
      mockGetJiraIssue.mockResolvedValue(issueWithFields({ [JIRA_FIELDS.orderId]: '1' }, 'WO-120'));
      mockSend.mockResolvedValue({ ok: true, messageId: '4242', error: null });

      const res = await POST(makeRequest({ event: 'translator_order_created', issueKey: 'WO-120' }));
      expect(res.status).toBe(200);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('customfield_10073 on WO-120 is not a UUID'));
      warnSpy.mockRestore();
    });
  });

  // ── Reservation / send / update failure handling — must never silently succeed ──

  describe('explicit failure reporting (no silent success on a critical write)', () => {
    it('returns 500 without contacting Jira/Telegram when the reservation insert fails for a non-race reason', async () => {
      callQueue = [
        () => chainable({ data: null, error: null }), // existing check
        () => chainable({ data: { id: 'job-uuid-1' }, error: null }), // jobs lookup
        () => chainable({ data: null, error: { code: '42P01', message: 'relation missing' } }), // reserve insert fails
      ];
      const res = await POST(makeRequest({ event: 'translator_order_created', issueKey: 'WO-1' }));
      expect(res.status).toBe(500);
      expect(mockGetJiraIssue).not.toHaveBeenCalled();
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('treats a unique-violation on the reservation insert as a benign concurrent retry (already_broadcast)', async () => {
      callQueue = [
        () => chainable({ data: null, error: null }),
        () => chainable({ data: { id: 'job-uuid-1' }, error: null }),
        () => chainable({ data: null, error: { code: '23505', message: 'duplicate key' } }),
      ];
      const res = await POST(makeRequest({ event: 'translator_order_created', issueKey: 'WO-1' }));
      expect(res.status).toBe(200);
      const body = await res.json() as { skipped: string };
      expect(body.skipped).toBe('already_broadcast');
    });

    it('deletes the reservation and returns 502 when the Telegram send fails', async () => {
      let deleteCalled = false;
      callQueue = [
        () => chainable({ data: null, error: null }),
        () => chainable({ data: { id: 'job-uuid-1' }, error: null }),
        () => chainable({ data: { id: 'assign-1' }, error: null }),
        () => chainable({ data: null, error: null }), // price_quotes
        () => chainable({ data: null, error: null }), // cost_reservations
        () => chainable({ data: null, error: null }, (method) => { if (method === 'delete') deleteCalled = true; }),
      ];
      mockGetJiraIssue.mockResolvedValue(issueWithFields({ [JIRA_FIELDS.orderId]: 'job-uuid-1' }));
      mockSend.mockResolvedValue({ ok: false, messageId: null, error: 'Telegram down' });

      const res = await POST(makeRequest({ event: 'translator_order_created', issueKey: 'WO-1' }));
      expect(res.status).toBe(502);
      expect(deleteCalled).toBe(true);
    });

    it('returns 500 (not 200) when the message was sent but recording its message_id fails', async () => {
      callQueue = [
        () => chainable({ data: null, error: null }),
        () => chainable({ data: { id: 'job-uuid-1' }, error: null }),
        () => chainable({ data: { id: 'assign-1' }, error: null }),
        () => chainable({ data: null, error: null }), // price_quotes
        () => chainable({ data: null, error: null }), // cost_reservations
        () => chainable({ data: null, error: { code: '08006', message: 'connection lost' } }), // update fails
      ];
      mockGetJiraIssue.mockResolvedValue(issueWithFields({ [JIRA_FIELDS.orderId]: 'job-uuid-1' }));
      mockSend.mockResolvedValue({ ok: true, messageId: '555', error: null });

      const res = await POST(makeRequest({ event: 'translator_order_created', issueKey: 'WO-1' }));
      expect(res.status).toBe(500);
      const body = await res.json() as { error: string };
      expect(body.error).toContain('assignment row update failed');
    });
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
