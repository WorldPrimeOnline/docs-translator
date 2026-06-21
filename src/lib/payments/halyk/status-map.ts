import type { InternalPaymentStatus } from './types';

/**
 * Maps Halyk resultCode + statusName to an internal payment status.
 * Only resultCode=100 + statusName=CHARGE means a successful card charge.
 * All other combinations map to non-paid or review statuses.
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
        // 1-step scheme: AUTH without CHARGE is unexpected — flag for review
        return 'requires_review';
      default:
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
    // Technical error — retry recommended
    return 'requires_review';
  }

  // Any other resultCode: flag for manual review
  return 'requires_review';
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
