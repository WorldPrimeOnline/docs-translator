/**
 * Single customer-safe response for every internal pricing/analysis failure (2026-07-28
 * decision). WPO has no manual operator pricing process (docs/ai-context/DECISIONS.md) — a
 * customer must never see LANGUAGE_RATE_MISSING, PRICING_VERSION_MISMATCH,
 * SERVICE_LEVEL_PRICING_DISABLED, DOCUMENT_ANALYSIS_FAILED, UNSUPPORTED_DOCUMENT, or any other
 * "operator review" outcome — these are internal config/pipeline problems, not something the
 * customer did wrong or can fix by re-uploading (contrast with the genuinely-corrupted-file
 * INVALID_DOCUMENT case in document-analysis/service.ts, which stays a distinct, honest,
 * customer-facing code — see its own comment).
 *
 * Every call site that reaches this MUST already have returned before creating a payment_pending
 * job (or, if a job already exists, moved it to 'failed' first) — this helper only builds the
 * response, it never touches jobs/documents itself.
 */
import * as Sentry from '@sentry/nextjs';

export const INTERNAL_PRICING_FAILURE_ERROR = 'PRICING_UNAVAILABLE';
export const INTERNAL_PRICING_FAILURE_HTTP_STATUS = 503;

/**
 * Reports the REAL internal reason to Sentry (for ops to actually fix — a missing language
 * rate, a version mismatch, a disabled flag, etc.), and returns the one generic customer-safe
 * { status, error } every caller surfaces instead.
 */
export function reportInternalPricingFailure(
  internalReason: string,
  context: Record<string, unknown> = {},
): { status: number; error: string } {
  Sentry.captureMessage(`Internal pricing failure: ${internalReason}`, {
    level: 'error',
    tags: { component: 'pricing-internal-failure', reason: internalReason },
    extra: context,
  });
  return { status: INTERNAL_PRICING_FAILURE_HTTP_STATUS, error: INTERNAL_PRICING_FAILURE_ERROR };
}
