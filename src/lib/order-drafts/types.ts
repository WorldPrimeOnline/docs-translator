import type { PricingResult } from '@/lib/pricing/types';

export type DraftStatus = 'draft_created' | 'price_calculated' | 'checkout_started' | 'expired' | 'converted';

export interface DraftFileKey {
  key: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
}

export interface DraftPricingSnapshot {
  result: PricingResult;
  computedAt: string;
  /** Pre-discount amount in KZT. Present only when a partner discount was applied. */
  priceBeforeDiscountKzt?: number;
  /** KZT discount subtracted from priceBeforeDiscountKzt. Present only when > 0. */
  discountAppliedKzt?: number;
  /** Normalized (uppercased) partner referral code the discount was validated against. */
  discountCode?: string | null;
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
  refCode?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmContent?: string | null;
  utmTerm?: string | null;
}
