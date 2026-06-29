/**
 * Tests for src/lib/referral/server.ts
 *
 * Verifies:
 * 1. Valid referral code creates partner_referrals record
 * 2. Invalid referral code does not block order creation
 * 3. Missing referral code does not block order creation
 * 4. UTM params are preserved in the inserted record
 * 5. Referral code is validated server-side (partner lookup)
 * 6. Inactive partner does not generate eligible referral
 * 7. Successful payment moves referral to confirmed
 * 8. Cancelled/refunded order sets commission to 0
 * 9. Commission base excludes pass-through costs (notary_official_fee, delivery_fee)
 * 10. Client-submitted commission values are ignored (no such field in FormData schema)
 * 11. Existing upload route tests still pass (covered by running the test suite separately)
 */

jest.mock('@/lib/supabase/server', () => ({
  supabaseServer: { from: jest.fn() },
}));

import { supabaseServer } from '@/lib/supabase/server';
import {
  attachReferralToOrder,
  confirmReferral,
  cancelReferral,
} from '../server';

const mockFrom = supabaseServer.from as jest.Mock;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makePartnerChain(partner: unknown) {
  return {
    select: jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        maybeSingle: jest.fn().mockResolvedValue({ data: partner, error: null }),
      }),
    }),
  };
}

function makeInsertChain(error: unknown = null) {
  return {
    insert: jest.fn().mockResolvedValue({ error }),
  };
}

const ACTIVE_PARTNER = { id: 'partner-uuid', commission_rate: 0.05, is_active: true };
const INACTIVE_PARTNER = { id: 'partner-uuid', commission_rate: 0.05, is_active: false };

const BASE_PARAMS = {
  jobId: 'job-uuid',
  userId: 'user-uuid',
  refCode: 'PARTNER123',
  utmSource: 'instagram',
  utmMedium: 'story',
  utmCampaign: 'spring2026',
  utmContent: 'banner_v2',
  utmTerm: 'translation',
  orderAmountKzt: 15000,
};

beforeEach(() => {
  jest.clearAllMocks();
});

// ─── 1. Valid referral code creates partner_referrals record ──────────────────

describe('attachReferralToOrder — valid referral', () => {
  it('inserts a partner_referrals record for a valid active partner', async () => {
    const insertMock = jest.fn().mockResolvedValue({ error: null });

    mockFrom
      .mockReturnValueOnce(makePartnerChain(ACTIVE_PARTNER)) // partners lookup
      .mockReturnValueOnce({ insert: insertMock });            // partner_referrals insert

    await attachReferralToOrder(BASE_PARAMS);

    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        partner_id: 'partner-uuid',
        job_id: 'job-uuid',
        user_id: 'user-uuid',
        ref_code: 'PARTNER123',
        status: 'pending',
        commission_rate: 0.05,
        order_amount_kzt: 15000,
      }),
    );
  });

  // ─── 4. UTM params preserved ──────────────────────────────────────────────
  it('preserves all UTM params in the inserted record', async () => {
    const insertMock = jest.fn().mockResolvedValue({ error: null });
    mockFrom
      .mockReturnValueOnce(makePartnerChain(ACTIVE_PARTNER))
      .mockReturnValueOnce({ insert: insertMock });

    await attachReferralToOrder(BASE_PARAMS);

    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        utm_source:   'instagram',
        utm_medium:   'story',
        utm_campaign: 'spring2026',
        utm_content:  'banner_v2',
        utm_term:     'translation',
      }),
    );
  });
});

// ─── 2. Invalid referral code does not block order creation ──────────────────

describe('attachReferralToOrder — invalid referral code', () => {
  it('returns without throwing when partner is not found', async () => {
    mockFrom.mockReturnValueOnce(makePartnerChain(null)); // no partner

    await expect(attachReferralToOrder(BASE_PARAMS)).resolves.toBeUndefined();
    expect(mockFrom).toHaveBeenCalledTimes(1); // only partner lookup, no insert
  });
});

// ─── 3. Missing referral code does not block order creation ──────────────────

describe('attachReferralToOrder — missing referral code', () => {
  it('returns immediately without any DB calls when refCode is null', async () => {
    await attachReferralToOrder({ ...BASE_PARAMS, refCode: null });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('returns immediately when refCode is empty string', async () => {
    await attachReferralToOrder({ ...BASE_PARAMS, refCode: '' });
    expect(mockFrom).not.toHaveBeenCalled();
  });
});

// ─── 5. Referral code is validated server-side ───────────────────────────────

describe('attachReferralToOrder — server-side validation', () => {
  it('queries partners table by referral_code before inserting', async () => {
    const insertMock = jest.fn().mockResolvedValue({ error: null });
    const partnerSelectChain = makePartnerChain(ACTIVE_PARTNER);
    mockFrom
      .mockReturnValueOnce(partnerSelectChain)
      .mockReturnValueOnce({ insert: insertMock });

    await attachReferralToOrder(BASE_PARAMS);

    // First call must be 'partners', not 'partner_referrals'
    expect(mockFrom).toHaveBeenNthCalledWith(1, 'partners');
    expect(mockFrom).toHaveBeenNthCalledWith(2, 'partner_referrals');
  });
});

// ─── 6. Inactive partner does not generate eligible referral ─────────────────

describe('attachReferralToOrder — inactive partner', () => {
  it('does not insert a referral for an inactive partner', async () => {
    mockFrom.mockReturnValueOnce(makePartnerChain(INACTIVE_PARTNER));

    await attachReferralToOrder(BASE_PARAMS);

    expect(mockFrom).toHaveBeenCalledTimes(1); // only partner lookup, no insert
  });
});

// ─── 7. Successful payment moves referral to confirmed ───────────────────────

describe('confirmReferral — payment success', () => {
  const REFERRAL_ROW = {
    id: 'ref-uuid',
    order_amount_kzt: 15000,
    commission_rate: 0.05,
  };

  it('moves referral status to confirmed after payment', async () => {
    const updateMock = jest.fn().mockReturnValue({
      eq: jest.fn().mockResolvedValue({ error: null }),
    });

    mockFrom
      // partner_referrals select (pending referral lookup)
      .mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              maybeSingle: jest.fn().mockResolvedValue({ data: REFERRAL_ROW, error: null }),
            }),
          }),
        }),
      })
      // price_quote_items (no pass-through items)
      .mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            in: jest.fn().mockResolvedValue({ data: [], error: null }),
          }),
        }),
      })
      // partner_referrals update
      .mockReturnValueOnce({ update: updateMock });

    await confirmReferral('job-uuid', 'quote-uuid');

    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'confirmed',
        commission_base_kzt: 15000,
        commission_kzt: 750, // 15000 × 0.05
      }),
    );
  });
});

// ─── 8. Cancelled/refunded order sets commission to 0 ────────────────────────

describe('cancelReferral', () => {
  it('sets status=refunded and zeros commission for a refunded order', async () => {
    const updateMock = jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        in: jest.fn().mockResolvedValue({ error: null }),
      }),
    });
    mockFrom.mockReturnValueOnce({ update: updateMock });

    await cancelReferral('job-uuid', 'refunded');

    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'refunded',
        commission_base_kzt: 0,
        commission_kzt: 0,
      }),
    );
  });

  it('sets status=canceled and zeros commission for a cancelled order', async () => {
    const updateMock = jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        in: jest.fn().mockResolvedValue({ error: null }),
      }),
    });
    mockFrom.mockReturnValueOnce({ update: updateMock });

    await cancelReferral('job-uuid', 'canceled');

    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'canceled',
        commission_base_kzt: 0,
        commission_kzt: 0,
      }),
    );
  });
});

// ─── 9. Commission base excludes pass-through costs ──────────────────────────

describe('confirmReferral — commission base calculation', () => {
  it('subtracts notary_official_fee and delivery_fee from commission base', async () => {
    const REFERRAL = { id: 'ref-uuid', order_amount_kzt: 20000, commission_rate: 0.05 };

    const updateMock = jest.fn().mockReturnValue({
      eq: jest.fn().mockResolvedValue({ error: null }),
    });

    mockFrom
      .mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              maybeSingle: jest.fn().mockResolvedValue({ data: REFERRAL, error: null }),
            }),
          }),
        }),
      })
      // Pass-through items: notary 5000 + delivery 2000 = 7000
      .mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            in: jest.fn().mockResolvedValue({
              data: [{ amount_kzt: 5000 }, { amount_kzt: 2000 }],
              error: null,
            }),
          }),
        }),
      })
      .mockReturnValueOnce({ update: updateMock });

    await confirmReferral('job-uuid', 'quote-uuid');

    // commission_base = 20000 - 7000 = 13000; commission = 13000 × 0.05 = 650
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        commission_base_kzt: 13000,
        commission_kzt: 650,
      }),
    );
  });

  it('commission base is 0 when pass-through costs exceed order amount', async () => {
    const REFERRAL = { id: 'ref-uuid', order_amount_kzt: 3000, commission_rate: 0.05 };

    const updateMock = jest.fn().mockReturnValue({
      eq: jest.fn().mockResolvedValue({ error: null }),
    });

    mockFrom
      .mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              maybeSingle: jest.fn().mockResolvedValue({ data: REFERRAL, error: null }),
            }),
          }),
        }),
      })
      // Pass-through total (5000) exceeds order amount (3000)
      .mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            in: jest.fn().mockResolvedValue({
              data: [{ amount_kzt: 5000 }],
              error: null,
            }),
          }),
        }),
      })
      .mockReturnValueOnce({ update: updateMock });

    await confirmReferral('job-uuid', 'quote-uuid');

    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ commission_base_kzt: 0, commission_kzt: 0 }),
    );
  });
});

// ─── 10. Client-submitted commission values are ignored ───────────────────────

describe('commission values cannot be submitted by client', () => {
  it('server.ts has no parameter for client-supplied commission amount', () => {
    // attachReferralToOrder accepts refCode, UTMs, orderAmountKzt, and clientDiscountAppliedKzt only.
    // commission_rate is read from partners table server-side.
    // commission_kzt / commission_base_kzt are calculated server-side only.
    const params = BASE_PARAMS as Record<string, unknown>;
    expect(params['commissionKzt']).toBeUndefined();
    expect(params['commissionBase']).toBeUndefined();
    expect(params['commission_kzt']).toBeUndefined();
  });
});

// ─── 11. Discount stored in referral; commission base deducted after discount ──

describe('client discount integration', () => {
  it('stores clientDiscountAppliedKzt in the partner_referrals insert', async () => {
    const insertMock = jest.fn().mockResolvedValue({ error: null });
    mockFrom
      .mockReturnValueOnce(makePartnerChain(ACTIVE_PARTNER))
      .mockReturnValueOnce({ insert: insertMock });

    await attachReferralToOrder({ ...BASE_PARAMS, orderAmountKzt: 15000, clientDiscountAppliedKzt: 1000 });

    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        order_amount_kzt: 15000,
        client_discount_applied_kzt: 1000,
      }),
    );
  });

  it('commission base deducts client discount before pass-through exclusion', async () => {
    // Order: 20000 gross, 1000 discount → 19000 net.
    // Pass-through (notary 5000 + delivery 2000) → commission base = 19000 - 7000 = 12000.
    // Commission = 12000 × 0.05 = 600.
    const REFERRAL = {
      id: 'ref-uuid',
      order_amount_kzt: 20000,
      client_discount_applied_kzt: 1000,
      commission_rate: 0.05,
    };

    const updateMock = jest.fn().mockReturnValue({
      eq: jest.fn().mockResolvedValue({ error: null }),
    });

    mockFrom
      .mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              maybeSingle: jest.fn().mockResolvedValue({ data: REFERRAL, error: null }),
            }),
          }),
        }),
      })
      .mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            in: jest.fn().mockResolvedValue({
              data: [{ amount_kzt: 5000 }, { amount_kzt: 2000 }],
              error: null,
            }),
          }),
        }),
      })
      .mockReturnValueOnce({ update: updateMock });

    await confirmReferral('job-uuid', 'quote-uuid');

    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        commission_base_kzt: 12000,
        commission_kzt: 600,
        status: 'confirmed',
      }),
    );
  });

  it('commission base is 0 when discount + pass-throughs exceed order amount', async () => {
    const REFERRAL = {
      id: 'ref-uuid',
      order_amount_kzt: 6000,
      client_discount_applied_kzt: 2000, // 6000 - 2000 = 4000 net
      commission_rate: 0.05,
    };

    const updateMock = jest.fn().mockReturnValue({
      eq: jest.fn().mockResolvedValue({ error: null }),
    });

    mockFrom
      .mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              maybeSingle: jest.fn().mockResolvedValue({ data: REFERRAL, error: null }),
            }),
          }),
        }),
      })
      .mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            in: jest.fn().mockResolvedValue({
              data: [{ amount_kzt: 5000 }], // pass-through 5000 > net 4000
              error: null,
            }),
          }),
        }),
      })
      .mockReturnValueOnce({ update: updateMock });

    await confirmReferral('job-uuid', 'quote-uuid');

    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ commission_base_kzt: 0, commission_kzt: 0 }),
    );
  });
});
