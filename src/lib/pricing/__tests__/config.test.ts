/**
 * Tests for capDiscountForElectronicMinimum() — 2026-08-01 staging incident fix.
 * Business rule: the final amount an Electronic customer pays must never be below
 * ELECTRONIC_MINIMUM_PAYABLE_KZT, including after any partner/referral discount.
 */
import { capDiscountForElectronicMinimum, ELECTRONIC_MINIMUM_PAYABLE_KZT } from '../config';

describe('capDiscountForElectronicMinimum', () => {
  it('electronic: caps the discount so base - discount never drops below the floor', () => {
    // base 1600, nominal discount 300 -> would leave 1300, below the 1500 floor
    const capped = capDiscountForElectronicMinimum(1600, 300, 'electronic');
    expect(1600 - capped).toBe(ELECTRONIC_MINIMUM_PAYABLE_KZT);
    expect(capped).toBe(100);
  });

  it('electronic: a discount that already keeps the result at/above the floor is unchanged', () => {
    const capped = capDiscountForElectronicMinimum(2000, 300, 'electronic');
    expect(capped).toBe(300);
    expect(2000 - capped).toBe(1700);
  });

  it('electronic: base already at the floor -> discount is capped to 0', () => {
    const capped = capDiscountForElectronicMinimum(1500, 200, 'electronic');
    expect(capped).toBe(0);
  });

  it('electronic: never returns a negative cap even if base is (in theory) below the floor', () => {
    const capped = capDiscountForElectronicMinimum(1400, 500, 'electronic');
    expect(capped).toBe(0);
    expect(capped).toBeGreaterThanOrEqual(0);
  });

  it('official: discount is never capped — no floor applies to this service level', () => {
    const capped = capDiscountForElectronicMinimum(1600, 1000, 'official_with_translator_signature_and_provider_stamp');
    expect(capped).toBe(1000);
  });

  it('notarized: discount is never capped — no floor applies to this service level', () => {
    const capped = capDiscountForElectronicMinimum(1600, 1000, 'notarization_through_partners');
    expect(capped).toBe(1000);
  });

  it('null/undefined serviceLevel: treated as non-electronic, discount unchanged', () => {
    expect(capDiscountForElectronicMinimum(1600, 300, null)).toBe(300);
    expect(capDiscountForElectronicMinimum(1600, 300, undefined)).toBe(300);
  });
});
