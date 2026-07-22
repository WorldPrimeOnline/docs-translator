import * as fs from 'node:fs';
import * as path from 'node:path';

/** e.g. 20260720T143000Z */
export function generateRunTimestamp(now: Date = new Date()): string {
  return now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
}

export function buildRunDir(outputDir: string, timestamp: string): string {
  return path.join(outputDir, timestamp);
}

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

/** <basename-without-extension>.report.json / .report.md */
export function reportBaseName(filename: string): string {
  return filename.replace(/\.[^./]+$/, '');
}
