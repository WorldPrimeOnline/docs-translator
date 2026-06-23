import { getAlmatyNow, getAlmatyHour, getNotaryCutoffWindow } from '../almaty-time';

// Asia/Almaty = UTC+5, no DST. Create a real UTC Date that corresponds to a given Almaty local time.
function almatyTime(hour: number, minute = 0): Date {
  const utcHour = hour - 5;
  const d = new Date('2026-06-15T00:00:00Z');
  d.setUTCHours(utcHour < 0 ? utcHour + 24 : utcHour, minute, 0, 0);
  if (utcHour < 0) {
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return d;
}

describe('getAlmatyNow', () => {
  it('returns Almaty local hour correctly for 11:59 Almaty (use getUTCHours)', () => {
    const utcDate = almatyTime(11, 59);
    const almaty = getAlmatyNow(utcDate);
    expect(almaty.getUTCHours()).toBe(11);
    expect(almaty.getUTCMinutes()).toBe(59);
  });

  it('returns Almaty local hour 12:00 for UTC 07:00', () => {
    const utcDate = almatyTime(12, 0);
    const almaty = getAlmatyNow(utcDate);
    expect(almaty.getUTCHours()).toBe(12);
  });

  it('returns Almaty local hour 18:00 for UTC 13:00', () => {
    const utcDate = almatyTime(18, 0);
    const almaty = getAlmatyNow(utcDate);
    expect(almaty.getUTCHours()).toBe(18);
  });
});

describe('getAlmatyHour', () => {
  it('returns numeric hour in Almaty timezone (UTC-based)', () => {
    expect(getAlmatyHour(almatyTime(9, 30))).toBe(9);
    expect(getAlmatyHour(almatyTime(23, 0))).toBe(23);
    expect(getAlmatyHour(almatyTime(0, 0))).toBe(0);
  });
});

describe('getNotaryCutoffWindow', () => {
  it('11:59 Almaty → before_noon, multiplier 1.0', () => {
    const result = getNotaryCutoffWindow(almatyTime(11, 59));
    expect(result.window).toBe('before_noon');
    expect(result.multiplier).toBe(1.0);
    expect(result.cutoffAt).not.toBeNull();
  });

  it('12:00 Almaty → after_noon, multiplier 1.5', () => {
    const result = getNotaryCutoffWindow(almatyTime(12, 0));
    expect(result.window).toBe('after_noon');
    expect(result.multiplier).toBe(1.5);
  });

  it('17:59 Almaty → after_noon', () => {
    const result = getNotaryCutoffWindow(almatyTime(17, 59));
    expect(result.window).toBe('after_noon');
    expect(result.multiplier).toBe(1.5);
  });

  it('18:00 Almaty → after_18, multiplier 2.0', () => {
    const result = getNotaryCutoffWindow(almatyTime(18, 0));
    expect(result.window).toBe('after_18');
    expect(result.multiplier).toBe(2.0);
    expect(result.cutoffAt).toBeNull();
  });

  it('23:59 Almaty → after_18, multiplier 2.0', () => {
    const result = getNotaryCutoffWindow(almatyTime(23, 59));
    expect(result.window).toBe('after_18');
    expect(result.multiplier).toBe(2.0);
  });

  it('before_noon: quoteExpiresAt equals 12:00 Almaty = 07:00 UTC', () => {
    const now = almatyTime(10, 0); // 05:00 UTC
    const result = getNotaryCutoffWindow(now);
    const expiry = new Date(result.quoteExpiresAt);
    expect(expiry.getUTCHours()).toBe(7); // 12:00 Almaty = 07:00 UTC
    expect(result.cutoffAt).toBe(result.quoteExpiresAt);
  });

  it('after_noon: quoteExpiresAt equals 18:00 Almaty = 13:00 UTC', () => {
    const now = almatyTime(14, 0); // 09:00 UTC
    const result = getNotaryCutoffWindow(now);
    const expiry = new Date(result.quoteExpiresAt);
    expect(expiry.getUTCHours()).toBe(13); // 18:00 Almaty = 13:00 UTC
    expect(result.cutoffAt).toBe(result.quoteExpiresAt);
  });

  it('after_18: quoteExpiresAt is ~2h from now', () => {
    const now = almatyTime(19, 0);
    const result = getNotaryCutoffWindow(now);
    const expiry = new Date(result.quoteExpiresAt);
    const diffMs = expiry.getTime() - now.getTime();
    expect(diffMs).toBeGreaterThan(1.9 * 60 * 60 * 1000);
    expect(diffMs).toBeLessThan(2.1 * 60 * 60 * 1000);
  });

  it('pricingTimezone is always Asia/Almaty', () => {
    expect(getNotaryCutoffWindow(almatyTime(10, 0)).pricingTimezone).toBe('Asia/Almaty');
    expect(getNotaryCutoffWindow(almatyTime(15, 0)).pricingTimezone).toBe('Asia/Almaty');
    expect(getNotaryCutoffWindow(almatyTime(20, 0)).pricingTimezone).toBe('Asia/Almaty');
  });
});
