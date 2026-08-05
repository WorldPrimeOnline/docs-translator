/**
 * Splits a customer's orders into the three dashboard sections (active,
 * ready/downloadable, history). Extracted from src/app/[locale]/dashboard/page.tsx
 * so this classification is independently testable — see
 * __tests__/order-buckets.test.ts, which locks in that a completed electronic
 * order (any output format — DOCX/HTML) always lands in `readyOrders`, never
 * silently dropped from all three buckets.
 *
 * Bucket membership depends ONLY on isActive/isTerminal (derived from
 * getCustomerOrderState — job status / workflow status / service level).
 * It never looks at document_type, output format, or file extension.
 *
 * 2026-08-03 incident: bucket membership must never double as sort/render order.
 * visibleOrders() used to render `[...activeOrders, ...readyOrders]` — every
 * non-terminal order above every terminal/downloadable one, so an old stuck
 * payment_pending order always outranked a brand-new completed order. Position
 * is created_at DESC only (see order-sort.ts) — never status, never bucket.
 */
import { sortByCreatedAtDesc, type SortableOrder } from './order-sort';

export interface Bucketable {
  isActive: boolean;
  isTerminal: boolean;
}

export interface OrderBuckets<T> {
  /** In progress — not yet terminal, not downloadable. */
  activeOrders: T[];
  /** Terminal AND downloadable (electronic completed, certified ready_for_delivery/delivered). */
  readyOrders: T[];
  /** Terminal, not downloadable (failed/refunded/canceled/notarized delivered, etc.). */
  historyOrders: T[];
}

/**
 * 2026-07-25 regression: the original version filtered each bucket independently
 * (`isActive && !isTerminal` / `isActive && isTerminal` / `isTerminal && !isActive`),
 * which left the isActive=false/isTerminal=false combination matching NONE of the
 * three predicates — an order in that state would silently vanish from every
 * section. That combination should never arise from getCustomerOrderState() itself
 * (isActive is derived as `!isTerminal || canDownload`, so isActive=false requires
 * isTerminal=true) — but it WAS reachable in practice: the retention fix's
 * applyFilesPurgedOverride() forced isActive:false whenever a document was purged,
 * without checking isTerminal first, so a genuinely abandoned (never paid,
 * non-terminal) order older than 30 days could get its files purged and then
 * disappear from all three buckets (fixed separately in order-retention.ts, but this
 * function is hardened here too — defense in depth, not reliant on every caller
 * getting isActive/isTerminal combinations exactly right). readyOrders/historyOrders
 * are defined precisely and are mutually exclusive by construction; activeOrders is
 * everything else — the safe catch-all, so an unrecognized/malformed combination
 * lands in Active (visible, actionable) rather than disappearing.
 */
export function bucketOrders<T extends Bucketable>(orders: T[]): OrderBuckets<T> {
  const readyOrders = orders.filter((o) => o.isActive && o.isTerminal);
  const historyOrders = orders.filter((o) => o.isTerminal && !o.isActive);
  const classified = new Set([...readyOrders, ...historyOrders]);
  const activeOrders = orders.filter((o) => !classified.has(o));
  return { activeOrders, readyOrders, historyOrders };
}

/**
 * The section the dashboard actually renders order cards from — active + ready
 * (i.e. every order with isActive=true, regardless of terminal state), sorted
 * strictly by created_at DESC. Never bucket-concatenate (all active before all
 * ready) — that reintroduces the 2026-08-03 incident. Sorts defensively
 * regardless of the input array's order, so an out-of-order poll response can
 * never leak into render order.
 */
export function visibleOrders<T extends Bucketable & SortableOrder>(orders: T[]): T[] {
  return sortByCreatedAtDesc(orders.filter((o) => o.isActive));
}
