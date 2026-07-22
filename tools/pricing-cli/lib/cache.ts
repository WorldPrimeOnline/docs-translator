/**
 * Local-only SHA-256 cache for document analysis (OCR/text-extraction) results, so re-running
 * the same file doesn't re-invoke paid OCR. Keyed by sha256(file bytes + mimeType) — content,
 * not filename, so renaming a file still hits the cache and editing it still misses.
 *
 * Never stores secrets (no API keys/tokens) — only the DocumentAnalysisResult shape (extracted
 * text, page counts, quality signals). Entirely local (.pricing-cache/, gitignored); never
 * synced to Supabase/R2/anywhere.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import type { DocumentAnalysisResult } from '@/lib/document-analysis/analyze';

export const DEFAULT_CACHE_DIR = '.pricing-cache';

export function hashFile(buffer: Buffer, mimeType: string): string {
  return crypto.createHash('sha256').update(mimeType).update(buffer).digest('hex');
}

function entryPath(cacheDir: string, hash: string): string {
  return path.join(cacheDir, `${hash}.json`);
}

export function readCacheEntry(cacheDir: string, hash: string): DocumentAnalysisResult | null {
  try {
    const raw = fs.readFileSync(entryPath(cacheDir, hash), 'utf-8');
    return JSON.parse(raw) as DocumentAnalysisResult;
  } catch {
    return null;
  }
}

export function writeCacheEntry(cacheDir: string, hash: string, result: DocumentAnalysisResult): void {
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(entryPath(cacheDir, hash), JSON.stringify(result, null, 2), 'utf-8');
}

export function clearCacheDir(cacheDir: string): void {
  fs.rmSync(cacheDir, { recursive: true, force: true });
}
