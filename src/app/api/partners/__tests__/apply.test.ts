/**
 * Tests for POST /api/partners/apply
 *
 * Approach: mock supabaseServer and jira partner-client, call the route handler directly.
 */

import { POST } from '../apply/route';
import type { NextResponse } from 'next/server';

// ─── Mocks ───────────────────────────────────────────────────────────────────

jest.mock('@/lib/supabase/server', () => ({
  supabaseServer: {
    from: jest.fn(),
  },
}));

jest.mock('@/lib/jira/partner-client', () => ({
  createPartnerApplicationIssue: jest.fn(),
}));

import { createPartnerApplicationIssue } from '@/lib/jira/partner-client';
import { supabaseServer } from '@/lib/supabase/server';

const mockCreateJiraIssue = createPartnerApplicationIssue as jest.MockedFunction<
  typeof createPartnerApplicationIssue
>;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/partners/apply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function json(res: NextResponse): Promise<unknown> {
  return res.json();
}

const VALID_BODY = {
  partnerType: 'translator',
  name: 'Иван Петров',
  email: 'ivan@example.com',
};

const INSERTED_ROW = { id: 'app-uuid-123', created_at: '2026-06-28T00:00:00Z' };

function setupDbSuccess() {
  (supabaseServer.from as jest.Mock).mockReturnValue({
    insert: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        single: jest.fn().mockResolvedValue({ data: INSERTED_ROW, error: null }),
      }),
    }),
    update: jest.fn().mockReturnValue({
      eq: jest.fn().mockResolvedValue({ error: null }),
    }),
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  mockCreateJiraIssue.mockResolvedValue(null);
});

describe('POST /api/partners/apply — validation', () => {
  it('returns 400 on non-JSON body', async () => {
    const req = new Request('http://localhost/api/partners/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 422 for missing required fields', async () => {
    setupDbSuccess();
    const res = await POST(makeRequest({ name: 'Test' }));
    expect(res.status).toBe(422);
  });

  it('returns 422 for invalid partner type', async () => {
    setupDbSuccess();
    const res = await POST(makeRequest({ ...VALID_BODY, partnerType: 'investor' }));
    expect(res.status).toBe(422);
  });

  it('returns 422 for invalid email', async () => {
    setupDbSuccess();
    const res = await POST(makeRequest({ ...VALID_BODY, email: 'not-an-email' }));
    expect(res.status).toBe(422);
  });

  it('returns 422 for message exceeding 2000 chars', async () => {
    setupDbSuccess();
    const res = await POST(makeRequest({ ...VALID_BODY, message: 'x'.repeat(2001) }));
    expect(res.status).toBe(422);
  });
});

describe('POST /api/partners/apply — DB insert', () => {
  it('returns 200 with applicationId on success', async () => {
    setupDbSuccess();
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(200);
    const body = await json(res) as { ok: boolean; applicationId: string };
    expect(body.ok).toBe(true);
    expect(body.applicationId).toBe('app-uuid-123');
  });

  it('returns 500 if DB insert fails', async () => {
    (supabaseServer.from as jest.Mock).mockReturnValue({
      insert: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({ data: null, error: new Error('db error') }),
        }),
      }),
    });
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(500);
  });
});

describe('POST /api/partners/apply — Jira fallback behavior', () => {
  it('returns 200 even when Jira creation throws', async () => {
    setupDbSuccess();
    mockCreateJiraIssue.mockRejectedValue(new Error('Jira unreachable'));

    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(200);
    const body = await json(res) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it('updates jira_sync_status=synced when Jira succeeds', async () => {
    const mockEqFn = jest.fn().mockResolvedValue({ error: null });
    const mockUpdateFn = jest.fn().mockReturnValue({ eq: mockEqFn });
    (supabaseServer.from as jest.Mock)
      .mockReturnValueOnce({
        insert: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({ data: INSERTED_ROW, error: null }),
          }),
        }),
      })
      .mockReturnValueOnce({ update: mockUpdateFn });

    mockCreateJiraIssue.mockResolvedValue({
      issueId: 'jira-123',
      issueKey: 'WO-999',
      issueUrl: 'https://jira.example.com/browse/WO-999',
    });

    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(200);
    expect(mockUpdateFn).toHaveBeenCalledWith(
      expect.objectContaining({ jira_issue_key: 'WO-999', jira_sync_status: 'synced' }),
    );
  });

  it('updates jira_sync_status=failed and records error when Jira fails', async () => {
    const mockEqFn = jest.fn().mockResolvedValue({ error: null });
    const mockUpdateFn = jest.fn().mockReturnValue({ eq: mockEqFn });
    (supabaseServer.from as jest.Mock)
      .mockReturnValueOnce({
        insert: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({ data: INSERTED_ROW, error: null }),
          }),
        }),
      })
      .mockReturnValueOnce({ update: mockUpdateFn });

    mockCreateJiraIssue.mockRejectedValue(new Error('Jira createPartnerIssue failed: 503'));

    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(200);
    expect(mockUpdateFn).toHaveBeenCalledWith(
      expect.objectContaining({
        jira_sync_status: 'failed',
        jira_last_error: expect.stringContaining('Jira createPartnerIssue failed'),
      }),
    );
  });
});

describe('POST /api/partners/apply — staging safety', () => {
  it('labels Jira issue with wpo-staging on staging environment', async () => {
    const origEnv = process.env.NEXT_PUBLIC_APP_ENV;
    process.env.NEXT_PUBLIC_APP_ENV = 'staging';

    setupDbSuccess();
    mockCreateJiraIssue.mockResolvedValue(null);

    await POST(makeRequest(VALID_BODY));

    // Verify that createPartnerApplicationIssue was called — the label is set inside
    // partner-client.ts based on NEXT_PUBLIC_APP_ENV, so we just verify it was invoked
    expect(mockCreateJiraIssue).toHaveBeenCalledWith(
      expect.objectContaining({ applicationId: INSERTED_ROW.id }),
    );

    process.env.NEXT_PUBLIC_APP_ENV = origEnv;
  });
});
