/**
 * Almaty timezone helpers for notary cutoff pricing.
 * All notary same-day pricing decisions must use Asia/Almaty time,
 * never browser local time or server UTC without conversion.
 *
 * Asia/Almaty is UTC+5 with NO daylight saving time — offset is safe to hardcode.
 * All functions use UTC arithmetic exclusively (never server local time methods).
 */

export type NotaryCutoffWindow =
  | 'before_noon' // 00:00–11:59 → multiplier 1.0, expires at 12:00 today
  | 'after_noon'  // 12:00–17:59 → multiplier 1.5, expires at 18:00 today
  | 'after_18'    // 18:00–23:59 → multiplier 2.0, expires in 2h
  | 'standard';   // no same-day: standard 24h quote

export interface NotaryCutoffInfo {
  window: NotaryCutoffWindow;
  almatyHour: number;
  almatyMinute: number;
  multiplier: number;
  /** ISO string of when this window's quote expires */
  quoteExpiresAt: string;
  /** Descriptive label for the window */
  windowLabel: string;
  /** ISO string of the window's cutoff boundary (12:00 or 18:00 Almaty), null for after_18 */
  cutoffAt: string | null;
  pricingTimezone: 'Asia/Almaty';
}

const ALMATY_OFFSET_MS = 5 * 60 * 60 * 1000; // UTC+5, no DST

/**
 * Returns a Date whose UTC fields (.getUTCHours(), .getUTCMinutes()) represent
 * the Almaty local time components. Works correctly on any server timezone.
 * NOTE: Use .getUTCHours() / .getUTCMinutes() on the returned value — never .getHours().
 */
export function getAlmatyNow(now = new Date()): Date {
  return new Date(now.getTime() + ALMATY_OFFSET_MS);
}

/** Get the hour (0–23) in Asia/Almaty. Server-timezone-agnostic. */
export function getAlmatyHour(now = new Date()): number {
  return getAlmatyNow(now).getUTCHours();
}

/**
 * Returns the real UTC Date that corresponds to today at the given hour:minute in Asia/Almaty.
 * Uses UTC-only arithmetic — safe regardless of server timezone.
 */
export function getAlmatyTodayAt(hour: number, minute = 0, now = new Date()): Date {
  // Shift now to Almaty epoch (treat as if UTC, but the h/m/s fields are Almaty local)
  const almatyMs = now.getTime() + ALMATY_OFFSET_MS;
  // Floor to start of the current Almaty day (midnight Almaty in Almaty epoch)
  const almatyDayStartMs = almatyMs - (almatyMs % (24 * 60 * 60 * 1000));
  // Add the target hour and minute in Almaty epoch
  const targetAlmatyMs = almatyDayStartMs + hour * 60 * 60 * 1000 + minute * 60 * 1000;
  // Convert back to real UTC
  return new Date(targetAlmatyMs - ALMATY_OFFSET_MS);
}

/**
 * Determine the notary cutoff window for a same-day order based on current Almaty time.
 * @param now - injectable for testing (real UTC Date)
 */
export function getNotaryCutoffWindow(now = new Date()): NotaryCutoffInfo {
  const almatyNow = getAlmatyNow(now);
  const h = almatyNow.getUTCHours();
  const m = almatyNow.getUTCMinutes();

  // Real UTC instants for today's Almaty 12:00 and 18:00
  const noonUTC = getAlmatyTodayAt(12, 0, now);
  const eveUTC = getAlmatyTodayAt(18, 0, now);
  const twoHoursFromNow = new Date(now.getTime() + 2 * 60 * 60 * 1000);

  if (h < 12) {
    return {
      window: 'before_noon',
      almatyHour: h,
      almatyMinute: m,
      multiplier: 1.0,
      quoteExpiresAt: noonUTC.toISOString(),
      windowLabel: 'same_day_before_noon',
      cutoffAt: noonUTC.toISOString(),
      pricingTimezone: 'Asia/Almaty',
    };
  } else if (h < 18) {
    return {
      window: 'after_noon',
      almatyHour: h,
      almatyMinute: m,
      multiplier: 1.5,
      quoteExpiresAt: eveUTC.toISOString(),
      windowLabel: 'same_day_after_noon',
      cutoffAt: eveUTC.toISOString(),
      pricingTimezone: 'Asia/Almaty',
    };
  } else {
    return {
      window: 'after_18',
      almatyHour: h,
      almatyMinute: m,
      multiplier: 2.0,
      quoteExpiresAt: twoHoursFromNow.toISOString(),
      windowLabel: 'same_day_after_18',
      cutoffAt: null,
      pricingTimezone: 'Asia/Almaty',
    };
  }
}
