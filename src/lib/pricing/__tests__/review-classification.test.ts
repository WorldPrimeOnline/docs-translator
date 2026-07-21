/**
 * Tests for classifyPricingReviewReasons() (2026-07-23) — pins the classifier against the exact
 * literal reviewReasons strings calculator.ts pushes today, so a wording change there that
 * silently breaks the classification is caught here rather than in production.
 */
import { classifyPricingReviewReasons, PRICING_REVIEW_HTTP_STATUS } from '../review-classification';

describe('classifyPricingReviewReasons', () => {
  it('no active language rate -> LANGUAGE_RATE_MISSING', () => {
    expect(classifyPricingReviewReasons(['No active language rate found for ru→zh — requires operator review'])).toBe('LANGUAGE_RATE_MISSING');
  });

  it('language rate marked requires_operator_review -> LANGUAGE_RATE_MISSING', () => {
    expect(classifyPricingReviewReasons(['Language rate for ru→en is marked requires_operator_review'])).toBe('LANGUAGE_RATE_MISSING');
  });

  it('language rate inactive -> LANGUAGE_RATE_MISSING', () => {
    expect(classifyPricingReviewReasons(['Language rate for ru→en is inactive — requires operator review'])).toBe('LANGUAGE_RATE_MISSING');
  });

  it('unused_channel_reserve negative -> PRICING_VERSION_MISMATCH', () => {
    expect(classifyPricingReviewReasons(['unused_channel_reserve is negative — channel_reserve_rate configuration cannot cover this discount/commission combination'])).toBe('PRICING_VERSION_MISMATCH');
  });

  it('no character count available -> DOCUMENT_ANALYSIS_FAILED', () => {
    expect(classifyPricingReviewReasons(['No character count available from document analysis — requires operator review'])).toBe('DOCUMENT_ANALYSIS_FAILED');
  });

  it('presentation not yet supported -> UNSUPPORTED_DOCUMENT (generic fallback)', () => {
    expect(classifyPricingReviewReasons(['presentation_pricing_not_yet_supported — presentations require a dedicated pricing flow not yet implemented'])).toBe('UNSUPPORTED_DOCUMENT');
  });

  it('an unrecognized reason falls back to UNSUPPORTED_DOCUMENT, never throws', () => {
    expect(classifyPricingReviewReasons(['some future reason not yet classified'])).toBe('UNSUPPORTED_DOCUMENT');
  });

  it('empty reasons array falls back to UNSUPPORTED_DOCUMENT rather than throwing', () => {
    expect(classifyPricingReviewReasons([])).toBe('UNSUPPORTED_DOCUMENT');
  });

  it('language rate reason takes priority when multiple reasons are present', () => {
    expect(classifyPricingReviewReasons([
      'No active language rate found for ru→zh — requires operator review',
      'No character count available from document analysis — requires operator review',
    ])).toBe('LANGUAGE_RATE_MISSING');
  });

  it('every classification has an HTTP status mapping', () => {
    const classifications: Array<ReturnType<typeof classifyPricingReviewReasons>> = [
      'LANGUAGE_RATE_MISSING', 'PRICING_VERSION_MISMATCH', 'DOCUMENT_ANALYSIS_FAILED', 'UNSUPPORTED_DOCUMENT',
    ];
    for (const c of classifications) {
      expect(typeof PRICING_REVIEW_HTTP_STATUS[c]).toBe('number');
    }
  });
});
