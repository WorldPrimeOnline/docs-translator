/**
 * Pure poll-merge logic for the dashboard order list — extracted from
 * src/app/[locale]/dashboard/page.tsx (2026-08-01 incident fix) so the exact
 * "processing -> completed never removes the card" invariant is independently
 * testable, the same way bucketOrders()/getCustomerOrderState() already are.
 */
import { getCustomerOrderState } from './customer-order-state';

export interface PolledOrderData {
  status: string;
  progress: number;
  errorMessage: string | null;
  workflowStatus: string | null;
  serviceLevel: string;
  fulfillmentMethod: 'pickup' | 'delivery' | null;
  /** 2026-08-01 multi-file fulfillment decision — see customer-order-state.ts. */
  hasReadyResultFiles: boolean | null;
  latestQuoteId: string | null;
  quoteStatus: string | null;
  quoteAmountKzt: number | null;
  quoteCurrency: string | null;
  quoteExpiresAt: string | null;
  quoteRequiresOperatorReview: boolean;
}

export interface PollableOrderEntry {
  documentId: string;
  jobStatus: string | null;
  workflowStatus: string | null;
  fulfillmentMethod: 'pickup' | 'delivery' | null;
  progressPercent: number;
  errorMessage: string | null;
  customerStatus: string | null;
  canDownload: boolean;
  isActive: boolean;
  isTerminal: boolean;
  latestQuoteId: string | null;
  quoteStatus: string | null;
  quoteAmountKzt: number | null;
  quoteCurrency: string | null;
  quoteExpiresAt: string | null;
  quoteRequiresOperatorReview: boolean;
  stages: { key: string; labelKey: string; done: boolean; current: boolean }[];
}

/**
 * Applies one poll response to the matching order in `orders`, by documentId.
 *
 * ALWAYS returns an array of the SAME LENGTH as the input — a polled update only
 * ever rewrites the matching entry's fields in place; it never removes an entry,
 * regardless of the new customerStatus/isTerminal value. This is the exact
 * invariant the 2026-08-01 incident needed: a multi-source Electronic order that
 * never gets a legacy `translations` row must stay in the list once its job
 * transitions from "translating" to "completed", not disappear.
 *
 * No match found (unknown documentId) -> returns the SAME array reference
 * unchanged, so callers can rely on referential equality to skip a re-render.
 */
export function applyPolledOrderUpdate<T extends PollableOrderEntry>(
  orders: T[],
  documentId: string,
  data: PolledOrderData,
): T[] {
  const idx = orders.findIndex((x) => x.documentId === documentId);
  if (idx < 0) return orders;

  const state = getCustomerOrderState({
    jobStatus: data.status,
    progressPercent: data.progress,
    workflowStatus: data.workflowStatus,
    serviceLevel: data.serviceLevel,
    fulfillmentMethod: data.fulfillmentMethod ?? null,
    hasReadyResultFiles: data.hasReadyResultFiles ?? undefined,
  });

  const next = [...orders];
  const prevEntry = next[idx]!;
  next[idx] = {
    ...prevEntry,
    jobStatus: data.status,
    workflowStatus: data.workflowStatus,
    fulfillmentMethod: data.fulfillmentMethod ?? null,
    progressPercent: state.progressPercent,
    errorMessage: data.errorMessage,
    customerStatus: state.customerStatus,
    canDownload: state.canDownload,
    isActive: state.isActive,
    isTerminal: state.isTerminal,
    latestQuoteId: data.latestQuoteId ?? prevEntry.latestQuoteId,
    quoteStatus: data.quoteStatus ?? prevEntry.quoteStatus,
    quoteAmountKzt: data.quoteAmountKzt ?? prevEntry.quoteAmountKzt,
    quoteCurrency: data.quoteCurrency ?? prevEntry.quoteCurrency,
    quoteExpiresAt: data.quoteExpiresAt ?? prevEntry.quoteExpiresAt,
    quoteRequiresOperatorReview: data.quoteRequiresOperatorReview ?? prevEntry.quoteRequiresOperatorReview,
    stages: state.stages,
  };
  return next;
}
