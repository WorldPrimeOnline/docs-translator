export type ServiceLevel =
  | 'electronic'
  | 'official_with_translator_signature_and_provider_stamp'
  | 'notarization_through_partners';

export type UrgencyLevel = 'standard' | 'within_24h' | 'six_to_twelve_hours' | 'two_to_four_hours';

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
  fulfillmentMethod?: 'pickup' | 'delivery';
  deliveryRequired?: boolean;
  salesChannel?: SalesChannel;
  partnerId?: string;
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
  grossRevenue: number;
  totalCosts: number;
  targetProfit: number;
  estimatedMarginKzt: number;
  estimatedMarginRate: number;
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
  };
}
