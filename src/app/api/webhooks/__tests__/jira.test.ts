/**
 * @jest-environment node
 */
import type { NextRequest } from 'next/server';

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock('@/lib/integrations/workflow', () => ({
  syncTranslatorDoneCertified: jest.fn().mockResolvedValue({ applied: true }),
  syncTranslatorDoneNotarized: jest.fn().mockResolvedValue({ applied: true }),
  syncTranslatorInProgress: jest.fn().mockResolvedValue({ applied: true }),
  syncNotaryInProgress: jest.fn().mockResolvedValue({ applied: true }),
  syncNotaryDone: jest.fn().mockResolvedValue({ applied: true }),
  syncTranslatorDeclined: jest.fn().mockResolvedValue(undefined),
  syncNotaryDeclined: jest.fn().mockResolvedValue(undefined),
  syncOrderReady: jest.fn().mockResolvedValue({ applied: true }),
  syncOutForDelivery: jest.fn().mockResolvedValue({ applied: true }),
  syncDelivered: jest.fn().mockResolvedValue({ applied: true }),
  syncPickedUp: jest.fn().mockResolvedValue({ applied: true }),
  syncJobTerminated: jest.fn().mockResolvedValue(undefined),
  syncInformational: jest.fn().mockResolvedValue(undefined),
}));

// Build a chainable Supabase mock.
const mockMaybySingle = jest.fn();
const mockSingle = jest.fn();
const mockInsert = jest.fn();

const chainable = {
  select: jest.fn(),
  eq: jest.fn(),
  insert: mockInsert,
  update: jest.fn(),
  maybeSingle: mockMaybySingle,
  single: mockSingle,
} as {
  select: jest.Mock;
  eq: jest.Mock;
  insert: jest.Mock;
  update: jest.Mock;
  maybeSingle: jest.Mock;
  single: jest.Mock;
};
chainable.select.mockReturnValue(chainable);
chainable.eq.mockReturnValue(chainable);
chainable.update.mockReturnValue(chainable);

jest.mock('@/lib/supabase/server', () => ({
  supabaseServer: {
    from: jest.fn(() => chainable),
  },
}));

// ── Helpers ────────────────────────────────────────────────────────────────────

const mocks = jest.requireMock('@/lib/integrations/workflow') as {
  syncTranslatorDoneCertified: jest.Mock;
  syncTranslatorDoneNotarized: jest.Mock;
  syncTranslatorInProgress: jest.Mock;
  syncNotaryInProgress: jest.Mock;
  syncNotaryDone: jest.Mock;
  syncTranslatorDeclined: jest.Mock;
  syncNotaryDeclined: jest.Mock;
  syncOrderReady: jest.Mock;
  syncOutForDelivery: jest.Mock;
  syncDelivered: jest.Mock;
  syncPickedUp: jest.Mock;
  syncJobTerminated: jest.Mock;
  syncInformational: jest.Mock;
};

const WEBHOOK_SECRET = 'test-webhook-secret';
const JOB_ID = '00000000-0000-4000-8000-000000000001'; // valid v4 UUID
const ISSUE_KEY = 'WPO-42';
const DOC_ID = '00000000-0000-4000-8000-000000000099';

function makeReq(body: unknown, secret?: string): NextRequest {
  return {
    json: jest.fn().mockResolvedValue(body),
    headers: {
      get: (name: string) => {
        if (name === 'x-wpo-webhook-secret') return secret ?? null;
        return null;
      },
    },
  } as unknown as NextRequest;
}

function makeJobRow(serviceLevel: string, issueKey: string = ISSUE_KEY, fulfillmentMethod = 'pickup') {
  return {
    id: JOB_ID,
    service_level: serviceLevel,
    notarized: false,
    jira_issue_key: issueKey,
    google_drive_folder_url: null,
    notary_city: 'almaty',
    fulfillment_method: fulfillmentMethod,
    document_id: DOC_ID,
    workflow_status: null,
  };
}

function payload(
  eventType: string,
  eventId: string,
  issueKey = ISSUE_KEY,
  orderId = JOB_ID,
) {
  return { eventId, eventType, issueKey, orderId };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/webhooks/jira', () => {
  let POST: typeof import('@/app/api/webhooks/jira/route').POST;

  beforeAll(async () => {
    process.env.JIRA_WEBHOOK_SECRET = WEBHOOK_SECRET;
    ({ POST } = await import('@/app/api/webhooks/jira/route'));
  });

  afterAll(() => {
    delete process.env.JIRA_WEBHOOK_SECRET;
  });

  beforeEach(() => {
    mockMaybySingle.mockReset();
    mockSingle.mockReset();
    mockInsert.mockReset();
    jest.clearAllMocks();
    mockInsert.mockResolvedValue({ error: null });
    mockSingle.mockResolvedValue({ data: null, error: null });
    // Restore chain after clearAllMocks
    chainable.select.mockReturnValue(chainable);
    chainable.eq.mockReturnValue(chainable);
    chainable.update.mockReturnValue(chainable);
  });

  function setupDb(auditExists: boolean, jobRow: ReturnType<typeof makeJobRow> | null) {
    mockMaybySingle
      .mockResolvedValueOnce({ data: auditExists ? { id: 'existing' } : null, error: null })
      .mockResolvedValueOnce({ data: jobRow, error: null })
      .mockResolvedValueOnce({ data: { source_language: 'kk', target_language: 'ru' }, error: null });
  }

  // ── 1. Authentication & validation ────────────────────────────────────────

  describe('authentication & validation', () => {
    it('returns 401 with wrong x-wpo-webhook-secret', async () => {
      const res = await POST(makeReq(payload('TRANSLATOR_COMPLETED', 'e-auth-1'), 'wrong'));
      expect(res.status).toBe(401);
    });

    it('returns 400 for invalid payload schema', async () => {
      const res = await POST(makeReq({ bad: 'payload' }, WEBHOOK_SECRET));
      expect(res.status).toBe(400);
    });

    it('returns 400 for unknown eventType', async () => {
      const res = await POST(makeReq(payload('UNKNOWN_EVENT', 'e-unk-1'), WEBHOOK_SECRET));
      expect(res.status).toBe(400);
    });

    it('returns 400 when orderId is not a UUID', async () => {
      const res = await POST(makeReq({ eventId: 'e-1', eventType: 'JOB_FAILED', issueKey: 'WPO-1', orderId: 'not-a-uuid' }, WEBHOOK_SECRET));
      expect(res.status).toBe(400);
    });
  });

  // ── 2. Idempotency ────────────────────────────────────────────────────────

  describe('idempotency', () => {
    it('skips already-processed event (audit log hit)', async () => {
      setupDb(true, makeJobRow('official_with_translator_signature_and_provider_stamp'));
      const res = await POST(makeReq(payload('TRANSLATOR_COMPLETED', 'e-idem-1'), WEBHOOK_SECRET));
      const body = (await res.json()) as { ok: boolean; skipped: string };
      expect(res.status).toBe(200);
      expect(body.skipped).toBe('already_processed');
      expect(mocks.syncTranslatorDoneCertified).not.toHaveBeenCalled();
    });
  });

  // ── 3. Event validation ───────────────────────────────────────────────────

  describe('event validation', () => {
    it('rejects NOTARY_COMPLETED for certified job (422)', async () => {
      setupDb(false, makeJobRow('official_with_translator_signature_and_provider_stamp'));
      const res = await POST(makeReq(payload('NOTARY_COMPLETED', 'e-val-1'), WEBHOOK_SECRET));
      expect(res.status).toBe(422);
    });

    it('rejects when issueKey does not match job record (409)', async () => {
      setupDb(false, makeJobRow('official_with_translator_signature_and_provider_stamp', 'WPO-999'));
      const res = await POST(makeReq(payload('TRANSLATOR_COMPLETED', 'e-val-2'), WEBHOOK_SECRET));
      expect(res.status).toBe(409);
    });
  });

  // ── 4. TRANSLATOR_COMPLETED — certified ──────────────────────────────────

  describe('TRANSLATOR_COMPLETED — certified', () => {
    it('calls syncTranslatorDoneCertified and returns 200', async () => {
      setupDb(false, makeJobRow('official_with_translator_signature_and_provider_stamp'));
      const res = await POST(makeReq(payload('TRANSLATOR_COMPLETED', 'e-cert-1'), WEBHOOK_SECRET));
      expect(res.status).toBe(200);
      expect(mocks.syncTranslatorDoneCertified).toHaveBeenCalledWith({
        jobId: JOB_ID,
        jiraIssueKey: ISSUE_KEY,
      });
      expect(mocks.syncTranslatorDoneNotarized).not.toHaveBeenCalled();
    });
  });

  // ── 5. TRANSLATOR_COMPLETED — notarized ──────────────────────────────────

  describe('TRANSLATOR_COMPLETED — notarized', () => {
    it('calls syncTranslatorDoneNotarized and returns 200', async () => {
      setupDb(false, makeJobRow('notarization_through_partners'));
      const res = await POST(makeReq(payload('TRANSLATOR_COMPLETED', 'e-not-1'), WEBHOOK_SECRET));
      expect(res.status).toBe(200);
      expect(mocks.syncTranslatorDoneNotarized).toHaveBeenCalled();
      expect(mocks.syncTranslatorDoneCertified).not.toHaveBeenCalled();
    });
  });

  // ── 6. TRANSLATOR_DECLINED ────────────────────────────────────────────────

  describe('TRANSLATOR_DECLINED', () => {
    it('calls syncTranslatorDeclined and returns 200', async () => {
      setupDb(false, makeJobRow('official_with_translator_signature_and_provider_stamp'));
      const res = await POST(makeReq(payload('TRANSLATOR_DECLINED', 'e-decl-1'), WEBHOOK_SECRET));
      expect(res.status).toBe(200);
      expect(mocks.syncTranslatorDeclined).toHaveBeenCalledWith({ jobId: JOB_ID, jiraIssueKey: ISSUE_KEY });
    });
  });

  // ── 7. NOTARY_IN_PROGRESS ─────────────────────────────────────────────────

  describe('NOTARY_IN_PROGRESS', () => {
    it('calls syncNotaryInProgress for notarization jobs', async () => {
      setupDb(false, makeJobRow('notarization_through_partners'));
      const res = await POST(makeReq(payload('NOTARY_IN_PROGRESS', 'e-nip-1'), WEBHOOK_SECRET));
      expect(res.status).toBe(200);
      expect(mocks.syncNotaryInProgress).toHaveBeenCalledWith({ jobId: JOB_ID, jiraIssueKey: ISSUE_KEY });
    });

    it('rejects NOTARY_IN_PROGRESS for certified job (422)', async () => {
      setupDb(false, makeJobRow('official_with_translator_signature_and_provider_stamp'));
      const res = await POST(makeReq(payload('NOTARY_IN_PROGRESS', 'e-nip-2'), WEBHOOK_SECRET));
      expect(res.status).toBe(422);
    });
  });

  // ── 8. NOTARY_COMPLETED ───────────────────────────────────────────────────

  describe('NOTARY_COMPLETED', () => {
    it('calls syncNotaryDone for notarization jobs', async () => {
      setupDb(false, makeJobRow('notarization_through_partners'));
      const res = await POST(makeReq(payload('NOTARY_COMPLETED', 'e-ndone-1'), WEBHOOK_SECRET));
      expect(res.status).toBe(200);
      expect(mocks.syncNotaryDone).toHaveBeenCalledWith({ jobId: JOB_ID, jiraIssueKey: ISSUE_KEY });
    });
  });

  // ── 9. NOTARY_DECLINED ────────────────────────────────────────────────────

  describe('NOTARY_DECLINED', () => {
    it('calls syncNotaryDeclined for notarization jobs', async () => {
      setupDb(false, makeJobRow('notarization_through_partners'));
      const res = await POST(makeReq(payload('NOTARY_DECLINED', 'e-ndecl-1'), WEBHOOK_SECRET));
      expect(res.status).toBe(200);
      expect(mocks.syncNotaryDeclined).toHaveBeenCalledWith({ jobId: JOB_ID, jiraIssueKey: ISSUE_KEY });
    });
  });

  // ── 10. ORDER_READY — delivery path ──────────────────────────────────────

  describe('ORDER_READY — delivery', () => {
    it('calls syncOrderReady with fulfillmentMethod=delivery', async () => {
      setupDb(false, makeJobRow('notarization_through_partners', ISSUE_KEY, 'delivery'));
      const res = await POST(makeReq(payload('ORDER_READY', 'e-ord-del-1'), WEBHOOK_SECRET));
      expect(res.status).toBe(200);
      expect(mocks.syncOrderReady).toHaveBeenCalledWith({
        jobId: JOB_ID,
        jiraIssueKey: ISSUE_KEY,
        fulfillmentMethod: 'delivery',
        serviceLevel: 'notarization_through_partners',
      });
    });
  });

  // ── 11. ORDER_READY — pickup path ─────────────────────────────────────────

  describe('ORDER_READY — pickup', () => {
    it('calls syncOrderReady with fulfillmentMethod=pickup', async () => {
      setupDb(false, makeJobRow('notarization_through_partners', ISSUE_KEY, 'pickup'));
      const res = await POST(makeReq(payload('ORDER_READY', 'e-ord-pick-1'), WEBHOOK_SECRET));
      expect(res.status).toBe(200);
      expect(mocks.syncOrderReady).toHaveBeenCalledWith({
        jobId: JOB_ID,
        jiraIssueKey: ISSUE_KEY,
        fulfillmentMethod: 'pickup',
        serviceLevel: 'notarization_through_partners',
      });
    });
  });

  // ── 12. OUT_FOR_DELIVERY ──────────────────────────────────────────────────

  describe('OUT_FOR_DELIVERY', () => {
    it('calls syncOutForDelivery and returns 200', async () => {
      setupDb(false, makeJobRow('notarization_through_partners', ISSUE_KEY, 'delivery'));
      const res = await POST(makeReq(payload('OUT_FOR_DELIVERY', 'e-ofd-1'), WEBHOOK_SECRET));
      expect(res.status).toBe(200);
      expect(mocks.syncOutForDelivery).toHaveBeenCalledWith({ jobId: JOB_ID, jiraIssueKey: ISSUE_KEY });
    });
  });

  // ── 13. DELIVERED ─────────────────────────────────────────────────────────

  describe('DELIVERED', () => {
    it('calls syncDelivered and returns 200', async () => {
      setupDb(false, makeJobRow('notarization_through_partners', ISSUE_KEY, 'delivery'));
      const res = await POST(makeReq(payload('DELIVERED', 'e-del-1'), WEBHOOK_SECRET));
      expect(res.status).toBe(200);
      expect(mocks.syncDelivered).toHaveBeenCalledWith({ jobId: JOB_ID, jiraIssueKey: ISSUE_KEY });
    });
  });

  // ── 14. PICKED_UP ─────────────────────────────────────────────────────────

  describe('PICKED_UP', () => {
    it('calls syncPickedUp (pickup path) and returns 200', async () => {
      setupDb(false, makeJobRow('notarization_through_partners', ISSUE_KEY, 'pickup'));
      const res = await POST(makeReq(payload('PICKED_UP', 'e-pick-1'), WEBHOOK_SECRET));
      expect(res.status).toBe(200);
      expect(mocks.syncPickedUp).toHaveBeenCalledWith({ jobId: JOB_ID, jiraIssueKey: ISSUE_KEY });
      expect(mocks.syncDelivered).not.toHaveBeenCalled();
    });
  });

  // ── 15. JOB_FAILED ────────────────────────────────────────────────────────

  describe('JOB_FAILED', () => {
    it('calls syncJobTerminated with reason failed', async () => {
      setupDb(false, makeJobRow('official_with_translator_signature_and_provider_stamp'));
      const res = await POST(makeReq(payload('JOB_FAILED', 'e-fail-1'), WEBHOOK_SECRET));
      expect(res.status).toBe(200);
      expect(mocks.syncJobTerminated).toHaveBeenCalledWith({ jobId: JOB_ID, jiraIssueKey: ISSUE_KEY, reason: 'failed' });
    });
  });

  // ── 16. JOB_CANCELED ──────────────────────────────────────────────────────

  describe('JOB_CANCELED', () => {
    it('calls syncJobTerminated with reason canceled', async () => {
      setupDb(false, makeJobRow('official_with_translator_signature_and_provider_stamp'));
      const res = await POST(makeReq(payload('JOB_CANCELED', 'e-cancel-1'), WEBHOOK_SECRET));
      expect(res.status).toBe(200);
      expect(mocks.syncJobTerminated).toHaveBeenCalledWith({ jobId: JOB_ID, jiraIssueKey: ISSUE_KEY, reason: 'canceled' });
    });
  });

  // ── 17. Informational events ──────────────────────────────────────────────

  describe('informational events', () => {
    it('TRANSLATOR_ACCEPTED calls syncInformational', async () => {
      setupDb(false, makeJobRow('official_with_translator_signature_and_provider_stamp'));
      const res = await POST(makeReq(payload('TRANSLATOR_ACCEPTED', 'e-inf-1'), WEBHOOK_SECRET));
      expect(res.status).toBe(200);
      expect(mocks.syncInformational).toHaveBeenCalled();
    });

    it('NOTARY_ACCEPTED calls syncInformational (notarization job only)', async () => {
      setupDb(false, makeJobRow('notarization_through_partners'));
      const res = await POST(makeReq(payload('NOTARY_ACCEPTED', 'e-inf-3'), WEBHOOK_SECRET));
      expect(res.status).toBe(200);
      expect(mocks.syncInformational).toHaveBeenCalled();
    });
  });

  // ── TRANSLATOR_IN_PROGRESS — "В работе у переводчика" (2026-08-04) ──────────
  // No longer informational — sets workflow_status = translator_review_in_progress.

  describe('TRANSLATOR_IN_PROGRESS', () => {
    it('calls syncTranslatorInProgress and returns 200 for an Official job', async () => {
      setupDb(false, makeJobRow('official_with_translator_signature_and_provider_stamp'));
      const res = await POST(makeReq(payload('TRANSLATOR_IN_PROGRESS', 'e-tip-1'), WEBHOOK_SECRET));
      expect(res.status).toBe(200);
      expect(mocks.syncTranslatorInProgress).toHaveBeenCalledWith({ jobId: JOB_ID, jiraIssueKey: ISSUE_KEY });
      expect(mocks.syncInformational).not.toHaveBeenCalled();
    });

    it('calls syncTranslatorInProgress and returns 200 for a Notary job', async () => {
      setupDb(false, makeJobRow('notarization_through_partners'));
      const res = await POST(makeReq(payload('TRANSLATOR_IN_PROGRESS', 'e-tip-2'), WEBHOOK_SECRET));
      expect(res.status).toBe(200);
      expect(mocks.syncTranslatorInProgress).toHaveBeenCalledWith({ jobId: JOB_ID, jiraIssueKey: ISSUE_KEY });
    });

    it('repeating the same eventId is idempotent — the existing in-memory guard short-circuits the retry, syncTranslatorInProgress is never called twice', async () => {
      setupDb(false, makeJobRow('official_with_translator_signature_and_provider_stamp'));
      const res1 = await POST(makeReq(payload('TRANSLATOR_IN_PROGRESS', 'e-tip-3'), WEBHOOK_SECRET));
      expect(res1.status).toBe(200);
      expect(mocks.syncTranslatorInProgress).toHaveBeenCalledTimes(1);

      // Second delivery of the SAME eventId — caught by the existing in-process
      // processedEventIds guard (route.ts step 3, before the DB is even queried again).
      const res2 = await POST(makeReq(payload('TRANSLATOR_IN_PROGRESS', 'e-tip-3'), WEBHOOK_SECRET));
      const body2 = await res2.json() as { ok: boolean; skipped?: string };
      expect(res2.status).toBe(200);
      expect(body2.skipped).toBe('duplicate');
      expect(mocks.syncTranslatorInProgress).toHaveBeenCalledTimes(1); // still 1 — not called again
    });
  });
});
