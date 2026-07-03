/**
 * Assembles the full test-run report (report.json / report.md / report.html)
 * from already-computed pipeline outputs. Pure — takes plain data in, returns
 * plain data / strings out. No fs, no network.
 */
import type {
  InternalCostRow,
  MarginSection,
  PriceComponentRow,
  ReconciliationResult,
} from './pricing-report';

export const INTERNAL_TEST_WATERMARK = 'INTERNAL TEST — NOT CLIENT ORDER — NOT PAID — NOT FOR DELIVERY';

export interface RunSummarySection {
  runId: string;
  timestamp: string;
  environment: string;
  operatorEmail: string | null;
  sourceFile: { name: string; sizeBytes: number; sha256: string; mimeType: string; inputKind: string };
  sourceLanguage: string;
  targetLanguage: string;
  documentType: { raw: string; canonical: string };
  serviceLevel: { raw: string; canonical: string };
  urgency: string;
  fulfillmentMethod: string | null;
  notaryCity: string | null;
  deliveryCity: string | null;
}

export interface OcrSummarySection {
  provider: string;
  model: string | null;
  pageCount: number | null;
  extractedWordCount: number | null;
  confidence: string | null;
  warnings: string[];
}

export interface TranslationSummarySection {
  llmProvider: string;
  model: string;
  promptVersion: string;
  translationMode: string | null;
  visualElementsHandling: { count: number; kinds: string[] } | null;
  officialMarkersStatus: string;
  warnings: string[];
}

export interface RenderedOutputSection {
  /** Diagnostic artifact only — production electronic delivery is DOCX+HTML, never PDF. */
  translatedPdfPath: string | null;
  translatedDocxPath: string | null;
  translatedHtmlPath: string | null;
  warnings: string[];
}

export interface PricingContextSection {
  pricingVersion: string | null;
  languagePair: string | null;
  languageGroup: string | null;
  documentType: string;
  serviceLevel: string;
  physicalPages: number | null;
  sourceWordCount: number | null;
  includedWords: number | null;
  includedPages: number | null;
  urgency: string;
  fulfillmentMethod: string | null;
}

export interface ReportData {
  watermark: string;
  runSummary: RunSummarySection;
  ocrSummary: OcrSummarySection;
  translationSummary: TranslationSummarySection;
  renderedOutput: RenderedOutputSection;
  pricingContext: PricingContextSection | null;
  clientPriceComponents: PriceComponentRow[];
  internalCosts: InternalCostRow[];
  margin: MarginSection | null;
  reconciliation: ReconciliationResult | null;
  pricingError: string | null;
  debug: {
    pricingContextJson: unknown;
    priceBreakdownJson: unknown;
    internalCostJson: unknown;
    marginJson: unknown;
    warningsJson: string[];
  };
  allWarnings: string[];
}

export interface BuildReportDataInput {
  runSummary: RunSummarySection;
  ocrSummary: OcrSummarySection;
  translationSummary: TranslationSummarySection;
  renderedOutput: RenderedOutputSection;
  pricingContext: PricingContextSection | null;
  clientPriceComponents: PriceComponentRow[];
  internalCosts: InternalCostRow[];
  margin: MarginSection | null;
  reconciliation: ReconciliationResult | null;
  pricingError: string | null;
  rawPricingContextJson?: unknown;
}

export function buildReportData(input: BuildReportDataInput): ReportData {
  const allWarnings = [
    ...input.ocrSummary.warnings,
    ...input.translationSummary.warnings,
    ...input.renderedOutput.warnings,
    ...(input.pricingError ? [`pricing: ${input.pricingError}`] : []),
    ...(input.reconciliation?.status === 'WARNING'
      ? input.reconciliation.reasons.map((r) => `reconciliation: ${r}`)
      : []),
  ];

  return {
    watermark: INTERNAL_TEST_WATERMARK,
    runSummary: input.runSummary,
    ocrSummary: input.ocrSummary,
    translationSummary: input.translationSummary,
    renderedOutput: input.renderedOutput,
    pricingContext: input.pricingContext,
    clientPriceComponents: input.clientPriceComponents,
    internalCosts: input.internalCosts,
    margin: input.margin,
    reconciliation: input.reconciliation,
    pricingError: input.pricingError,
    debug: {
      pricingContextJson: input.rawPricingContextJson ?? input.pricingContext,
      priceBreakdownJson: input.clientPriceComponents,
      internalCostJson: input.internalCosts,
      marginJson: input.margin,
      warningsJson: allWarnings,
    },
    allWarnings,
  };
}

export function renderReportJson(data: ReportData): string {
  return JSON.stringify(data, null, 2);
}

function fmtKzt(n: number | null): string {
  if (n === null) return 'n/a';
  return `${n.toLocaleString('en-US')} KZT`;
}

function mdTable(headers: string[], rows: string[][]): string {
  const head = `| ${headers.join(' | ')} |`;
  const sep = `| ${headers.map(() => '---').join(' | ')} |`;
  const body = rows.map((r) => `| ${r.join(' | ')} |`).join('\n');
  return [head, sep, body].join('\n');
}

export function renderReportMarkdown(data: ReportData): string {
  const lines: string[] = [];
  lines.push(`# WPO AI Translation Test Lab — Report`);
  lines.push('');
  lines.push(`**${data.watermark}**`);
  lines.push('');

  lines.push('## 1. Test Run Summary');
  lines.push('');
  lines.push(mdTable(
    ['Field', 'Value'],
    [
      ['Run ID', data.runSummary.runId],
      ['Timestamp', data.runSummary.timestamp],
      ['Environment', data.runSummary.environment],
      ['Operator email', data.runSummary.operatorEmail ?? 'n/a'],
      ['Source file', data.runSummary.sourceFile.name],
      ['Detected MIME type', data.runSummary.sourceFile.mimeType],
      ['Input kind', data.runSummary.sourceFile.inputKind],
      ['File size', `${data.runSummary.sourceFile.sizeBytes} bytes`],
      ['SHA-256', data.runSummary.sourceFile.sha256],
      ['Source language', data.runSummary.sourceLanguage],
      ['Target language', data.runSummary.targetLanguage],
      ['Document type', `${data.runSummary.documentType.raw} → ${data.runSummary.documentType.canonical}`],
      ['Service level', `${data.runSummary.serviceLevel.raw} → ${data.runSummary.serviceLevel.canonical}`],
      ['Urgency', data.runSummary.urgency],
      ['Fulfillment method', data.runSummary.fulfillmentMethod ?? 'n/a'],
      ['Notary city', data.runSummary.notaryCity ?? 'n/a'],
      ['Delivery city', data.runSummary.deliveryCity ?? 'n/a'],
    ],
  ));
  lines.push('');

  lines.push('## 2. OCR Summary');
  lines.push('');
  lines.push(mdTable(
    ['Field', 'Value'],
    [
      ['Provider', data.ocrSummary.provider],
      ['Model', data.ocrSummary.model ?? 'n/a'],
      ['Page count', String(data.ocrSummary.pageCount ?? 'n/a')],
      ['Extracted word count', String(data.ocrSummary.extractedWordCount ?? 'n/a')],
      ['OCR confidence', data.ocrSummary.confidence ?? 'not available'],
      ['Warnings', data.ocrSummary.warnings.join('; ') || 'none'],
    ],
  ));
  lines.push('');

  lines.push('## 3. Translation Summary');
  lines.push('');
  lines.push(mdTable(
    ['Field', 'Value'],
    [
      ['LLM provider', data.translationSummary.llmProvider],
      ['Model', data.translationSummary.model],
      ['Prompt version', data.translationSummary.promptVersion],
      ['Translation mode', data.translationSummary.translationMode ?? 'n/a'],
      ['Visual elements', data.translationSummary.visualElementsHandling
        ? `${data.translationSummary.visualElementsHandling.count} (${data.translationSummary.visualElementsHandling.kinds.join(', ') || 'none'})`
        : 'n/a'],
      ['Official markers status', data.translationSummary.officialMarkersStatus],
      ['Warnings', data.translationSummary.warnings.join('; ') || 'none'],
    ],
  ));
  lines.push('');

  lines.push('## 4. Rendered Output');
  lines.push('');
  lines.push(mdTable(
    ['Field', 'Value'],
    [
      ['Translated DOCX', data.renderedOutput.translatedDocxPath ?? 'not generated'],
      ['Translated HTML', data.renderedOutput.translatedHtmlPath ?? 'not generated'],
      ['Translated PDF (internal diagnostic artifact only — not client delivery)', data.renderedOutput.translatedPdfPath ?? 'not generated'],
      ['Warnings', data.renderedOutput.warnings.join('; ') || 'none'],
    ],
  ));
  lines.push('');

  lines.push('## 5. Pricing Context');
  lines.push('');
  if (data.pricingContext) {
    lines.push(mdTable(
      ['Field', 'Value'],
      [
        ['Pricing version', data.pricingContext.pricingVersion ?? 'n/a'],
        ['Language pair', data.pricingContext.languagePair ?? 'n/a'],
        ['Language group', data.pricingContext.languageGroup ?? 'n/a'],
        ['Document type', data.pricingContext.documentType],
        ['Service level', data.pricingContext.serviceLevel],
        ['Physical pages', String(data.pricingContext.physicalPages ?? 'n/a')],
        ['Source word count', String(data.pricingContext.sourceWordCount ?? 'n/a')],
        ['Included words', String(data.pricingContext.includedWords ?? 'n/a')],
        ['Included pages', String(data.pricingContext.includedPages ?? 'n/a')],
        ['Urgency', data.pricingContext.urgency],
        ['Fulfillment method', data.pricingContext.fulfillmentMethod ?? 'n/a'],
      ],
    ));
  } else {
    lines.push(`_Pricing not computed: ${data.pricingError ?? 'unknown reason'}_`);
  }
  lines.push('');

  lines.push('## 6. Client / Revenue Price Components');
  lines.push('');
  lines.push('_Zero-amount rows are intentionally included — they prove the component was checked and either included in the minimum package or not applicable._');
  lines.push('');
  lines.push(mdTable(
    ['Item type', 'Label', 'Qty', 'Unit price KZT', 'Amount KZT', 'Visible to client', 'Metadata'],
    data.clientPriceComponents.map((r) => [
      r.itemType,
      r.label,
      String(r.quantity),
      r.unitPriceKzt === null ? 'n/a' : String(r.unitPriceKzt),
      fmtKzt(r.amountKzt),
      String(r.visibleToClient),
      `\`${JSON.stringify(r.metadata)}\``,
    ]),
  ));
  lines.push('');

  lines.push('## 7. Internal Cost / Reserve Allocation');
  lines.push('');
  lines.push(mdTable(
    ['Cost type', 'Label', 'Amount KZT', 'Metadata'],
    data.internalCosts.map((r) => [r.costType, r.label, fmtKzt(r.amountKzt), `\`${JSON.stringify(r.metadata)}\``]),
  ));
  lines.push('');

  lines.push('## 8. Margin Summary');
  lines.push('');
  if (data.margin) {
    lines.push(mdTable(
      ['Field', 'Value'],
      [
        ['Gross revenue', fmtKzt(data.margin.grossRevenueKzt)],
        ['Total internal costs/reserves', fmtKzt(data.margin.totalInternalCostsKzt)],
        ['Target profit', fmtKzt(data.margin.targetProfitKzt)],
        ['Estimated margin', fmtKzt(data.margin.estimatedMarginKzt)],
        ['Estimated margin %', `${data.margin.estimatedMarginPercent.toFixed(2)}%`],
      ],
    ));
  } else {
    lines.push('_Margin not available — pricing was not computed._');
  }
  lines.push('');

  lines.push('## 9. Reconciliation');
  lines.push('');
  if (data.reconciliation) {
    lines.push(mdTable(
      ['Field', 'Value'],
      [
        ['Raw subtotal (before rounding)', fmtKzt(data.reconciliation.rawSubtotalKzt)],
        ['Rounding adjustment', data.reconciliation.roundingAdjustmentFound
          ? fmtKzt(data.reconciliation.roundingAdjustmentKzt)
          : 'not found'],
        ['Canonical subtotal (raw + rounding)', fmtKzt(data.reconciliation.canonicalSubtotalKzt)],
        ['Final amount KZT', fmtKzt(data.reconciliation.finalAmountKzt)],
        ['Difference after rounding', fmtKzt(data.reconciliation.differenceKzt)],
        ['Status', data.reconciliation.status],
      ],
    ));
    if (data.reconciliation.reasons.length > 0) {
      lines.push('');
      lines.push('Reasons:');
      for (const r of data.reconciliation.reasons) lines.push(`- ${r}`);
    }
  } else {
    lines.push('_Reconciliation not available — pricing was not computed._');
  }
  lines.push('');

  lines.push('## 10. Debug JSON');
  lines.push('');
  lines.push('See `report.json` for machine-readable `pricing_context_json`, `price_breakdown_json`, `internal_cost_json`, `margin_json`, `warnings_json`.');
  lines.push('');
  if (data.allWarnings.length > 0) {
    lines.push('### All warnings');
    lines.push('');
    for (const w of data.allWarnings) lines.push(`- ${w}`);
    lines.push('');
  }

  lines.push('---');
  lines.push(`_${data.watermark}_`);

  return lines.join('\n');
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function htmlTable(headers: string[], rows: string[][]): string {
  const head = `<tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr>`;
  const body = rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('\n');
  return `<table border="1" cellpadding="6" cellspacing="0">\n${head}\n${body}\n</table>`;
}

export function renderReportHtml(data: ReportData): string {
  const style = `
    body { font-family: -apple-system, Arial, sans-serif; margin: 2rem; color: #1a1a1a; }
    .watermark { background: #b00020; color: white; padding: 0.75rem 1rem; font-weight: bold; text-align: center; margin-bottom: 1.5rem; }
    table { border-collapse: collapse; margin-bottom: 1.5rem; width: 100%; }
    th { background: #f0f0f0; text-align: left; }
    code { font-size: 0.85em; }
    h2 { border-bottom: 2px solid #ddd; padding-bottom: 0.25rem; margin-top: 2rem; }
  `;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>WPO AI Translation Test Lab — Report — ${escapeHtml(data.runSummary.runId)}</title>
<style>${style}</style>
</head>
<body>
<div class="watermark">${escapeHtml(data.watermark)}</div>
<h1>WPO AI Translation Test Lab — Report</h1>

<h2>1. Test Run Summary</h2>
${htmlTable(['Field', 'Value'], [
  ['Run ID', escapeHtml(data.runSummary.runId)],
  ['Timestamp', escapeHtml(data.runSummary.timestamp)],
  ['Environment', escapeHtml(data.runSummary.environment)],
  ['Operator email', escapeHtml(data.runSummary.operatorEmail ?? 'n/a')],
  ['Source file', escapeHtml(data.runSummary.sourceFile.name)],
  ['Detected MIME type', escapeHtml(data.runSummary.sourceFile.mimeType)],
  ['Input kind', escapeHtml(data.runSummary.sourceFile.inputKind)],
  ['File size', `${data.runSummary.sourceFile.sizeBytes} bytes`],
  ['SHA-256', `<code>${escapeHtml(data.runSummary.sourceFile.sha256)}</code>`],
  ['Source language', escapeHtml(data.runSummary.sourceLanguage)],
  ['Target language', escapeHtml(data.runSummary.targetLanguage)],
  ['Document type', escapeHtml(`${data.runSummary.documentType.raw} → ${data.runSummary.documentType.canonical}`)],
  ['Service level', escapeHtml(`${data.runSummary.serviceLevel.raw} → ${data.runSummary.serviceLevel.canonical}`)],
  ['Urgency', escapeHtml(data.runSummary.urgency)],
  ['Fulfillment method', escapeHtml(data.runSummary.fulfillmentMethod ?? 'n/a')],
  ['Notary city', escapeHtml(data.runSummary.notaryCity ?? 'n/a')],
  ['Delivery city', escapeHtml(data.runSummary.deliveryCity ?? 'n/a')],
])}

<h2>2. OCR Summary</h2>
${htmlTable(['Field', 'Value'], [
  ['Provider', escapeHtml(data.ocrSummary.provider)],
  ['Model', escapeHtml(data.ocrSummary.model ?? 'n/a')],
  ['Page count', String(data.ocrSummary.pageCount ?? 'n/a')],
  ['Extracted word count', String(data.ocrSummary.extractedWordCount ?? 'n/a')],
  ['OCR confidence', escapeHtml(data.ocrSummary.confidence ?? 'not available')],
  ['Warnings', escapeHtml(data.ocrSummary.warnings.join('; ') || 'none')],
])}

<h2>3. Translation Summary</h2>
${htmlTable(['Field', 'Value'], [
  ['LLM provider', escapeHtml(data.translationSummary.llmProvider)],
  ['Model', escapeHtml(data.translationSummary.model)],
  ['Prompt version', escapeHtml(data.translationSummary.promptVersion)],
  ['Translation mode', escapeHtml(data.translationSummary.translationMode ?? 'n/a')],
  ['Visual elements', escapeHtml(data.translationSummary.visualElementsHandling
    ? `${data.translationSummary.visualElementsHandling.count} (${data.translationSummary.visualElementsHandling.kinds.join(', ') || 'none'})`
    : 'n/a')],
  ['Official markers status', escapeHtml(data.translationSummary.officialMarkersStatus)],
  ['Warnings', escapeHtml(data.translationSummary.warnings.join('; ') || 'none')],
])}

<h2>4. Rendered Output</h2>
${htmlTable(['Field', 'Value'], [
  ['Translated DOCX', escapeHtml(data.renderedOutput.translatedDocxPath ?? 'not generated')],
  ['Translated HTML', escapeHtml(data.renderedOutput.translatedHtmlPath ?? 'not generated')],
  ['Translated PDF (internal diagnostic artifact only — not client delivery)', escapeHtml(data.renderedOutput.translatedPdfPath ?? 'not generated')],
  ['Warnings', escapeHtml(data.renderedOutput.warnings.join('; ') || 'none')],
])}

<h2>5. Pricing Context</h2>
${data.pricingContext ? htmlTable(['Field', 'Value'], [
  ['Pricing version', escapeHtml(data.pricingContext.pricingVersion ?? 'n/a')],
  ['Language pair', escapeHtml(data.pricingContext.languagePair ?? 'n/a')],
  ['Language group', escapeHtml(data.pricingContext.languageGroup ?? 'n/a')],
  ['Document type', escapeHtml(data.pricingContext.documentType)],
  ['Service level', escapeHtml(data.pricingContext.serviceLevel)],
  ['Physical pages', String(data.pricingContext.physicalPages ?? 'n/a')],
  ['Source word count', String(data.pricingContext.sourceWordCount ?? 'n/a')],
  ['Included words', String(data.pricingContext.includedWords ?? 'n/a')],
  ['Included pages', String(data.pricingContext.includedPages ?? 'n/a')],
  ['Urgency', escapeHtml(data.pricingContext.urgency)],
  ['Fulfillment method', escapeHtml(data.pricingContext.fulfillmentMethod ?? 'n/a')],
]) : `<p><em>Pricing not computed: ${escapeHtml(data.pricingError ?? 'unknown reason')}</em></p>`}

<h2>6. Client / Revenue Price Components</h2>
<p><em>Zero-amount rows are intentionally included — they prove the component was checked and either included in the minimum package or not applicable.</em></p>
${htmlTable(['Item type', 'Label', 'Qty', 'Unit price KZT', 'Amount KZT', 'Visible to client', 'Metadata'], data.clientPriceComponents.map((r) => [
  escapeHtml(r.itemType),
  escapeHtml(r.label),
  String(r.quantity),
  r.unitPriceKzt === null ? 'n/a' : String(r.unitPriceKzt),
  fmtKzt(r.amountKzt),
  String(r.visibleToClient),
  `<code>${escapeHtml(JSON.stringify(r.metadata))}</code>`,
]))}

<h2>7. Internal Cost / Reserve Allocation</h2>
${htmlTable(['Cost type', 'Label', 'Amount KZT', 'Metadata'], data.internalCosts.map((r) => [
  escapeHtml(r.costType),
  escapeHtml(r.label),
  fmtKzt(r.amountKzt),
  `<code>${escapeHtml(JSON.stringify(r.metadata))}</code>`,
]))}

<h2>8. Margin Summary</h2>
${data.margin ? htmlTable(['Field', 'Value'], [
  ['Gross revenue', fmtKzt(data.margin.grossRevenueKzt)],
  ['Total internal costs/reserves', fmtKzt(data.margin.totalInternalCostsKzt)],
  ['Target profit', fmtKzt(data.margin.targetProfitKzt)],
  ['Estimated margin', fmtKzt(data.margin.estimatedMarginKzt)],
  ['Estimated margin %', `${data.margin.estimatedMarginPercent.toFixed(2)}%`],
]) : '<p><em>Margin not available — pricing was not computed.</em></p>'}

<h2>9. Reconciliation</h2>
${data.reconciliation ? htmlTable(['Field', 'Value'], [
  ['Raw subtotal (before rounding)', fmtKzt(data.reconciliation.rawSubtotalKzt)],
  ['Rounding adjustment', data.reconciliation.roundingAdjustmentFound ? fmtKzt(data.reconciliation.roundingAdjustmentKzt) : 'not found'],
  ['Canonical subtotal (raw + rounding)', fmtKzt(data.reconciliation.canonicalSubtotalKzt)],
  ['Final amount KZT', fmtKzt(data.reconciliation.finalAmountKzt)],
  ['Difference after rounding', fmtKzt(data.reconciliation.differenceKzt)],
  ['Status', data.reconciliation.status],
]) : '<p><em>Reconciliation not available — pricing was not computed.</em></p>'}
${data.reconciliation && data.reconciliation.reasons.length > 0
  ? `<p><strong>Reasons:</strong></p><ul>${data.reconciliation.reasons.map((r) => `<li>${escapeHtml(r)}</li>`).join('')}</ul>`
  : ''}

<h2>10. Debug JSON</h2>
<p>See <code>report.json</code> for machine-readable <code>pricing_context_json</code>, <code>price_breakdown_json</code>, <code>internal_cost_json</code>, <code>margin_json</code>, <code>warnings_json</code>.</p>
${data.allWarnings.length > 0 ? `<h3>All warnings</h3><ul>${data.allWarnings.map((w) => `<li>${escapeHtml(w)}</li>`).join('')}</ul>` : ''}

<div class="watermark">${escapeHtml(data.watermark)}</div>
</body>
</html>`;
}
