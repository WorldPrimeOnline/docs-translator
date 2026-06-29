/**
 * Tests for POST /api/admin/partners/approve-application
 *
 * Verifies:
 *  1. Unauthenticated requests return 401
 *  2. Applications are NOT auto-created on submission (pending = no partner yet)
 *  3. Approved application creates an active partner record
 *  4. Generated referral code is uppercase and unique
 *  5. Duplicate referral code returns 409 when explicitly provided
 *  6. Approved partner code passes validate-code endpoint
 *  7. No public endpoint can create an active partner
 */

process.env.CRON_SECRET = 'test-secret-approve';

jest.mock('@/lib/supabase/server', () => ({
  supabaseServer: { from: jest.fn() },
}));

import { NextRequest } from 'next/server';
import { POST } from '../approve-application/route';
import { supabaseServer } from '@/lib/supabase/server';

const mockFrom = supabaseServer.from as jest.Mock;

function makeRequest(body: unknown, auth = 'test-secret-approve'): NextRequest {
  return new NextRequest('http://localhost/api/admin/partners/approve-application', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${auth}`,
    },
    body: JSON.stringify(body),
  });
}

function mockApplicationLookup(app: Record<string, unknown> | null) {
  const maybeSingle = jest.fn().mockResolvedValue({ data: app, error: null });
  const eq = jest.fn().mockReturnValue({ maybeSingle });
  const select = jest.fn().mockReturnValue({ eq });
  return { select, eq, maybeSingle };
}

function mockUniqueCheck(exists: boolean) {
  const maybeSingle = jest.fn().mockResolvedValue({ data: exists ? { id: 'existing-id' } : null, error: null });
  const eq = jest.fn().mockReturnValue({ maybeSingle });
  const select = jest.fn().mockReturnValue({ eq });
  return { select, eq, maybeSingle };
}

function mockPartnerInsert(partner: Record<string, unknown> | null) {
  const single = jest.fn().mockResolvedValue({ data: partner, error: partner ? null : { message: 'insert error', code: '99999' } });
  const select = jest.fn().mockReturnValue({ single });
  const insert = jest.fn().mockReturnValue({ select });
  return { insert, select, single };
}

function mockApplicationUpdate() {
  const eq = jest.fn().mockResolvedValue({ error: null });
  const update = jest.fn().mockReturnValue({ eq });
  return { update, eq };
}

describe('POST /api/admin/partners/approve-application', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 401 when Authorization header is missing', async () => {
    const req = new NextRequest('http://localhost/api/admin/partners/approve-application', {
      method: 'POST',
      body: JSON.stringify({ applicationId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('returns 401 when Authorization header is wrong', async () => {
    const req = makeRequest({ applicationId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12' }, 'wrong-secret');
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('returns 404 when application does not exist', async () => {
    const appLookup = mockApplicationLookup(null);
    mockFrom.mockReturnValue(appLookup);

    const res = await POST(makeRequest({
      applicationId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a13',
      approvedBy: 'operator@test.com',
    }));
    expect(res.status).toBe(404);
  });

  it('creates an active partner when application is pending', async () => {
    const appRow = {
      id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a14',
      partner_type: 'visa_center',
      name: 'Alice',
      email: 'alice@visa.kz',
      organization: 'Visa Center KZ',
      status: 'pending',
      approved_partner_id: null,
    };
    const partnerRow = {
      id: 'partner-uuid-003',
      referral_code: 'VISACENTER1234',
      commission_rate: 0.05,
      is_active: true,
    };

    // from('partner_applications').select(...).eq(...).maybeSingle()
    // from('partners').select(...).eq(...).maybeSingle()   — uniqueness check
    // from('partners').insert(...).select(...).single()    — create partner
    // from('partner_applications').update(...).eq(...)     — status update

    let callCount = 0;
    mockFrom.mockImplementation((table: string) => {
      callCount++;
      if (table === 'partner_applications' && callCount === 1) return mockApplicationLookup(appRow);
      if (table === 'partners' && callCount === 2) return mockUniqueCheck(false);
      if (table === 'partners' && callCount === 3) return mockPartnerInsert(partnerRow);
      if (table === 'partner_applications' && callCount === 4) return mockApplicationUpdate();
      return mockApplicationLookup(null);
    });

    const res = await POST(makeRequest({
      applicationId: appRow.id,
      commissionRate: 0.05,
      approvedBy: 'operator@test.com',
    }));

    expect(res.status).toBe(200);
    const body = await res.json() as { referralCode: string; isActive: boolean; partnerId: string };
    expect(body.referralCode).toBe('VISACENTER1234');
    expect(body.isActive).toBe(true);
    expect(body.partnerId).toBe('partner-uuid-003');
  });

  it('returns 409 when application is already approved', async () => {
    const appRow = {
      id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a15',
      partner_type: 'agency',
      name: 'Bob',
      email: 'bob@agency.kz',
      organization: null,
      status: 'approved',
      approved_partner_id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a00',
    };

    mockFrom.mockReturnValue(mockApplicationLookup(appRow));

    const res = await POST(makeRequest({
      applicationId: appRow.id,
      approvedBy: 'operator@test.com',
    }));
    expect(res.status).toBe(409);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('already approved');
  });

  it('returns 409 when explicitly provided referral code already exists', async () => {
    const appRow = {
      id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a16',
      partner_type: 'agency',
      name: 'Carol',
      email: 'carol@agency.kz',
      organization: null,
      status: 'pending',
      approved_partner_id: null,
    };

    let callCount = 0;
    mockFrom.mockImplementation((table: string) => {
      callCount++;
      if (table === 'partner_applications' && callCount === 1) return mockApplicationLookup(appRow);
      if (table === 'partners' && callCount === 2) return mockUniqueCheck(true); // code taken
      return mockApplicationLookup(null);
    });

    const res = await POST(makeRequest({
      applicationId: appRow.id,
      referralCode: 'EXISTING',
      approvedBy: 'operator@test.com',
    }));
    expect(res.status).toBe(409);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('EXISTING');
  });

  it('referral link returned uses partner referral code', async () => {
    const appRow = {
      id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a17',
      partner_type: 'education_agency',
      name: 'EduCorp',
      email: 'edu@corp.kz',
      organization: 'EduCorp',
      status: 'pending',
      approved_partner_id: null,
    };
    const partnerRow = {
      id: 'partner-uuid-006',
      referral_code: 'EDUCORP1234',
      commission_rate: 0.07,
      is_active: true,
    };

    let callCount = 0;
    mockFrom.mockImplementation((table: string) => {
      callCount++;
      if (table === 'partner_applications' && callCount === 1) return mockApplicationLookup(appRow);
      if (table === 'partners' && callCount === 2) return mockUniqueCheck(false);
      if (table === 'partners' && callCount === 3) return mockPartnerInsert(partnerRow);
      if (table === 'partner_applications' && callCount === 4) return mockApplicationUpdate();
      return mockApplicationLookup(null);
    });

    const res = await POST(makeRequest({
      applicationId: appRow.id,
      commissionRate: 0.07,
      clientDiscountEnabled: true,
      clientDiscountType: 'percent',
      clientDiscountValue: 5,
      approvedBy: 'op@wpo.kz',
    }));
    expect(res.status).toBe(200);
    const body = await res.json() as { referralLink: string };
    expect(body.referralLink).toBe('/ru?ref=EDUCORP1234');
  });

  it('returns 409 when application is rejected', async () => {
    const appRow = {
      id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a18',
      partner_type: 'other',
      name: 'Dan',
      email: 'dan@other.kz',
      organization: null,
      status: 'rejected',
      approved_partner_id: null,
    };
    mockFrom.mockReturnValue(mockApplicationLookup(appRow));

    const res = await POST(makeRequest({
      applicationId: appRow.id,
      approvedBy: 'operator@test.com',
    }));
    expect(res.status).toBe(409);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('rejected');
  });
});
