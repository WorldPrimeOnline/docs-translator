/**
 * 2026-07-23 dashboard task: history rows previously showed no retention/expiry
 * information at all. These are pure unit tests for the display-only retention
 * helpers — see order-retention.ts's doc comment for the known conflict with
 * cleanup/route.ts's full-`documents`-row deletion (not resolved here, flagged
 * in the task report as a product/eng decision).
 */
import { HISTORY_RETENTION_DAYS, computeRetentionExpiry, isRetentionExpired } from '../order-retention';

describe('computeRetentionExpiry', () => {
  it('adds HISTORY_RETENTION_DAYS (30) days to createdAt by default', () => {
    const createdAt = '2026-01-01T00:00:00.000Z';
    const expiry = computeRetentionExpiry(createdAt);
    expect(HISTORY_RETENTION_DAYS).toBe(30);
    expect(expiry.toISOString()).toBe('2026-01-31T00:00:00.000Z');
  });

  it('honors an explicit retentionDays override', () => {
    const createdAt = '2026-01-01T00:00:00.000Z';
    const expiry = computeRetentionExpiry(createdAt, 7);
    expect(expiry.toISOString()).toBe('2026-01-08T00:00:00.000Z');
  });
});

describe('isRetentionExpired', () => {
  it('is false immediately after creation', () => {
    const createdAt = '2026-07-01T00:00:00.000Z';
    const now = new Date('2026-07-01T00:00:01.000Z');
    expect(isRetentionExpired(createdAt, now)).toBe(false);
  });

  it('is false one day before the 30-day window closes', () => {
    const createdAt = '2026-07-01T00:00:00.000Z';
    const now = new Date('2026-07-30T00:00:00.000Z');
    expect(isRetentionExpired(createdAt, now)).toBe(false);
  });

  it('is true exactly at the 30-day boundary', () => {
    const createdAt = '2026-07-01T00:00:00.000Z';
    const now = new Date('2026-07-31T00:00:00.000Z');
    expect(isRetentionExpired(createdAt, now)).toBe(true);
  });

  it('is true well past the 30-day window — the scenario a real cron-lag or test would hit', () => {
    // Scoped per the task brief: this state is only actually observable in production
    // before the daily cleanup cron has run (or here, in a test that passes an old
    // createdAt directly) — once the cron runs, the whole `documents` row is deleted
    // and there is nothing left to render this message for.
    const createdAt = '2026-01-01T00:00:00.000Z';
    const now = new Date('2026-03-01T00:00:00.000Z');
    expect(isRetentionExpired(createdAt, now)).toBe(true);
  });

  it('defaults `now` to the current time when not provided', () => {
    const longAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
    expect(isRetentionExpired(longAgo)).toBe(true);
    const justNow = new Date().toISOString();
    expect(isRetentionExpired(justNow)).toBe(false);
  });
});
