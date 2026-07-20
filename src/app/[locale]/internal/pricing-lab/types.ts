/** Shared client-side types for the Pricing Lab UI. Mirrors the API's zod schema exactly. */

export type ServiceLevel = 'official_with_translator_signature_and_provider_stamp' | 'notarization_through_partners';

export interface VersionOverrides {
  taxRate?: number;
  acquiringRate?: number;
  riskReserveRate?: number;
  ownerReserveRate?: number;
  marketingRateDirect?: number;
  aiItRate?: number;
  channelReserveRate?: number;
  clientDiscountRate?: number;
  wpoCoordinationRate?: number;
  translatorPayoutRate?: number;
  partnerCommissionRate?: number;
  ocrRatePerPhysicalPageKzt?: number;
  courierFeeKzt?: number;
  printingFeeKzt?: number;
  extraPaperCopyFeeKzt?: number;
  roundingStepOfficialKzt?: number;
  roundingStepNotaryKzt?: number;
  mrpValue?: number;
}

export const VERSION_OVERRIDE_KEYS: Array<keyof VersionOverrides> = [
  'ocrRatePerPhysicalPageKzt', 'translatorPayoutRate', 'wpoCoordinationRate', 'mrpValue',
  'courierFeeKzt', 'printingFeeKzt', 'taxRate', 'acquiringRate', 'riskReserveRate',
  'marketingRateDirect', 'aiItRate', 'ownerReserveRate', 'channelReserveRate',
  'clientDiscountRate', 'partnerCommissionRate', 'roundingStepOfficialKzt', 'roundingStepNotaryKzt',
];

export const VERSION_OVERRIDE_LABELS: Record<keyof VersionOverrides, string> = {
  ocrRatePerPhysicalPageKzt: 'OCR (₸/физ.стр.)',
  translatorPayoutRate: 'Выплата переводчику',
  wpoCoordinationRate: 'Комиссия WPO',
  mrpValue: 'МРП (в тысячах ₸)',
  courierFeeKzt: 'Курьер (₸)',
  printingFeeKzt: 'Печать (₸)',
  extraPaperCopyFeeKzt: 'Доп. копия (₸)',
  taxRate: 'Налог',
  acquiringRate: 'Halyk (эквайринг)',
  riskReserveRate: 'Риск',
  marketingRateDirect: 'Маркетинг/CAC',
  aiItRate: 'AI/IT',
  ownerReserveRate: 'Резерв владельцев',
  channelReserveRate: 'Канальный резерв',
  clientDiscountRate: 'Скидка клиенту (Referral)',
  partnerCommissionRate: 'Комиссия партнёру (fallback)',
  roundingStepOfficialKzt: 'Округление (official)',
  roundingStepNotaryKzt: 'Округление (notary)',
};

export interface CalculateFormState {
  pricingVersionCode: string;
  serviceLevel: ServiceLevel;
  sourceLanguage: string;
  targetLanguage: string;
  sourceCharacterCountWithSpaces: number;
  physicalPageCount: number;
  applicantType: 'individual' | 'legal_entity';
  fulfillmentMethod: 'pickup' | 'delivery';
  deliveryRequired: boolean;
  notaryUrgencyLevel: 'standard' | 'same_day';
  notaryUrgencyWindowOverride?: 'before_noon' | 'after_noon' | 'after_18';
  extraPaperCopies: number;
  salesChannel: 'direct' | 'referral';
  partnerId?: string;
  partnerCommissionRateOverride?: number;
  manualAdjustmentKzt: number;
  manualAdjustmentReason: string;
  languageRateOverrideKzt?: number;
  versionOverrides: VersionOverrides;
}

export const DEFAULT_FORM_STATE: CalculateFormState = {
  pricingVersionCode: '2026-Q3-KZ-NEWMODEL',
  serviceLevel: 'official_with_translator_signature_and_provider_stamp',
  sourceLanguage: 'ru',
  targetLanguage: 'en',
  sourceCharacterCountWithSpaces: 1800,
  physicalPageCount: 1,
  applicantType: 'individual',
  fulfillmentMethod: 'pickup',
  deliveryRequired: false,
  notaryUrgencyLevel: 'standard',
  extraPaperCopies: 0,
  salesChannel: 'direct',
  manualAdjustmentKzt: 0,
  manualAdjustmentReason: '',
  versionOverrides: {},
};

export interface PricingLabPreset {
  id: string;
  label: string;
  description: string;
  form: Partial<CalculateFormState>;
  expected?: Record<string, number | string>;
}

export const PRICING_LAB_PRESETS: PricingLabPreset[] = [
  {
    id: 'preset-1-official-direct',
    label: 'Preset 1: Official RU→EN, Direct',
    description: '1800 символов, 1 физ. страница, Direct',
    form: {
      serviceLevel: 'official_with_translator_signature_and_provider_stamp',
      sourceLanguage: 'ru', targetLanguage: 'en',
      sourceCharacterCountWithSpaces: 1800, physicalPageCount: 1,
      salesChannel: 'direct',
    },
    expected: { T: 3000, O: 100, W: 900, subtotal: 4000, retail: 7400, channelBudget: 1480, reconciliation: 0 },
  },
  {
    id: 'preset-2-notary-standard',
    label: 'Preset 2: Notary RU→EN, standard, no delivery',
    description: '1800 символов, физлицо, без доставки, standard, Direct',
    form: {
      serviceLevel: 'notarization_through_partners',
      sourceLanguage: 'ru', targetLanguage: 'en',
      sourceCharacterCountWithSpaces: 1800, physicalPageCount: 1,
      applicantType: 'individual', fulfillmentMethod: 'pickup', deliveryRequired: false,
      notaryUrgencyLevel: 'standard', salesChannel: 'direct',
    },
    expected: { N: 2292.25, W_base: 1587.675, subtotal: 6979.925, retail: 13000, channelBudget: 2600, reconciliation: 0 },
  },
  {
    id: 'preset-3-notary-urgent-delivery',
    label: 'Preset 3: Notary RU→EN, after_noon ×1.5, с доставкой',
    description: '1800 символов, физлицо, доставка, after_noon, Direct',
    form: {
      serviceLevel: 'notarization_through_partners',
      sourceLanguage: 'ru', targetLanguage: 'en',
      sourceCharacterCountWithSpaces: 1800, physicalPageCount: 1,
      applicantType: 'individual', fulfillmentMethod: 'delivery', deliveryRequired: true,
      notaryUrgencyLevel: 'same_day', notaryUrgencyWindowOverride: 'after_noon', salesChannel: 'direct',
    },
    expected: { C: 5000, W_final: 4631.5125, subtotal: 15023.7625, retail: 28000, channelBudget: 5600, reconciliation: 0 },
  },
  {
    id: 'preset-4-official-referral',
    label: 'Preset 4: Official RU→EN, Referral 10%',
    description: '1800 символов, Referral, комиссия партнёру 10%',
    form: {
      serviceLevel: 'official_with_translator_signature_and_provider_stamp',
      sourceLanguage: 'ru', targetLanguage: 'en',
      sourceCharacterCountWithSpaces: 1800, physicalPageCount: 1,
      salesChannel: 'referral', partnerCommissionRateOverride: 0.10,
    },
    expected: { retail: 7400, discount: 740, actualPayment: 6660, partnerCommission: 666, channelBudget: 1480, unusedChannelReserve: 74, reconciliation: 0 },
  },
  {
    id: 'preset-5-character-precision',
    label: 'Preset 5: Official RU→EN, 3366 символов',
    description: 'Проверка точного расчёта расчётных страниц (1.87 стр.)',
    form: {
      serviceLevel: 'official_with_translator_signature_and_provider_stamp',
      sourceLanguage: 'ru', targetLanguage: 'en',
      sourceCharacterCountWithSpaces: 3366, physicalPageCount: 1,
      salesChannel: 'direct',
    },
    expected: { translationPages: 1.87, T: 5610 },
  },
  {
    id: 'preset-6-stress-th-legal-referral',
    label: 'Preset 6: Notary RU→TH, юрлицо, доставка, after_18, Referral 10% (stress)',
    description: 'Большой документ, без захардкоженной ожидаемой цены — reconciliation должен быть 0',
    form: {
      serviceLevel: 'notarization_through_partners',
      sourceLanguage: 'ru', targetLanguage: 'th',
      sourceCharacterCountWithSpaces: 50000, physicalPageCount: 20,
      applicantType: 'legal_entity', fulfillmentMethod: 'delivery', deliveryRequired: true,
      notaryUrgencyLevel: 'same_day', notaryUrgencyWindowOverride: 'after_18',
      salesChannel: 'referral', partnerCommissionRateOverride: 0.10,
    },
    expected: { reconciliation: 0 },
  },
];
