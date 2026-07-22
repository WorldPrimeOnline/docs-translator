import type { PricingResult, PricingVersion } from '@/lib/pricing/types';

export type DraftStatus = 'draft_created' | 'price_calculated' | 'checkout_started' | 'expired' | 'converted';

export interface DraftFileKey {
  key: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  /**
   * Provenance of the merged PDF at `key` (2026-07-29 incident fix — see
   * src/app/api/order-drafts/[draftId]/upload/complete/route.ts). sourceUploadCount/
   * sourceUploadIds reflect the DEDUPED source list actually merged (raw uploads with
   * identical content hashes collapse to one before mergePdfs()) — a stale/duplicated
   * client retry can never inflate these past the count of genuinely distinct files.
   * Absent on drafts completed before this fix.
   */
  sourceUploadCount?: number;
  sourceUploadIds?: string[];
  sourceContentHashes?: string[];
}

/**
 * Cached result of analyzeDocumentForPricing() for order_drafts.file_keys[0], keyed by that
 * exact R2 key — order_drafts has no documents.id yet (a real `documents` row, and therefore a
 * document_analysis row, only exists after convertDraftToOrder()), so this is the pre-document
 * equivalent of document_analysis's "reuse a completed analysis, never re-run OCR" guarantee.
 * Invalidated (a fresh analysis runs) only if fileKey no longer matches file_keys[0].key — e.g.
 * after a re-upload. requiresOperatorReview drafts never reach pricing_snapshot/price_calculated.
 */
export interface DraftAnalysisSnapshot {
  fileKey: string;
  method: string;
  characterCount: number;
  physicalPageCount: number | null;
  requiresOperatorReview: boolean;
  reviewReasons: string[];
  /** Copied from file_keys[0] at analysis time — see DraftFileKey's doc comment. */
  sourceUploadCount?: number;
  sourceUploadIds?: string[];
}

export interface DraftPricingSnapshot {
  result: PricingResult;
  /** The exact pricing_versions row used at calculation time — saveQuote()'s formula_version
   * snapshot must reflect what was actually quoted, not whatever version happens to be active
   * later at conversion time. */
  version: PricingVersion;
  computedAt: string;
  /** Pre-discount amount in KZT. Present only when a partner discount was applied. */
  priceBeforeDiscountKzt?: number;
  /** KZT discount subtracted from priceBeforeDiscountKzt. Present only when > 0. */
  discountAppliedKzt?: number;
  /** Normalized (uppercased) partner referral code the discount was validated against. */
  discountCode?: string | null;
  /** Copied from the analysis snapshot at calculate time — see DraftFileKey's doc comment. */
  sourceUploadCount?: number;
  sourceUploadIds?: string[];
}

/** Raw `order_drafts` row shape — snake_case, matches the DB column names exactly. */
export interface OrderDraftRow {
  id: string;
  user_id: string | null;
  anonymous_session_id: string;
  status: DraftStatus;
  source_language: string | null;
  target_language: string | null;
  document_type: string | null;
  output_format: string | null;
  service_level: string | null;
  applicant_type: string | null;
  notary_urgency_level: string | null;
  notary_city: string | null;
  fulfillment_method: string | null;
  delivery_phone: string | null;
  delivery_address: string | null;
  delivery_zone: string | null;
  customer_comment: string | null;
  file_keys: DraftFileKey[];
  pricing_snapshot: DraftPricingSnapshot | null;
  analysis_snapshot: DraftAnalysisSnapshot | null;
  ref_code: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  converted_job_id: string | null;
  converted_document_id: string | null;
  converted_quote_id: string | null;
  converted_price_kzt: number | null;
  consent_accepted_at: string | null;
  ip_address: string | null;
  expires_at: string;
  created_at: string;
  updated_at: string;
}

/** camelCase fields a client may create/update — mirrors the dashboard/upload-card field set. */
export interface OrderDraftInput {
  sourceLanguage?: string | null;
  targetLanguage?: string | null;
  documentType?: string | null;
  outputFormat?: string | null;
  serviceLevel?: string | null;
  applicantType?: string | null;
  notaryUrgencyLevel?: string | null;
  notaryCity?: string | null;
  fulfillmentMethod?: string | null;
  deliveryPhone?: string | null;
  deliveryAddress?: string | null;
  deliveryZone?: string | null;
  customerComment?: string | null;
  /** True when the visitor had the /start terms/consent box checked (or already accepted account-wide). Write-once — see updateDraftFields/createDraft; never clears an already-recorded acceptance. */
  consentAccepted?: boolean;
  refCode?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmContent?: string | null;
  utmTerm?: string | null;
}
