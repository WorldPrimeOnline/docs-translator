import { renderSummaryJson, renderSummaryCsv, renderSummaryHtml } from '../lib/batch-summary';
import type { BatchSummaryRow } from '../lib/types';

const COMPLETED_ROW: BatchSummaryRow = {
  index: 1,
  file: '01_ru_kk_identity_card_complex.pdf',
  sourceLanguage: 'ru',
  targetLanguage: 'kk',
  documentType: 'identity_card',
  serviceLevel: 'electronic',
  status: 'completed',
  itemFolder: '01_ru_kk_identity_card_01_ru_kk_identity_card_complex',
  finalPriceKzt: 3500,
  reconciliationStatus: 'OK',
  outputDocxPath: 'items/01.../rendered/translated-document.INTERNAL_TEST.docx',
  outputHtmlPath: 'items/01.../rendered/translated-document.INTERNAL_TEST.html',
  outputPdfDiagnosticPath: 'items/01.../rendered/translated-document.INTERNAL_DIAGNOSTIC_ONLY.pdf',
  reportPath: 'items/01.../report/report.INTERNAL_TEST.html',
  ocrPageCount: 1,
  extractedWordCount: 120,
  warningsCount: 1,
  warnings: ['OCR extracted word count is very low — check source scan quality.'],
  errorCode: null,
  errorMessage: null,
  durationSeconds: 42.3,
};

const FAILED_ROW: BatchSummaryRow = {
  ...COMPLETED_ROW,
  index: 2,
  file: '02_en_th_passport_biodata_visa.pdf',
  status: 'failed',
  finalPriceKzt: null,
  reconciliationStatus: null,
  outputDocxPath: null,
  outputHtmlPath: null,
  outputPdfDiagnosticPath: null,
  reportPath: null,
  warningsCount: 0,
  warnings: [],
  errorCode: 'PIPELINE_ERROR',
  errorMessage: 'OCR request failed: 500 Internal Server Error',
};

const SKIPPED_ROW: BatchSummaryRow = {
  ...COMPLETED_ROW,
  index: 3,
  file: '03_kk_birth_certificate_civil.pdf',
  status: 'skipped',
  warningsCount: 0,
  warnings: [],
  errorCode: null,
  errorMessage: null,
  durationSeconds: 0,
};

const ROWS = [COMPLETED_ROW, FAILED_ROW, SKIPPED_ROW];

describe('renderSummaryJson', () => {
  it('round-trips every field for every row', () => {
    const json = renderSummaryJson(ROWS);
    const parsed = JSON.parse(json) as BatchSummaryRow[];
    expect(parsed).toEqual(ROWS);
  });
});

describe('renderSummaryCsv', () => {
  it('has a header row plus one row per item', () => {
    const csv = renderSummaryCsv(ROWS);
    const lines = csv.trim().split('\n');
    expect(lines).toHaveLength(4); // header + 3 rows
  });

  it('header includes all required summary columns', () => {
    const csv = renderSummaryCsv(ROWS);
    const header = csv.split('\n')[0]!;
    for (const col of [
      'index', 'file', 'sourceLanguage', 'targetLanguage', 'documentType', 'serviceLevel',
      'status', 'finalPriceKzt', 'reconciliationStatus', 'outputDocxPath', 'outputHtmlPath',
      'outputPdfDiagnosticPath', 'reportPath', 'ocrPageCount', 'extractedWordCount',
      'warningsCount', 'errorCode', 'errorMessage', 'durationSeconds',
    ]) {
      expect(header).toContain(col);
    }
  });

  it('escapes commas and quotes in error messages', () => {
    const rowWithComma: BatchSummaryRow = { ...FAILED_ROW, errorMessage: 'Failed, "badly", see log' };
    const csv = renderSummaryCsv([rowWithComma]);
    expect(csv).toContain('"Failed, ""badly"", see log"');
  });

  it('failed row shows its errorCode and errorMessage', () => {
    const csv = renderSummaryCsv([FAILED_ROW]);
    expect(csv).toContain('PIPELINE_ERROR');
    expect(csv).toContain('OCR request failed');
  });
});

describe('renderSummaryHtml', () => {
  const meta = {
    batchId: 'batch_20260703T120000Z_ab12cd34',
    environment: 'staging',
    generatedAt: '2026-07-03T12:05:00.000Z',
    totalFiles: 3,
    completed: 1,
    failed: 1,
    skipped: 1,
  };

  it('renders a table with one row per item', () => {
    const html = renderSummaryHtml(ROWS, meta);
    expect((html.match(/<tr class="status-/g) ?? []).length).toBe(3);
  });

  it('links to each report and generated DOCX/HTML/PDF file', () => {
    const html = renderSummaryHtml(ROWS, meta);
    expect(html).toContain(`href="${COMPLETED_ROW.outputDocxPath}"`);
    expect(html).toContain(`href="${COMPLETED_ROW.outputHtmlPath}"`);
    expect(html).toContain(`href="${COMPLETED_ROW.outputPdfDiagnosticPath}"`);
    expect(html).toContain(`href="${COMPLETED_ROW.reportPath}"`);
  });

  it('failed rows are highlighted with a distinct class and status label', () => {
    const html = renderSummaryHtml(ROWS, meta);
    expect(html).toContain('status-failed');
    expect(html).toContain('FAILED');
  });

  it('skipped rows get their own distinct class', () => {
    const html = renderSummaryHtml(ROWS, meta);
    expect(html).toContain('status-skipped');
    expect(html).toContain('SKIPPED');
  });

  it('warnings are visible (not hidden/dropped)', () => {
    const html = renderSummaryHtml(ROWS, meta);
    expect(html).toContain('OCR extracted word count is very low');
  });

  it('shows the error message for a failed row', () => {
    const html = renderSummaryHtml(ROWS, meta);
    expect(html).toContain('OCR request failed: 500 Internal Server Error');
  });

  it('escapes HTML in file names and error messages (no injection)', () => {
    const malicious: BatchSummaryRow = { ...FAILED_ROW, file: '<script>alert(1)</script>.pdf' };
    const html = renderSummaryHtml([malicious], meta);
    expect(html).not.toContain('<script>alert(1)</script>.pdf');
    expect(html).toContain('&lt;script&gt;');
  });

  it('is valid enough to open in a browser (has doctype, html, body)', () => {
    const html = renderSummaryHtml(ROWS, meta);
    expect(html).toMatch(/^<!doctype html>/);
    expect(html).toContain('<body>');
    expect(html).toContain('</html>');
  });

  it('shows batch metadata (id, environment, counts)', () => {
    const html = renderSummaryHtml(ROWS, meta);
    expect(html).toContain(meta.batchId);
    expect(html).toContain(meta.environment);
    expect(html).toContain('Completed: 1');
    expect(html).toContain('Failed: 1');
    expect(html).toContain('Skipped: 1');
  });

  it('shows the internal-test watermark disclaimer', () => {
    const html = renderSummaryHtml(ROWS, meta);
    expect(html).toMatch(/INTERNAL TEST/);
  });
});
