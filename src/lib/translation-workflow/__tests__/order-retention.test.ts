/**
 * 2026-07-23 dashboard task: history rows previously showed no retention/expiry
 * information at all. These are pure unit tests for the display-only retention
 * helpers. 2026-07-24: the metadata-preserving cleanup fix (migration 0066) resolved
 * the previously-flagged documents-row-deletion conflict — see order-retention.ts's
 * updated doc comment — and added applyFilesPurgedOverride(), tested below.
 */
import { HISTORY_RETENTION_DAYS, computeRetentionExpiry, isRetentionExpired, applyFilesPurgedOverride } from '../order-retention';

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

describe('applyFilesPurgedOverride (2026-07-24)', () => {
  function order(overrides: { isActive: boolean; filesPurgedAt: string | null; id: string }) {
    return { documentId: overrides.id, isActive: overrides.isActive, filesPurgedAt: overrides.filesPurgedAt };
  }

  it('forces isActive:false for a purged order, regardless of its original isActive value', () => {
    const results = applyFilesPurgedOverride([order({ id: 'a', isActive: true, filesPurgedAt: '2026-07-01T00:00:00Z' })]);
    expect(results[0]!.isActive).toBe(false);
  });

  it('leaves a non-purged order completely unchanged', () => {
    const input = order({ id: 'a', isActive: true, filesPurgedAt: null });
    const [result] = applyFilesPurgedOverride([input]);
    expect(result).toEqual(input);
  });

  it('a mixed list: only the purged order flips to isActive:false, others are untouched', () => {
    const active = order({ id: 'active', isActive: true, filesPurgedAt: null });
    const purgedButWasActive = order({ id: 'purged', isActive: true, filesPurgedAt: '2026-06-01T00:00:00Z' });
    const alreadyInactive = order({ id: 'inactive', isActive: false, filesPurgedAt: null });

    const result = applyFilesPurgedOverride([active, purgedButWasActive, alreadyInactive]);

    expect(result.find((o) => o.documentId === 'active')!.isActive).toBe(true);
    expect(result.find((o) => o.documentId === 'purged')!.isActive).toBe(false);
    expect(result.find((o) => o.documentId === 'inactive')!.isActive).toBe(false);
  });
});
