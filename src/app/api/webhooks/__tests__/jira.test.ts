/**
 * @jest-environment node
 */
import type { NextRequest } from 'next/server';

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock('@/lib/integrations/workflow', () => ({
  syncTranslatorDoneCertified: jest.fn().mockResolvedValue(undefined),
  syncTranslatorDoneNotarized: jest.fn().mockResolvedValue(undefined),
  syncNotaryDone: jest.fn().mockResolvedValue(undefined),
  syncTranslatorDeclined: jest.fn().mockResolvedValue(undefined),
  syncNotaryDeclined: jest.fn().mockResolvedValue(undefined),
  syncReadyForDelivery: jest.fn().mockResolvedValue(undefined),
  syncJobTerminated: jest.fn().mockResolvedValue(undefined),
  // aliases kept for compat
  transitionCertifiedToOperator: jest.fn().mockResolvedValue(undefined),
  transitionToNotary: jest.fn().mockResolvedValue(undefined),
  transitionNotaryToOperator: jest.fn().mockResolvedValue(undefined),
}));

// Build a chainable Supabase mock.
// select/eq/update keep persistent mockReturnValue(chainable) — never reset them.
// Only mockMaybySingle / mockInsert / mockSingle are reset between tests.
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
  syncNotaryDone: jest.Mock;
  syncTranslatorDeclined: jest.Mock;
  syncNotaryDeclined: jest.Mock;
  syncReadyForDelivery: jest.Mock;
  syncJobTerminated: jest.Mock;
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
        if (name === 'x-jira-webhook-secret') return secret ?? null;
        return null;
      },
    },
  } as unknown as NextRequest;
}

function makeJobRow(serviceLevel: string, issueKey: string = ISSUE_KEY) {
  return {
    id: JOB_ID,
    service_level: serviceLevel,
    notarized: false,
    jira_issue_key: issueKey,
    google_drive_folder_url: null,
    notary_city: 'almaty',
    fulfillment_method: 'pickup',
    document_id: DOC_ID,
  };
}

function payload(
  event: string,
  eventId: string,
  issueKey = ISSUE_KEY,
  jobId = JOB_ID,
) {
  return { eventId, event, issueKey, jobId };
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

  describe('authentication & validation', () => {
    it('returns 401 with wrong secret', async () => {
      const res = await POST(makeReq(payload('TRANSLATOR_DONE', 'e-auth-1'), 'wrong'));
      expect(res.status).toBe(401);
    });

    it('returns 400 for invalid payload schema', async () => {
      const res = await POST(makeReq({ bad: 'payload' }, WEBHOOK_SECRET));
      expect(res.status).toBe(400);
    });

    it('returns 400 for unknown event type', async () => {
      const res = await POST(makeReq(payload('UNKNOWN_EVENT', 'e-unk-1'), WEBHOOK_SECRET));
      expect(res.status).toBe(400);
    });
  });

  describe('idempotency', () => {
    it('skips already-processed event (audit log)', async () => {
      setupDb(true, makeJobRow('official_with_translator_signature_and_provider_stamp'));
      const res = await POST(makeReq(payload('TRANSLATOR_DONE', 'e-idem-1'), WEBHOOK_SECRET));
      const body = (await res.json()) as { ok: boolean; skipped: string };
      expect(res.status).toBe(200);
      expect(body.skipped).toBe('already_processed');
      expect(mocks.syncTranslatorDoneCertified).not.toHaveBeenCalled();
    });
  });

  describe('event validation', () => {
    it('rejects NOTARY_DONE for certified job (422)', async () => {
      setupDb(false, makeJobRow('official_with_translator_signature_and_provider_stamp'));
      const res = await POST(makeReq(payload('NOTARY_DONE', 'e-val-1'), WEBHOOK_SECRET));
      expect(res.status).toBe(422);
    });

    it('rejects when issueKey does not match job record (409)', async () => {
      setupDb(false, makeJobRow('official_with_translator_signature_and_provider_stamp', 'WPO-999'));
      const res = await POST(makeReq(payload('TRANSLATOR_DONE', 'e-val-2'), WEBHOOK_SECRET));
      expect(res.status).toBe(409);
    });
  });

  describe('TRANSLATOR_DONE — certified', () => {
    it('calls syncTranslatorDoneCertified and returns 200', async () => {
      setupDb(false, makeJobRow('official_with_translator_signature_and_provider_stamp'));
      const res = await POST(makeReq(payload('TRANSLATOR_DONE', 'e-cert-1'), WEBHOOK_SECRET));
      expect(res.status).toBe(200);
      expect(mocks.syncTranslatorDoneCertified).toHaveBeenCalledWith({
        jobId: JOB_ID,
        jiraIssueKey: ISSUE_KEY,
      });
      expect(mocks.syncTranslatorDoneNotarized).not.toHaveBeenCalled();
    });
  });

  describe('TRANSLATOR_DONE — notarized', () => {
    it('calls syncTranslatorDoneNotarized and returns 200', async () => {
      setupDb(false, makeJobRow('notarization_through_partners'));
      const res = await POST(makeReq(payload('TRANSLATOR_DONE', 'e-not-1'), WEBHOOK_SECRET));
      expect(res.status).toBe(200);
      expect(mocks.syncTranslatorDoneNotarized).toHaveBeenCalled();
      expect(mocks.syncTranslatorDoneCertified).not.toHaveBeenCalled();
    });
  });

  describe('TRANSLATOR_DECLINED', () => {
    it('calls syncTranslatorDeclined and returns 200', async () => {
      setupDb(false, makeJobRow('official_with_translator_signature_and_provider_stamp'));
      const res = await POST(makeReq(payload('TRANSLATOR_DECLINED', 'e-decl-1'), WEBHOOK_SECRET));
      expect(res.status).toBe(200);
      expect(mocks.syncTranslatorDeclined).toHaveBeenCalledWith({ jobId: JOB_ID, jiraIssueKey: ISSUE_KEY });
    });
  });

  describe('NOTARY_DONE', () => {
    it('calls syncNotaryDone for notarization jobs', async () => {
      setupDb(false, makeJobRow('notarization_through_partners'));
      const res = await POST(makeReq(payload('NOTARY_DONE', 'e-ndone-1'), WEBHOOK_SECRET));
      expect(res.status).toBe(200);
      expect(mocks.syncNotaryDone).toHaveBeenCalledWith({ jobId: JOB_ID, jiraIssueKey: ISSUE_KEY });
    });
  });

  describe('NOTARY_DECLINED', () => {
    it('calls syncNotaryDeclined for notarization jobs', async () => {
      setupDb(false, makeJobRow('notarization_through_partners'));
      const res = await POST(makeReq(payload('NOTARY_DECLINED', 'e-ndecl-1'), WEBHOOK_SECRET));
      expect(res.status).toBe(200);
      expect(mocks.syncNotaryDeclined).toHaveBeenCalledWith({ jobId: JOB_ID, jiraIssueKey: ISSUE_KEY });
    });
  });

  describe('JOB_FAILED', () => {
    it('calls syncJobTerminated with reason failed', async () => {
      setupDb(false, makeJobRow('official_with_translator_signature_and_provider_stamp'));
      const res = await POST(makeReq(payload('JOB_FAILED', 'e-fail-1'), WEBHOOK_SECRET));
      expect(res.status).toBe(200);
      expect(mocks.syncJobTerminated).toHaveBeenCalledWith({ jobId: JOB_ID, jiraIssueKey: ISSUE_KEY, reason: 'failed' });
    });
  });

  describe('JOB_CANCELED', () => {
    it('calls syncJobTerminated with reason canceled', async () => {
      setupDb(false, makeJobRow('official_with_translator_signature_and_provider_stamp'));
      const res = await POST(makeReq(payload('JOB_CANCELED', 'e-cancel-1'), WEBHOOK_SECRET));
      expect(res.status).toBe(200);
      expect(mocks.syncJobTerminated).toHaveBeenCalledWith({ jobId: JOB_ID, jiraIssueKey: ISSUE_KEY, reason: 'canceled' });
    });
  });

  describe('READY_FOR_DELIVERY', () => {
    it('calls syncReadyForDelivery and returns 200', async () => {
      setupDb(false, makeJobRow('official_with_translator_signature_and_provider_stamp'));
      const res = await POST(makeReq(payload('READY_FOR_DELIVERY', 'e-rfd-1'), WEBHOOK_SECRET));
      expect(res.status).toBe(200);
      expect(mocks.syncReadyForDelivery).toHaveBeenCalledWith({ jobId: JOB_ID, jiraIssueKey: ISSUE_KEY });
    });
  });
});
