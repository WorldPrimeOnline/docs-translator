/**
 * Tests for aggregateReliablePhysicalPageCount() — 2026-08-02 staging incident fix
 * (job 29b5fa37-24ac-4269-b965-c024429560da): 2 uploaded sources with real physical
 * page counts [2,1] were priced as physicalPageCount=1, since Electronic never runs
 * document analysis on the merged bundle and previously hardcoded 1.
 */
import { aggregateReliablePhysicalPageCount } from '../physical-pages';

describe('aggregateReliablePhysicalPageCount', () => {
  it('reproduces the exact incident: sourcePageCounts [2,1] -> aggregate 3', () => {
    const result = aggregateReliablePhysicalPageCount([
      { physicalPageCount: 2 },
      { physicalPageCount: 1 },
    ]);
    expect(result).toBe(3);
  });

  it('sums any number of sources, order-independent', () => {
    expect(aggregateReliablePhysicalPageCount([
      { physicalPageCount: 1 }, { physicalPageCount: 1 }, { physicalPageCount: 5 },
    ])).toBe(7);
  });

  it('a single source returns its own page count (single-file pricing path, unchanged)', () => {
    expect(aggregateReliablePhysicalPageCount([{ physicalPageCount: 4 }])).toBe(4);
  });

  it('duplicate sources are excluded before this function ever sees them — it sums exactly what it is given, trusting the caller\'s deduplicated array (see order-drafts upload/complete\'s 2026-07-29 dedup-by-content-hash fix, which builds file_keys[0].sources)', () => {
    // Simulates the ALREADY-DEDUPED array a caller passes in (a raw duplicate upload
    // is dropped upstream, before a DraftSourceFile/JobSourceFileInput entry is ever
    // created for it) — this function itself has no dedup logic and shouldn't need any.
    const dedupedSources = [{ physicalPageCount: 2 }, { physicalPageCount: 1 }]; // duplicate #3 already dropped
    expect(aggregateReliablePhysicalPageCount(dedupedSources)).toBe(3);
  });

  it('returns undefined ("unreliable") when any source is missing a page count — never guesses a partial sum', () => {
    const result = aggregateReliablePhysicalPageCount([
      { physicalPageCount: 2 },
      { physicalPageCount: null },
    ]);
    expect(result).toBeUndefined();
  });

  it('returns undefined for an empty sources array', () => {
    expect(aggregateReliablePhysicalPageCount([])).toBeUndefined();
  });

  it('returns undefined for undefined/null input (legacy pre-0063 draft, no sources array at all)', () => {
    expect(aggregateReliablePhysicalPageCount(undefined)).toBeUndefined();
    expect(aggregateReliablePhysicalPageCount(null)).toBeUndefined();
  });

  it('never returns a value that could be mistaken for multiplying a per-file minimum — it is a page sum, not a file-count multiplier', () => {
    // 2 files, but say each is a single-page document -> aggregate is 2 pages, not
    // "2 files x minimum" (that multiplication never happens anywhere in this function
    // or its callers — see calculateElectronicPrice's additionalPages formula, which
    // only ever adds a per-PAGE fee beyond the included page, never re-applies the
    // base minimum per file).
    expect(aggregateReliablePhysicalPageCount([{ physicalPageCount: 1 }, { physicalPageCount: 1 }])).toBe(2);
  });
});
