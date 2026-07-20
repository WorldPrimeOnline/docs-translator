/**
 * Tests for extractNotaryUrgencySnapshot() (migration 0048, WO-77 incident 2026-07-15).
 * Pure mapping from a PricingResult onto the jobs.notary_urgency_* snapshot shape —
 * calculatePrice()'s own notaryCutoff computation is already covered by
 * calculator.test.ts; this only tests the new extraction/mapping step.
 */
jest.mock('@/lib/supabase/server', () => ({
  supabaseServer: { from: jest.fn() },
}));

import { extractNotaryUrgencySnapshot } from '../service';
import type { PricingResult, QuoteLineItem } from '../types';

function makeResult(overrides: Partial<PricingResult['context']> = {}, items: QuoteLineItem[] = []): PricingResult {
  return {
    amountKzt: 15000,
    currency: 'KZT',
    status: 'quoted',
    items,
    pricingVersionId: 'v1',
    pricingVersionCode: 'v1',
    internalCosts: {} as PricingResult['internalCosts'],
    margin: {} as PricingResult['margin'],
    requiresOperatorReview: false,
    reviewReasons: [],
    context: {
      languagePair: 'ru→en',
      baseMinimumKzt: 8000,
      extraWords: 0,
      additionalPages: 0,
      documentCoefficient: 1,
      urgencyCoefficient: 1,
      includedWordCount: 250,
      includedPageCount: 1,
      ...overrides,
    },
  };
}

describe('extractNotaryUrgencySnapshot', () => {
  it('1. same_day before noon: multiplier 1.0, no fee item pushed → feeKzt 0', () => {
    const result = makeResult({
      notaryCutoff: {
        notaryUrgencyLevel: 'same_day',
        effectiveWindow: 'before_noon',
        multiplier: 1.0,
        quoteExpiresAt: '2026-07-15T07:00:00.000Z',
        cutoffAt: '2026-07-15T07:00:00.000Z',
        pricingTimezone: 'Asia/Almaty',
        windowLabel: 'before noon',
      },
    });
    expect(extractNotaryUrgencySnapshot(result)).toEqual({
      level: 'same_day',
      effectiveWindow: 'before_noon',
      multiplier: 1.0,
      cutoffAt: '2026-07-15T07:00:00.000Z',
      feeKzt: 0,
    });
  });

  it('2. same_day after noon: multiplier 1.5, notary_urgency_fee item present', () => {
    const result = makeResult(
      {
        notaryCutoff: {
          notaryUrgencyLevel: 'same_day',
          effectiveWindow: 'after_noon',
          multiplier: 1.5,
          quoteExpiresAt: '2026-07-15T13:00:00.000Z',
          cutoffAt: '2026-07-15T13:00:00.000Z',
          pricingTimezone: 'Asia/Almaty',
          windowLabel: 'after noon',
        },
      },
      [{ itemType: 'notary_urgency_fee', label: 'Same-day surcharge', quantity: 1, unitPriceKzt: 2500, amountKzt: 2500, isClientVisible: true, isCost: false, sortOrder: 5 }],
    );
    expect(extractNotaryUrgencySnapshot(result)).toEqual({
      level: 'same_day',
      effectiveWindow: 'after_noon',
      multiplier: 1.5,
      cutoffAt: '2026-07-15T13:00:00.000Z',
      feeKzt: 2500,
    });
  });

  it('3. same_day after 18:00: multiplier 2.0, larger fee', () => {
    const result = makeResult(
      {
        notaryCutoff: {
          notaryUrgencyLevel: 'same_day',
          effectiveWindow: 'after_18',
          multiplier: 2.0,
          quoteExpiresAt: '2026-07-15T20:00:00.000Z',
          cutoffAt: '2026-07-15T18:00:00.000Z',
          pricingTimezone: 'Asia/Almaty',
          windowLabel: 'night',
        },
      },
      [{ itemType: 'notary_urgency_fee', label: 'Night surcharge', quantity: 1, unitPriceKzt: 5000, amountKzt: 5000, isClientVisible: true, isCost: false, sortOrder: 5 }],
    );
    expect(extractNotaryUrgencySnapshot(result)).toMatchObject({ level: 'same_day', effectiveWindow: 'after_18', multiplier: 2.0, feeKzt: 5000 });
  });

  it('4. standard notary urgency: multiplier 1.0, no cutoff timestamp, fee 0', () => {
    const result = makeResult({
      notaryCutoff: {
        notaryUrgencyLevel: 'standard',
        effectiveWindow: 'standard',
        multiplier: 1.0,
        quoteExpiresAt: '',
        cutoffAt: null,
        pricingTimezone: 'Asia/Almaty',
        windowLabel: 'standard',
      },
    });
    expect(extractNotaryUrgencySnapshot(result)).toEqual({
      level: 'standard',
      effectiveWindow: 'standard',
      multiplier: 1.0,
      cutoffAt: null,
      feeKzt: 0,
    });
  });

  it('5. official/electronic order: no notaryCutoff in context at all → returns null', () => {
    const result = makeResult({}); // no notaryCutoff key
    expect(extractNotaryUrgencySnapshot(result)).toBeNull();
  });
});
