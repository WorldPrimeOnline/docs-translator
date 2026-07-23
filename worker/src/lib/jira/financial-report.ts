/**
 * Worker-side synced copy of src/lib/pricing/financial-report.ts (2026-07-22) — the canonical
 * version lives there; worker has its own build and cannot import from src/ directly (same
 * convention as output-plan.ts/visual-elements.ts/etc., documented in CLAUDE.md). Keep the two
 * files in sync manually.
 *
 * NewModelBreakdownLike below is a structural mirror of src/lib/pricing/types.ts's
 * NewModelBreakdown — the real runtime value here always comes from
 * price_quotes.wpo_financial_breakdown_json (a jsonb column), so this is read as plain JSON,
 * never imported as a TS type from src/. Same pattern already used by finance-report.ts's local
 * type copies in this same directory.
 */

export type TranslationPageBasis = 'minimum_one_page' | 'physical_pages' | 'character_count';
export type SalesChannel = 'direct' | 'referral';
export type ServiceLevel =
  | 'electronic'
  | 'official_with_translator_signature_and_provider_stamp'
  | 'notarization_through_partners';

export interface LanguagePairBaseRateLike {
  language: string;
  rateId: string;
  rateKztPerTranslationPage: number;
  active: boolean;
  requiresOperatorReview: boolean;
}

export interface LanguagePairResolutionLike {
  sourceBaseRate: LanguagePairBaseRateLike | null;
  targetBaseRate: LanguagePairBaseRateLike | null;
  winningSide: 'source' | 'target';
}

/** Mirrors src/lib/pricing/coordination-tiers.ts's TranslationTierBreakdownEntry. */
export interface TranslationTierBreakdownEntryLike {
  fromPage: number;
  upToPage: number | null;
  pages: number;
  rate: number;
  ratePerPageKzt: number;
  translationAmountKzt: number;
  coordinationAmountKzt: number;
}

export interface NewModelBreakdownLike {
  physicalPageCount: number | null;
  characterPages: number;
  billableTranslationPages: number;
  translationPageBasis: TranslationPageBasis;
  translationAmountKzt: number;
  ocrAmountKzt: number;
  notaryAmountKzt: number;
  courierAmountKzt: number;
  printingAmountKzt: number;
  coordinationBaseAmountKzt: number;
  // 2026-08-04 progressive coordination — optional so a wpo_financial_breakdown_json
  // snapshot from BEFORE this feature (no coordinationVolumeTiers configured, or an
  // older quote row) still parses fine; formationLinesRu falls back to the single
  // pre-2026-08-04 "Комиссия WPO: X" line when translationTiers is empty/absent.
  translationCoordinationKzt?: number;
  notaryCoordinationKzt?: number;
  courierCoordinationKzt?: number;
  translationTiers?: TranslationTierBreakdownEntryLike[];
  manualAdjustmentKzt: number;
  componentSubtotalKzt: number;
  grossUpRate: number;
  grossUpAmountKzt: number;
  roundingStepKzt: number;
  standardRetailKzt: number;
  urgencyMultiplier: number;
  urgencySurchargeKzt: number;
  retailKzt: number;
  salesChannel: SalesChannel;
  clientDiscountKzt: number;
  actualPaymentKzt: number;
  translatorPayoutKzt: number;
  notaryPayoutKzt: number;
  courierPayoutKzt: number;
  printingCostKzt: number;
  acquiringFeeKzt: number;
  taxReserveKzt: number;
  partnerCommissionKzt: number;
  riskReserveKzt: number;
  marketingReserveKzt: number;
  aiItReserveKzt: number;
  ownerReserveKzt: number;
  unusedChannelReserveKzt: number;
  netProfitWpoKzt: number;
  netMargin: number;
  totalCashRetainedByWpoKzt: number;
  reconciliationDifferenceKzt: number;
  ratePerTranslationPageKzt: number;
  languagePairResolution: LanguagePairResolutionLike | null;
}

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
  nm: NewModelBreakdownLike | undefined;
  legacyAmountKzt: number;
}

export function buildFinancialReportModel(input: {
  nm: NewModelBreakdownLike | undefined;
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

const SERVICE_LEVEL_RU: Record<ServiceLevel, string> = {
  electronic: 'Электронный перевод',
  official_with_translator_signature_and_provider_stamp: 'Официальный перевод (подпись переводчика и печать бюро)',
  notarization_through_partners: 'Нотариальный перевод',
};

const METHOD_RU: Record<string, string> = {
  docx_text: 'DOCX (текст извлечён напрямую)',
  pdf_text_layer: 'PDF (текстовый слой)',
  ocr: 'OCR',
  manual: 'Ручной ввод',
};

const TRANSLATION_PAGE_BASIS_RU: Record<TranslationPageBasis, string> = {
  minimum_one_page: 'минимум 1 страница',
  physical_pages: 'физические страницы',
  character_count: 'количество символов',
};

function fmtKzt(n: number | undefined | null): string {
  if (n == null) return '—';
  return n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₸';
}

function fmtPct(n: number): string {
  return (n * 100).toLocaleString('ru-RU', { maximumFractionDigits: 2 }) + '%';
}

function fmtNum(n: number, digits = 0): string {
  return n.toLocaleString('ru-RU', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function fmtPages(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 6 });
}

function urgencyLineRu(nm: NewModelBreakdownLike | undefined): string | null {
  if (!nm) return null;
  if (nm.urgencyMultiplier <= 1) return null;
  return `Срочность +${fmtNum((nm.urgencyMultiplier - 1) * 100)}%`;
}

function orderParamsLinesRu(model: FinancialReportModel): string[] {
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

function documentAnalysisLinesRu(model: FinancialReportModel): string[] {
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

/** See src/lib/pricing/financial-report.ts's languagePairResolutionLineRu — kept in sync manually. */
function languagePairResolutionLineRu(nm: NewModelBreakdownLike): string | null {
  const res = nm.languagePairResolution;
  if (!res) return null;
  const sideLabel = (base: LanguagePairBaseRateLike | null): string =>
    base ? `${base.language.toUpperCase()} ${fmtNum(base.rateKztPerTranslationPage)} ₸/стр` : 'RU (якорь, 0 ₸)';
  const sourceLabel = sideLabel(res.sourceBaseRate);
  const targetLabel = sideLabel(res.targetBaseRate);
  const winnerLabel = res.winningSide === 'source' ? sourceLabel : targetLabel;
  return `База ставки: ${sourceLabel} / ${targetLabel} → применена ${winnerLabel} (выше)`;
}

/** See src/lib/pricing/financial-report.ts's translationTierLabelRu — kept in sync manually. */
function translationTierLabelRu(tier: TranslationTierBreakdownEntryLike): string {
  if (tier.fromPage === 0) return `первые ${fmtNum(tier.upToPage ?? tier.pages)} стр.`;
  if (tier.upToPage === null) return `страницы свыше ${fmtNum(tier.fromPage)}`;
  return `страницы ${fmtNum(tier.fromPage)}–${fmtNum(tier.upToPage)}`;
}

/** See src/lib/pricing/financial-report.ts's coordinationLinesRu — kept in sync manually. */
function coordinationLinesRu(nm: NewModelBreakdownLike): string[] {
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

function formationLinesRu(nm: NewModelBreakdownLike, sourceCharacterCountWithSpaces: number | null): string[] {
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

function payoutsLinesRu(nm: NewModelBreakdownLike): string[] {
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

function reservesLinesRu(nm: NewModelBreakdownLike): string[] {
  return [
    `Риск: ${fmtKzt(nm.riskReserveKzt)}`,
    `Маркетинг/CAC: ${fmtKzt(nm.marketingReserveKzt)}`,
    `AI/IT: ${fmtKzt(nm.aiItReserveKzt)}`,
    `Резерв владельцев: ${fmtKzt(nm.ownerReserveKzt)}`,
    `Канальный резерв (остаток): ${fmtKzt(nm.unusedChannelReserveKzt)}`,
  ];
}

/** Never says "чистая прибыль" — this is contribution margin per order, not net profit. */
function resultLinesRu(nm: NewModelBreakdownLike): string[] {
  const reconciliationOk = Math.abs(nm.reconciliationDifferenceKzt) < 0.01;
  return [
    `Фактическая оплата: ${fmtKzt(nm.actualPaymentKzt)}`,
    `Маржинальная прибыль заказа до постоянных расходов: ${fmtKzt(nm.netProfitWpoKzt)}`,
    `Маржа: ${fmtPct(nm.netMargin)}`,
    `Всего денег остаётся внутри WPO: ${fmtKzt(nm.totalCashRetainedByWpoKzt)}`,
    `Reconciliation: ${reconciliationOk ? 'сходится (0 ₸)' : `НЕ СХОДИТСЯ, разница ${fmtKzt(nm.reconciliationDifferenceKzt)}`}`,
  ];
}

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
