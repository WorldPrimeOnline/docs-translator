/**
 * @jest-environment node
 */
import type { NextRequest } from 'next/server';

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock('@/lib/integrations/workflow', () => ({
  transitionCertifiedToOperator: jest.fn().mockResolvedValue(undefined),
  transitionToNotary: jest.fn().mockResolvedValue(undefined),
  transitionNotaryToOperator: jest.fn().mockResolvedValue(undefined),
}));

// Build a chainable Supabase mock that supports per-test data injection.
// select/eq/update keep persistent mockReturnValue(chainable) and must NEVER be reset.
// Only mockMaybySingle / mockInsert / mockSingle are reset between tests.
const mockMaybySingle = jest.fn();
const mockSingle = jest.fn();
const mockInsert = jest.fn();

const chainable = {
  select: jest.fn<typeof chainable, []>(),
  eq: jest.fn<typeof chainable, []>(),
  insert: mockInsert,
  update: jest.fn<typeof chainable, []>(),
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
// Self-referential so any chained call returns the same object
chainable.select.mockReturnValue(chainable);
chainable.eq.mockReturnValue(chainable);
chainable.update.mockReturnValue(chainable);

jest.mock('@/lib/supabase/server', () => ({
  supabaseServer: {
    from: jest.fn(() => chainable),
  },
}));

// ── Helpers ────────────────────────────────────────────────────────────────────

const { transitionCertifiedToOperator, transitionToNotary, transitionNotaryToOperator } =
  jest.requireMock('@/lib/integrations/workflow') as {
    transitionCertifiedToOperator: jest.Mock;
    transitionToNotary: jest.Mock;
    transitionNotaryToOperator: jest.Mock;
  };

const WEBHOOK_SECRET = 'test-webhook-secret';
const JOB_ID = '00000000-0000-4000-8000-000000000001'; // v4 UUID (version=4, variant=8)
const ISSUE_KEY = 'WPO-42';
const DOC_ID = '00000000-0000-0000-0000-000000000099';

/** Create a fake NextRequest that properly returns body via json() */
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

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/webhooks/jira', () => {
  // Import once — we control idempotency by using unique eventIds per test
  let POST: typeof import('@/app/api/webhooks/jira/route').POST;

  beforeAll(async () => {
    process.env.JIRA_WEBHOOK_SECRET = WEBHOOK_SECRET;
    ({ POST } = await import('@/app/api/webhooks/jira/route'));
  });

  afterAll(() => {
    delete process.env.JIRA_WEBHOOK_SECRET;
  });

  beforeEach(() => {
    // mockReset clears queued mockResolvedValueOnce values (clearAllMocks does not).
    mockMaybySingle.mockReset();
    mockSingle.mockReset();
    mockInsert.mockReset();
    // clearAllMocks clears call history on workflow integration fns without touching implementations.
    // chainable.select/eq/update keep their mockReturnValue(chainable) — clearAllMocks is safe.
    jest.clearAllMocks();
    // Re-apply defaults after mockReset cleared them.
    mockInsert.mockResolvedValue({ error: null });
    mockSingle.mockResolvedValue({ data: null, error: null });
  });

  // Simulate two Supabase maybySingle calls: (1) audit check, (2) job load
  function setupDbSequence(auditExists: boolean, jobRow: ReturnType<typeof makeJobRow> | null) {
    mockMaybySingle
      .mockResolvedValueOnce({ data: auditExists ? { id: 'existing' } : null, error: null })
      .mockResolvedValueOnce({ data: jobRow, error: null })
      // For transitionToNotary path: document query
      .mockResolvedValueOnce({
        data: { source_language: 'en', target_language: 'ru' },
        error: null,
      });
  }

  describe('authentication', () => {
    it('returns 401 with wrong secret', async () => {
      setupDbSequence(false, makeJobRow('official_with_translator_signature_and_provider_stamp'));
      const res = await POST(makeReq(
        { eventId: 'auth-e1', event: 'TRANSLATOR_DONE', issueKey: ISSUE_KEY, jobId: JOB_ID },
        'wrong-secret',
      ));
      expect(res.status).toBe(401);
    });

    it('returns 400 for invalid payload schema', async () => {
      const res = await POST(makeReq({ bad: 'payload' }, WEBHOOK_SECRET));
      expect(res.status).toBe(400);
    });
  });

  describe('idempotency', () => {
    it('skips already-processed event found in audit log', async () => {
      setupDbSequence(true, makeJobRow('official_with_translator_signature_and_provider_stamp'));
      const res = await POST(makeReq(
        { eventId: 'idempotency-e1', event: 'TRANSLATOR_DONE', issueKey: ISSUE_KEY, jobId: JOB_ID },
        WEBHOOK_SECRET,
      ));
      const body = (await res.json()) as { ok: boolean; skipped: string };
      expect(res.status).toBe(200);
      expect(body.skipped).toBe('already_processed');
      expect(transitionCertifiedToOperator).not.toHaveBeenCalled();
    });
  });

  describe('transition validation', () => {
    it('rejects NOTARY_DONE for certified job (422)', async () => {
      setupDbSequence(false, makeJobRow('official_with_translator_signature_and_provider_stamp'));
      const res = await POST(makeReq(
        { eventId: 'validate-e1', event: 'NOTARY_DONE', issueKey: ISSUE_KEY, jobId: JOB_ID },
        WEBHOOK_SECRET,
      ));
      expect(res.status).toBe(422);
    });

    it('rejects when issueKey does not match job (409)', async () => {
      setupDbSequence(false, makeJobRow('official_with_translator_signature_and_provider_stamp', 'WPO-999'));
      const res = await POST(makeReq(
        { eventId: 'validate-e2', event: 'TRANSLATOR_DONE', issueKey: ISSUE_KEY, jobId: JOB_ID },
        WEBHOOK_SECRET,
      ));
      expect(res.status).toBe(409);
    });
  });

  describe('TRANSLATOR_DONE — certified', () => {
    it('calls transitionCertifiedToOperator and returns 200', async () => {
      setupDbSequence(false, makeJobRow('official_with_translator_signature_and_provider_stamp'));
      const res = await POST(makeReq(
        { eventId: 'cert-e1', event: 'TRANSLATOR_DONE', issueKey: ISSUE_KEY, jobId: JOB_ID },
        WEBHOOK_SECRET,
      ));
      expect(res.status).toBe(200);
      expect(transitionCertifiedToOperator).toHaveBeenCalledWith({
        jobId: JOB_ID,
        jiraIssueKey: ISSUE_KEY,
      });
    });
  });

  describe('TRANSLATOR_DONE — notarization', () => {
    it('calls transitionToNotary and returns 200', async () => {
      setupDbSequence(false, makeJobRow('notarization_through_partners'));
      const res = await POST(makeReq(
        { eventId: 'notarized-e1', event: 'TRANSLATOR_DONE', issueKey: ISSUE_KEY, jobId: JOB_ID },
        WEBHOOK_SECRET,
      ));
      expect(res.status).toBe(200);
      expect(transitionToNotary).toHaveBeenCalled();
      expect(transitionCertifiedToOperator).not.toHaveBeenCalled();
    });
  });

  describe('NOTARY_DONE', () => {
    it('calls transitionNotaryToOperator for notarization jobs', async () => {
      setupDbSequence(false, makeJobRow('notarization_through_partners'));
      const res = await POST(makeReq(
        { eventId: 'notary-done-e1', event: 'NOTARY_DONE', issueKey: ISSUE_KEY, jobId: JOB_ID },
        WEBHOOK_SECRET,
      ));
      expect(res.status).toBe(200);
      expect(transitionNotaryToOperator).toHaveBeenCalledWith({
        jobId: JOB_ID,
        jiraIssueKey: ISSUE_KEY,
      });
    });
  });
});
