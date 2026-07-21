import type { PricingResult, ServiceLevel } from '@/lib/pricing/types';
import type { VersionOverrides } from './version-overrides';

/** CLI-friendly urgency alias (see lib/alias-map.ts) before it's split into level + window. */
export type UrgencyAlias = 'standard' | 'same_day' | 'before_noon' | 'after_noon' | 'after_18';

/** Fully-resolved parameters actually applied to one file, after the whole priority chain. */
export interface ResolvedFileParams {
  pricingVersionCode: string;
  pricingVersionSource: 'local' | 'staging';
  sourceLanguage: string;
  targetLanguage: string;
  serviceLevel: ServiceLevel;
  applicantType: 'individual' | 'legal_entity';
  fulfillmentMethod: 'pickup' | 'delivery';
  deliveryRequired: boolean;
  urgency: UrgencyAlias;
  extraPaperCopies: number;
  salesChannel: 'direct' | 'referral';
  partnerCommissionRateOverride?: number;
  manualAdjustmentKzt: number;
  manualAdjustmentReason?: string;
  languageRateOverrideKzt?: number;
  /** Operator-supplied physical page count — used when analysis can't get a reliable one without rendering (DOCX). */
  manualPhysicalPageCountOverride?: number;
  versionOverrides: VersionOverrides;
}

/** One JSON-config-shaped layer in the priority chain (all fields optional — see lib/config.ts). */
export interface PricingParamsInput {
  pricingVersionCode?: string;
  pricingVersionSource?: 'local' | 'staging';
  sourceLanguage?: string;
  targetLanguage?: string;
  serviceLevel?: string;
  applicantType?: 'individual' | 'legal_entity';
  fulfillmentMethod?: 'pickup' | 'delivery';
  deliveryRequired?: boolean;
  notaryUrgency?: string;
  extraPaperCopies?: number;
  channel?: 'direct' | 'referral';
  partnerCommissionRate?: number;
  manualAdjustmentKzt?: number;
  manualAdjustmentReason?: string;
  languageRateOverrideKzt?: number;
  manualPhysicalPageCountOverride?: number;
  versionOverrides?: VersionOverrides;
}

export type FileStatus = 'success' | 'operator_review' | 'failed';

export type FailureReasonCode =
  | 'encrypted_pdf'
  | 'corrupted_pdf'
  | 'ocr_failed'
  | 'no_text'
  | 'unsupported_type'
  | 'no_language_rate'
  | 'invalid_config'
  | 'reconciliation_mismatch';

export interface AnalysisSummary {
  method: string;
  /** null when no reliable count could be obtained without rendering (DOCX render failure). */
  physicalPageCount: number | null;
  charactersWithSpaces: number;
  translationPages: number;
  fromCache: boolean;
}

export interface FileResult {
  filename: string;
  relativePath: string;
  status: FileStatus;
  reasonCode?: FailureReasonCode;
  reasons: string[];
  usedTemporaryOverrides: boolean;
  appliedParams?: ResolvedFileParams;
  analysis?: AnalysisSummary;
  pricingResult?: PricingResult;
  reconciliationOk?: boolean;
}
