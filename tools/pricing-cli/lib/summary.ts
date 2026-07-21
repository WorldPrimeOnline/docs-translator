/** Builds the batch-wide summary.csv / summary.json / summary.md from all per-file results. */
import { buildCsv } from './csv';
import type { FileResult } from './types';

export const SUMMARY_CSV_HEADERS = [
  'filename', 'status', 'analysis_method', 'physical_pages', 'characters_with_spaces',
  'character_pages', 'billable_translation_pages', 'translation_page_basis',
  'source_language', 'target_language', 'language_rate', 'service_level',
  'translation_amount', 'ocr', 'notary', 'courier', 'wpo_coordination',
  'component_subtotal', 'gross_up', 'standard_retail', 'urgency_multiplier', 'urgency_surcharge', 'retail', 'discount', 'actual_payment',
  'translator_payout', 'notary_payout', 'courier_payout', 'partner_commission',
  'internal_reserves', 'marginal_profit', 'margin', 'reconciliation', 'reason',
];

function summaryRow(fr: FileResult): Record<string, unknown> {
  const nm = fr.pricingResult?.newModel;
  return {
    filename: fr.filename,
    status: fr.status,
    analysis_method: fr.analysis?.method ?? '',
    // physical_pages/character_pages/billable_translation_pages/translation_page_basis all come
    // from the REAL calculator breakdown (nm), never from fr.analysis's pre-calculation estimate
    // (fr.analysis.translationPages = max(1, chars/1800) ignores physical pages entirely — that
    // ambiguity was the summary.csv bug: a sparse/table document that bills off physical pages
    // was showing its character-based estimate instead of the real billable page count).
    physical_pages: nm?.physicalPageCount ?? fr.analysis?.physicalPageCount ?? '',
    characters_with_spaces: fr.analysis?.charactersWithSpaces ?? '',
    character_pages: nm ? Number(nm.characterPages.toFixed(6)) : '',
    billable_translation_pages: nm ? Number(nm.billableTranslationPages.toFixed(6)) : '',
    translation_page_basis: nm?.translationPageBasis ?? '',
    source_language: fr.appliedParams?.sourceLanguage ?? '',
    target_language: fr.appliedParams?.targetLanguage ?? '',
    language_rate: nm?.ratePerTranslationPageKzt ?? '',
    service_level: fr.appliedParams?.serviceLevel ?? '',
    translation_amount: nm?.translationAmountKzt ?? '',
    ocr: nm?.ocrAmountKzt ?? '',
    notary: nm?.notaryAmountKzt ?? '',
    courier: nm?.courierAmountKzt ?? '',
    wpo_coordination: nm?.coordinationBaseAmountKzt ?? '',
    component_subtotal: nm?.componentSubtotalKzt ?? '',
    gross_up: nm?.grossUpAmountKzt ?? '',
    standard_retail: nm?.standardRetailKzt ?? '',
    urgency_multiplier: nm?.urgencyMultiplier ?? '',
    urgency_surcharge: nm?.urgencySurchargeKzt ?? '',
    retail: nm?.retailKzt ?? '',
    discount: nm?.clientDiscountKzt ?? '',
    actual_payment: nm?.actualPaymentKzt ?? '',
    translator_payout: nm?.translatorPayoutKzt ?? '',
    notary_payout: nm?.notaryPayoutKzt ?? '',
    courier_payout: nm?.courierPayoutKzt ?? '',
    partner_commission: nm?.partnerCommissionKzt ?? '',
    internal_reserves: nm?.totalInternalReservesKzt ?? '',
    marginal_profit: nm?.netProfitWpoKzt ?? '',
    margin: nm ? Number((nm.netMargin * 100).toFixed(2)) : '',
    reconciliation: nm?.reconciliationDifferenceKzt ?? '',
    reason: fr.reasons.join(' | '),
  };
}

export function buildSummaryCsv(results: FileResult[]): string {
  return buildCsv(SUMMARY_CSV_HEADERS, results.map(summaryRow));
}

export interface SummaryTotals {
  total: number;
  success: number;
  operatorReview: number;
  failed: number;
  totalRetailKzt: number;
  totalMarginalProfitKzt: number;
}

export function computeTotals(results: FileResult[]): SummaryTotals {
  let totalRetailKzt = 0;
  let totalMarginalProfitKzt = 0;
  let success = 0;
  let operatorReview = 0;
  let failed = 0;

  for (const fr of results) {
    if (fr.status === 'success') success += 1;
    else if (fr.status === 'operator_review') operatorReview += 1;
    else failed += 1;

    const nm = fr.pricingResult?.newModel;
    if (fr.status === 'success' && nm) {
      totalRetailKzt += nm.retailKzt;
      totalMarginalProfitKzt += nm.netProfitWpoKzt;
    }
  }

  return { total: results.length, success, operatorReview, failed, totalRetailKzt, totalMarginalProfitKzt };
}

export function buildSummaryJson(results: FileResult[]): string {
  return JSON.stringify({ totals: computeTotals(results), files: results.map(summaryRow) }, null, 2);
}

export function buildSummaryMarkdown(results: FileResult[]): string {
  const totals = computeTotals(results);
  const lines: string[] = [
    '# Сводный отчёт по папке',
    '',
    `- Всего файлов: ${totals.total}`,
    `- Успешно рассчитано: ${totals.success}`,
    `- Требуют проверки оператора: ${totals.operatorReview}`,
    `- Ошибка: ${totals.failed}`,
    `- Сумма retail (успешные): ${totals.totalRetailKzt.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₸`,
    `- Сумма маржинальной прибыли (успешные): ${totals.totalMarginalProfitKzt.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₸`,
    '',
    '| Файл | Статус | Метод | Страниц | Символов | Retail ₸ | Прибыль ₸ | Reconciliation |',
    '|---|---|---|---|---|---|---|---|',
  ];

  for (const fr of results) {
    const nm = fr.pricingResult?.newModel;
    lines.push(
      `| ${fr.filename} | ${fr.status} | ${fr.analysis?.method ?? '—'} | ${fr.analysis?.physicalPageCount ?? '—'} | ${fr.analysis?.charactersWithSpaces ?? '—'} | ${nm?.retailKzt ?? '—'} | ${nm?.netProfitWpoKzt ?? '—'} | ${nm ? (Math.abs(nm.reconciliationDifferenceKzt) < 0.01 ? 'OK' : `MISMATCH (${nm.reconciliationDifferenceKzt})`) : '—'} |`,
    );
  }

  return lines.join('\n') + '\n';
}
