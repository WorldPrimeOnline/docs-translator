/**
 * Centralized Decimal-based money arithmetic for the WPO pricing engine (2026-07-17 rewrite).
 *
 * Never use bare `Math.round(amount * 100) / 100` or `.toFixed(2)` for KZT amounts — native
 * floats misround boundary values (e.g. `1.005` is actually stored as
 * `1.00499999999999989...`, so naive rounding yields `1.00` instead of the correct `1.01`).
 * The imprecision happens the moment a decimal literal is parsed into a JS `number` — no
 * amount of careful rounding logic afterward can undo it. `decimal.js-light` avoids this by
 * operating on the exact decimal representation throughout.
 *
 * Postgres `numeric` columns come back from Supabase JS as STRINGS by default. Pass those
 * strings directly into `toDecimal`/these helpers rather than calling `Number(...)` on them
 * first — an early `Number()` cast reintroduces exactly the precision loss this module exists
 * to avoid.
 */
import Decimal from 'decimal.js-light';

Decimal.set({ precision: 34, rounding: Decimal.ROUND_HALF_UP });

export type MoneyInput = number | string | Decimal;

export function toDecimal(value: MoneyInput): Decimal {
  return value instanceof Decimal ? value : new Decimal(value);
}

/** Round to 0.01 KZT (half-up on the true decimal value), returning a plain number. */
export function roundToKopeks(value: MoneyInput): number {
  return toDecimal(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
}

/** Round UP to the nearest multiple of `step` — the retail-rounding operation (100 official / 500 notary). */
export function roundUpToStep(value: MoneyInput, step: MoneyInput): number {
  const amount = toDecimal(value);
  const stepDecimal = toDecimal(step);
  if (stepDecimal.lte(0)) {
    throw new Error(`roundUpToStep: step must be > 0, got ${stepDecimal.toString()}`);
  }
  // decimal.js-light has no .ceil() method — ROUND_UP rounds away from zero to the nearest
  // integer, which is equivalent to ceil() for the always-positive amounts used here.
  const steps = amount.dividedBy(stepDecimal).toDecimalPlaces(0, Decimal.ROUND_UP);
  return steps.times(stepDecimal).toNumber();
}

/** amount * rate, rounded to kopeks. Use for any percentage-of-amount computation (tax, Halyk, risk, marketing, AI/IT, owner, channel, discount, partner commission). */
export function applyRate(amount: MoneyInput, rate: MoneyInput): number {
  return roundToKopeks(toDecimal(amount).times(toDecimal(rate)));
}

/**
 * characters / divisor (default 1800) — full Decimal precision, NOT rounded to money.
 * This is a reporting/snapshot value (translation_page_count_exact) only — never feed the
 * result back into money math. See computeTranslationAmount, which derives T directly from
 * the integer character count instead.
 */
export function charsToPages(characterCount: MoneyInput, divisor: MoneyInput = 1800): Decimal {
  return toDecimal(characterCount).dividedBy(toDecimal(divisor));
}

/**
 * T = translation amount, computed directly from the integer character count — never from a
 * previously-rounded page count (that would compound a rounding error before the money math
 * even starts). A document with <= `divisor` characters is billed at exactly one page's rate
 * (the 1.00-page minimum); above that, T scales linearly with the character count.
 */
export function computeTranslationAmount(
  characterCount: MoneyInput,
  ratePerPage: MoneyInput,
  divisor: MoneyInput = 1800,
): number {
  const chars = toDecimal(characterCount);
  const rate = toDecimal(ratePerPage);
  const div = toDecimal(divisor);
  if (chars.lte(div)) {
    return roundToKopeks(rate);
  }
  return roundToKopeks(chars.times(rate).dividedBy(div));
}

/** Sum any number of money values with full Decimal precision, rounding only the final result. */
export function sumMoney(...values: MoneyInput[]): number {
  return roundToKopeks(values.reduce((acc: Decimal, v) => acc.plus(toDecimal(v)), new Decimal(0)));
}

/** a - b, rounded to kopeks — used for reconciliation-difference checks (should be exactly 0, or within a documented tolerance). */
export function moneyDifference(a: MoneyInput, b: MoneyInput): number {
  return roundToKopeks(toDecimal(a).minus(toDecimal(b)));
}
