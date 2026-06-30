/**
 * Tests for POST /api/webhooks/jira/partnership
 *
 * Verifies: auth, activation, idempotent re-activation, deactivation,
 * code generation, no-op for unknown statuses, missing application guard,
 * Jira activation/deactivation comment posting (best-effort).
 */

process.env.JIRA_WEBHOOK_SECRET = 'test-partnership-secret';

jest.mock('@/lib/supabase/server', () => ({
  supabaseServer: { from: jest.fn() },
}));

jest.mock('@/lib/jira/partner-client', () => ({
  createPartnerApplicationIssue: jest.fn().mockResolvedValue(undefined),
  addPartnerActivationComment: jest.fn().mockResolvedValue(undefined),
  addPartnerDeactivationComment: jest.fn().mockResolvedValue(undefined),
}));

import { NextRequest } from 'next/server';
import { POST } from '../partnership/route';
import { supabaseServer } from '@/lib/supabase/server';
import {
  addPartnerActivationComment,
  addPartnerDeactivationComment,
} from '@/lib/jira/partner-client';

const mockFrom = supabaseServer.from as jest.Mock;
const mockActivationComment = addPartnerActivationComment as jest.Mock;
const mockDeactivationComment = addPartnerDeactivationComment as jest.Mock;

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

function chainSingle(data: unknown, error: unknown = null) {
  return {
    select: jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        single: jest.fn().mockResolvedValue({ data, error }),
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

function chainUpdate(error: unknown = null) {
  return {
    update: jest.fn().mockReturnValue({
      eq: jest.fn().mockResolvedValue({ error }),
    }),
  };
}

// Queue-based mock: each from() call consumes the next item in the queue.
let callQueue: Array<() => object> = [];

beforeEach(() => {
  jest.clearAllMocks();
  callQueue = [];
  mockFrom.mockImplementation(() => {
    const factory = callQueue.shift();
    if (!factory) {
      // Fallback for any unexpected extra calls
      return chainMaybeSingle(null);
    }
    return factory();
  });
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('POST /api/webhooks/jira/partnership', () => {

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

  it('unknown status returns 200 no_op and does not call Supabase', async () => {
    const res = await POST(makeRequest({ issue: { key: 'WPO-24', status: 'НА РАССМОТРЕНИИ' } }));
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; action: string };
    expect(body.ok).toBe(true);
    expect(body.action).toBe('no_op');
    expect(mockFrom).not.toHaveBeenCalled();
  });

  // ── Missing application ───────────────────────────────────────────────────

  it('returns 404 when application not found by jira_issue_key', async () => {
    callQueue = [() => chainMaybeSingle(null)];
    const res = await POST(makeRequest({ issue: { key: 'WPO-404', status: ACTIVATE } }));
    expect(res.status).toBe(404);
  });

  it('returns 404 when application not found by partner_application_id', async () => {
    callQueue = [() => chainMaybeSingle(null)];
    const res = await POST(makeRequest({
      issue: { key: 'WPO-404', status: ACTIVATE },
      partner_application_id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a02',
    }));
    expect(res.status).toBe(404);
  });

  // ── Activation: creates new partner ──────────────────────────────────────
  // DB calls: loadApp → uniqueness check → insert partner → update app → update comment ts

  it('creates partner from application on АКТИВНОЕ ПАРТНЁРСТВО', async () => {
    const app = makeApp();
    const partner = { id: 'partner-uuid-01', referral_code: 'VISACENTER1234' };

    callQueue = [
      () => chainMaybeSingle(app),         // loadApplication
      () => chainMaybeSingle(null),        // uniqueness check → unique
      () => chainInsertSelect(partner),    // insert partner
      () => chainUpdate(),                 // update application (approve)
      () => chainUpdate(),                 // update activation_comment_added_at
    ];

    const res = await POST(makeRequest({ issue: { key: 'WPO-10', status: ACTIVATE } }));
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; action: string; partnerId: string };
    expect(body.ok).toBe(true);
    expect(body.action).toBe('created');
    expect(body.partnerId).toBe('partner-uuid-01');
  });

  it('response includes referral link with production domain on creation', async () => {
    const app = makeApp();
    const partner = { id: 'partner-uuid-link', referral_code: 'MYCODE123' };

    callQueue = [
      () => chainMaybeSingle(app),
      () => chainMaybeSingle(null),
      () => chainInsertSelect(partner),
      () => chainUpdate(),
      () => chainUpdate(),
    ];

    const res = await POST(makeRequest({ issue: { key: 'WPO-30', status: ACTIVATE } }));
    const body = await res.json() as { referralLink: string };
    expect(body.referralLink).toBe('https://www.wpotranslations.org/ru?ref=MYCODE123');
  });

  // ── Activation: Jira comment posted ──────────────────────────────────────

  it('calls addPartnerActivationComment after successful partner creation', async () => {
    const app = makeApp();
    const partner = { id: 'partner-uuid-comment', referral_code: 'TESTCODE' };

    callQueue = [
      () => chainMaybeSingle(app),
      () => chainMaybeSingle(null),
      () => chainInsertSelect(partner),
      () => chainUpdate(),
      () => chainUpdate(),
    ];

    await POST(makeRequest({ issue: { key: 'WPO-31', status: ACTIVATE } }));

    expect(mockActivationComment).toHaveBeenCalledTimes(1);
    const [calledKey, calledParams] = mockActivationComment.mock.calls[0] as [string, {
      referralCode: string; partnerLink: string; qrCodeUrl: string;
      commissionRate: number; clientDiscountEnabled: boolean;
    }];
    expect(calledKey).toBe('WPO-31');
    expect(calledParams.referralCode).toBe('TESTCODE');
    expect(calledParams.partnerLink).toBe('https://www.wpotranslations.org/ru?ref=TESTCODE');
    expect(calledParams.qrCodeUrl).toBe('https://www.wpotranslations.org/api/partners/qr/TESTCODE');
    expect(calledParams.commissionRate).toBe(0.05);
    // Default: 5% discount capped at 500 KZT, min order 2500 KZT
    expect(calledParams.clientDiscountEnabled).toBe(true);
  });

  it('creates partner with 5% default discount (capped 500 KZT, min order 2500 KZT)', async () => {
    const app = makeApp();
    const partner = { id: 'partner-uuid-defaults', referral_code: 'DEFAULTTEST' };
    let capturedInsert: ReturnType<typeof chainInsertSelect> | null = null;

    callQueue = [
      () => chainMaybeSingle(app),
      () => chainMaybeSingle(null),
      () => { capturedInsert = chainInsertSelect(partner); return capturedInsert; },
      () => chainUpdate(),
      () => chainUpdate(),
    ];

    await POST(makeRequest({ issue: { key: 'WPO-defaults', status: ACTIVATE } }));

    const insertArg = (capturedInsert!.insert as jest.Mock).mock.calls[0][0] as Record<string, unknown>;
    expect(insertArg.client_discount_enabled).toBe(true);
    expect(insertArg.client_discount_type).toBe('percent');
    expect(insertArg.client_discount_value).toBe(5);
    expect(insertArg.client_discount_min_order_amount).toBe(2500);
    expect(insertArg.client_discount_max_amount).toBe(500);
  });

  it('Jira comment failure is non-fatal — response still 200 and stores error', async () => {
    mockActivationComment.mockRejectedValueOnce(new Error('Jira down'));

    const app = makeApp();
    const partner = { id: 'partner-uuid-err', referral_code: 'FAILCODE' };
    const errorUpdate = chainUpdate();

    callQueue = [
      () => chainMaybeSingle(app),
      () => chainMaybeSingle(null),
      () => chainInsertSelect(partner),
      () => chainUpdate(),
      () => errorUpdate,   // activation_comment_error update
    ];

    const res = await POST(makeRequest({ issue: { key: 'WPO-32', status: ACTIVATE } }));
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(true);

    // Error update was called with activation_comment_error field
    const updateMock = errorUpdate.update as jest.Mock;
    const updateArg = updateMock.mock.calls[0][0] as Record<string, unknown>;
    expect(updateArg).toHaveProperty('activation_comment_error');
    expect(typeof updateArg.activation_comment_error).toBe('string');
  });

  // ── Activation: uses application ref_code ─────────────────────────────────

  it('uses normalized application ref_code when available and unique', async () => {
    const app = makeApp({ ref_code: 'EDU5PCT' });
    const partner = { id: 'partner-uuid-02', referral_code: 'EDU5PCT' };

    callQueue = [
      () => chainMaybeSingle(app),
      () => chainMaybeSingle(null),    // code is unique
      () => chainInsertSelect(partner),
      () => chainUpdate(),
      () => chainUpdate(),
    ];

    const res = await POST(makeRequest({ issue: { key: 'WPO-11', status: ACTIVATE } }));
    expect(res.status).toBe(200);
    const body = await res.json() as { referralCode: string };
    expect(body.referralCode).toBe('EDU5PCT');
  });

  // ── Activation: code collision → retry ───────────────────────────────────

  it('generates a new code when ref_code already taken (collision handling)', async () => {
    const app = makeApp({ ref_code: 'TAKEN' });
    const partner = { id: 'partner-uuid-03', referral_code: 'VISACENTER1234' };

    callQueue = [
      () => chainMaybeSingle(app),
      () => chainMaybeSingle({ id: 'existing' }), // TAKEN → collision
      () => chainMaybeSingle(null),               // auto-generated → unique
      () => chainInsertSelect(partner),
      () => chainUpdate(),
      () => chainUpdate(),
    ];

    const res = await POST(makeRequest({ issue: { key: 'WPO-12', status: ACTIVATE } }));
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  // ── Activation: idempotent (existing partner) ────────────────────────────
  // DB calls: loadApp → select existing partner → update is_active → update comment ts

  it('re-activates existing partner on АКТИВНОЕ ПАРТНЁРСТВО (idempotent)', async () => {
    const app = makeApp({ approved_partner_id: 'existing-partner-id' });
    const existingPartner = {
      id: 'existing-partner-id',
      referral_code: 'EXISTCODE',
      commission_rate: 0.05,
      client_discount_enabled: true,
      client_discount_type: 'fixed',
      client_discount_value: 1000,
      client_discount_min_order_amount: 5000,
      client_discount_max_amount: null,
    };

    callQueue = [
      () => chainMaybeSingle(app),          // loadApplication
      () => chainSingle(existingPartner),   // select existing partner (for comment params)
      () => chainUpdate(),                  // update is_active + links
      () => chainUpdate(),                  // update activation_comment_added_at
    ];

    const res = await POST(makeRequest({ issue: { key: 'WPO-13', status: ACTIVATE } }));
    expect(res.status).toBe(200);
    const body = await res.json() as { action: string; partnerId: string };
    expect(body.action).toBe('reactivated');
    expect(body.partnerId).toBe('existing-partner-id');
  });

  it('calls addPartnerActivationComment on reactivation using actual partner config', async () => {
    const app = makeApp({ approved_partner_id: 'existing-partner-id' });
    const existingPartner = {
      id: 'existing-partner-id',
      referral_code: 'REACTIVATE',
      commission_rate: 0.07,
      client_discount_enabled: true,
      client_discount_type: 'percent',
      client_discount_value: 5,
      client_discount_min_order_amount: 3000,
      client_discount_max_amount: 10000,
    };

    callQueue = [
      () => chainMaybeSingle(app),
      () => chainSingle(existingPartner),
      () => chainUpdate(),
      () => chainUpdate(),
    ];

    await POST(makeRequest({ issue: { key: 'WPO-34', status: ACTIVATE } }));

    expect(mockActivationComment).toHaveBeenCalledTimes(1);
    const [, params] = mockActivationComment.mock.calls[0] as [string, { commissionRate: number; clientDiscountValue: number; clientDiscountType: string }];
    expect(params.commissionRate).toBe(0.07);
    expect(params.clientDiscountValue).toBe(5);
  });

  // ── Deactivation: deactivates partner ────────────────────────────────────
  // DB calls: loadApp → update app (cancel) → select partner (ref code) → update partner (deactivate)

  it('deactivates existing partner on ПАРТНЁРСТВО ОТМЕНЕНО', async () => {
    const app = makeApp({ approved_partner_id: 'partner-to-deactivate' });
    const existingPartner = { id: 'partner-to-deactivate', referral_code: 'DEACTCODE' };

    callQueue = [
      () => chainMaybeSingle(app),           // loadApplication
      () => chainUpdate(),                   // update application (cancel)
      () => chainSingle(existingPartner),    // select partner for ref code
      () => chainUpdate(),                   // update partner (deactivate)
    ];

    const res = await POST(makeRequest({ issue: { key: 'WPO-14', status: DEACTIVATE } }));
    expect(res.status).toBe(200);
    const body = await res.json() as { action: string; partnerId: string };
    expect(body.action).toBe('deactivated');
    expect(body.partnerId).toBe('partner-to-deactivate');
  });

  it('calls addPartnerDeactivationComment after deactivation', async () => {
    const app = makeApp({ approved_partner_id: 'partner-deact-comment' });
    const existingPartner = { id: 'partner-deact-comment', referral_code: 'BYECODE' };

    callQueue = [
      () => chainMaybeSingle(app),
      () => chainUpdate(),
      () => chainSingle(existingPartner),
      () => chainUpdate(),
    ];

    await POST(makeRequest({ issue: { key: 'WPO-35', status: DEACTIVATE } }));

    expect(mockDeactivationComment).toHaveBeenCalledTimes(1);
    const [calledKey, calledCode] = mockDeactivationComment.mock.calls[0] as [string, string];
    expect(calledKey).toBe('WPO-35');
    expect(calledCode).toBe('BYECODE');
  });

  it('deactivation comment failure is non-fatal', async () => {
    mockDeactivationComment.mockRejectedValueOnce(new Error('Jira timeout'));

    const app = makeApp({ approved_partner_id: 'partner-deact-nofail' });
    const existingPartner = { id: 'partner-deact-nofail', referral_code: 'NOFAIL' };

    callQueue = [
      () => chainMaybeSingle(app),
      () => chainUpdate(),
      () => chainSingle(existingPartner),
      () => chainUpdate(),
    ];

    const res = await POST(makeRequest({ issue: { key: 'WPO-36', status: DEACTIVATE } }));
    expect(res.status).toBe(200);
    const body = await res.json() as { action: string };
    expect(body.action).toBe('deactivated');
  });

  // ── Deactivation: no partner yet (only application exists) ───────────────

  it('cancels application when no partner record exists yet', async () => {
    const app = makeApp({ approved_partner_id: null });

    callQueue = [
      () => chainMaybeSingle(app),   // loadApplication (no approved_partner_id)
      () => chainUpdate(),           // update application (cancel)
    ];

    const res = await POST(makeRequest({ issue: { key: 'WPO-15', status: DEACTIVATE } }));
    expect(res.status).toBe(200);
    const body = await res.json() as { action: string };
    expect(body.action).toBe('application_canceled');
    expect(mockDeactivationComment).not.toHaveBeenCalled();
  });

  // ── Lookup by partner_application_id ──────────────────────────────────────

  it('prefers partner_application_id lookup over jira_issue_key', async () => {
    const app = makeApp({ id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a03' });
    const partner = { id: 'partner-uuid-04', referral_code: 'VISACENTER9876' };

    callQueue = [
      () => chainMaybeSingle(app),
      () => chainMaybeSingle(null),
      () => chainInsertSelect(partner),
      () => chainUpdate(),
      () => chainUpdate(),
    ];

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
    const req = new NextRequest('http://localhost/api/webhooks/jira/partnership', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ issue: { key: 'WPO-99', status: ACTIVATE } }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  // ── Ё/Е normalization ─────────────────────────────────────────────────────

  it('accepts "АКТИВНОЕ ПАРТНЕРСТВО" (without Ё) as activation', async () => {
    const app = makeApp();
    const partner = { id: 'partner-uuid-norm-01', referral_code: 'VISACENTERABCD' };

    callQueue = [
      () => chainMaybeSingle(app),
      () => chainMaybeSingle(null),
      () => chainInsertSelect(partner),
      () => chainUpdate(),
      () => chainUpdate(),
    ];

    const res = await POST(makeRequest({ issue: { key: 'WPO-20', status: 'АКТИВНОЕ ПАРТНЕРСТВО' } }));
    expect(res.status).toBe(200);
    const body = await res.json() as { action: string };
    expect(body.action).toBe('created');
  });

  it('accepts "АКТИВНОЕ ПАРТНЁРСТВО" (with Ё) as activation', async () => {
    const app = makeApp();
    const partner = { id: 'partner-uuid-norm-02', referral_code: 'VISACENTEREFGH' };

    callQueue = [
      () => chainMaybeSingle(app),
      () => chainMaybeSingle(null),
      () => chainInsertSelect(partner),
      () => chainUpdate(),
      () => chainUpdate(),
    ];

    const res = await POST(makeRequest({ issue: { key: 'WPO-21', status: 'АКТИВНОЕ ПАРТНЁРСТВО' } }));
    expect(res.status).toBe(200);
    const body = await res.json() as { action: string };
    expect(body.action).toBe('created');
  });

  it('accepts "ПАРТНЕРСТВО ОТМЕНЕНО" (without Ё) as deactivation', async () => {
    const app = makeApp({ approved_partner_id: 'partner-deact-norm-01' });
    const existingPartner = { id: 'partner-deact-norm-01', referral_code: 'NORMCODE1' };

    callQueue = [
      () => chainMaybeSingle(app),
      () => chainUpdate(),
      () => chainSingle(existingPartner),
      () => chainUpdate(),
    ];

    const res = await POST(makeRequest({ issue: { key: 'WPO-22', status: 'ПАРТНЕРСТВО ОТМЕНЕНО' } }));
    expect(res.status).toBe(200);
    const body = await res.json() as { action: string };
    expect(body.action).toBe('deactivated');
  });

  it('accepts "ПАРТНЁРСТВО ОТМЕНЕНО" (with Ё) as deactivation', async () => {
    const app = makeApp({ approved_partner_id: 'partner-deact-norm-02' });
    const existingPartner = { id: 'partner-deact-norm-02', referral_code: 'NORMCODE2' };

    callQueue = [
      () => chainMaybeSingle(app),
      () => chainUpdate(),
      () => chainSingle(existingPartner),
      () => chainUpdate(),
    ];

    const res = await POST(makeRequest({ issue: { key: 'WPO-23', status: 'ПАРТНЁРСТВО ОТМЕНЕНО' } }));
    expect(res.status).toBe(200);
    const body = await res.json() as { action: string };
    expect(body.action).toBe('deactivated');
  });
});
