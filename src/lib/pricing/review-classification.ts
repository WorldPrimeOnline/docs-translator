/**
 * Classifies calculatePrice()'s reviewReasons (free-text strings, pushed throughout
 * calculator.ts) into a small set of machine-readable outcomes — 2026-07-23, following the
 * staging incident where every requiresOperatorReview=true result was collapsed into a single
 * generic UNSUPPORTED_DOCUMENT, hiding that the actual cause (no active language rate for
 * ru→zh under the active version) was a configuration/pricing gap, not a document problem.
 *
 * Matches against the exact literal strings calculator.ts pushes today — not a structured code
 * from the calculator itself, so this file must be kept in sync if those strings change (see
 * the regression test asserting each known reason classifies correctly). A calculator.ts change
 * is out of scope here deliberately: it is the highest-risk file in this codebase per
 * CLAUDE.md, and this classification only needs to read its already-stable existing messages.
 */

export type PricingReviewClassification =
  | 'LANGUAGE_RATE_MISSING'
  | 'PRICING_VERSION_MISMATCH'
  | 'DOCUMENT_ANALYSIS_FAILED'
  | 'UNSUPPORTED_DOCUMENT';

/** HTTP status each classification should surface as, from a checkout endpoint. */
export const PRICING_REVIEW_HTTP_STATUS: Record<PricingReviewClassification, number> = {
  // Customer's specific language pair isn't priceable automatically today — not their fault,
  // but not a server error either.
  LANGUAGE_RATE_MISSING: 422,
  // A real config problem with the active pricing_versions row (e.g. unused_channel_reserve
  // negative) — same severity as computeQuoteForJob's own top-level PRICING_VERSION_MISMATCH gate.
  PRICING_VERSION_MISMATCH: 503,
  // "No character count available" reaching calculateOfficialNotaryPrice should be unreachable
  // via the document-analysis-gated checkout flow (a 'completed' analysis always has a
  // character count) — if it happens anyway, that's an internal pipeline inconsistency, not a
  // customer-facing document problem.
  DOCUMENT_ANALYSIS_FAILED: 500,
  // A document type/scenario genuinely not supported by automatic pricing yet.
  UNSUPPORTED_DOCUMENT: 422,
};

export function classifyPricingReviewReasons(reasons: string[]): PricingReviewClassification {
  const joined = reasons.join(' | ');

  if (/no active language rate found|language rate for .+ is (marked requires_operator_review|inactive)/i.test(joined)) {
    return 'LANGUAGE_RATE_MISSING';
  }
  if (/unused_channel_reserve is negative/i.test(joined)) {
    return 'PRICING_VERSION_MISMATCH';
  }
  if (/no character count available from document analysis/i.test(joined)) {
    return 'DOCUMENT_ANALYSIS_FAILED';
  }
  // presentation_pricing_not_yet_supported, applicant/delivery-zone confirmation gaps, manual
  // adjustment reason missing, or anything else not recognized above: genuinely not
  // auto-priceable today — the honest generic bucket, never "an operator will handle it".
  return 'UNSUPPORTED_DOCUMENT';
}
