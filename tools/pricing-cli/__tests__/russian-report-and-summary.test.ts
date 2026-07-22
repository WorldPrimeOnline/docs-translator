import { calculatePrice } from '@/lib/pricing/calculator';
import { DEFAULT_PRICING_VERSION, getDefaultLanguageRate } from '../lib/default-pricing-version';
import { buildRussianReport } from '../lib/russian-report';
import { buildSummaryCsv, buildSummaryJson, buildSummaryMarkdown, computeTotals, SUMMARY_CSV_HEADERS } from '../lib/summary';
import { computeExitCode } from '../lib/exit-code';
import type { FileResult, ResolvedFileParams } from '../lib/types';

const PARAMS: ResolvedFileParams = {
  pricingVersionCode: DEFAULT_PRICING_VERSION.code,
  pricingVersionSource: 'local',
  sourceLanguage: 'ru',
  targetLanguage: 'en',
  serviceLevel: 'notarization_through_partners',
  applicantType: 'individual',
  fulfillmentMethod: 'delivery',
  deliveryRequired: true,
  urgency: 'standard',
  extraPaperCopies: 0,
  salesChannel: 'direct',
  manualAdjustmentKzt: 0,
  versionOverrides: {},
};

function realSuccessResult(): FileResult {
  const languageRate = getDefaultLanguageRate(DEFAULT_PRICING_VERSION.id, 'ru', 'en')!;
  const pricingResult = calculatePrice(
    {
      sourceLanguage: 'ru', targetLanguage: 'en', serviceLevel: 'notarization_through_partners',
      sourceCharacterCountWithSpaces: 1800, physicalPageCount: 1,
      applicantType: 'individual', fulfillmentMethod: 'delivery', deliveryRequired: true,
      notaryUrgencyLevel: 'standard', salesChannel: 'direct', languageRate,
    },
    DEFAULT_PRICING_VERSION,
  );
  return {
    filename: 'passport.pdf',
    relativePath: 'passport.pdf',
    status: 'success',
    reasons: [],
    usedTemporaryOverrides: false,
    appliedParams: PARAMS,
    analysis: { method: 'pdf_text_layer', physicalPageCount: 1, charactersWithSpaces: 1800, translationPages: 1, fromCache: false },
    pricingResult,
    reconciliationOk: true,
  };
}

function realUrgentDeliveryReferralResult(): FileResult {
  const languageRate = getDefaultLanguageRate(DEFAULT_PRICING_VERSION.id, 'ru', 'en')!;
  const pricingResult = calculatePrice(
    {
      sourceLanguage: 'ru', targetLanguage: 'en', serviceLevel: 'notarization_through_partners',
      sourceCharacterCountWithSpaces: 1800, physicalPageCount: 1,
      applicantType: 'individual', fulfillmentMethod: 'delivery', deliveryRequired: true,
      notaryUrgencyLevel: 'standard', salesChannel: 'direct', languageRate,
    },
    DEFAULT_PRICING_VERSION,
  );
  // Force urgencyMultiplier without depending on wall-clock cutoff windows: build the report
  // input directly off a hand-modified newModel breakdown reflecting a ×1.5 after_noon order.
  const nm = pricingResult.newModel!;
  const urgentNm = {
    ...nm,
    urgencyMultiplier: 1.5,
    standardRetailKzt: nm.retailKzt,
    urgencySurchargeKzt: nm.retailKzt * 0.5,
    retailKzt: nm.retailKzt * 1.5,
  };
  return {
    filename: 'passport.pdf',
    relativePath: 'passport.pdf',
    status: 'success',
    reasons: [],
    usedTemporaryOverrides: false,
    appliedParams: PARAMS,
    analysis: { method: 'pdf_text_layer', physicalPageCount: 1, charactersWithSpaces: 1800, translationPages: 1, fromCache: false },
    pricingResult: { ...pricingResult, newModel: urgentNm },
    reconciliationOk: true,
  };
}

describe('buildRussianReport', () => {
  it('never leaks an English canonical enum value, a UUID, or raw JSON', () => {
    const report = buildRussianReport(realSuccessResult());
    expect(report).not.toContain('notarization_through_partners');
    expect(report).not.toContain('individual');
    expect(report).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    expect(report).not.toMatch(/[{}[\]]/);
  });

  it('renders the expected Russian section headers and labels', () => {
    const report = buildRussianReport(realSuccessResult());
    expect(report).toContain('ОТЧЁТ ПО ЦЕНЕ');
    expect(report).toContain('Файл:');
    expect(report).toContain('passport.pdf');
    expect(report).toContain('Анализ (до расчёта цены):');
    expect(report).toContain('Параметры заказа:');
    expect(report).toContain('Нотариальный перевод');
    expect(report).toContain('Физическое лицо');
    expect(report).toContain('Доставка');
    expect(report).toContain('Формирование клиентской цены:');
    expect(report).toContain('Внешние выплаты:');
    expect(report).toContain('Внутренние резервы:');
    expect(report).toContain('Результат:');
    expect(report).toContain('Reconciliation: сходится (0 ₸)');
  });

  it('2026-07-21 regression #19: shows the new page-basis fields, courier line, and whole-order urgency lines', () => {
    const report = buildRussianReport(realSuccessResult());
    // billable-page breakdown (spec: "Физических страниц; Страниц по символам; Оплачиваемых страниц; Основание расчёта")
    expect(report).toContain('Физических страниц:');
    expect(report).toContain('Страниц по символам:');
    expect(report).toContain('Оплачиваемых страниц:');
    expect(report).toContain('Основание расчёта:');
    // delivery must show the courier amount, not just the word "Доставка"
    // (ru-RU toLocaleString uses a non-breaking space as the thousands separator — match via \s)
    expect(report).toMatch(/- Курьер:\s*5\s*000,00\s*₸/);

    const urgentReport = buildRussianReport(realUrgentDeliveryReferralResult());
    expect(urgentReport).toContain('Стандартная цена заказа');
    expect(urgentReport).toContain('Множитель срочности: ×1,5');
    expect(urgentReport).toContain('Срочная надбавка:');
    expect(urgentReport).toContain('Retail со срочностью:');
    // the old (wrong) line that equated the surcharge to part of the WPO commission must be gone
    expect(urgentReport).not.toContain('Итоговая комиссия WPO');
  });

  it('notes when a temporary override was used', () => {
    const withOverride: FileResult = { ...realSuccessResult(), usedTemporaryOverrides: true };
    expect(buildRussianReport(withOverride)).toContain('Использована временная настройка');
  });

  it('renders a failed-file report with its reasons, not a price breakdown', () => {
    const failed: FileResult = {
      filename: 'bad.pdf', relativePath: 'bad.pdf', status: 'failed', reasonCode: 'corrupted_pdf',
      reasons: ['PDF is corrupted and could not be opened for analysis.'], usedTemporaryOverrides: false,
    };
    const report = buildRussianReport(failed);
    expect(report).toContain('ОШИБКА');
    expect(report).toContain('PDF is corrupted');
    expect(report).not.toContain('Формирование цены');
  });

  it('renders an operator_review report with its reasons, not a price breakdown', () => {
    const review: FileResult = {
      filename: 'scan.pdf', relativePath: 'scan.pdf', status: 'operator_review', reasonCode: 'no_text',
      reasons: ['No text could be extracted.'], usedTemporaryOverrides: false,
      analysis: { method: 'ocr', physicalPageCount: 1, charactersWithSpaces: 0, translationPages: 1, fromCache: false },
    };
    const report = buildRussianReport(review);
    expect(report).toContain('ТРЕБУЕТСЯ ПРОВЕРКА ОПЕРАТОРА');
    expect(report).not.toContain('Формирование цены');
  });
});

describe('summary builders', () => {
  const results = [realSuccessResult()];

  it('CSV has every required column from the spec', () => {
    const required = [
      'filename', 'status', 'analysis_method', 'physical_pages', 'characters_with_spaces',
      'character_pages', 'billable_translation_pages', 'translation_page_basis',
      'source_language', 'target_language', 'language_rate', 'service_level',
      'translation_amount', 'ocr', 'notary', 'courier', 'wpo_coordination',
      'component_subtotal', 'gross_up', 'standard_retail', 'urgency_multiplier', 'urgency_surcharge', 'retail', 'discount', 'actual_payment',
      'translator_payout', 'notary_payout', 'courier_payout', 'partner_commission',
      'internal_reserves', 'marginal_profit', 'margin', 'reconciliation', 'reason',
    ];
    for (const col of required) expect(SUMMARY_CSV_HEADERS).toContain(col);
    expect(SUMMARY_CSV_HEADERS).not.toContain('translation_pages'); // ambiguous column, removed 2026-07-22

    const csv = buildSummaryCsv(results);
    expect(csv.split('\n')[0]).toBe(SUMMARY_CSV_HEADERS.join(','));
    expect(csv).toContain('passport.pdf');
  });

  it('2026-07-22 regression: sparse/table document (physical pages win) reports physical_pages/character_pages/billable_translation_pages separately, not conflated', () => {
    const languageRate = getDefaultLanguageRate(DEFAULT_PRICING_VERSION.id, 'ru', 'en')!;
    const pricingResult = calculatePrice(
      {
        sourceLanguage: 'ru', targetLanguage: 'en',
        serviceLevel: 'official_with_translator_signature_and_provider_stamp',
        sourceCharacterCountWithSpaces: 671, physicalPageCount: 2,
        salesChannel: 'direct', languageRate,
      },
      DEFAULT_PRICING_VERSION,
    );
    const fr: FileResult = {
      filename: 'sparse-table.pdf', relativePath: 'sparse-table.pdf', status: 'success', reasons: [],
      usedTemporaryOverrides: false, appliedParams: PARAMS,
      analysis: { method: 'pdf_text_layer', physicalPageCount: 2, charactersWithSpaces: 671, translationPages: 1, fromCache: false },
      pricingResult, reconciliationOk: true,
    };
    const row = JSON.parse(buildSummaryJson([fr])).files[0];
    expect(row.physical_pages).toBe(2);
    expect(row.character_pages).toBeCloseTo(0.372778, 5);
    expect(row.billable_translation_pages).toBe(2);
    expect(row.translation_page_basis).toBe('physical_pages');
  });

  it('JSON includes totals and per-file rows', () => {
    const json = JSON.parse(buildSummaryJson(results));
    expect(json.totals.total).toBe(1);
    expect(json.totals.success).toBe(1);
    expect(json.files[0].filename).toBe('passport.pdf');
  });

  it('markdown includes a totals section and a per-file table row', () => {
    const md = buildSummaryMarkdown(results);
    expect(md).toContain('Сводный отчёт');
    expect(md).toContain('passport.pdf');
  });

  it('computeTotals sums retail/profit only for successful files', () => {
    const failed: FileResult = { filename: 'x', relativePath: 'x', status: 'failed', reasons: [], usedTemporaryOverrides: false };
    const totals = computeTotals([...results, failed]);
    expect(totals.total).toBe(2);
    expect(totals.success).toBe(1);
    expect(totals.failed).toBe(1);
    expect(totals.totalRetailKzt).toBe(results[0].pricingResult!.newModel!.retailKzt);
  });
});

describe('computeExitCode', () => {
  const success: FileResult = { filename: 'a', relativePath: 'a', status: 'success', reasons: [], usedTemporaryOverrides: false };
  const review: FileResult = { filename: 'b', relativePath: 'b', status: 'operator_review', reasons: [], usedTemporaryOverrides: false };
  const failed: FileResult = { filename: 'c', relativePath: 'c', status: 'failed', reasons: [], usedTemporaryOverrides: false };

  it('0 when everything succeeds', () => expect(computeExitCode([success, success])).toBe(0));
  it('1 when anything failed (even alongside operator_review)', () => expect(computeExitCode([success, review, failed])).toBe(1));
  it('2 when only operator_review, no failures', () => expect(computeExitCode([success, review])).toBe(2));
});
