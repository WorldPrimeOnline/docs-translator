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

export function bucketOrders<T extends Bucketable>(orders: T[]): OrderBuckets<T> {
  return {
    activeOrders: orders.filter((o) => o.isActive && !o.isTerminal),
    readyOrders: orders.filter((o) => o.isActive && o.isTerminal),
    historyOrders: orders.filter((o) => o.isTerminal && !o.isActive),
  };
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
