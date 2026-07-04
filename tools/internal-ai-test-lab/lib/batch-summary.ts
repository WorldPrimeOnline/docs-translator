/**
 * batch-summary.{json,csv,html} generation for batch mode.
 */
import type { BatchSummaryRow } from './types';

export function renderSummaryJson(rows: BatchSummaryRow[]): string {
  return JSON.stringify(rows, null, 2);
}

function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

const CSV_COLUMNS: Array<keyof BatchSummaryRow> = [
  'index',
  'file',
  'sourceLanguage',
  'targetLanguage',
  'documentType',
  'serviceLevel',
  'status',
  'finalPriceKzt',
  'reconciliationStatus',
  'outputDocxPath',
  'outputHtmlPath',
  'outputPdfDiagnosticPath',
  'reportPath',
  'ocrPageCount',
  'extractedWordCount',
  'warningsCount',
  'errorCode',
  'errorMessage',
  'durationSeconds',
];

export function renderSummaryCsv(rows: BatchSummaryRow[]): string {
  const header = CSV_COLUMNS.join(',');
  const lines = rows.map((row) =>
    CSV_COLUMNS.map((col) => {
      const v = row[col];
      if (col === 'warnings') return csvEscape((v as string[]).join('; '));
      return csvEscape(v);
    }).join(','),
  );
  return [header, ...lines].join('\n') + '\n';
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function statusClass(status: BatchSummaryRow['status']): string {
  if (status === 'completed') return 'status-completed';
  if (status === 'failed') return 'status-failed';
  return 'status-skipped';
}

function link(pathValue: string | null, label: string): string {
  if (!pathValue) return `<span class="muted">not generated</span>`;
  return `<a href="${escapeHtml(pathValue)}">${escapeHtml(label)}</a>`;
}

export interface BatchSummaryHtmlMeta {
  batchId: string;
  environment: string;
  generatedAt: string;
  totalFiles: number;
  completed: number;
  failed: number;
  skipped: number;
}

export function renderSummaryHtml(rows: BatchSummaryRow[], meta: BatchSummaryHtmlMeta): string {
  const rowsHtml = rows
    .map((row) => {
      const warningsHtml = row.warnings.length > 0
        ? `<details><summary>${row.warningsCount} warning(s)</summary><ul>${row.warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join('')}</ul></details>`
        : '<span class="muted">none</span>';
      const errorHtml = row.errorMessage
        ? `<span class="error-text">${escapeHtml(row.errorCode ?? 'ERROR')}: ${escapeHtml(row.errorMessage)}</span>`
        : '<span class="muted">n/a</span>';
      return `<tr class="${statusClass(row.status)}">
  <td>${row.index}</td>
  <td>${escapeHtml(row.file)}</td>
  <td>${escapeHtml(row.sourceLanguage)} → ${escapeHtml(row.targetLanguage)}</td>
  <td>${escapeHtml(row.documentType)}</td>
  <td>${escapeHtml(row.serviceLevel)}</td>
  <td class="status-label">${row.status.toUpperCase()}</td>
  <td>${row.finalPriceKzt !== null ? `${row.finalPriceKzt} KZT` : '<span class="muted">n/a</span>'}</td>
  <td>${row.reconciliationStatus ?? '<span class="muted">n/a</span>'}</td>
  <td>${link(row.outputDocxPath, 'DOCX')}</td>
  <td>${link(row.outputHtmlPath, 'HTML')}</td>
  <td>${link(row.outputPdfDiagnosticPath, 'PDF (diagnostic)')}</td>
  <td>${link(row.reportPath, 'Report')}</td>
  <td>${row.ocrPageCount ?? '<span class="muted">n/a</span>'}</td>
  <td>${row.extractedWordCount ?? '<span class="muted">n/a</span>'}</td>
  <td>${warningsHtml}</td>
  <td>${errorHtml}</td>
  <td>${row.durationSeconds.toFixed(1)}s</td>
</tr>`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>WPO AI Translation Test Lab — Batch Summary (${escapeHtml(meta.batchId)})</title>
<style>
  body { font-family: -apple-system, Segoe UI, Roboto, sans-serif; margin: 24px; background: #0b0b0f; color: #e5e5ea; }
  h1 { font-size: 18px; }
  .watermark { color: #f59e0b; font-weight: 600; margin-bottom: 16px; }
  .meta { color: #9ca3af; font-size: 13px; margin-bottom: 16px; }
  table { border-collapse: collapse; width: 100%; font-size: 12px; }
  th, td { border: 1px solid #2b2b33; padding: 6px 8px; text-align: left; vertical-align: top; }
  th { background: #17171d; position: sticky; top: 0; }
  tr.status-failed { background: rgba(220, 38, 38, 0.15); }
  tr.status-skipped { background: rgba(107, 114, 128, 0.15); }
  tr.status-completed { background: rgba(16, 185, 129, 0.06); }
  .status-label { font-weight: 700; }
  tr.status-failed .status-label { color: #f87171; }
  tr.status-skipped .status-label { color: #9ca3af; }
  tr.status-completed .status-label { color: #34d399; }
  .muted { color: #6b7280; }
  .error-text { color: #f87171; }
  a { color: #60a5fa; }
</style>
</head>
<body>
<h1>WPO AI Translation Test Lab — Batch Summary</h1>
<p class="watermark">INTERNAL TEST — NOT CLIENT ORDERS — NOT PAID — NOT FOR DELIVERY</p>
<p class="meta">
  Batch: ${escapeHtml(meta.batchId)} &middot;
  Environment: ${escapeHtml(meta.environment)} &middot;
  Generated: ${escapeHtml(meta.generatedAt)} &middot;
  Files: ${meta.totalFiles} &middot;
  Completed: ${meta.completed} &middot;
  Failed: ${meta.failed} &middot;
  Skipped: ${meta.skipped}
</p>
<table>
<thead>
<tr>
  <th>#</th><th>File</th><th>Lang pair</th><th>Document type</th><th>Service level</th>
  <th>Status</th><th>Price</th><th>Reconciliation</th>
  <th>DOCX</th><th>HTML</th><th>PDF (diagnostic)</th><th>Report</th>
  <th>Pages</th><th>Words</th><th>Warnings</th><th>Error</th><th>Duration</th>
</tr>
</thead>
<tbody>
${rowsHtml}
</tbody>
</table>
</body>
</html>
`;
}
