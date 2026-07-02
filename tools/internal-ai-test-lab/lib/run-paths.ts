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
