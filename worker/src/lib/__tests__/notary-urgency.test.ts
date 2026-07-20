/**
 * @jest-environment node
 *
 * Tests for resolveNotaryUrgencySnapshot() (migration 0048, WO-77 incident 2026-07-15).
 * Pure function — no DB/Jira mocking needed.
 */

import { resolveNotaryUrgencySnapshot } from '../notary-urgency';

describe('resolveNotaryUrgencySnapshot', () => {
  it('1. same_day before noon: reads jobs columns, multiplier 1.0, fee 0 (WO-77 exact case)', () => {
    const snapshot = resolveNotaryUrgencySnapshot({
      notary_urgency_level: 'same_day',
      notary_urgency_window: 'before_noon',
      notary_urgency_multiplier: '1.00',
      notary_urgency_cutoff_at: '2026-07-15T07:00:00.000Z',
      notary_urgency_fee_kzt: '0.00',
    });
    expect(snapshot).toEqual({
      level: 'same_day',
      window: 'before_noon',
      multiplier: 1,
      cutoffAt: '2026-07-15T07:00:00.000Z',
      feeKzt: 0,
    });
  });

  it('2. same_day after noon: multiplier 1.5, non-zero fee', () => {
    const snapshot = resolveNotaryUrgencySnapshot({
      notary_urgency_level: 'same_day',
      notary_urgency_window: 'after_noon',
      notary_urgency_multiplier: 1.5,
      notary_urgency_cutoff_at: '2026-07-15T13:00:00.000Z',
      notary_urgency_fee_kzt: 2500,
    });
    expect(snapshot).toEqual({
      level: 'same_day',
      window: 'after_noon',
      multiplier: 1.5,
      cutoffAt: '2026-07-15T13:00:00.000Z',
      feeKzt: 2500,
    });
  });

  it('3. same_day after 18:00: multiplier 2.0, night surcharge', () => {
    const snapshot = resolveNotaryUrgencySnapshot({
      notary_urgency_level: 'same_day',
      notary_urgency_window: 'after_18',
      notary_urgency_multiplier: 2.0,
      notary_urgency_cutoff_at: '2026-07-15T18:00:00.000Z',
      notary_urgency_fee_kzt: 5000,
    });
    expect(snapshot).toMatchObject({ level: 'same_day', window: 'after_18', multiplier: 2, feeKzt: 5000 });
  });

  it('4. standard notary urgency: multiplier 1.0, no cutoff timestamp, fee 0', () => {
    const snapshot = resolveNotaryUrgencySnapshot({
      notary_urgency_level: 'standard',
      notary_urgency_window: 'standard',
      notary_urgency_multiplier: 1.0,
      notary_urgency_cutoff_at: null,
      notary_urgency_fee_kzt: 0,
    });
    expect(snapshot).toEqual({ level: 'standard', window: 'standard', multiplier: 1, cutoffAt: null, feeKzt: 0 });
  });

  it('5. official/electronic order: no jobs columns and no quote → returns null (no notary urgency concept applies)', () => {
    expect(resolveNotaryUrgencySnapshot(null, null)).toBeNull();
    expect(resolveNotaryUrgencySnapshot({ notary_urgency_level: null }, null)).toBeNull();
  });

  it('6. legacy job: jobs columns absent, falls back to price_quotes.pricing_context_json.notaryCutoff + breakdown_json fee item', () => {
    const snapshot = resolveNotaryUrgencySnapshot(null, {
      pricingContextJson: {
        notaryCutoff: {
          notaryUrgencyLevel: 'same_day',
          effectiveWindow: 'after_noon',
          multiplier: 1.5,
          cutoffAt: '2026-06-01T13:00:00.000Z',
          pricingTimezone: 'Asia/Almaty',
        },
      },
      breakdownJson: {
        items: [
          { itemType: 'notary_coordination_fee', amountKzt: 5000 },
          { itemType: 'notary_urgency_fee', amountKzt: 2500 },
        ],
      },
    });
    expect(snapshot).toEqual({
      level: 'same_day',
      window: 'after_noon',
      multiplier: 1.5,
      cutoffAt: '2026-06-01T13:00:00.000Z',
      feeKzt: 2500,
    });
  });

  it('6b. legacy job, standard urgency, no notary_urgency_fee item in breakdown → fee defaults to 0', () => {
    const snapshot = resolveNotaryUrgencySnapshot(null, {
      pricingContextJson: {
        notaryCutoff: { notaryUrgencyLevel: 'standard', effectiveWindow: 'standard', multiplier: 1.0, cutoffAt: null },
      },
      breakdownJson: { items: [] },
    });
    expect(snapshot).toMatchObject({ level: 'standard', multiplier: 1, feeKzt: 0 });
  });

  it('jobs columns take priority over quote fallback when both are present', () => {
    const snapshot = resolveNotaryUrgencySnapshot(
      { notary_urgency_level: 'same_day', notary_urgency_window: 'before_noon', notary_urgency_multiplier: 1, notary_urgency_cutoff_at: null, notary_urgency_fee_kzt: 0 },
      { pricingContextJson: { notaryCutoff: { notaryUrgencyLevel: 'standard', effectiveWindow: 'standard', multiplier: 1 } } },
    );
    expect(snapshot?.level).toBe('same_day');
  });

  it('no jobs columns and quote has no notaryCutoff at all → null', () => {
    expect(resolveNotaryUrgencySnapshot(null, { pricingContextJson: {}, breakdownJson: { items: [] } })).toBeNull();
  });
});
