/**
 * Tests for the shared FinancialReportModel (financial-report.ts, 2026-07-22) — the canonical
 * source for both the CLI's local .report.md (tools/pricing-cli/lib/russian-report.ts) and the
 * Jira pricing breakdown description (worker/src/lib/jira/price-breakdown.ts, via its synced
 * copy worker/src/lib/jira/financial-report.ts).
 */
import { buildFinancialReportModel, renderPricingReportMarkdown, renderPricingReportForJira } from '../financial-report';
import { calculatePrice } from '../calculator';
import type { PricingInput, PricingLanguageRate, PricingVersion } from '../types';

function mockNewModelVersion(overrides: Partial<PricingVersion> = {}): PricingVersion {
  return {
    id: 'v-newmodel', code: '2026-Q3-KZ-NEWMODEL', status: 'draft', currency: 'KZT',
    internalFxRate: null, mrpValue: 4.325,
    taxRate: 0.03, acquiringRate: 0.025, riskReserveRate: 0.05, ownerReserveRate: 0.00,
    marketingRateDirect: 0.05, partnerCommissionRate: 0.10, targetProfitRate: 0.25,
    aiItReservePerPageKzt: 100,
    validFrom: '2026-07-17', validTo: null, metadata: { formula_version: 'new_2026_07_21' },
    aiItRate: 0.10, channelReserveRate: 0.20, clientDiscountRate: 0.10, wpoCoordinationRate: 0.30,
    translatorPayoutRate: 0.30, ocrRatePerPhysicalPageKzt: 100, courierFeeKzt: 5000,
    printingFeeKzt: 0, extraPaperCopyFeeKzt: 0, roundingStepOfficialKzt: 100, roundingStepNotaryKzt: 500,
    publicElectronicPriceKzt: null, publicOfficialMinPriceKzt: null, publicNotaryMinPriceKzt: null,
    ...overrides,
  };
}

function mockLanguageRate(overrides: Partial<PricingLanguageRate> = {}): PricingLanguageRate {
  return {
    id: 'rate-ru-en', pricingVersionId: 'v-newmodel', sourceLanguage: 'ru', targetLanguage: 'en', rateKztPerTranslationPage: 3000, active: true, requiresOperatorReview: false,
    resolution: {
      sourceBaseRate: null,
      targetBaseRate: { language: 'en', rateId: 'rate-ru-en', rateKztPerTranslationPage: 3000, active: true, requiresOperatorReview: false },
      winningSide: 'target',
    },
    ...overrides,
  };
}

function notaryInput(overrides: Partial<PricingInput> = {}): PricingInput {
  return {
    sourceLanguage: 'ru', targetLanguage: 'en', serviceLevel: 'notarization_through_partners',
    sourceCharacterCountWithSpaces: 1800, physicalPageCount: 1,
    applicantType: 'individual', fulfillmentMethod: 'delivery', deliveryRequired: true,
    notaryUrgencyLevel: 'standard', salesChannel: 'direct', languageRate: mockLanguageRate(),
    ...overrides,
  };
}

describe('FinancialReportModel — Russian markdown renderer', () => {
  it('renders all 6 blocks with real computed numbers (Fixture C: notary + delivery + standard)', () => {
    const result = calculatePrice(notaryInput(), mockNewModelVersion());
    const nm = result.newModel!;
    const model = buildFinancialReportModel({
      nm, legacyAmountKzt: result.amountKzt,
      filename: 'passport.pdf', analysisMethod: 'pdf_text_layer', physicalPageCount: 1, charactersWithSpaces: 1800,
      sourceLanguage: 'ru', targetLanguage: 'en', serviceLevel: 'notarization_through_partners',
      applicantType: 'individual', deliveryRequired: true, salesChannel: 'direct',
    });

    const report = renderPricingReportMarkdown(model);

    expect(report).toContain('Анализ документа:');
    expect(report).toContain('Параметры заказа:');
    expect(report).toContain('Формирование клиентской цены:');
    expect(report).toContain('Внешние выплаты:');
    expect(report).toContain('Внутренние резервы:');
    expect(report).toContain('Результат:');
    expect(report).toContain('Курьер: 5 000,00 ₸'); // delivery: courier line present
    expect(report).toContain('Reconciliation: сходится (0 ₸)');
    expect(report).not.toContain('чистая прибыль'); // never "net profit" wording
    expect(report).not.toMatch(/[{}[\]]/); // no raw JSON/debug dump
  });

  it('applies the whole-order urgency multiplier and shows both standard and urgent prices', () => {
    const result = calculatePrice(notaryInput({ deliveryRequired: false, fulfillmentMethod: 'pickup' }), mockNewModelVersion());
    const nm = { ...result.newModel!, urgencyMultiplier: 1.5, standardRetailKzt: result.newModel!.retailKzt, urgencySurchargeKzt: result.newModel!.retailKzt * 0.5, retailKzt: result.newModel!.retailKzt * 1.5 };
    const model = buildFinancialReportModel({
      nm, legacyAmountKzt: result.amountKzt,
      sourceLanguage: 'ru', targetLanguage: 'en', serviceLevel: 'notarization_through_partners',
      applicantType: 'individual', deliveryRequired: false, salesChannel: 'direct',
    });

    const report = renderPricingReportMarkdown(model);
    expect(report).toContain('Множитель срочности: ×1,5');
    expect(report).toContain('Срочная надбавка:');
    expect(report).toContain('Retail со срочностью:');
  });

  it('electronic (nm undefined) renders only the legacy-amount fallback, no NewModelBreakdown sections', () => {
    const model = buildFinancialReportModel({
      nm: undefined, legacyAmountKzt: 5000,
      sourceLanguage: 'ru', targetLanguage: 'en', serviceLevel: 'electronic', salesChannel: 'direct',
    });

    const report = renderPricingReportMarkdown(model);
    expect(report).toContain('Итоговая цена: 5 000,00 ₸');
    expect(report).not.toContain('Формирование клиентской цены');
  });
});

describe('FinancialReportModel — Jira ADF renderer', () => {
  it('produces a valid ADF document with the same 6 blocks as an ADF heading structure', () => {
    const result = calculatePrice(notaryInput(), mockNewModelVersion());
    const model = buildFinancialReportModel({
      nm: result.newModel!, legacyAmountKzt: result.amountKzt,
      sourceLanguage: 'ru', targetLanguage: 'en', serviceLevel: 'notarization_through_partners',
      applicantType: 'individual', deliveryRequired: true, salesChannel: 'direct',
    });

    const adf = renderPricingReportForJira(model, 'WO-123') as { version: number; type: string; content: Record<string, unknown>[] };

    expect(adf.version).toBe(1);
    expect(adf.type).toBe('doc');
    const headingTexts = adf.content
      .filter((n) => n.type === 'heading')
      .map((n) => (n.content as Array<{ text: string }>)[0]?.text);
    expect(headingTexts).toEqual([
      'Расчёт стоимости заказа WO-123',
      'Документ и анализ',
      'Параметры заказа',
      'Формирование клиентской цены',
      'Внешние выплаты',
      'Внутренние резервы',
      'Результат',
    ]);
  });
});
