/**
 * @jest-environment node
 */
import { getPriceKzt } from '@/lib/payments/halyk/pricing';

describe('getPriceKzt — pricing by service level', () => {
  it('returns a positive integer for electronic', () => {
    const price = getPriceKzt('electronic');
    expect(price).toBeGreaterThan(0);
    expect(Number.isInteger(price)).toBe(true);
  });

  it('returns a higher price for certified than electronic', () => {
    const electronic = getPriceKzt('electronic');
    const certified = getPriceKzt('official_with_translator_signature_and_provider_stamp');
    expect(certified).toBeGreaterThan(electronic);
  });

  it('returns the highest price for notarization', () => {
    const certified = getPriceKzt('official_with_translator_signature_and_provider_stamp');
    const notarized = getPriceKzt('notarization_through_partners');
    expect(notarized).toBeGreaterThan(certified);
  });

  it('prices are reasonable KZT amounts (between 100 and 999_999)', () => {
    const levels = [
      'electronic',
      'official_with_translator_signature_and_provider_stamp',
      'notarization_through_partners',
    ] as const;
    for (const level of levels) {
      const price = getPriceKzt(level);
      expect(price).toBeGreaterThanOrEqual(100);
      expect(price).toBeLessThanOrEqual(999_999);
    }
  });
});
