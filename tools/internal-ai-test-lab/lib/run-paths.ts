import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import type { RunPaths } from './types';

/** Timestamp + short random suffix, e.g. 20260702T184600Z_ab12cd34 */
export function generateRunId(now: Date = new Date()): string {
  const ts = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const suffix = crypto.randomBytes(4).toString('hex');
  return `${ts}_${suffix}`;
}

/** Pure path computation — no filesystem access. */
export function buildRunPaths(outputDir: string, runId: string): RunPaths {
  const runDir = path.join(outputDir, runId);
  return {
    runId,
    runDir,
    sourceDir: path.join(runDir, 'source'),
    ocrDir: path.join(runDir, 'ocr'),
    translationDir: path.join(runDir, 'translation'),
    renderedDir: path.join(runDir, 'rendered'),
    pricingDir: path.join(runDir, 'pricing'),
    reportDir: path.join(runDir, 'report'),
    logFile: path.join(runDir, 'run.log'),
  };
}

export function ensureRunDirs(paths: RunPaths): void {
  for (const dir of [
    paths.runDir,
    paths.sourceDir,
    paths.ocrDir,
    paths.translationDir,
    paths.renderedDir,
    paths.pricingDir,
    paths.reportDir,
  ]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// ─── Batch mode ──────────────────────────────────────────────────────────────

/** e.g. batch_20260703T120000Z_ab12cd34 */
export function generateBatchId(now: Date = new Date()): string {
  return `batch_${generateRunId(now)}`;
}

export interface BatchPaths {
  batchId: string;
  batchDir: string;
  itemsDir: string;
  summaryJsonPath: string;
  summaryCsvPath: string;
  summaryHtmlPath: string;
  logFile: string;
}

export function buildBatchPaths(outputDir: string, batchId: string): BatchPaths {
  const batchDir = path.join(outputDir, batchId);
  return {
    batchId,
    batchDir,
    itemsDir: path.join(batchDir, 'items'),
    summaryJsonPath: path.join(batchDir, 'batch-summary.json'),
    summaryCsvPath: path.join(batchDir, 'batch-summary.csv'),
    summaryHtmlPath: path.join(batchDir, 'batch-summary.html'),
    logFile: path.join(batchDir, 'batch.log'),
  };
}

export function ensureBatchDirs(paths: BatchPaths): void {
  fs.mkdirSync(paths.batchDir, { recursive: true });
  fs.mkdirSync(paths.itemsDir, { recursive: true });
}

/**
 * Reuses the single-run RunPaths shape for one batch item, nested under
 * items/<folderName>/ instead of its own top-level runs/<runId>/ folder —
 * "reuse the existing single-run output structure as much as possible."
 */
export function buildItemPaths(itemsDir: string, folderName: string): RunPaths {
  const runDir = path.join(itemsDir, folderName);
  return {
    runId: folderName,
    runDir,
    sourceDir: path.join(runDir, 'source'),
    ocrDir: path.join(runDir, 'ocr'),
    translationDir: path.join(runDir, 'translation'),
    renderedDir: path.join(runDir, 'rendered'),
    pricingDir: path.join(runDir, 'pricing'),
    reportDir: path.join(runDir, 'report'),
    logFile: path.join(runDir, 'run.log'),
  };
}

/**
 * Safe folder name: <index>_<source>_<target>_<documentType>_<slug-of-filename>.
 * No spaces or characters outside [a-z0-9_-] survive.
 */
export function buildItemFolderName(
  index: number,
  sourceLanguage: string,
  targetLanguage: string,
  documentType: string,
  fileName: string,
): string {
  const slugify = (s: string): string =>
    s
      .toLowerCase()
      .replace(/\.[^./]+$/, '') // strip extension
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 60);
  const paddedIndex = String(index).padStart(2, '0');
  return [paddedIndex, slugify(sourceLanguage), slugify(targetLanguage), slugify(documentType), slugify(fileName)]
    .filter(Boolean)
    .join('_');
}
