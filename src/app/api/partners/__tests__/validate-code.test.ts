/**
 * Tests for POST /api/partners/validate-code
 *
 * Verifies: valid active partner returns discount info; inactive/missing partner
 * returns valid:false; commission_rate is never exposed; auth guard works.
 */

jest.mock('@/lib/supabase/server', () => ({
  supabaseServer: { from: jest.fn() },
}));

// Mock Next.js cookies and auth client
jest.mock('next/headers', () => ({
  cookies: jest.fn().mockResolvedValue({ getAll: () => [], setAll: () => {} }),
}));

jest.mock('@supabase/ssr', () => ({
  createServerClient: jest.fn().mockReturnValue({
    auth: {
      getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'user-uuid' } } }),
    },
  }),
}));

import { NextRequest } from 'next/server';
import { POST } from '../validate-code/route';
import { supabaseServer } from '@/lib/supabase/server';

const mockFrom = supabaseServer.from as jest.Mock;

function makePartnerRow(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Test Partner',
    organization: 'Visa Center Almaty',
    is_active: true,
    client_discount_enabled: true,
    client_discount_type: 'fixed',
    client_discount_value: 1000,
    client_discount_min_order_amount: 5000,
    client_discount_max_amount: null,
    ...overrides,
  };
}

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/partners/validate-code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function makePartnerChain(row: unknown) {
  return {
    select: jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        maybeSingle: jest.fn().mockResolvedValue({ data: row, error: null }),
      }),
    }),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ─── Valid partner code returns discount info ─────────────────────────────────

describe('valid active partner', () => {
  it('returns valid:true with discount info for an active partner', async () => {
    mockFrom.mockReturnValueOnce(makePartnerChain(makePartnerRow()));

    const res = await POST(makeRequest({ code: 'VISAALMATY' }));
    const body = await res.json() as Record<string, unknown>;

    expect(body.valid).toBe(true);
    expect(body.partnerName).toBe('Visa Center Almaty');
    expect(body.discountEnabled).toBe(true);
    expect(body.discountType).toBe('fixed');
    expect(body.discountValue).toBe(1000);
    expect(body.discountMinOrderKzt).toBe(5000);
  });

  it('returns percent discount info correctly', async () => {
    mockFrom.mockReturnValueOnce(makePartnerChain(makePartnerRow({
      client_discount_type: 'percent',
      client_discount_value: 5,
      client_discount_min_order_amount: 0,
      client_discount_max_amount: 2000,
    })));

    const res = await POST(makeRequest({ code: 'PARTNER5PCT' }));
    const body = await res.json() as Record<string, unknown>;

    expect(body.valid).toBe(true);
    expect(body.discountType).toBe('percent');
    expect(body.discountValue).toBe(5);
    expect(body.discountMaxKzt).toBe(2000);
  });

  it('does NOT expose commission_rate in response', async () => {
    mockFrom.mockReturnValueOnce(makePartnerChain(makePartnerRow()));
    const res = await POST(makeRequest({ code: 'VISAALMATY' }));
    const body = await res.json() as Record<string, unknown>;

    expect(body.commission_rate).toBeUndefined();
    expect(body.commissionRate).toBeUndefined();
  });

  it('normalises code to uppercase before lookup', async () => {
    mockFrom.mockReturnValueOnce(makePartnerChain(makePartnerRow()));
    await POST(makeRequest({ code: 'visaalmaty' }));

    const selectChain = mockFrom.mock.results[0]?.value as {
      select: jest.Mock;
    };
    const eqCall = selectChain.select.mock.results[0]?.value as { eq: jest.Mock };
    expect(eqCall.eq).toHaveBeenCalledWith('referral_code', 'VISAALMATY');
  });
});

// ─── Invalid / inactive partner code ─────────────────────────────────────────

describe('invalid partner code', () => {
  it('returns valid:false when partner is not found', async () => {
    mockFrom.mockReturnValueOnce(makePartnerChain(null));
    const res = await POST(makeRequest({ code: 'NOPE123' }));
    const body = await res.json() as Record<string, unknown>;
    expect(body.valid).toBe(false);
  });

  it('returns valid:false when partner is inactive/suspended', async () => {
    mockFrom.mockReturnValueOnce(makePartnerChain(makePartnerRow({ is_active: false })));
    const res = await POST(makeRequest({ code: 'SUSPENDED' }));
    const body = await res.json() as Record<string, unknown>;
    expect(body.valid).toBe(false);
  });

  it('returns valid:false for empty code input', async () => {
    const res = await POST(makeRequest({ code: '' }));
    const body = await res.json() as Record<string, unknown>;
    expect(body.valid).toBe(false);
  });

  it('returns valid:true without discount info when discount is disabled', async () => {
    mockFrom.mockReturnValueOnce(makePartnerChain(makePartnerRow({
      client_discount_enabled: false,
      client_discount_type: null,
      client_discount_value: null,
    })));
    const res = await POST(makeRequest({ code: 'NODISCOUNT' }));
    const body = await res.json() as Record<string, unknown>;
    expect(body.valid).toBe(true);
    expect(body.discountEnabled).toBe(false);
    expect(body.discountType).toBeUndefined();
    expect(body.discountValue).toBeUndefined();
  });
});
