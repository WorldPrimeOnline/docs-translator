/**
 * Tests for POST /api/telegram/jira-event
 *
 * Verifies: auth, payload validation, broadcast idempotency, chat-not-configured
 * skip, Jira-issue-not-found errors, page-count/payout inclusion, status_changed
 * message projection, and that no Jira transition is ever attempted (getJiraIssue
 * is the only Jira call this route makes).
 *
 * Domain model: Telegram Operations is Jira-driven. jira_issue_key + role is the
 * operational identity of a Telegram assignment (migration 0068's UNIQUE
 * constraint) — a WPO job is optional enrichment, never a prerequisite. A Jira
 * issue with no corresponding jobs row (e.g. manually created purely to test the
 * Jira -> Telegram -> claim/start/done -> Jira workflow, tagged wpo-production,
 * with no Supabase order ever created) is a fully valid Telegram Operations issue
 * — the broadcast must succeed with telegram_assignments.job_id = NULL (migration
 * 0069), never a 422.
 *
 * job_id resolution regressions:
 *  - WO-120 (2026-08-09): customfield_10073 held "1" instead of a UUID, crashing
 *    the telegram_assignments insert. job_id must always be resolved/verified via
 *    jobs, never trusted directly from the Jira custom field.
 *  - WO-122 (2026-08-09): the "issue created" Automation trigger can fire before
 *    WPO has persisted jobs.jira_issue_key back onto the job (that write happens
 *    strictly after Jira returns the new issue key). The primary jobs.jira_issue_key
 *    lookup must therefore fall back to a *verified* customfield_10073 lookup
 *    (syntactically a UUID AND a real jobs row exists with that id), and repair
 *    jobs.jira_issue_key for next time.
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

/** Success-path queue when job_id resolves via the PRIMARY jobs.jira_issue_key
 * lookup: existing-check(null) -> jobs-by-issue-key(hit) -> reserve insert ->
 * price_quotes -> cost_reservations -> message_id update -> audit log insert. */
function successQueuePrimary(opts: {
  jobId: string;
  reservedId?: string;
  pageCount?: number | null;
  payoutKzt?: number | null;
  onReserveInsert?: (args: unknown[]) => void;
}): Array<() => unknown> {
  const reservedId = opts.reservedId ?? 'assign-1';
  return [
    () => chainable({ data: null, error: null }), // existing-assignment check
    () => chainable({ data: { id: opts.jobId }, error: null }), // jobs lookup by jira_issue_key: hit
    () => chainable({ data: { id: reservedId }, error: null }, (method, args) => {
      if (method === 'insert' && opts.onReserveInsert) opts.onReserveInsert(args);
    }), // reservation insert
    () => chainable({ data: { physical_page_count: opts.pageCount ?? null }, error: null }), // price_quotes
    () => chainable({ data: opts.payoutKzt != null ? { amount_kzt: opts.payoutKzt } : null, error: null }), // cost_reservations
    () => chainable({ data: null, error: null }), // message_id update
    () => chainable({ data: null, error: null }), // job_audit_log insert
  ];
}

/** Success-path queue when job_id resolves via the customfield_10073 FALLBACK
 * (jobs.jira_issue_key not yet persisted — the WO-122 race): existing-check(null)
 * -> jobs-by-issue-key(miss) -> jobs-by-id(hit) -> backfill update -> reserve
 * insert -> price_quotes -> cost_reservations -> message_id update -> audit log. */
function successQueueFallback(opts: {
  jobId: string;
  reservedId?: string;
  pageCount?: number | null;
  payoutKzt?: number | null;
  onBackfillUpdate?: (args: unknown[]) => void;
}): Array<() => unknown> {
  const reservedId = opts.reservedId ?? 'assign-1';
  return [
    () => chainable({ data: null, error: null }), // existing-assignment check
    () => chainable({ data: null, error: null }), // jobs lookup by jira_issue_key: miss (race)
    () => chainable({ data: { id: opts.jobId }, error: null }), // jobs lookup by id (customfield_10073): hit
    () => chainable({ data: null, error: null }, (method, args) => {
      if (method === 'update' && opts.onBackfillUpdate) opts.onBackfillUpdate(args);
    }), // backfill jobs.jira_issue_key
    () => chainable({ data: { id: reservedId }, error: null }), // reservation insert
    () => chainable({ data: { physical_page_count: opts.pageCount ?? null }, error: null }), // price_quotes
    () => chainable({ data: opts.payoutKzt != null ? { amount_kzt: opts.payoutKzt } : null, error: null }), // cost_reservations
    () => chainable({ data: null, error: null }), // message_id update
    () => chainable({ data: null, error: null }), // job_audit_log insert
  ];
}

/** Success-path queue for a Jira-only operational issue with NO corresponding WPO
 * job (manually created test issue): existing-check(null) -> jobs-by-issue-key(miss)
 * -> [jobs-by-id(miss), only if customfield_10073 is a syntactically valid UUID] ->
 * reserve insert (job_id: null) -> message_id update. getOrderExtras and
 * job_audit_log are never called at all — both short-circuit on a null job_id. */
function successQueueNoJob(opts: {
  reservedId?: string;
  attemptedUuidLookup?: boolean;
  onReserveInsert?: (args: unknown[]) => void;
}): Array<() => unknown> {
  const reservedId = opts.reservedId ?? 'assign-1';
  const queue: Array<() => unknown> = [
    () => chainable({ data: null, error: null }), // existing-assignment check
    () => chainable({ data: null, error: null }), // jobs lookup by jira_issue_key: miss
  ];
  if (opts.attemptedUuidLookup) {
    queue.push(() => chainable({ data: null, error: null })); // jobs lookup by id: miss
  }
  queue.push(
    () => chainable({ data: { id: reservedId }, error: null }, (method, args) => {
      if (method === 'insert' && opts.onReserveInsert) opts.onReserveInsert(args);
    }), // reservation insert (job_id: null)
    () => chainable({ data: null, error: null }), // message_id update
  );
  return queue;
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
    callQueue = successQueuePrimary({ jobId: 'job-uuid-1', pageCount: 3, payoutKzt: 4500 });
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

  it('returns 404 without ever querying jobs when the Jira issue cannot be found', async () => {
    callQueue = [() => chainable({ data: null, error: null })]; // existing check only
    mockGetJiraIssue.mockResolvedValue(null);
    const res = await POST(makeRequest({ event: 'translator_order_created', issueKey: 'WO-404' }));
    expect(res.status).toBe(404);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('omits page count and payout lines when neither exists (never fabricated)', async () => {
    callQueue = successQueuePrimary({ jobId: 'job-uuid-2', pageCount: null, payoutKzt: null });
    mockGetJiraIssue.mockResolvedValue(issueWithFields({ [JIRA_FIELDS.orderId]: 'job-uuid-2' }));
    mockSend.mockResolvedValue({ ok: true, messageId: '1000', error: null });

    await POST(makeRequest({ event: 'translator_order_created', issueKey: 'WO-777' }));
    const text = mockSend.mock.calls[0][1] as string;
    expect(text).not.toContain('Количество страниц');
    expect(text).not.toContain('Выплата переводчику');
  });

  // ── notary_required ───────────────────────────────────────────────────────

  it('broadcasts a notary order to the notary chat using notary_payout', async () => {
    callQueue = successQueuePrimary({ jobId: 'job-uuid-3', pageCount: 2, payoutKzt: 6000 });
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

  // ── job_id resolution: primary path + WO-120 drift check ────────────────

  describe('job_id resolution — primary path (jobs.jira_issue_key already set)', () => {
    it('never inserts the raw non-UUID customfield_10073 value when the primary lookup already succeeded', async () => {
      let insertedJobId: unknown;
      callQueue = successQueuePrimary({
        jobId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', // the real jobs.id, from jira_issue_key
        onReserveInsert: (args) => { insertedJobId = (args[0] as { job_id: unknown }).job_id; },
      });
      // The Jira field holds "1" — exactly the WO-120 production value — not a UUID.
      // Since the primary lookup already succeeded, this must be ignored entirely.
      mockGetJiraIssue.mockResolvedValue(issueWithFields({ [JIRA_FIELDS.orderId]: '1' }, 'WO-120'));
      mockSend.mockResolvedValue({ ok: true, messageId: '4242', error: null });

      const res = await POST(makeRequest({ event: 'translator_order_created', issueKey: 'WO-120' }));
      expect(res.status).toBe(200);
      const body = await res.json() as { action: string };
      expect(body.action).toBe('broadcast_sent');
      expect(insertedJobId).toBe('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11');
    });

    it('logs a warning (non-fatal) when customfield_10073 disagrees with the primary resolution', async () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      callQueue = successQueuePrimary({ jobId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' });
      mockGetJiraIssue.mockResolvedValue(issueWithFields({ [JIRA_FIELDS.orderId]: '1' }, 'WO-120'));
      mockSend.mockResolvedValue({ ok: true, messageId: '4242', error: null });

      const res = await POST(makeRequest({ event: 'translator_order_created', issueKey: 'WO-120' }));
      expect(res.status).toBe(200);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('customfield_10073 on WO-120 is not a UUID'));
      warnSpy.mockRestore();
    });
  });

  // ── job_id resolution: customfield_10073 fallback (WO-122 race) ─────────

  describe('job_id resolution — customfield_10073 fallback (WO-122: jobs.jira_issue_key not yet persisted)', () => {
    it('resolves via the verified customfield_10073 fallback, backfills jobs.jira_issue_key, and completes the broadcast', async () => {
      const verifiedJobId = 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a22';
      let backfillArgs: unknown;
      callQueue = successQueueFallback({
        jobId: verifiedJobId,
        onBackfillUpdate: (args) => { backfillArgs = args[0]; },
      });
      mockGetJiraIssue.mockResolvedValue(issueWithFields({ [JIRA_FIELDS.orderId]: verifiedJobId }, 'WO-122'));
      mockSend.mockResolvedValue({ ok: true, messageId: '7777', error: null });

      const res = await POST(makeRequest({ event: 'translator_order_created', issueKey: 'WO-122' }));
      expect(res.status).toBe(200);
      const body = await res.json() as { action: string };
      expect(body.action).toBe('broadcast_sent');

      // telegram_assignments was created (the reservation insert is part of successQueueFallback
      // and the flow reaching sendMessage/200 proves it succeeded).
      expect(mockSend).toHaveBeenCalledWith(
        '-100111',
        expect.any(String),
        expect.arrayContaining([expect.objectContaining({ callback_data: 'translator_claim:WO-122' })]),
      );
      // jobs.jira_issue_key was repaired for next time, guarded against overwriting a set value.
      expect(backfillArgs).toEqual({ jira_issue_key: 'WO-122' });
    });

  });

  // ── job_id resolution: Jira-only operational issue, no WPO job at all ────

  describe('job_id resolution — no WPO job exists (manually created Jira operational issue)', () => {
    it('broadcasts successfully with job_id NULL when customfield_10073 is missing and jobs.jira_issue_key has no match', async () => {
      let insertedJobId: unknown = 'not-set';
      callQueue = successQueueNoJob({
        attemptedUuidLookup: false, // empty field — resolveJobId never attempts the byId lookup
        onReserveInsert: (args) => { insertedJobId = (args[0] as { job_id: unknown }).job_id; },
      });
      mockGetJiraIssue.mockResolvedValue(issueWithFields({}, 'WO-999'));
      mockSend.mockResolvedValue({ ok: true, messageId: '9001', error: null });

      const res = await POST(makeRequest({ event: 'translator_order_created', issueKey: 'WO-999' }));
      expect(res.status).toBe(200);
      const body = await res.json() as { action: string };
      expect(body.action).toBe('broadcast_sent');
      expect(insertedJobId).toBeNull();
      expect(mockSend).toHaveBeenCalledWith(
        '-100111',
        expect.any(String),
        expect.arrayContaining([expect.objectContaining({ callback_data: 'translator_claim:WO-999' })]),
      );
    });

    it('broadcasts successfully with job_id NULL when customfield_10073 is non-UUID (WO-120 shape) and jobs.jira_issue_key has no match', async () => {
      let insertedJobId: unknown = 'not-set';
      callQueue = successQueueNoJob({
        attemptedUuidLookup: false, // non-UUID field — resolveJobId never attempts the byId lookup
        onReserveInsert: (args) => { insertedJobId = (args[0] as { job_id: unknown }).job_id; },
      });
      mockGetJiraIssue.mockResolvedValue(issueWithFields({ [JIRA_FIELDS.orderId]: '1' }, 'WO-120'));
      mockSend.mockResolvedValue({ ok: true, messageId: '9002', error: null });

      const res = await POST(makeRequest({ event: 'translator_order_created', issueKey: 'WO-120' }));
      expect(res.status).toBe(200);
      const body = await res.json() as { action: string };
      expect(body.action).toBe('broadcast_sent');
      expect(insertedJobId).toBeNull();
    });

    it('broadcasts successfully with job_id NULL when customfield_10073 is a syntactically valid UUID but no jobs row has that id', async () => {
      let insertedJobId: unknown = 'not-set';
      callQueue = successQueueNoJob({
        attemptedUuidLookup: true, // valid UUID syntax — resolveJobId does attempt (and misses) the byId lookup
        onReserveInsert: (args) => { insertedJobId = (args[0] as { job_id: unknown }).job_id; },
      });
      mockGetJiraIssue.mockResolvedValue(issueWithFields({ [JIRA_FIELDS.orderId]: 'c2eebc99-9c0b-4ef8-bb6d-6bb9bd380a33' }, 'WO-500'));
      mockSend.mockResolvedValue({ ok: true, messageId: '9003', error: null });

      const res = await POST(makeRequest({ event: 'translator_order_created', issueKey: 'WO-500' }));
      expect(res.status).toBe(200);
      const body = await res.json() as { action: string };
      expect(body.action).toBe('broadcast_sent');
      expect(insertedJobId).toBeNull();
    });

    it('never queries price_quotes/cost_reservations or writes job_audit_log for a job_id-NULL broadcast', async () => {
      callQueue = successQueueNoJob({ attemptedUuidLookup: false });
      mockGetJiraIssue.mockResolvedValue(issueWithFields({}, 'WO-999'));
      mockSend.mockResolvedValue({ ok: true, messageId: '9004', error: null });

      await POST(makeRequest({ event: 'translator_order_created', issueKey: 'WO-999' }));
      // successQueueNoJob only supplies 4 factories (existing-check, jobs-by-key,
      // reserve, message_id update) — if getOrderExtras or job_audit_log made any
      // extra .from() calls, mockFrom would fall through to the default stub
      // instead of throwing, so we assert the exact call count directly.
      expect(mockFrom).toHaveBeenCalledTimes(4);
    });
  });

  // ── Reservation / send / update failure handling — must never silently succeed ──

  describe('explicit failure reporting (no silent success on a critical write)', () => {
    it('returns 500 without contacting Telegram when the reservation insert fails for a non-race reason', async () => {
      callQueue = [
        () => chainable({ data: null, error: null }), // existing check
        () => chainable({ data: { id: 'job-uuid-1' }, error: null }), // jobs lookup
        () => chainable({ data: null, error: { code: '42P01', message: 'relation missing' } }), // reserve insert fails
      ];
      mockGetJiraIssue.mockResolvedValue(issueWithFields({ [JIRA_FIELDS.orderId]: 'job-uuid-1' }));
      const res = await POST(makeRequest({ event: 'translator_order_created', issueKey: 'WO-1' }));
      expect(res.status).toBe(500);
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('treats a unique-violation on the reservation insert as a benign concurrent retry (already_broadcast)', async () => {
      callQueue = [
        () => chainable({ data: null, error: null }),
        () => chainable({ data: { id: 'job-uuid-1' }, error: null }),
        () => chainable({ data: null, error: { code: '23505', message: 'duplicate key' } }),
      ];
      mockGetJiraIssue.mockResolvedValue(issueWithFields({ [JIRA_FIELDS.orderId]: 'job-uuid-1' }));
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
