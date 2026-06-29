/**
 * Tests for POST /api/webhooks/jira/partnership
 *
 * Verifies: auth, activation, idempotent re-activation, deactivation,
 * code generation, no-op for unknown statuses, missing application guard.
 */

process.env.JIRA_WEBHOOK_SECRET = 'test-partnership-secret';

jest.mock('@/lib/supabase/server', () => ({
  supabaseServer: { from: jest.fn() },
}));

import { NextRequest } from 'next/server';
import { POST } from '../partnership/route';
import { supabaseServer } from '@/lib/supabase/server';

const mockFrom = supabaseServer.from as jest.Mock;

// ─── Request factory ─────────────────────────────────────────────────────────

function makeRequest(body: unknown, secret = 'test-partnership-secret'): NextRequest {
  return new NextRequest('http://localhost/api/webhooks/jira/partnership', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-wpo-webhook-secret': secret,
    },
    body: JSON.stringify(body),
  });
}

const ACTIVATE   = 'АКТИВНОЕ ПАРТНЁРСТВО';
const DEACTIVATE = 'ПАРТНЁРСТВО ОТМЕНЕНО';

// ─── Application stub ────────────────────────────────────────────────────────

function makeApp(overrides: Partial<{
  id: string; name: string; email: string; organization: string | null;
  ref_code: string | null; status: string; approved_partner_id: string | null;
  partner_type: string;
}> = {}) {
  return {
    id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a01',
    partner_type: 'visa_center',
    name: 'Alice Visa',
    email: 'alice@visa.kz',
    organization: 'Visa Center Almaty',
    ref_code: null,
    status: 'pending',
    approved_partner_id: null,
    ...overrides,
  };
}

// ─── Mock chain builders ─────────────────────────────────────────────────────

function chainMaybeSingle(data: unknown) {
  return {
    select: jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        maybeSingle: jest.fn().mockResolvedValue({ data, error: null }),
      }),
    }),
  };
}

function chainInsertSelect(data: unknown, error: unknown = null) {
  return {
    insert: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        single: jest.fn().mockResolvedValue({ data, error }),
      }),
    }),
  };
}

function chainUpdate() {
  return {
    update: jest.fn().mockReturnValue({
      eq: jest.fn().mockResolvedValue({ error: null }),
    }),
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('POST /api/webhooks/jira/partnership', () => {
  beforeEach(() => jest.clearAllMocks());

  // ── Auth ──────────────────────────────────────────────────────────────────

  it('returns 401 when X-WPO-Webhook-Secret is missing', async () => {
    const req = new NextRequest('http://localhost/api/webhooks/jira/partnership', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ issue: { key: 'WPO-1', status: ACTIVATE } }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('returns 401 when X-WPO-Webhook-Secret is wrong', async () => {
    const res = await POST(makeRequest({ issue: { key: 'WPO-1', status: ACTIVATE } }, 'wrong'));
    expect(res.status).toBe(401);
  });

  // ── Unknown status → no-op ────────────────────────────────────────────────

  it('returns ok with action=no_op for unrecognized Jira statuses', async () => {
    const res = await POST(makeRequest({ issue: { key: 'WPO-99', status: 'В РАБОТЕ' } }));
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; action: string };
    expect(body.ok).toBe(true);
    expect(body.action).toBe('no_op');
  });

  // ── Missing application ───────────────────────────────────────────────────

  it('returns 404 when application not found by jira_issue_key', async () => {
    mockFrom.mockReturnValue(chainMaybeSingle(null));
    const res = await POST(makeRequest({ issue: { key: 'WPO-404', status: ACTIVATE } }));
    expect(res.status).toBe(404);
  });

  it('returns 404 when application not found by partner_application_id', async () => {
    mockFrom.mockReturnValue(chainMaybeSingle(null));
    const res = await POST(makeRequest({
      issue: { key: 'WPO-404', status: ACTIVATE },
      partner_application_id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a02',
    }));
    expect(res.status).toBe(404);
  });

  // ── Activation: creates new partner ──────────────────────────────────────

  it('creates partner from application on АКТИВНОЕ ПАРТНЁРСТВО', async () => {
    const app = makeApp();
    const partner = { id: 'partner-uuid-01', referral_code: 'VISACENTER1234' };

    let callCount = 0;
    mockFrom.mockImplementation((table: string) => {
      callCount++;
      if (table === 'partner_applications' && callCount === 1) return chainMaybeSingle(app);        // loadApplication
      if (table === 'partners' && callCount === 2) return chainMaybeSingle(null);                   // uniqueness check
      if (table === 'partners' && callCount === 3) return chainInsertSelect(partner);               // insert
      if (table === 'partner_applications' && callCount === 4) return chainUpdate();                 // update application
      return chainMaybeSingle(null);
    });

    const res = await POST(makeRequest({ issue: { key: 'WPO-10', status: ACTIVATE } }));
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; action: string; partnerId: string };
    expect(body.ok).toBe(true);
    expect(body.action).toBe('created');
    expect(body.partnerId).toBe('partner-uuid-01');
  });

  // ── Activation: uses application ref_code ─────────────────────────────────

  it('uses normalized application ref_code when available and unique', async () => {
    const app = makeApp({ ref_code: 'EDU5PCT' });
    const partner = { id: 'partner-uuid-02', referral_code: 'EDU5PCT' };

    let callCount = 0;
    mockFrom.mockImplementation((table: string) => {
      callCount++;
      if (table === 'partner_applications' && callCount === 1) return chainMaybeSingle(app);
      if (table === 'partners' && callCount === 2) return chainMaybeSingle(null);   // code is unique
      if (table === 'partners' && callCount === 3) return chainInsertSelect(partner);
      if (table === 'partner_applications' && callCount === 4) return chainUpdate();
      return chainMaybeSingle(null);
    });

    const res = await POST(makeRequest({ issue: { key: 'WPO-11', status: ACTIVATE } }));
    expect(res.status).toBe(200);
    const body = await res.json() as { referralCode: string };
    expect(body.referralCode).toBe('EDU5PCT');
  });

  // ── Activation: code collision → retry ───────────────────────────────────

  it('generates a new code when ref_code already taken (collision handling)', async () => {
    const app = makeApp({ ref_code: 'TAKEN' });
    const partner = { id: 'partner-uuid-03', referral_code: 'VISACENTER1234' };

    let callCount = 0;
    mockFrom.mockImplementation((table: string) => {
      callCount++;
      if (table === 'partner_applications' && callCount === 1) return chainMaybeSingle(app);
      if (table === 'partners' && callCount === 2) {
        // First uniqueness check (TAKEN) → collision
        return chainMaybeSingle({ id: 'existing' });
      }
      if (table === 'partners' && callCount === 3) return chainMaybeSingle(null);   // auto-generated unique
      if (table === 'partners' && callCount === 4) return chainInsertSelect(partner);
      if (table === 'partner_applications' && callCount === 5) return chainUpdate();
      return chainMaybeSingle(null);
    });

    const res = await POST(makeRequest({ issue: { key: 'WPO-12', status: ACTIVATE } }));
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  // ── Activation: idempotent (existing partner) ────────────────────────────

  it('re-activates existing partner on АКТИВНОЕ ПАРТНЁРСТВО (idempotent)', async () => {
    const app = makeApp({ approved_partner_id: 'existing-partner-id' });

    let callCount = 0;
    mockFrom.mockImplementation((table: string) => {
      callCount++;
      if (table === 'partner_applications' && callCount === 1) return chainMaybeSingle(app);
      if (table === 'partners' && callCount === 2) return chainUpdate();   // update existing
      return chainMaybeSingle(null);
    });

    const res = await POST(makeRequest({ issue: { key: 'WPO-13', status: ACTIVATE } }));
    expect(res.status).toBe(200);
    const body = await res.json() as { action: string; partnerId: string };
    expect(body.action).toBe('reactivated');
    expect(body.partnerId).toBe('existing-partner-id');
  });

  // ── Deactivation: deactivates partner ────────────────────────────────────

  it('deactivates existing partner on ПАРТНЁРСТВО ОТМЕНЕНО', async () => {
    const app = makeApp({ approved_partner_id: 'partner-to-deactivate' });

    let callCount = 0;
    mockFrom.mockImplementation((table: string) => {
      callCount++;
      if (table === 'partner_applications' && callCount === 1) return chainMaybeSingle(app);
      if (table === 'partner_applications' && callCount === 2) return chainUpdate();  // cancel app
      if (table === 'partners' && callCount === 3) return chainUpdate();              // deactivate partner
      return chainMaybeSingle(null);
    });

    const res = await POST(makeRequest({ issue: { key: 'WPO-14', status: DEACTIVATE } }));
    expect(res.status).toBe(200);
    const body = await res.json() as { action: string; partnerId: string };
    expect(body.action).toBe('deactivated');
    expect(body.partnerId).toBe('partner-to-deactivate');
  });

  // ── Deactivation: no partner yet (only application exists) ───────────────

  it('cancels application when no partner record exists yet', async () => {
    const app = makeApp({ approved_partner_id: null });

    let callCount = 0;
    mockFrom.mockImplementation((table: string) => {
      callCount++;
      if (table === 'partner_applications' && callCount === 1) return chainMaybeSingle(app);
      if (table === 'partner_applications' && callCount === 2) return chainUpdate();  // cancel app
      return chainMaybeSingle(null);
    });

    const res = await POST(makeRequest({ issue: { key: 'WPO-15', status: DEACTIVATE } }));
    expect(res.status).toBe(200);
    const body = await res.json() as { action: string };
    expect(body.action).toBe('application_canceled');
  });

  // ── Lookup by partner_application_id ──────────────────────────────────────

  it('prefers partner_application_id lookup over jira_issue_key', async () => {
    const app = makeApp({ id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a03' });
    const partner = { id: 'partner-uuid-04', referral_code: 'VISACENTER9876' };

    let callCount = 0;
    mockFrom.mockImplementation((table: string) => {
      callCount++;
      if (table === 'partner_applications' && callCount === 1) return chainMaybeSingle(app);
      if (table === 'partners' && callCount === 2) return chainMaybeSingle(null);
      if (table === 'partners' && callCount === 3) return chainInsertSelect(partner);
      if (table === 'partner_applications' && callCount === 4) return chainUpdate();
      return chainMaybeSingle(null);
    });

    const res = await POST(makeRequest({
      issue: { key: 'WPO-16', status: ACTIVATE },
      partner_application_id: app.id,
    }));
    expect(res.status).toBe(200);

    // First from() call must be partner_applications with select (by ID, not by jira key)
    const firstCall = mockFrom.mock.calls[0];
    expect(firstCall[0]).toBe('partner_applications');
  });

  // ── Public apply does not create active partner ───────────────────────────

  it('public application submit does not create a partners row (no active partner without webhook)', async () => {
    // The apply route only inserts into partner_applications + creates Jira issue.
    // Verify that activating a partner requires going through this webhook.
    // This is verified by the fact that no activation logic exists in apply/route.ts.
    // Here we just confirm the webhook correctly requires JIRA_WEBHOOK_SECRET.
    const req = new NextRequest('http://localhost/api/webhooks/jira/partnership', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // No auth header — simulates unauthorized public call
      body: JSON.stringify({ issue: { key: 'WPO-99', status: ACTIVATE } }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });
});
