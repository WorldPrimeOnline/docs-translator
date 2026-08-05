/**
 * Tests for sortByCreatedAtDesc()/compareByCreatedAtDesc() — 2026-08-03 dashboard
 * ordering incident: an old payment_pending order was rendered above a newer
 * completed one because the dashboard bucket-concatenated by status instead of
 * sorting by created_at. This module is the single source of truth for order
 * position — status/updated_at must never factor in.
 */
import { compareByCreatedAtDesc, sortByCreatedAtDesc, type SortableOrder } from '../order-sort';

function order(documentId: string, sortCreatedAt: string): SortableOrder {
  return { documentId, sortCreatedAt };
}

describe('sortByCreatedAtDesc', () => {
  it('reproduces the incident: an old payment_pending order and a newer completed order — newer always first, regardless of status', () => {
    const oldPending = order('doc-old', '2026-07-20T10:00:00.000Z');
    const newCompleted = order('doc-new', '2026-08-03T09:00:00.000Z');

    const sorted = sortByCreatedAtDesc([oldPending, newCompleted]);
    expect(sorted.map((o) => o.documentId)).toEqual(['doc-new', 'doc-old']);
  });

  it('sorts strictly by created_at DESC for any input order', () => {
    const a = order('a', '2026-08-01T00:00:00.000Z');
    const b = order('b', '2026-08-03T00:00:00.000Z');
    const c = order('c', '2026-08-02T00:00:00.000Z');

    expect(sortByCreatedAtDesc([a, b, c]).map((o) => o.documentId)).toEqual(['b', 'c', 'a']);
    expect(sortByCreatedAtDesc([b, c, a]).map((o) => o.documentId)).toEqual(['b', 'c', 'a']);
    expect(sortByCreatedAtDesc([c, a, b]).map((o) => o.documentId)).toEqual(['b', 'c', 'a']);
  });

  it('a new job always lands first — inserting a newer entry anywhere in the input still sorts it to position 0', () => {
    const existing = [order('old-1', '2026-07-01T00:00:00.000Z'), order('old-2', '2026-06-01T00:00:00.000Z')];
    const withNew = [...existing, order('brand-new', '2026-08-03T12:00:00.000Z')];

    expect(sortByCreatedAtDesc(withNew)[0]!.documentId).toBe('brand-new');
  });

  it('does not mutate the input array', () => {
    const input = [order('a', '2026-01-01T00:00:00.000Z'), order('b', '2026-02-01T00:00:00.000Z')];
    const inputCopy = [...input];
    sortByCreatedAtDesc(input);
    expect(input).toEqual(inputCopy);
  });

  it('equal created_at falls back to a deterministic documentId tie-break, never left in arbitrary/input order', () => {
    const same = '2026-08-03T00:00:00.000Z';
    const x = order('zzz', same);
    const y = order('aaa', same);

    expect(sortByCreatedAtDesc([x, y]).map((o) => o.documentId)).toEqual(['zzz', 'aaa']);
    expect(sortByCreatedAtDesc([y, x]).map((o) => o.documentId)).toEqual(['zzz', 'aaa']);
  });

  it('compareByCreatedAtDesc returns 0 for identical createdAt and documentId', () => {
    const a = order('same', '2026-08-03T00:00:00.000Z');
    const b = order('same', '2026-08-03T00:00:00.000Z');
    expect(compareByCreatedAtDesc(a, b)).toBe(0);
  });
});
