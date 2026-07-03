export type ServiceLevel =
  | 'electronic'
  | 'official_with_translator_signature_and_provider_stamp'
  | 'notarization_through_partners';

export type UrgencyLevel = 'standard' | 'within_24h' | 'six_to_twelve_hours' | 'two_to_four_hours' | 'night_or_weekend';

export type ScanQuality = 'normal' | 'poor_scan' | 'handwritten';

export type LayoutComplexity = 'standard' | 'tables' | 'complex_tables' | 'complex_layout';

export type VisualMarksComplexity = 'normal' | 'many_stamps';

export type ApplicantType = 'individual' | 'legal_entity' | 'unknown';

export type DeliveryZone = 'almaty_standard' | 'remote_area' | 'other_city' | 'urgent_delivery';

export type NotaryUrgencyLevel = 'standard' | 'same_day';

export type SalesChannel = 'direct' | 'referral' | 'reseller';

export type QuoteStatus =
  | 'draft'
  | 'quoted'
  | 'expired'
  | 'payment_pending'
  | 'paid'
  | 'canceled'
  | 'refunded'
  | 'requires_operator_review';

export interface PricingVersion {
  id: string;
  code: string;
  status: 'draft' | 'active' | 'archived';
  currency: string;
  internalFxRate: number | null;
  mrpValue: number | null;
  taxRate: number;
  acquiringRate: number;
  riskReserveRate: number;
  ownerReserveRate: number;
  marketingRateDirect: number;
  partnerCommissionRate: number;
  targetProfitRate: number;
  aiItReservePerPageKzt: number;
  validFrom: string;
  validTo: string | null;
  metadata: Record<string, unknown>;
}

export interface QuoteLineItem {
  itemType: string;
  label: string;
  quantity: number;
  unitPriceKzt: number | null;
  amountKzt: number;
  isClientVisible: boolean;
  isCost: boolean;
  sortOrder: number;
  metadataJson?: Record<string, unknown>;
}

export interface PricingInput {
  documentId?: string;
  jobId?: string;
  userId?: string;
  sourceLanguage: string;
  targetLanguage: string;
  serviceLevel: ServiceLevel;
  documentType?: string;
  sourceWordCount?: number;
  physicalPageCount?: number;
  complexity?: 'simple' | 'complex';
  urgencyLevel?: UrgencyLevel;
  scanQuality?: ScanQuality;
  layoutComplexity?: LayoutComplexity;
  visualMarksComplexity?: VisualMarksComplexity;
  applicantType?: ApplicantType;
  deliveryZone?: DeliveryZone;
  extraPaperCopies?: number;
  fulfillmentMethod?: 'pickup' | 'delivery';
  deliveryRequired?: boolean;
  salesChannel?: SalesChannel;
  partnerId?: string;
  notaryUrgencyLevel?: NotaryUrgencyLevel;
}

export interface NotaryCutoffSnapshot {
  notaryUrgencyLevel: NotaryUrgencyLevel;
  effectiveWindow: string;    // 'before_noon' | 'after_noon' | 'after_18' | 'standard'
  multiplier: number;
  quoteExpiresAt: string;     // ISO — cutoff-aware expiry for same_day, '' for standard
  cutoffAt: string | null;    // ISO of the window boundary (12:00 or 18:00 Almaty)
  pricingTimezone: 'Asia/Almaty';
  windowLabel: string;
}

export interface InternalCostBreakdown {
  taxReserve: number;
  acquiringFee: number;
  riskReserve: number;
  ownerReserve: number;
  marketingReserve: number;
  partnerCommission: number;
  aiItReserve: number;
  translatorReserved: number;
  notaryFee: number;
  notaryCoordFee: number;
  courierCost: number;
  printingCost: number;
}

export interface MarginBreakdown {
  /** Final client price (post margin-floor-adjustment, post rounding). */
  grossRevenue: number;
  /** Sum of all internal costs/reserves (now includes courierCost + printingCost). */
  totalCosts: number;
  /** Target profit *benchmark* (subtotal × targetProfitRate) — informational only, never a cost. */
  targetProfit: number;
  /** grossRevenue - totalCosts. */
  estimatedMarginKzt: number;
  /** estimatedMarginKzt / grossRevenue. */
  estimatedMarginRate: number;
  /** Raw client price before the margin floor step (normal rounding only). */
  rawPriceBeforeMarginFloor: number;
  /** estimatedMarginKzt computed against rawPriceBeforeMarginFloor, before any floor adjustment. */
  estimatedMarginRateBeforeFloor: number;
  /** margin_floor_adjustment amount added to price (0 if margin was already ≥ target). */
  marginFloorAdjustmentKzt: number;
  /** The margin floor target rate applied for this order's service level (e.g. 0.50). */
  targetMarginFloorRate: number;
  /** How far final margin exceeds the floor target, in KZT (>= 0 whenever the floor holds). */
  profitBufferAboveTargetKzt: number;
  /** How far final margin exceeds the floor target, as a rate (>= 0 whenever the floor holds). */
  profitBufferAboveTargetRate: number;
}

export interface PricingResult {
  amountKzt: number;
  currency: 'KZT';
  status: QuoteStatus;
  items: QuoteLineItem[];
  pricingVersionId: string;
  pricingVersionCode: string;
  internalCosts: InternalCostBreakdown;
  margin: MarginBreakdown;
  requiresOperatorReview: boolean;
  reviewReasons: string[];
  context: {
    languagePair: string;
    baseMinimumKzt: number;
    extraWords: number;
    additionalPages: number;
    documentCoefficient: number;
    urgencyCoefficient: number;
    includedWordCount: number;
    includedPageCount: number;
    notaryCutoff?: NotaryCutoffSnapshot;
  };
}
