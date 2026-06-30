/**
 * Tests for calculatePartnerDiscount()
 *
 * Default referral partner settings (aggressive marketing model, as of 2026-06-30):
 *   type=percent, value=10, min_order=0, max=null
 *
 * Rules:
 * - 10% off any order, no minimum, no cap (for default partners)
 * - Custom partners can have a cap (client_discount_max_amount) or min order
 * - Commission base is calculated on (order_amount − discount) by confirmReferral
 */

import { calculatePartnerDiscount, type PartnerDiscountInput } from '../discount';

function makePartner(overrides: Partial<PartnerDiscountInput> = {}): PartnerDiscountInput {
  return {
    is_active: true,
    client_discount_enabled: true,
    client_discount_type: 'percent',
    client_discount_value: 10,
    client_discount_min_order_amount: 0,
    client_discount_max_amount: null,
    ...overrides,
  };
}

describe('calculatePartnerDiscount — default 10% (no min, no cap)', () => {

  it('applies 10% on small order (1100 KZT) — discount = 110, final = 990', () => {
    const discount = calculatePartnerDiscount(1100, makePartner());
    expect(discount).toBe(110);
    expect(1100 - discount).toBe(990);
  });

  it('applies 10% on larger order (6000 KZT)', () => {
    expect(calculatePartnerDiscount(6000, makePartner())).toBe(600);
  });

  it('applies 10% on very large order with no cap', () => {
    // 50000 × 10% = 5000, no cap → discount = 5000
    expect(calculatePartnerDiscount(50000, makePartner())).toBe(5000);
  });

  it('applies discount at minimum possible order (1 KZT)', () => {
    expect(calculatePartnerDiscount(1, makePartner())).toBe(0); // Math.round(1 × 0.10) = 0
  });

  it('payment amount equals order minus discount (correct final price)', () => {
    const base = 6000;
    const discount = calculatePartnerDiscount(base, makePartner()); // 600
    expect(base - discount).toBe(5400);
  });

  it('no min order text shown: discount applies for any amount (min=0)', () => {
    // min=0 means all amounts qualify
    expect(calculatePartnerDiscount(100, makePartner())).toBe(10);
    expect(calculatePartnerDiscount(500, makePartner())).toBe(50);
    expect(calculatePartnerDiscount(999, makePartner())).toBe(100); // Math.round(99.9)
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
    expect(calculatePartnerDiscount(100, partner)).toBe(10); // 100 × 10% = 10
  });

  it('no cap (null) means full percent applies', () => {
    const partner = makePartner({ client_discount_max_amount: null });
    expect(calculatePartnerDiscount(20000, partner)).toBe(2000); // 20000 × 10% = 2000
  });

});
