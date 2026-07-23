/**
 * Shared "newest first" comparator for the customer dashboard order list —
 * 2026-08-03 incident: the dashboard rendered `[...activeOrders, ...readyOrders]`
 * (see order-buckets.ts), which puts EVERY non-terminal order above EVERY
 * terminal/downloadable one regardless of created_at — an old stuck
 * payment_pending order always outranked a brand-new completed one. Position on
 * the dashboard must depend ONLY on jobs.created_at, never on status or
 * updated_at (a status change never touches created_at, so re-sorting after
 * every update/poll is a no-op for position — exactly the "processing ->
 * completed keeps its place" requirement).
 */
export interface SortableOrder {
  /**
   * jobs.created_at (falling back to documents.created_at only when a document
   * has no job at all yet) — deliberately a DIFFERENT field from the order
   * card's user-visible `createdAt` (documents.created_at, shown as "Создан …"),
   * which this fix does not touch. Named distinctly so passing an OrderEntry
   * here can never silently pick up the wrong (display) timestamp.
   */
  sortCreatedAt: string;
  documentId: string;
}

/**
 * documentId is a stable, always-present tie-breaker for equal timestamps — not
 * chronological, just deterministic, so cards never jitter between renders/polls.
 */
export function compareByCreatedAtDesc(a: SortableOrder, b: SortableOrder): number {
  const aTime = new Date(a.sortCreatedAt).getTime();
  const bTime = new Date(b.sortCreatedAt).getTime();
  if (aTime !== bTime) return bTime - aTime;
  if (a.documentId === b.documentId) return 0;
  return a.documentId < b.documentId ? 1 : -1;
}

/** Never mutates the input array. */
export function sortByCreatedAtDesc<T extends SortableOrder>(orders: T[]): T[] {
  return [...orders].sort(compareByCreatedAtDesc);
}
