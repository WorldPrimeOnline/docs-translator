/**
 * Canonical financial report model + renderers for the new-model formula (2026-07-21).
 *
 * ONE normalized model (FinancialReportModel), TWO renderers (Russian markdown for the CLI's
 * local `.report.md`, ADF for the Jira pricing breakdown description) — replacing what used to
 * be independent, drifting re-implementations (tools/pricing-cli/lib/russian-report.ts and
 * worker/src/lib/jira/price-breakdown.ts each hand-rolled their own field extraction from either
 * NewModelBreakdown directly or raw price_quotes/price_quote_items/cost_reservations rows).
 *
 * Worker cannot import this file directly (separate build, no access to src/ — same convention
 * documented in CLAUDE.md for output-plan.ts/visual-elements.ts/etc.) — see
 * worker/src/lib/jira/financial-report.ts for the synced copy. Keep the two in sync manually;
 * the worker copy's docblock points back here.
 *
 * Never parses a rendered report back out — Jira/CLI/JSON snapshot all come from this one model,
 * not from each other's rendered text.
 */
import type { LanguagePairBaseRate, NewModelBreakdown, SalesChannel, ServiceLevel, TranslationPageBasis } from './types';
import type { TranslationTierBreakdownEntry } from './coordination-tiers';

export interface FinancialReportModel {
  document: {
    filename: string | null;
    analysisMethod: string | null;
    physicalPageCount: number | null;
    charactersWithSpaces: number | null;
  };
  order: {
    sourceLanguage: string;
    targetLanguage: string;
    serviceLevel: ServiceLevel;
    applicantType?: 'individual' | 'legal_entity';
    deliveryRequired: boolean;
    salesChannel: SalesChannel;
  };
  /** undefined only for the legacy electronic formula, which has no NewModelBreakdown. */
  nm: NewModelBreakdown | undefined;
  /** pricingResult.amountKzt — used only when nm is undefined (electronic). */
  legacyAmountKzt: number;
}

export function buildFinancialReportModel(input: {
  nm: NewModelBreakdown | undefined;
  legacyAmountKzt: number;
  filename?: string | null;
  analysisMethod?: string | null;
  physicalPageCount?: number | null;
  charactersWithSpaces?: number | null;
  sourceLanguage: string;
  targetLanguage: string;
  serviceLevel: ServiceLevel;
  applicantType?: 'individual' | 'legal_entity';
  deliveryRequired?: boolean;
  salesChannel: SalesChannel;
}): FinancialReportModel {
  return {
    document: {
      filename: input.filename ?? null,
      analysisMethod: input.analysisMethod ?? null,
      physicalPageCount: input.physicalPageCount ?? null,
      charactersWithSpaces: input.charactersWithSpaces ?? null,
    },
    order: {
      sourceLanguage: input.sourceLanguage,
      targetLanguage: input.targetLanguage,
      serviceLevel: input.serviceLevel,
      applicantType: input.applicantType,
      deliveryRequired: input.deliveryRequired ?? false,
      salesChannel: input.salesChannel,
    },
    nm: input.nm,
    legacyAmountKzt: input.legacyAmountKzt,
  };
}

// ─── Shared Russian vocabulary ──────────────────────────────────────────────────

export const SERVICE_LEVEL_RU: Record<ServiceLevel, string> = {
  electronic: 'Электронный перевод',
  official_with_translator_signature_and_provider_stamp: 'Официальный перевод (подпись переводчика и печать бюро)',
  notarization_through_partners: 'Нотариальный перевод',
};

export const METHOD_RU: Record<string, string> = {
  docx_text: 'DOCX (текст извлечён напрямую)',
  pdf_text_layer: 'PDF (текстовый слой)',
  ocr: 'OCR',
  manual: 'Ручной ввод',
};

export const TRANSLATION_PAGE_BASIS_RU: Record<TranslationPageBasis, string> = {
  minimum_one_page: 'минимум 1 страница',
  physical_pages: 'физические страницы',
  character_count: 'количество символов',
};

// ─── Number formatting (shared by both renderers) ───────────────────────────────

export function fmtKzt(n: number | undefined | null): string {
  if (n == null) return '—';
  return n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₸';
}

export function fmtPct(n: number): string {
  return (n * 100).toLocaleString('ru-RU', { maximumFractionDigits: 2 }) + '%';
}

export function fmtNum(n: number, digits = 0): string {
  return n.toLocaleString('ru-RU', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** Whole numbers print bare; fractional page counts print with up to 6 decimals (no trailing zeros). */
export function fmtPages(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 6 });
}

function urgencyLineRu(nm: NewModelBreakdown | undefined): string | null {
  if (!nm) return null;
  if (nm.urgencyMultiplier <= 1) return null;
  return `Срочность +${fmtNum((nm.urgencyMultiplier - 1) * 100)}%`;
}

/** Block 2 — order parameters, as a flat list of lines (no leading "- ", callers prefix that). */
export function orderParamsLinesRu(model: FinancialReportModel): string[] {
  const { order, nm } = model;
  const lines: string[] = [];
  lines.push(`${order.sourceLanguage.toUpperCase()} → ${order.targetLanguage.toUpperCase()}`);
  lines.push(SERVICE_LEVEL_RU[order.serviceLevel]);
  if (order.applicantType) lines.push(order.applicantType === 'individual' ? 'Физическое лицо' : 'Юридическое лицо');
  lines.push(order.deliveryRequired ? 'Доставка' : 'Самовывоз');
  const urgencyLine = urgencyLineRu(nm);
  if (urgencyLine) lines.push(urgencyLine);
  lines.push(order.salesChannel === 'referral' ? 'Реферальный (партнёрский) заказ' : 'Прямой заказ');
  return lines;
}

/** Block 1 — document/analysis, as a flat list of lines. */
export function documentAnalysisLinesRu(model: FinancialReportModel): string[] {
  const { document: d, nm } = model;
  const lines: string[] = [];
  if (d.filename) lines.push(`Файл: ${d.filename}`);
  if (d.analysisMethod) lines.push(`Метод: ${METHOD_RU[d.analysisMethod] ?? d.analysisMethod}`);
  lines.push(`Физических страниц: ${(nm?.physicalPageCount ?? d.physicalPageCount) != null ? String(nm?.physicalPageCount ?? d.physicalPageCount) : '—'}`);
  if (d.charactersWithSpaces != null) lines.push(`Символов с пробелами: ${fmtNum(d.charactersWithSpaces)}`);
  if (nm) {
    lines.push(`Страниц по символам: ${fmtPages(nm.characterPages)}`);
    lines.push(`Оплачиваемых страниц: ${fmtPages(nm.billableTranslationPages)}`);
    lines.push(`Основание расчёта: ${TRANSLATION_PAGE_BASIS_RU[nm.translationPageBasis]}`);
  }
  return lines;
}

/**
 * "База ставки: EN 3000 ₸/стр / ZH 5000 ₸/стр → применена ZH (выше)" — records which two base
 * rates (2026-07-26 symmetric pair resolution) produced the resolved per-page rate, for audit.
 * Russian anchor side (no stored row) prints as "RU (якорь, 0 ₸)".
 */
function languagePairResolutionLineRu(nm: NewModelBreakdown): string | null {
  const res = nm.languagePairResolution;
  if (!res) return null;
  const sideLabel = (base: LanguagePairBaseRate | null): string =>
    base ? `${base.language.toUpperCase()} ${fmtNum(base.rateKztPerTranslationPage)} ₸/стр` : 'RU (якорь, 0 ₸)';
  const sourceLabel = sideLabel(res.sourceBaseRate);
  const targetLabel = sideLabel(res.targetBaseRate);
  const winnerLabel = res.winningSide === 'source' ? sourceLabel : targetLabel;
  return `База ставки: ${sourceLabel} / ${targetLabel} → применена ${winnerLabel} (выше)`;
}

/**
 * "первые 5 стр." / "страницы 5–10" / "страницы свыше 10" — 2026-08-04 progressive
 * WPO coordination. First tier (fromPage=0) always reads "первые N стр."; the last
 * (upToPage=null) tier always reads "страницы свыше N"; any middle tier reads
 * "страницы A–B".
 */
function translationTierLabelRu(tier: TranslationTierBreakdownEntry): string {
  if (tier.fromPage === 0) return `первые ${fmtNum(tier.upToPage ?? tier.pages)} стр.`;
  if (tier.upToPage === null) return `страницы свыше ${fmtNum(tier.fromPage)}`;
  return `страницы ${fmtNum(tier.fromPage)}–${fmtNum(tier.upToPage)}`;
}

/**
 * "Комиссия WPO:" breakdown lines (2026-08-04 progressive coordination) — one line per
 * translation tier that actually contributed pages, plus notary/courier coordination
 * (only when N/C > 0), plus a total. Falls back to the single pre-2026-08-04 line when
 * the pricing version has no coordinationVolumeTiers configured (translationTiers is
 * empty) — this is what keeps every old quote's report byte-identical to before.
 */
function coordinationLinesRu(nm: NewModelBreakdown): string[] {
  const tiers = nm.translationTiers ?? [];
  if (tiers.length === 0) {
    return [`Комиссия WPO: ${fmtKzt(nm.coordinationBaseAmountKzt)}`];
  }
  const lines: string[] = ['Комиссия WPO:'];
  for (const tier of tiers) {
    lines.push(`- перевод, ${translationTierLabelRu(tier)} × ${fmtNum(tier.rate * 100)}%: ${fmtKzt(tier.coordinationAmountKzt)}`);
  }
  if (nm.notaryAmountKzt > 0) {
    lines.push(`- нотариус × ${fmtNum((nm.notaryCoordinationKzt ?? 0) / nm.notaryAmountKzt * 100)}%: ${fmtKzt(nm.notaryCoordinationKzt ?? 0)}`);
  }
  if (nm.courierAmountKzt > 0) {
    lines.push(`- курьер × ${fmtNum((nm.courierCoordinationKzt ?? 0) / nm.courierAmountKzt * 100)}%: ${fmtKzt(nm.courierCoordinationKzt ?? 0)}`);
  }
  lines.push(`- итого: ${fmtKzt(nm.coordinationBaseAmountKzt)}`);
  return lines;
}

/** Block 3 — price formation, as a flat list of lines. */
function formationLinesRu(nm: NewModelBreakdown, sourceCharacterCountWithSpaces: number | null): string[] {
  const lines: string[] = [];
  lines.push(
    nm.translationPageBasis === 'character_count'
      ? `Перевод: ${fmtNum(sourceCharacterCountWithSpaces ?? 0)} × ${fmtNum(nm.ratePerTranslationPageKzt)} / 1 800 = ${fmtKzt(nm.translationAmountKzt)}`
      : `Перевод: ${fmtPages(nm.billableTranslationPages)} стр. × ${fmtNum(nm.ratePerTranslationPageKzt)} = ${fmtKzt(nm.translationAmountKzt)}`,
  );
  const resolutionLine = languagePairResolutionLineRu(nm);
  if (resolutionLine) lines.push(resolutionLine);
  lines.push(`OCR и техническая обработка: ${fmtKzt(nm.ocrAmountKzt)}`);
  if (nm.notaryAmountKzt > 0) lines.push(`Нотариус: ${fmtKzt(nm.notaryAmountKzt)}`);
  if (nm.courierAmountKzt > 0) lines.push(`Курьер: ${fmtKzt(nm.courierAmountKzt)}`);
  if (nm.printingAmountKzt > 0) lines.push(`Печать: ${fmtKzt(nm.printingAmountKzt)}`);
  lines.push(...coordinationLinesRu(nm));
  if (nm.manualAdjustmentKzt !== 0) lines.push(`Ручная корректировка: ${fmtKzt(nm.manualAdjustmentKzt)}`);
  lines.push(`Сумма компонентов: ${fmtKzt(nm.componentSubtotalKzt)}`);
  lines.push(`Gross-up ${fmtPct(nm.grossUpRate)}: ${fmtKzt(nm.grossUpAmountKzt)}`);
  lines.push(`Стандартная цена заказа (округлено, шаг ${nm.roundingStepKzt} ₸): ${fmtKzt(nm.standardRetailKzt)}`);
  if (nm.urgencyMultiplier > 1) {
    lines.push(`Множитель срочности: ×${fmtNum(nm.urgencyMultiplier, 1)}`);
    lines.push(`Срочная надбавка: ${fmtKzt(nm.urgencySurchargeKzt)}`);
    lines.push(`Retail со срочностью: ${fmtKzt(nm.retailKzt)}`);
  } else {
    lines.push(`Retail: ${fmtKzt(nm.retailKzt)}`);
  }
  if (nm.salesChannel === 'referral') {
    lines.push(`Скидка клиенту: ${fmtKzt(nm.clientDiscountKzt)}`);
    lines.push(`Фактическая оплата: ${fmtKzt(nm.actualPaymentKzt)}`);
  }
  return lines;
}

/** Block 4 — external payouts, as a flat list of lines. */
function payoutsLinesRu(nm: NewModelBreakdown): string[] {
  const lines: string[] = [];
  lines.push(`Переводчику: ${fmtKzt(nm.translatorPayoutKzt)}`);
  if (nm.notaryPayoutKzt > 0) lines.push(`Нотариусу: ${fmtKzt(nm.notaryPayoutKzt)}`);
  if (nm.courierPayoutKzt > 0) lines.push(`Курьеру: ${fmtKzt(nm.courierPayoutKzt)}`);
  if (nm.printingCostKzt > 0) lines.push(`Печать: ${fmtKzt(nm.printingCostKzt)}`);
  lines.push(`Halyk (эквайринг): ${fmtKzt(nm.acquiringFeeKzt)}`);
  lines.push(`Налог: ${fmtKzt(nm.taxReserveKzt)}`);
  if (nm.partnerCommissionKzt > 0) lines.push(`Партнёру: ${fmtKzt(nm.partnerCommissionKzt)}`);
  return lines;
}

/** Block 5 — internal reserves, as a flat list of lines. */
function reservesLinesRu(nm: NewModelBreakdown): string[] {
  return [
    `Риск: ${fmtKzt(nm.riskReserveKzt)}`,
    `Маркетинг/CAC: ${fmtKzt(nm.marketingReserveKzt)}`,
    `AI/IT: ${fmtKzt(nm.aiItReserveKzt)}`,
    `Резерв владельцев: ${fmtKzt(nm.ownerReserveKzt)}`,
    `Канальный резерв (остаток): ${fmtKzt(nm.unusedChannelReserveKzt)}`,
  ];
}

/**
 * Block 6 — result. Never says "чистая прибыль" — "маржинальная прибыль заказа до постоянных
 * расходов" is the exact, non-negotiable wording (this is contribution margin per order, not
 * bottom-line net profit — WPO's fixed costs are not netted out here).
 */
function resultLinesRu(nm: NewModelBreakdown): string[] {
  const reconciliationOk = Math.abs(nm.reconciliationDifferenceKzt) < 0.01;
  return [
    `Фактическая оплата: ${fmtKzt(nm.actualPaymentKzt)}`,
    `Маржинальная прибыль заказа до постоянных расходов: ${fmtKzt(nm.netProfitWpoKzt)}`,
    `Маржа: ${fmtPct(nm.netMargin)}`,
    `Всего денег остаётся внутри WPO: ${fmtKzt(nm.totalCashRetainedByWpoKzt)}`,
    `Reconciliation: ${reconciliationOk ? 'сходится (0 ₸)' : `НЕ СХОДИТСЯ, разница ${fmtKzt(nm.reconciliationDifferenceKzt)}`}`,
  ];
}

/** Full plain-text Russian report body (Blocks 1-6) — used for the CLI's local `.report.md`. */
export function renderPricingReportMarkdown(model: FinancialReportModel): string {
  const lines: string[] = [];

  lines.push('Анализ документа:');
  for (const l of documentAnalysisLinesRu(model)) lines.push(`- ${l}`);
  lines.push('');

  lines.push('Параметры заказа:');
  for (const l of orderParamsLinesRu(model)) lines.push(`- ${l}`);
  lines.push('');

  if (!model.nm) {
    lines.push(`Итоговая цена: ${fmtKzt(model.legacyAmountKzt)}`);
    lines.push('(Электронный тариф использует старую формулу без детальной разбивки newModel.)');
    return lines.join('\n');
  }

  lines.push('Формирование клиентской цены:');
  for (const l of formationLinesRu(model.nm, model.document.charactersWithSpaces)) lines.push(`- ${l}`);
  lines.push('');

  lines.push('Внешние выплаты:');
  for (const l of payoutsLinesRu(model.nm)) lines.push(`- ${l}`);
  lines.push('');

  lines.push('Внутренние резервы:');
  for (const l of reservesLinesRu(model.nm)) lines.push(`- ${l}`);
  lines.push('');

  lines.push('Результат:');
  for (const l of resultLinesRu(model.nm)) lines.push(`- ${l}`);

  return lines.join('\n');
}

// ─── ADF (Atlassian Document Format) rendering for Jira ─────────────────────────
// Same node shapes as worker/src/lib/jira/price-breakdown.ts's existing builders.

export type AdfNode = Record<string, unknown>;

function adfHeading(level: number, text: string): AdfNode {
  return { type: 'heading', attrs: { level }, content: [{ type: 'text', text }] };
}

function adfBulletList(lines: string[]): AdfNode {
  return {
    type: 'bulletList',
    content: lines.map((text) => ({
      type: 'listItem',
      content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
    })),
  };
}

function adfParagraph(text: string): AdfNode {
  return { type: 'paragraph', content: [{ type: 'text', text: text || ' ' }] };
}

/** Full ADF document body (Blocks 1-6) for the Jira pricing breakdown description. */
export function renderPricingReportForJira(model: FinancialReportModel, orderNumber: string): AdfNode {
  const content: AdfNode[] = [adfHeading(1, `Расчёт стоимости заказа ${orderNumber}`)];

  content.push(adfHeading(2, 'Документ и анализ'));
  content.push(adfBulletList(documentAnalysisLinesRu(model)));

  content.push(adfHeading(2, 'Параметры заказа'));
  content.push(adfBulletList(orderParamsLinesRu(model)));

  if (!model.nm) {
    content.push(adfHeading(2, 'Итог'));
    content.push(adfParagraph(`Итоговая цена: ${fmtKzt(model.legacyAmountKzt)}`));
    content.push(adfParagraph('Электронный тариф использует старую формулу без детальной разбивки newModel.'));
    return { version: 1, type: 'doc', content };
  }

  content.push(adfHeading(2, 'Формирование клиентской цены'));
  content.push(adfBulletList(formationLinesRu(model.nm, model.document.charactersWithSpaces)));

  content.push(adfHeading(2, 'Внешние выплаты'));
  content.push(adfBulletList(payoutsLinesRu(model.nm)));

  content.push(adfHeading(2, 'Внутренние резервы'));
  content.push(adfBulletList(reservesLinesRu(model.nm)));

  content.push(adfHeading(2, 'Результат'));
  content.push(adfBulletList(resultLinesRu(model.nm)));

  return { version: 1, type: 'doc', content };
}
