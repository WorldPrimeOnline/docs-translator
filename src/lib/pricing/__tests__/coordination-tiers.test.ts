/**
 * Tests for parseCoordinationConfig()/computeTranslationCoordination() — 2026-08-04
 * progressive WPO coordination feature. WO-98 worked example fixtures come directly
 * from the approved spec.
 */
import { parseCoordinationConfig, computeTranslationCoordination, type CoordinationVolumeTier } from '../coordination-tiers';

const WO98_TIERS: CoordinationVolumeTier[] = [
  { fromPage: 0, upToPage: 5, rate: 0.30 },
  { fromPage: 5, upToPage: 10, rate: 0.25 },
  { fromPage: 10, upToPage: null, rate: 0.20 },
];

describe('computeTranslationCoordination — WO-98 worked example', () => {
  it('20.0788888889 pages @ 3000 KZT/page -> 14297.33 total, 3 tiers', () => {
    const result = computeTranslationCoordination(20.0788888889, 3000, WO98_TIERS);
    expect(result.totalKzt).toBe(14297.33);
    expect(result.tiers).toHaveLength(3);
    expect(result.tiers[0]).toMatchObject({ fromPage: 0, upToPage: 5, pages: 5, rate: 0.30, coordinationAmountKzt: 4500.00 });
    expect(result.tiers[1]).toMatchObject({ fromPage: 5, upToPage: 10, pages: 5, rate: 0.25, coordinationAmountKzt: 3750.00 });
    expect(result.tiers[2]).toMatchObject({ fromPage: 10, upToPage: null, pages: 10.0788888889, rate: 0.20, coordinationAmountKzt: 6047.33 });
  });

  it('10.1 pages -> 5 @ 30% + 5 @ 25% + 0.1 @ 20%', () => {
    const result = computeTranslationCoordination(10.1, 3000, WO98_TIERS);
    expect(result.tiers).toHaveLength(3);
    expect(result.tiers[2]!.pages).toBeCloseTo(0.1, 10);
  });
});

describe('computeTranslationCoordination — boundaries and monotonicity', () => {
  it('exactly 5 pages -> ONLY tier 1 contributes (0 in tier 2/3), matches flat 30% of T', () => {
    const result = computeTranslationCoordination(5, 3000, WO98_TIERS);
    expect(result.tiers).toHaveLength(1);
    expect(result.totalKzt).toBe(4500.00);
    const flatEquivalent = 5 * 3000 * 0.30;
    expect(result.totalKzt).toBeCloseTo(flatEquivalent, 2);
  });

  it('4.99 pages -> only tier 1, proportionally less than 5 pages', () => {
    const result = computeTranslationCoordination(4.99, 3000, WO98_TIERS);
    expect(result.tiers).toHaveLength(1);
    expect(result.totalKzt).toBeLessThan(4500.00);
  });

  it('5.01 pages -> tier 1 full (5) + a sliver of tier 2 (0.01)', () => {
    const result = computeTranslationCoordination(5.01, 3000, WO98_TIERS);
    expect(result.tiers).toHaveLength(2);
    expect(result.tiers[0]!.pages).toBe(5);
    expect(result.tiers[1]!.pages).toBeCloseTo(0.01, 10);
  });

  it('exactly 10 pages -> tier 1 + tier 2 only (0 in tier 3)', () => {
    const result = computeTranslationCoordination(10, 3000, WO98_TIERS);
    expect(result.tiers).toHaveLength(2);
    expect(result.tiers[0]!.pages).toBe(5);
    expect(result.tiers[1]!.pages).toBe(5);
  });

  it('9.99 pages -> tier 1 full + tier 2 sliver, never reaching tier 3', () => {
    const result = computeTranslationCoordination(9.99, 3000, WO98_TIERS);
    expect(result.tiers).toHaveLength(2);
    expect(result.tiers[1]!.pages).toBeCloseTo(4.99, 10);
  });

  it('10.01 pages -> tier 3 gets a 0.01-page sliver', () => {
    const result = computeTranslationCoordination(10.01, 3000, WO98_TIERS);
    expect(result.tiers).toHaveLength(3);
    expect(result.tiers[2]!.pages).toBeCloseTo(0.01, 10);
  });

  it('1 page -> only tier 1 (1-page Official/Notary presets unaffected)', () => {
    const result = computeTranslationCoordination(1, 3000, WO98_TIERS);
    expect(result.tiers).toHaveLength(1);
    expect(result.totalKzt).toBe(900.00); // 1 * 3000 * 0.30
  });

  it('total price never decreases as page count increases (monotonicity, 0.1 -> 100 step 0.1)', () => {
    let prevTranslationAmount = 0;
    let prevCoordination = 0;
    for (let pages = 0.1; pages <= 100; pages = Math.round((pages + 0.1) * 10) / 10) {
      const result = computeTranslationCoordination(pages, 3000, WO98_TIERS);
      const translationAmount = pages * 3000;
      // total "translation + its coordination" must never decrease as pages increase.
      expect(translationAmount + result.totalKzt).toBeGreaterThanOrEqual(prevTranslationAmount + prevCoordination - 0.02); // rounding tolerance
      prevTranslationAmount = translationAmount;
      prevCoordination = result.totalKzt;
    }
  });

  it('crossing the 5-page and 10-page boundaries never creates a downward jump in coordination', () => {
    const just_below_5 = computeTranslationCoordination(4.999, 3000, WO98_TIERS).totalKzt;
    const at_5 = computeTranslationCoordination(5, 3000, WO98_TIERS).totalKzt;
    const just_below_10 = computeTranslationCoordination(9.999, 3000, WO98_TIERS).totalKzt;
    const at_10 = computeTranslationCoordination(10, 3000, WO98_TIERS).totalKzt;
    expect(at_5).toBeGreaterThanOrEqual(just_below_5);
    expect(at_10).toBeGreaterThanOrEqual(just_below_10);
  });
});

describe('parseCoordinationConfig', () => {
  it('parses a well-formed config', () => {
    const config = parseCoordinationConfig({
      coordinationVolumeTiers: WO98_TIERS,
      notaryCoordinationRate: 0.30,
      courierCoordinationRate: 0.30,
    });
    expect(config.translationTiers).toEqual(WO98_TIERS);
    expect(config.notaryCoordinationRate).toBe(0.30);
    expect(config.courierCoordinationRate).toBe(0.30);
  });

  it('returns null tiers for metadata with no coordinationVolumeTiers key (old pricing version)', () => {
    const config = parseCoordinationConfig({ formula_version: 'new_2026_07_21' });
    expect(config.translationTiers).toBeNull();
    expect(config.notaryCoordinationRate).toBeNull();
    expect(config.courierCoordinationRate).toBeNull();
  });

  it('returns null tiers for null/undefined metadata', () => {
    expect(parseCoordinationConfig(null).translationTiers).toBeNull();
    expect(parseCoordinationConfig(undefined).translationTiers).toBeNull();
  });

  it('returns null tiers for an empty array', () => {
    expect(parseCoordinationConfig({ coordinationVolumeTiers: [] }).translationTiers).toBeNull();
  });

  it('rejects a non-contiguous tier set (gap between tiers)', () => {
    const config = parseCoordinationConfig({
      coordinationVolumeTiers: [
        { fromPage: 0, upToPage: 5, rate: 0.30 },
        { fromPage: 6, upToPage: null, rate: 0.20 }, // gap: 5 -> 6
      ],
    });
    expect(config.translationTiers).toBeNull();
  });

  it('rejects a tier set that does not start at page 0', () => {
    const config = parseCoordinationConfig({
      coordinationVolumeTiers: [{ fromPage: 1, upToPage: null, rate: 0.30 }],
    });
    expect(config.translationTiers).toBeNull();
  });

  it('rejects a tier set where the last tier is not open-ended', () => {
    const config = parseCoordinationConfig({
      coordinationVolumeTiers: [{ fromPage: 0, upToPage: 5, rate: 0.30 }],
    });
    expect(config.translationTiers).toBeNull();
  });

  it('rejects a tier with rate outside [0,1]', () => {
    const config = parseCoordinationConfig({
      coordinationVolumeTiers: [{ fromPage: 0, upToPage: null, rate: 1.5 }],
    });
    expect(config.translationTiers).toBeNull();
  });

  it('rejects malformed entries (missing fields, wrong types)', () => {
    expect(parseCoordinationConfig({ coordinationVolumeTiers: [{ fromPage: 0 }] }).translationTiers).toBeNull();
    expect(parseCoordinationConfig({ coordinationVolumeTiers: ['not-an-object'] }).translationTiers).toBeNull();
    expect(parseCoordinationConfig({ coordinationVolumeTiers: 'not-an-array' }).translationTiers).toBeNull();
  });

  it('ignores an out-of-range notaryCoordinationRate/courierCoordinationRate rather than throwing', () => {
    const config = parseCoordinationConfig({ notaryCoordinationRate: 5, courierCoordinationRate: -1 });
    expect(config.notaryCoordinationRate).toBeNull();
    expect(config.courierCoordinationRate).toBeNull();
  });
});
