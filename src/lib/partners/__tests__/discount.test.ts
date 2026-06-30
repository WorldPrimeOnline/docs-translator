/**
 * Tests for calculatePartnerDiscount()
 *
 * Default referral partner settings (as of 2026-06-30):
 *   type=percent, value=5, min_order=2500, max=500
 *
 * Rules:
 * - 5% of order, capped at 500 KZT, only if order >= 2500 KZT
 * - Partner referral is created even when discount is 0 (below min order)
 * - Commission base is calculated on (order_amount − discount) by confirmReferral
 */

import { calculatePartnerDiscount, type PartnerDiscountInput } from '../discount';

function makePartner(overrides: Partial<PartnerDiscountInput> = {}): PartnerDiscountInput {
  return {
    is_active: true,
    client_discount_enabled: true,
    client_discount_type: 'percent',
    client_discount_value: 5,
    client_discount_min_order_amount: 2500,
    client_discount_max_amount: 500,
    ...overrides,
  };
}

describe('calculatePartnerDiscount — default 5% capped at 500 KZT', () => {

  it('returns 5% for order above min, below cap threshold', () => {
    // 3000 × 5% = 150 < 500 cap → discount = 150
    expect(calculatePartnerDiscount(3000, makePartner())).toBe(150);
  });

  it('returns cap (500 KZT) when 5% exceeds the cap', () => {
    // 15000 × 5% = 750 > 500 cap → discount = 500
    expect(calculatePartnerDiscount(15000, makePartner())).toBe(500);
  });

  it('returns 500 KZT cap exactly at threshold (10000 KZT order)', () => {
    // 10000 × 5% = 500 = cap → discount = 500
    expect(calculatePartnerDiscount(10000, makePartner())).toBe(500);
  });

  it('returns 0 when order is below minimum (2500 KZT)', () => {
    // order 2000 < min 2500 → no discount; partner referral still created upstream
    expect(calculatePartnerDiscount(2000, makePartner())).toBe(0);
  });

  it('returns 0 at exact minimum boundary minus 1', () => {
    expect(calculatePartnerDiscount(2499, makePartner())).toBe(0);
  });

  it('applies discount at exact minimum boundary (2500 KZT)', () => {
    // 2500 × 5% = 125 → discount = 125
    expect(calculatePartnerDiscount(2500, makePartner())).toBe(125);
  });

  it('payment amount equals order minus discount (correct final price)', () => {
    const base = 6000;
    const discount = calculatePartnerDiscount(base, makePartner()); // 300
    const finalPrice = base - discount;
    expect(finalPrice).toBe(5700);
  });

});

describe('calculatePartnerDiscount — fixed discount type', () => {

  it('returns fixed discount amount when above min order', () => {
    const partner = makePartner({ client_discount_type: 'fixed', client_discount_value: 1000, client_discount_max_amount: null });
    expect(calculatePartnerDiscount(5000, partner)).toBe(1000);
  });

  it('caps fixed discount at client_discount_max_amount when set', () => {
    const partner = makePartner({ client_discount_type: 'fixed', client_discount_value: 1000, client_discount_max_amount: 500 });
    expect(calculatePartnerDiscount(5000, partner)).toBe(500);
  });

  it('never exceeds order amount (caps at base price)', () => {
    const partner = makePartner({ client_discount_type: 'fixed', client_discount_value: 10000, client_discount_max_amount: null, client_discount_min_order_amount: 0 });
    expect(calculatePartnerDiscount(500, partner)).toBe(500);
  });

});

describe('calculatePartnerDiscount — guard cases', () => {

  it('returns 0 for null partner', () => {
    expect(calculatePartnerDiscount(5000, null)).toBe(0);
  });

  it('returns 0 for undefined partner', () => {
    expect(calculatePartnerDiscount(5000, undefined)).toBe(0);
  });

  it('returns 0 when partner is inactive', () => {
    expect(calculatePartnerDiscount(5000, makePartner({ is_active: false }))).toBe(0);
  });

  it('returns 0 when client_discount_enabled is false (attribution-only partner)', () => {
    expect(calculatePartnerDiscount(5000, makePartner({ client_discount_enabled: false }))).toBe(0);
  });

  it('returns 0 when client_discount_type is null', () => {
    expect(calculatePartnerDiscount(5000, makePartner({ client_discount_type: null }))).toBe(0);
  });

  it('returns 0 when client_discount_value is null', () => {
    expect(calculatePartnerDiscount(5000, makePartner({ client_discount_value: null }))).toBe(0);
  });

  it('no min order (null) means all order amounts qualify', () => {
    const partner = makePartner({ client_discount_min_order_amount: null });
    expect(calculatePartnerDiscount(100, partner)).toBe(5); // 100 × 5% = 5
  });

  it('no cap (null) means full percent applies', () => {
    const partner = makePartner({ client_discount_max_amount: null });
    expect(calculatePartnerDiscount(20000, partner)).toBe(1000); // 20000 × 5% = 1000
  });

});
