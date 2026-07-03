/**
 * Orchestrates running every manifest entry through processDocument(),
 * building batch-summary rows. Sequential by default (concurrency=1); see
 * cli-args.ts for the hard cap of 2.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import { buildItemFolderName, buildItemPaths, ensureRunDirs } from './run-paths';
import { createLogger, type Logger } from './logger';
import { processDocument } from './process-document';
import type { BatchSummaryRow, Environment, ManifestEntry } from './types';

export interface BatchRunnerInput {
  entries: ManifestEntry[];
  inputDir: string;
  itemsDir: string;
  environment: Environment;
  operatorEmail?: string;
  maxFileMb: number;
  maxPages: number;
  dryRunPricingOnly: boolean;
  skipRender: boolean;
  keepIntermediate: boolean;
  saveToR2: boolean;
  debugFullText: boolean;
  continueOnError: boolean;
  skipExisting: boolean;
  concurrency: number;
  batchLogger: Logger;
}

export interface BatchRunResult {
  rows: BatchSummaryRow[];
  stoppedEarly: boolean;
}

function reportPathFor(itemsDir: string, folderName: string): string {
  return path.join(itemsDir, folderName, 'report', 'report.INTERNAL_TEST.json');
}

async function runOneItem(
  entry: ManifestEntry,
  position: number,
  input: BatchRunnerInput,
): Promise<BatchSummaryRow> {
  const folderName = buildItemFolderName(position, entry.sourceLanguage, entry.targetLanguage, entry.documentType, entry.file);
  const paths = buildItemPaths(input.itemsDir, folderName);
  const started = Date.now();

  if (input.skipExisting && fs.existsSync(reportPathFor(input.itemsDir, folderName))) {
    input.batchLogger.info(`[${position}] ${entry.file} — SKIPPED (existing completed report found at ${folderName})`);
    return {
      index: position,
      file: entry.file,
      sourceLanguage: entry.sourceLanguage,
      targetLanguage: entry.targetLanguage,
      documentType: entry.documentType,
      serviceLevel: entry.serviceLevel,
      status: 'skipped',
      itemFolder: folderName,
      finalPriceKzt: null,
      reconciliationStatus: null,
      outputDocxPath: null,
      outputHtmlPath: null,
      outputPdfDiagnosticPath: null,
      reportPath: reportPathFor(input.itemsDir, folderName),
      ocrPageCount: null,
      extractedWordCount: null,
      warningsCount: 0,
      warnings: [],
      errorCode: null,
      errorMessage: null,
      durationSeconds: 0,
      notes: entry.notes,
    };
  }

  ensureRunDirs(paths);
  const itemLogger = createLogger(paths.logFile);
  // Guarantees run.log exists for this item even if processDocument fails
  // before its first internal log call (e.g. a pre-flight validation error).
  itemLogger.info(`item ${position}: ${entry.file} — starting`);
  input.batchLogger.info(`[${position}] ${entry.file} — starting (${folderName})`);

  try {
    const result = await processDocument({
      file: path.join(input.inputDir, entry.file),
      sourceLanguage: entry.sourceLanguage,
      targetLanguage: entry.targetLanguage,
      documentTypeRaw: entry.documentType,
      serviceLevelRaw: entry.serviceLevel,
      urgencyRaw: entry.urgency,
      fulfillmentMethodRaw: entry.fulfillmentMethod,
      notaryCity: entry.notaryCity,
      deliveryCity: entry.deliveryCity,
      dryRunPricingOnly: input.dryRunPricingOnly,
      skipRender: input.skipRender,
      keepIntermediate: input.keepIntermediate,
      saveToR2: input.saveToR2,
      debugFullText: input.debugFullText,
      maxFileMb: input.maxFileMb,
      maxPages: input.maxPages,
      environment: input.environment,
      operatorEmail: input.operatorEmail,
      paths,
      logger: itemLogger,
    });

    input.batchLogger.info(
      `[${position}] ${entry.file} — ${result.status.toUpperCase()} in ${result.durationSeconds.toFixed(1)}s` +
        (result.status === 'failed' ? ` (${result.errorCode}: ${result.errorMessage})` : ''),
    );

    return {
      index: position,
      file: entry.file,
      sourceLanguage: entry.sourceLanguage,
      targetLanguage: entry.targetLanguage,
      documentType: entry.documentType,
      serviceLevel: entry.serviceLevel,
      status: result.status,
      itemFolder: folderName,
      finalPriceKzt: result.pricingAmountKzt,
      reconciliationStatus: result.reconciliationStatus,
      outputDocxPath: result.translatedDocxPath,
      outputHtmlPath: result.translatedHtmlPath,
      outputPdfDiagnosticPath: result.translatedPdfPath,
      reportPath: result.reportHtmlPath,
      ocrPageCount: result.pageCount,
      extractedWordCount: result.extractedWordCount,
      warningsCount: result.warnings.length,
      warnings: result.warnings,
      errorCode: result.errorCode,
      errorMessage: result.errorMessage,
      durationSeconds: result.durationSeconds,
      notes: entry.notes,
    };
  } catch (err) {
    // processDocument() catches internally and should never throw — this is a
    // last-resort guard so one item can never crash the whole batch process.
    const msg = err instanceof Error ? err.message : String(err);
    input.batchLogger.error(`[${position}] ${entry.file} — UNEXPECTED ERROR: ${msg}`);
    return {
      index: position,
      file: entry.file,
      sourceLanguage: entry.sourceLanguage,
      targetLanguage: entry.targetLanguage,
      documentType: entry.documentType,
      serviceLevel: entry.serviceLevel,
      status: 'failed',
      itemFolder: folderName,
      finalPriceKzt: null,
      reconciliationStatus: null,
      outputDocxPath: null,
      outputHtmlPath: null,
      outputPdfDiagnosticPath: null,
      reportPath: null,
      ocrPageCount: null,
      extractedWordCount: null,
      warningsCount: 0,
      warnings: [],
      errorCode: 'UNEXPECTED_ERROR',
      errorMessage: msg,
      durationSeconds: (Date.now() - started) / 1000,
      notes: entry.notes,
    };
  }
}

export async function runBatch(input: BatchRunnerInput): Promise<BatchRunResult> {
  const rows: BatchSummaryRow[] = [];
  let stoppedEarly = false;

  const items = input.entries.map((entry, i) => ({ entry, position: i + 1 }));

  for (let chunkStart = 0; chunkStart < items.length; chunkStart += input.concurrency) {
    if (stoppedEarly) break;
    const chunk = items.slice(chunkStart, chunkStart + input.concurrency);
    const chunkResults = await Promise.all(chunk.map((item) => runOneItem(item.entry, item.position, input)));
    for (const row of chunkResults) {
      rows.push(row);
      if (row.status === 'failed' && !input.continueOnError) {
        stoppedEarly = true;
        input.batchLogger.warn(`Stopping batch — item ${row.index} (${row.file}) failed and --stop-on-error is set.`);
      }
    }
  }

  return { rows, stoppedEarly };
}
