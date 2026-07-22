import {
  roundToKopeks,
  roundUpToStep,
  applyRate,
  charsToPages,
  computeTranslationAmount,
  sumMoney,
  moneyDifference,
} from '../money';

describe('roundToKopeks', () => {
  it('rounds 1.005 to 1.01 (not 1.00 — the classic IEEE-754 float misround)', () => {
    // Passed as a STRING deliberately: the literal `1.005` as a JS number is already
    // imprecise (stored as 1.00499999999999989...) before this function ever sees it — no
    // rounding logic can undo that. Postgres numeric columns come back from Supabase as
    // strings for exactly this reason; this test exercises that real code path.
    expect(roundToKopeks('1.005')).toBe(1.01);
  });

  it('rounds 2.675 to 2.68 (native (2.675).toFixed(2) famously yields "2.67")', () => {
    expect(roundToKopeks('2.675')).toBe(2.68);
  });

  it('handles a repeating-decimal input (2001/1800 style) correctly', () => {
    // 2001/1800 = 1.111666... -> rounds to 1.11
    expect(roundToKopeks('1.111666666666666666')).toBe(1.11);
  });

  it('handles large sums without precision loss', () => {
    expect(roundToKopeks('1234567.895')).toBe(1234567.9);
    expect(roundToKopeks('999999.995')).toBe(1000000);
  });

  it('accepts a plain number for already-exact values', () => {
    expect(roundToKopeks(100)).toBe(100);
    expect(roundToKopeks(7400)).toBe(7400);
  });
});

describe('roundUpToStep', () => {
  it('rounds up to the nearest 100 (official)', () => {
    expect(roundUpToStep('7339.449541', 100)).toBe(7400);
    expect(roundUpToStep(7400, 100)).toBe(7400); // already exact
  });

  it('rounds up to the nearest 500 (notary)', () => {
    expect(roundUpToStep('12807.201835', 500)).toBe(13000);
    expect(roundUpToStep('27566.53211', 500)).toBe(28000);
  });

  it('throws on a non-positive step', () => {
    expect(() => roundUpToStep(100, 0)).toThrow();
    expect(() => roundUpToStep(100, -1)).toThrow();
  });
});

describe('applyRate', () => {
  it('computes a flat percentage of an amount, rounded to kopeks', () => {
    expect(applyRate(7400, 0.03)).toBe(222);
    expect(applyRate(7400, 0.025)).toBe(185);
    expect(applyRate(7400, 0.05)).toBe(370);
    expect(applyRate(7400, 0.10)).toBe(740);
    expect(applyRate(7400, 0.20)).toBe(1480);
  });

  it('does not misround a boundary case', () => {
    // 20.10 * 0.05 = 1.005 exactly -> must round to 1.01, not 1.00
    expect(applyRate('20.10', '0.05')).toBe(1.01);
  });
});

describe('charsToPages', () => {
  it('returns full Decimal precision, not rounded to money', () => {
    expect(charsToPages(3366).toNumber()).toBeCloseTo(1.87, 6);
    expect(charsToPages(2001).toString()).toMatch(/^1\.111\d+/);
  });

  it('respects the minimum of 1 page when combined with a max(1, ...) caller', () => {
    const pages = charsToPages(1);
    expect(Math.max(1, pages.toNumber())).toBe(1);
  });
});

describe('computeTranslationAmount (T)', () => {
  const RATE = 3000;

  it('bills exactly one page\'s rate for 1 character', () => {
    expect(computeTranslationAmount(1, RATE)).toBe(3000);
  });
  it('bills exactly one page\'s rate for 1799 characters', () => {
    expect(computeTranslationAmount(1799, RATE)).toBe(3000);
  });
  it('bills exactly one page\'s rate for exactly 1800 characters', () => {
    expect(computeTranslationAmount(1800, RATE)).toBe(3000);
  });
  it('bills slightly more than one page for 1801 characters', () => {
    // 1801/1800 * 3000 = 3001.666... -> 3001.67
    expect(computeTranslationAmount(1801, RATE)).toBe(3001.67);
  });
  it('matches the 2001-character worked example at a 10,000 KZT/page rate', () => {
    // 2001 * 10000 / 1800 = 11116.6666... -> 11116.67
    expect(computeTranslationAmount(2001, 10000)).toBe(11116.67);
  });
  it('matches the 3366-character worked example (1.87 pages) at 3000 KZT/page', () => {
    // 3366 * 3000 / 1800 = 5610 exactly
    expect(computeTranslationAmount(3366, RATE)).toBe(5610);
  });
  it('handles a large multi-thousand-character document without precision loss', () => {
    // 50000 * 3000 / 1800 = 83333.3333... -> 83333.33
    expect(computeTranslationAmount(50000, RATE)).toBe(83333.33);
  });
  it('never derives T from a previously-rounded page count — only from the raw character count', () => {
    const chars = 2001;
    const rate = 10000;
    const roundedPages = Math.round(charsToPages(chars).toNumber() * 1000) / 1000; // 1.112 (rounded to 3dp, as an old numeric(10,3) column would have stored)
    const wrongT = roundToKopeks(roundedPages * rate); // what you'd get feeding the rounded page count back in
    const correctT = computeTranslationAmount(chars, rate);
    expect(correctT).toBe(11116.67);
    expect(wrongT).not.toBe(correctT); // 1.112 * 10000 = 11120, demonstrably different/wrong
  });
});

describe('sumMoney', () => {
  it('sums with full precision, rounding only the final result', () => {
    expect(sumMoney(900, 222, 185, 370, 370, 740, 1480)).toBe(4267);
  });
  it('handles fractional inputs without compounding error', () => {
    expect(sumMoney('1.005', '1.005', '1.005')).toBe(3.02); // 3.015 rounds to 3.02 (half-up)
  });
});

describe('moneyDifference (reconciliation)', () => {
  it('returns exactly 0 for a balanced reconciliation', () => {
    const actualPayment = 7400;
    const totalAllocations = 4267;
    const netProfit = 3133;
    expect(moneyDifference(actualPayment, sumMoney(totalAllocations, netProfit))).toBe(0);
  });
});
