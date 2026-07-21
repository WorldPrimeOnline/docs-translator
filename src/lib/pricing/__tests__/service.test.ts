/**
 * Tests for src/lib/pricing/service.ts — focused on the 2026-07-22 additions:
 *   - computeQuoteForJob()'s Official/Notary feature-flag gate + active-version-must-match check
 *     (there is no legacy Official/Notary formula left in this codebase to fall back to, so a
 *     disabled flag must refuse to quote rather than silently price against the wrong version)
 *   - markQuotePaid()'s status guard (mirrors markQuotePaymentPending()'s existing guard)
 * calculatePrice() itself is exercised in calculator.test.ts — mocked here so this file only
 * tests service.ts's own orchestration logic.
 */
jest.mock('@/lib/supabase/server', () => ({
  supabaseServer: { from: jest.fn() },
}));
const mockCalculatePrice = jest.fn();
jest.mock('../calculator', () => ({
  calculatePrice: (...args: unknown[]) => mockCalculatePrice(...args),
}));

import { supabaseServer } from '@/lib/supabase/server';
import { computeQuoteForJob, markQuotePaid } from '../service';
import { _resetPricingFeatureFlagsCache } from '../feature-flags';
import type { PricingInput } from '../types';

const mockFrom = supabaseServer.from as jest.Mock;

function chain(result: { data?: unknown; error?: unknown }) {
  const c: Record<string, unknown> = {};
  const methods = ['select', 'eq', 'or', 'order', 'limit', 'update', 'in'];
  for (const m of methods) c[m] = jest.fn(() => c);
  c.maybeSingle = jest.fn(() => Promise.resolve(result));
  c.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return c;
}

const NEW_MODEL_VERSION_ROW = {
  id: 'v-newmodel', code: '2026-Q3-KZ-NEWMODEL', status: 'active', currency: 'KZT',
  internal_fx_rate: null, mrp_value: 4.325,
  tax_rate: 0.03, acquiring_rate: 0.025, risk_reserve_rate: 0.05, owner_reserve_rate: 0,
  marketing_rate_direct: 0.05, partner_commission_rate: 0.1, target_profit_rate: 0.25,
  ai_it_reserve_per_page_kzt: 100, valid_from: '2026-07-17', valid_to: null,
  metadata: { formula_version: 'new_2026_07_21' },
  ai_it_rate: 0.1, channel_reserve_rate: 0.2, client_discount_rate: 0.1, wpo_coordination_rate: 0.3,
  translator_payout_rate: 0.3, ocr_rate_per_physical_page_kzt: 100, courier_fee_kzt: 5000,
  printing_fee_kzt: 0, extra_paper_copy_fee_kzt: 0, rounding_step_official_kzt: 100, rounding_step_notary_kzt: 500,
  public_electronic_price_kzt: null, public_official_min_price_kzt: null, public_notary_min_price_kzt: null,
};

const MVP_VERSION_ROW = { ...NEW_MODEL_VERSION_ROW, id: 'v-mvp', code: '2026-Q3-KZ-MVP', metadata: { note: 'old' } };

function baseInput(overrides: Partial<PricingInput> = {}): PricingInput {
  return { sourceLanguage: 'ru', targetLanguage: 'en', serviceLevel: 'official_with_translator_signature_and_provider_stamp', ...overrides };
}

describe('computeQuoteForJob', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    _resetPricingFeatureFlagsCache();
    delete process.env.ENABLE_NEW_OFFICIAL_PRICING;
    delete process.env.ENABLE_NEW_NOTARY_PRICING;
    mockCalculatePrice.mockReturnValue({ amountKzt: 1000, newModel: undefined });
  });

  it('electronic is never gated by the Official/Notary flags — no version-code check either', async () => {
    mockFrom.mockReturnValueOnce(chain({ data: MVP_VERSION_ROW, error: null })); // getActivePricingVersion only
    const result = await computeQuoteForJob(baseInput({ serviceLevel: 'electronic' }));
    expect('error' in result).toBe(false);
    expect(mockCalculatePrice).toHaveBeenCalledTimes(1);
  });

  it('official + ENABLE_NEW_OFFICIAL_PRICING unset (default false) -> SERVICE_LEVEL_PRICING_DISABLED, never calls calculatePrice', async () => {
    mockFrom.mockReturnValueOnce(chain({ data: NEW_MODEL_VERSION_ROW, error: null }));
    const result = await computeQuoteForJob(baseInput());
    expect(result).toEqual({ error: 'SERVICE_LEVEL_PRICING_DISABLED' });
    expect(mockCalculatePrice).not.toHaveBeenCalled();
  });

  it('notarization + ENABLE_NEW_NOTARY_PRICING unset (default false) -> SERVICE_LEVEL_PRICING_DISABLED', async () => {
    mockFrom.mockReturnValueOnce(chain({ data: NEW_MODEL_VERSION_ROW, error: null }));
    const result = await computeQuoteForJob(baseInput({ serviceLevel: 'notarization_through_partners' }));
    expect(result).toEqual({ error: 'SERVICE_LEVEL_PRICING_DISABLED' });
    expect(mockCalculatePrice).not.toHaveBeenCalled();
  });

  it('official + flag ON but active version is NOT the corrected new-model row -> PRICING_VERSION_MISMATCH, never silently prices against the wrong version', async () => {
    process.env.ENABLE_NEW_OFFICIAL_PRICING = 'true';
    mockFrom.mockReturnValueOnce(chain({ data: MVP_VERSION_ROW, error: null }));
    const result = await computeQuoteForJob(baseInput());
    expect(result).toEqual({ error: 'PRICING_VERSION_MISMATCH' });
    expect(mockCalculatePrice).not.toHaveBeenCalled();
  });

  it('official + flag ON + active version IS the corrected new-model row -> proceeds to calculatePrice as normal', async () => {
    process.env.ENABLE_NEW_OFFICIAL_PRICING = 'true';
    mockFrom
      .mockReturnValueOnce(chain({ data: NEW_MODEL_VERSION_ROW, error: null })) // getActivePricingVersion
      .mockReturnValueOnce(chain({ data: null, error: null }))                  // validateChannelReserveInvariant's partners query
      .mockReturnValueOnce(chain({ data: null, error: null }));                 // getLanguageRate

    const result = await computeQuoteForJob(baseInput());
    expect('error' in result).toBe(false);
    expect(mockCalculatePrice).toHaveBeenCalledTimes(1);
  });

  it('notarization + flag ON + correct version -> proceeds to calculatePrice as normal', async () => {
    process.env.ENABLE_NEW_NOTARY_PRICING = 'true';
    mockFrom
      .mockReturnValueOnce(chain({ data: NEW_MODEL_VERSION_ROW, error: null }))
      .mockReturnValueOnce(chain({ data: null, error: null }))
      .mockReturnValueOnce(chain({ data: null, error: null }));

    const result = await computeQuoteForJob(baseInput({ serviceLevel: 'notarization_through_partners' }));
    expect('error' in result).toBe(false);
    expect(mockCalculatePrice).toHaveBeenCalledTimes(1);
  });

  it('no active pricing version at all -> PRICING_NOT_CONFIGURED, before any flag/version check', async () => {
    mockFrom.mockReturnValueOnce(chain({ data: null, error: null }));
    const result = await computeQuoteForJob(baseInput());
    expect(result).toEqual({ error: 'PRICING_NOT_CONFIGURED' });
  });
});

describe('markQuotePaid — status guard', () => {
  it('only transitions quoted/payment_pending/requires_operator_review quotes, mirroring markQuotePaymentPending', async () => {
    const updateChain = chain({ data: null, error: null });
    const reservationsChain = chain({ data: null, error: null });
    mockFrom.mockReturnValueOnce(updateChain).mockReturnValueOnce(reservationsChain);

    await markQuotePaid('quote-1', 'txn-1');

    expect(updateChain.in).toHaveBeenCalledWith('status', ['quoted', 'payment_pending', 'requires_operator_review']);
  });
});
