/**
 * Per-file analysis orchestration: extension -> mime type, cache lookup, PDF encrypted/corrupted
 * preflight, --no-ocr short-circuit, then the SAME analyzeDocumentForPricing() the real
 * document_analysis pipeline uses (src/lib/document-analysis/analyze.ts) — never a separate
 * extraction implementation for this CLI.
 */
import { analyzeDocumentForPricing, type DocumentAnalysisResult } from '@/lib/document-analysis/analyze';
import { extractPdfTextLayer, isTextLayerSufficient } from '@/lib/document-analysis/pdf-text-layer';
import { hashFile, readCacheEntry, writeCacheEntry } from './cache';
import { preflightPdf, type PdfPreflightStatus } from './pdf-preflight';

export const SUPPORTED_EXTENSIONS = ['.docx', '.pdf', '.jpg', '.jpeg', '.png'] as const;
export type SupportedExtension = (typeof SUPPORTED_EXTENSIONS)[number];

const MIME_BY_EXTENSION: Record<SupportedExtension, string> = {
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
};

function isSupportedExtension(ext: string): ext is SupportedExtension {
  return (SUPPORTED_EXTENSIONS as readonly string[]).includes(ext);
}

export type LocalAnalysisOutcome =
  | { kind: 'analyzed'; result: DocumentAnalysisResult; fromCache: boolean }
  | { kind: 'skipped_ocr'; reason: string }
  | { kind: 'preflight_failed'; status: Exclude<PdfPreflightStatus, 'ok'> }
  | { kind: 'unsupported_type' };

export interface AnalyzeLocalFileOptions {
  noOcr: boolean;
  noCache: boolean;
  cacheDir: string;
  /** Passed straight through to analyzeDocumentForPricing() -> extractTextFromPdf(); never
   * read from @/lib/env — see lib/env-loader.ts's checkOcrEnvOrThrow(). */
  mistralApiKey?: string;
}

export async function analyzeLocalFile(
  buffer: Buffer,
  extension: string,
  opts: AnalyzeLocalFileOptions,
): Promise<LocalAnalysisOutcome> {
  const ext = extension.toLowerCase();
  if (!isSupportedExtension(ext)) return { kind: 'unsupported_type' };
  const mimeType = MIME_BY_EXTENSION[ext];

  const hash = hashFile(buffer, mimeType);
  if (!opts.noCache) {
    const cached = readCacheEntry(opts.cacheDir, hash);
    if (cached) return { kind: 'analyzed', result: cached, fromCache: true };
  }

  if (mimeType === 'application/pdf') {
    const preflight = await preflightPdf(buffer);
    if (preflight !== 'ok') return { kind: 'preflight_failed', status: preflight };
  }

  if (opts.noOcr) {
    if (mimeType === 'image/jpeg' || mimeType === 'image/png') {
      return { kind: 'skipped_ocr', reason: 'Image files require OCR; --no-ocr is set — marked for operator review.' };
    }
    if (mimeType === 'application/pdf') {
      const textLayer = await extractPdfTextLayer(buffer);
      if (!isTextLayerSufficient(textLayer)) {
        return {
          kind: 'skipped_ocr',
          reason: 'Scanned PDF (no usable embedded text layer) requires OCR; --no-ocr is set — marked for operator review.',
        };
      }
      // Sufficient text layer — falls through to the real analysis below, which will resolve
      // to method 'pdf_text_layer' and never invoke OCR (confirmed by the same check it runs internally).
    }
  }

  const result = await analyzeDocumentForPricing(buffer, mimeType, { mistralApiKey: opts.mistralApiKey });
  if (!opts.noCache) writeCacheEntry(opts.cacheDir, hash, result);
  return { kind: 'analyzed', result, fromCache: false };
}
