#!/usr/bin/env npx tsx
/**
 * npm run pricing:fixtures — the 6 WPO-approved worked-example scenarios, salvaged from the
 * deleted Pricing Lab web tool's PRICING_LAB_PRESETS (git a24b45bf,
 * src/app/[locale]/internal/pricing-lab/types.ts). Console fixtures only, no UI, no files —
 * calculatePrice() is called directly against the built-in local default pricing version.
 */
import { calculatePrice } from '@/lib/pricing/calculator';
import type { NewModelBreakdown, PricingInput } from '@/lib/pricing/types';
import { DEFAULT_PRICING_VERSION, getDefaultLanguageRate } from './lib/default-pricing-version';
import { buildNowOverride } from './lib/alias-map';

interface Fixture {
  id: string;
  label: string;
  description: string;
  input: Partial<PricingInput> & Pick<PricingInput, 'sourceLanguage' | 'targetLanguage' | 'serviceLevel'>;
  notaryUrgencyWindowOverride?: 'before_noon' | 'after_noon' | 'after_18';
  expected?: Partial<Record<keyof NewModelBreakdown | 'translationPages', number>>;
}

const FIXTURES: Fixture[] = [
  {
    id: 'preset-1-official-direct',
    label: 'Preset 1: Official RU→EN, Direct',
    description: '1800 символов, 1 физ. страница, Direct',
    input: {
      sourceLanguage: 'ru', targetLanguage: 'en',
      serviceLevel: 'official_with_translator_signature_and_provider_stamp',
      sourceCharacterCountWithSpaces: 1800, physicalPageCount: 1,
      salesChannel: 'direct',
    },
    expected: { translationAmountKzt: 3000, ocrAmountKzt: 100, coordinationBaseAmountKzt: 900, componentSubtotalKzt: 4000, retailKzt: 7400, reconciliationDifferenceKzt: 0 },
  },
  {
    id: 'preset-2-notary-standard',
    label: 'Preset 2: Notary RU→EN, standard, no delivery',
    description: '1800 символов, физлицо, без доставки, standard, Direct',
    input: {
      sourceLanguage: 'ru', targetLanguage: 'en',
      serviceLevel: 'notarization_through_partners',
      sourceCharacterCountWithSpaces: 1800, physicalPageCount: 1,
      applicantType: 'individual', fulfillmentMethod: 'pickup', deliveryRequired: false,
      notaryUrgencyLevel: 'standard', salesChannel: 'direct',
    },
    expected: { notaryAmountKzt: 2292.25, componentSubtotalKzt: 6979.925, retailKzt: 13000, reconciliationDifferenceKzt: 0 },
  },
  {
    id: 'preset-3-notary-urgent-delivery',
    label: 'Preset 3: Notary RU→EN, after_noon ×1.5, с доставкой',
    description: '1800 символов, физлицо, доставка, after_noon, Direct (2026-07-21: courier now enters W base; urgency now multiplies the whole standard retail, not just W)',
    input: {
      sourceLanguage: 'ru', targetLanguage: 'en',
      serviceLevel: 'notarization_through_partners',
      sourceCharacterCountWithSpaces: 1800, physicalPageCount: 1,
      applicantType: 'individual', fulfillmentMethod: 'delivery', deliveryRequired: true,
      notaryUrgencyLevel: 'same_day', salesChannel: 'direct',
    },
    notaryUrgencyWindowOverride: 'after_noon',
    expected: {
      courierAmountKzt: 5000,
      coordinationBaseAmountKzt: 3087.675,
      componentSubtotalKzt: 13479.925,
      standardRetailKzt: 25000,
      urgencyMultiplier: 1.5,
      urgencySurchargeKzt: 12500,
      retailKzt: 37500,
      reconciliationDifferenceKzt: 0,
    },
  },
  {
    id: 'preset-4-official-referral',
    label: 'Preset 4: Official RU→EN, Referral 10%',
    description: '1800 символов, Referral, комиссия партнёру 10%',
    input: {
      sourceLanguage: 'ru', targetLanguage: 'en',
      serviceLevel: 'official_with_translator_signature_and_provider_stamp',
      sourceCharacterCountWithSpaces: 1800, physicalPageCount: 1,
      salesChannel: 'referral', partnerCommissionRateOverride: 0.10,
    },
    expected: { retailKzt: 7400, clientDiscountKzt: 740, actualPaymentKzt: 6660, partnerCommissionKzt: 666, unusedChannelReserveKzt: 74, reconciliationDifferenceKzt: 0 },
  },
  {
    id: 'preset-5-character-precision',
    label: 'Preset 5: Official RU→EN, 3366 символов (= spec Fixture B)',
    description: 'Проверка точного расчёта расчётных страниц (1.87 стр., 1 физ. страница — символы побеждают)',
    input: {
      sourceLanguage: 'ru', targetLanguage: 'en',
      serviceLevel: 'official_with_translator_signature_and_provider_stamp',
      sourceCharacterCountWithSpaces: 3366, physicalPageCount: 1,
      salesChannel: 'direct',
    },
    expected: { translationPages: 1.87, translationAmountKzt: 5610, characterPages: 1.87, billableTranslationPages: 1.87 },
  },
  {
    id: 'preset-6-stress-th-legal-referral',
    label: 'Preset 6: Notary RU→TH, юрлицо, доставка, after_18, Referral 10% (stress)',
    description: 'Большой документ, без захардкоженной ожидаемой цены — reconciliation должен быть 0',
    input: {
      sourceLanguage: 'ru', targetLanguage: 'th',
      serviceLevel: 'notarization_through_partners',
      sourceCharacterCountWithSpaces: 50000, physicalPageCount: 20,
      applicantType: 'legal_entity', fulfillmentMethod: 'delivery', deliveryRequired: true,
      notaryUrgencyLevel: 'same_day', salesChannel: 'referral', partnerCommissionRateOverride: 0.10,
    },
    notaryUrgencyWindowOverride: 'after_18',
    expected: { reconciliationDifferenceKzt: 0 },
  },
  {
    id: 'fixture-a-physical-pages-win',
    label: 'Fixture A: Official RU→EN, 671 символов, 2 физ. страницы — физические страницы побеждают',
    description: 'characterPages≈0.3728 < 2 физ. страницы → оплачиваемых страниц = 2 (2026-07-21 formula rewrite)',
    input: {
      sourceLanguage: 'ru', targetLanguage: 'en',
      serviceLevel: 'official_with_translator_signature_and_provider_stamp',
      sourceCharacterCountWithSpaces: 671, physicalPageCount: 2,
      salesChannel: 'direct',
    },
    expected: {
      characterPages: 0.372777,
      billableTranslationPages: 2,
      translationAmountKzt: 6000,
      ocrAmountKzt: 200,
      coordinationBaseAmountKzt: 1800,
      componentSubtotalKzt: 8000,
      retailKzt: 14700,
      reconciliationDifferenceKzt: 0,
    },
  },
  {
    id: 'fixture-c-notary-delivery-standard',
    label: 'Fixture C: Notary RU→EN, standard, с доставкой',
    description: 'deliveryRequired=true → fulfillmentMethod=delivery, courier=5000 входит в базу комиссии WPO',
    input: {
      sourceLanguage: 'ru', targetLanguage: 'en',
      serviceLevel: 'notarization_through_partners',
      sourceCharacterCountWithSpaces: 1800, physicalPageCount: 1,
      applicantType: 'individual', fulfillmentMethod: 'delivery', deliveryRequired: true,
      notaryUrgencyLevel: 'standard', salesChannel: 'direct',
    },
    expected: {
      courierAmountKzt: 5000,
      coordinationBaseAmountKzt: 3087.675,
      componentSubtotalKzt: 13479.925,
      standardRetailKzt: 25000,
      urgencyMultiplier: 1,
      urgencySurchargeKzt: 0,
      retailKzt: 25000,
      reconciliationDifferenceKzt: 0,
    },
  },
  {
    id: 'fixture-d-notary-delivery-after-noon',
    label: 'Fixture D: тот же заказ, что и Fixture C, но after_noon (×1.5)',
    description: 'retail = standard retail (25000) × 1.5 = 37500 — срочность умножает ВЕСЬ заказ',
    input: {
      sourceLanguage: 'ru', targetLanguage: 'en',
      serviceLevel: 'notarization_through_partners',
      sourceCharacterCountWithSpaces: 1800, physicalPageCount: 1,
      applicantType: 'individual', fulfillmentMethod: 'delivery', deliveryRequired: true,
      notaryUrgencyLevel: 'same_day', salesChannel: 'direct',
    },
    notaryUrgencyWindowOverride: 'after_noon',
    expected: { standardRetailKzt: 25000, urgencyMultiplier: 1.5, urgencySurchargeKzt: 12500, retailKzt: 37500, reconciliationDifferenceKzt: 0 },
  },
  {
    id: 'fixture-d-notary-delivery-after-18',
    label: 'Fixture D (продолжение): тот же заказ, after_18 (×2)',
    description: 'retail = standard retail (25000) × 2 = 50000',
    input: {
      sourceLanguage: 'ru', targetLanguage: 'en',
      serviceLevel: 'notarization_through_partners',
      sourceCharacterCountWithSpaces: 1800, physicalPageCount: 1,
      applicantType: 'individual', fulfillmentMethod: 'delivery', deliveryRequired: true,
      notaryUrgencyLevel: 'same_day', salesChannel: 'direct',
    },
    notaryUrgencyWindowOverride: 'after_18',
    expected: { standardRetailKzt: 25000, urgencyMultiplier: 2, urgencySurchargeKzt: 25000, retailKzt: 50000, reconciliationDifferenceKzt: 0 },
  },
  {
    id: 'fixture-e-urgent-referral',
    label: 'Fixture E: Notary RU→EN, доставка, after_noon, Referral 10%',
    description: 'Скидка/партнёрская комиссия считаются от urgent retail (37500), после срочности',
    input: {
      sourceLanguage: 'ru', targetLanguage: 'en',
      serviceLevel: 'notarization_through_partners',
      sourceCharacterCountWithSpaces: 1800, physicalPageCount: 1,
      applicantType: 'individual', fulfillmentMethod: 'delivery', deliveryRequired: true,
      notaryUrgencyLevel: 'same_day', salesChannel: 'referral', partnerCommissionRateOverride: 0.10,
    },
    notaryUrgencyWindowOverride: 'after_noon',
    expected: {
      retailKzt: 37500,
      clientDiscountKzt: 3750,
      actualPaymentKzt: 33750,
      partnerCommissionKzt: 3375,
      reconciliationDifferenceKzt: 0,
    },
  },
];

const TOLERANCE = 0.01;

function runFixture(fixture: Fixture): { ok: boolean; failures: string[] } {
  const languageRate = getDefaultLanguageRate(DEFAULT_PRICING_VERSION.id, fixture.input.sourceLanguage, fixture.input.targetLanguage) ?? undefined;

  const input: PricingInput = {
    ...fixture.input,
    languageRate,
    nowOverride: buildNowOverride(fixture.notaryUrgencyWindowOverride),
  };

  const result = calculatePrice(input, DEFAULT_PRICING_VERSION);
  const nm = result.newModel;
  const failures: string[] = [];

  if (result.requiresOperatorReview) {
    failures.push(`unexpected requiresOperatorReview: ${result.reviewReasons.join('; ')}`);
  }

  if (fixture.expected) {
    for (const [key, expectedValue] of Object.entries(fixture.expected)) {
      const actual = key === 'translationPages'
        ? result.context.translationPageCountExact
        : nm?.[key as keyof NewModelBreakdown];
      if (typeof actual !== 'number' || Math.abs(actual - expectedValue) > TOLERANCE) {
        failures.push(`${key}: expected ${expectedValue}, got ${actual}`);
      }
    }
  }

  return { ok: failures.length === 0, failures };
}

export function runAllFixtures(): { fixture: Fixture; ok: boolean; failures: string[] }[] {
  return FIXTURES.map((fixture) => ({ fixture, ...runFixture(fixture) }));
}

function main(): void {
  console.log('WPO Pricing CLI — approved fixtures (calculatePrice() called directly, no files, no DB writes)\n');

  let allOk = true;
  for (const fixture of FIXTURES) {
    const { ok, failures } = runFixture(fixture);
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${fixture.label}`);
    console.log(`      ${fixture.description}`);
    for (const f of failures) console.log(`      ✗ ${f}`);
    if (!ok) allOk = false;
  }

  console.log('');
  console.log(allOk ? 'All fixtures passed.' : 'Some fixtures FAILED.');
  process.exit(allOk ? 0 : 1);
}

if (require.main === module) main();
