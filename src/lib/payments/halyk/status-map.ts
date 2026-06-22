import type { InternalPaymentStatus } from './types';

/**
 * Public payment statuses returned by the status API endpoint.
 * Never includes internal-only statuses (requires_review, duplicate_charge_review).
 */
export type PublicPaymentStatus =
  | 'payment_pending'
  | 'authorized'
  | 'paid'
  | 'failed'
  | 'canceled'
  | 'expired'
  | 'refunded'
  | 'unknown';

export interface PublicPaymentStatusResult {
  status: PublicPaymentStatus;
  isAuthorized: boolean;
  messageCode: string | null;
  /** Public terminal: stop polling. Distinct from internal terminal — duplicate_charge_review is terminal internally but maps to unknown publicly. */
  isPublicTerminal: boolean;
}

/**
 * Maps Halyk resultCode + statusName to an internal payment status.
 * Only resultCode=100 + statusName=CHARGE means a successful card charge.
 * Internal statuses (requires_review, duplicate_charge_review) are for DB/operator use.
 * Never return internal statuses directly to the frontend — use mapToPublicStatus() first.
 *
 * Reference: https://epayment.kz/docs/kody-oshibok
 */
export function mapHalykStatus(
  resultCode: number | string,
  statusName: string | undefined,
): InternalPaymentStatus {
  const code = Number(resultCode);
  // Normalize statusName: trim whitespace and uppercase for case-insensitive matching
  const status = statusName?.trim().toUpperCase();
  if (code === 100) {
    switch (status) {
      case 'CHARGE':
        return 'paid';
      case 'REFUND':
        return 'refunded';
      case 'CANCEL':
      case 'CANCEL_OLD':
        return 'canceled';
      case 'FAILED':
      case 'REJECT':
      case '3D':
        return 'failed';
      case 'NEW':
      case 'FINGERPRINT':
        return 'payment_pending';
      case 'AUTH':
        // WPO uses 1-step CHARGE flow. AUTH means pre-authorized, Halyk will auto-capture.
        // Treat as payment_pending — reconciliation will pick up CHARGE when it arrives.
        return 'payment_pending';
      default:
        // Unknown statusName under code=100: store internally for operator review
        return 'requires_review';
    }
  }

  if (code === 107) {
    // Transaction not found yet — check later
    return 'payment_pending';
  }

  if (code === 102) {
    // Immediately after initiation: not a final failure
    return 'payment_pending';
  }

  if (code === 103) {
    // Technical error on Halyk side — keep internal review flag; reconciliation will retry
    return 'requires_review';
  }

  // Any other resultCode: flag for manual review
  return 'requires_review';
}

/**
 * Maps an internal payment status to a public-safe status for API responses.
 * Ensures internal-only statuses (requires_review, duplicate_charge_review) are
 * never exposed directly to the frontend.
 */
export function mapToPublicStatus(internal: InternalPaymentStatus, providerStatusName?: string): PublicPaymentStatusResult {
  switch (internal) {
    case 'paid':
      return { status: 'paid', isAuthorized: false, messageCode: null, isPublicTerminal: true };
    case 'failed':
      return { status: 'failed', isAuthorized: false, messageCode: null, isPublicTerminal: true };
    case 'canceled':
      return { status: 'canceled', isAuthorized: false, messageCode: null, isPublicTerminal: true };
    case 'refunded':
      return { status: 'refunded', isAuthorized: false, messageCode: null, isPublicTerminal: true };
    case 'refund_pending':
      return { status: 'payment_pending', isAuthorized: false, messageCode: 'REFUND_IN_PROGRESS', isPublicTerminal: false };
    case 'requires_review':
      // Internal-only: expose as payment_pending so frontend keeps a reasonable UI.
      // Operator handles via reconcile cron.
      return { status: 'payment_pending', isAuthorized: false, messageCode: 'MANUAL_REVIEW_PENDING', isPublicTerminal: false };
    case 'duplicate_charge_review':
      // Terminal internally but exposed as unknown — operator must resolve manually.
      return { status: 'unknown', isAuthorized: false, messageCode: 'DUPLICATE_CHARGE_REVIEW', isPublicTerminal: true };
    case 'payment_pending':
    default: {
      // Auth state: provider reported AUTH (pre-authorized, 1-step auto-capture pending)
      const isAuth = providerStatusName?.toUpperCase() === 'AUTH';
      return {
        status: isAuth ? 'authorized' : 'payment_pending',
        isAuthorized: isAuth,
        messageCode: isAuth ? 'PAYMENT_AUTHORIZED_WAITING_FOR_CHARGE' : null,
        isPublicTerminal: false,
      };
    }
  }
}

/**
 * Returns true if the status is terminal (no further status changes expected).
 */
export function isTerminalStatus(status: InternalPaymentStatus): boolean {
  return ['paid', 'failed', 'canceled', 'refunded', 'duplicate_charge_review'].includes(status);
}

/**
 * Returns true if the status indicates a successful charge.
 */
export function isPaidStatus(status: InternalPaymentStatus): boolean {
  return status === 'paid';
}
