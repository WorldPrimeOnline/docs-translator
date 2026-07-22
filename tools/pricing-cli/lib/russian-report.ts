/**
 * Russian-language financial report renderer for the CLI's local `.report.md` — thin wrapper
 * around the shared FinancialReportModel (src/lib/pricing/financial-report.ts, 2026-07-22),
 * which also backs the Jira pricing breakdown description (worker/src/lib/jira/financial-report.ts
 * + price-breakdown.ts). Only CLI-specific framing stays here: the file header, the
 * pre-pricing local-cache analysis summary (--no-cache/fromCache — meaningless to Jira), a
 * temporary-overrides note, and the failed/operator_review early-return reports, none of which
 * apply to a real order's Jira breakdown (which only ever exists for a successfully-priced quote).
 * Blocks 1-6 (document analysis / order parameters / price formation / payouts / reserves /
 * result) come from renderPricingReportMarkdown() — never re-implemented here.
 *
 * No English enum values, UUIDs, or debug JSON ever appear in the output.
 */
import { buildFinancialReportModel, renderPricingReportMarkdown, fmtNum } from '@/lib/pricing/financial-report';
import type { FileResult, ResolvedFileParams } from './types';

const METHOD_RU: Record<string, string> = {
  docx_text: 'DOCX (текст извлечён напрямую)',
  pdf_text_layer: 'PDF (текстовый слой)',
  ocr: 'OCR',
  manual: 'Ручной ввод',
};

function overridesNoteRu(usedTemporaryOverrides: boolean): string {
  return usedTemporaryOverrides ? '_Использована временная настройка (не сохранена в pricing_versions)._' : '';
}

/** CLI-specific pre-pricing summary — --no-cache/fromCache have no Jira equivalent. */
function analysisSectionRu(fr: FileResult): string[] {
  if (!fr.analysis) return [];
  return [
    'Анализ (до расчёта цены):',
    `- Метод: ${METHOD_RU[fr.analysis.method] ?? fr.analysis.method}`,
    `- Физических страниц: ${fr.analysis.physicalPageCount ?? '— (не удалось определить без рендеринга; см. --manual-physical-pages)'}`,
    `- Символов с пробелами: ${fmtNum(fr.analysis.charactersWithSpaces)}`,
    `- Расчётных страниц: ${fmtNum(fr.analysis.translationPages, 2)}`,
    fr.analysis.fromCache ? '- (результат из локального кэша)' : '',
    '',
  ].filter((l, i, arr) => l !== '' || i !== arr.length - 1);
}

function buildModelFromFileResult(fr: FileResult, params: ResolvedFileParams) {
  const pricingResult = fr.pricingResult!;
  return buildFinancialReportModel({
    nm: pricingResult.newModel,
    legacyAmountKzt: pricingResult.amountKzt,
    filename: fr.filename,
    analysisMethod: fr.analysis?.method,
    physicalPageCount: fr.analysis?.physicalPageCount,
    charactersWithSpaces: fr.analysis?.charactersWithSpaces,
    sourceLanguage: params.sourceLanguage,
    targetLanguage: params.targetLanguage,
    serviceLevel: params.serviceLevel,
    applicantType: params.applicantType,
    deliveryRequired: params.deliveryRequired,
    salesChannel: params.salesChannel,
  });
}

export function buildRussianReport(fr: FileResult): string {
  const lines: string[] = ['ОТЧЁТ ПО ЦЕНЕ', '', 'Файл:', fr.filename, ''];

  if (fr.status === 'failed') {
    lines.push('Статус: ОШИБКА — файл не рассчитан.');
    lines.push('');
    lines.push('Причины:');
    for (const r of fr.reasons) lines.push(`- ${r}`);
    return lines.join('\n');
  }

  lines.push(...analysisSectionRu(fr));

  if (fr.status === 'operator_review') {
    lines.push('Статус: ТРЕБУЕТСЯ ПРОВЕРКА ОПЕРАТОРА.');
    lines.push('');
    lines.push('Причины:');
    for (const r of fr.reasons) lines.push(`- ${r}`);
    return lines.join('\n');
  }

  // Defensive backstop only — status:'success' must always carry a pricingResult by
  // construction (lib/pricing-run.ts). --dry-run never reaches this function at all (index.ts
  // handles it separately via lib/dry-run.ts); this guard exists so a future bug here fails
  // with a controlled report instead of a TypeError crashing the whole batch.
  if (!fr.pricingResult) {
    lines.push('Статус: ВНУТРЕННЯЯ ОШИБКА ОТЧЁТА — расчёт цены отсутствует для статуса "success".');
    lines.push('');
    lines.push('Причины:');
    lines.push('- pricingResult отсутствует; отчёт не может быть построен.');
    return lines.join('\n');
  }

  if (!fr.appliedParams) return lines.join('\n');

  const model = buildModelFromFileResult(fr, fr.appliedParams);
  const overridesNote = overridesNoteRu(fr.usedTemporaryOverrides);
  if (overridesNote) lines.push(overridesNote, '');

  lines.push(renderPricingReportMarkdown(model));
  return lines.join('\n');
}
