/**
 * analyzeDocumentForPricing — the shared, reusable analysis orchestrator (2026-07-17 decision).
 * Same functions used here will back the real pre-payment document_analysis pipeline once
 * wired into checkout — the internal Pricing Lab's file-mode is the first caller.
 *
 * Method resolution:
 *   - DOCX  -> mammoth.extractRawText() directly (extract-docx.ts). Physical page count is
 *              still derived via convertToPdf()+pdf-lib (matches how the real pipeline will
 *              need a physical page count for the O component even for DOCX uploads).
 *   - PDF   -> try the embedded text layer first (pdf-text-layer.ts); fall back to Mistral OCR
 *              (@/lib/ocr/mistral, already exists and is reused as-is, NOT duplicated) if the
 *              text layer is empty/too sparse.
 *   - Image -> converted to a one-page PDF via the existing convertToPdf() (src/lib/convert-to-pdf.ts,
 *              already used elsewhere for this exact purpose), then OCR'd the same way a
 *              scanned PDF would be — no separate image-specific OCR code path needed.
 *
 * Never fabricates a character count or falls back to a guessed page count on failure —
 * failure routes to operator_review with a real reason, per docs/ai-context/DECISIONS.md.
 */
import { convertToPdf } from '@/lib/convert-to-pdf';
import { extractTextFromPdf } from '@/lib/ocr/mistral';
import { extractDocxText } from './docx';
import { getPhysicalPageCount } from './physical-pages';
import { normalizeSourceTextForPricing } from './normalize';
// 2026-07-24: NOT a top-level import — pdf-text-layer.ts wraps `pdf-parse` (pdfjs-dist +
// @napi-rs/canvas internally), which crashed at module-init time in some bundling contexts
// ("ReferenceError: DOMMatrix is not defined"). Loaded dynamically, only inside the non-DOCX
// (PDF/image) branch below — a DOCX-only analysis never touches this chain at all. See also
// next.config.ts's serverExternalPackages (stops webpack from mangling the native canvas
// binary) and upload-card-shared.ts's matching dynamic import of this whole module.

export type AnalysisMethod = 'docx_text' | 'pdf_text_layer' | 'ocr' | 'manual';

export interface AnalysisQualitySignals {
  method: AnalysisMethod;
  rawCharacterCount: number;
  emptyOrNearEmpty: boolean;
  charsPerPhysicalPage: number;
  possiblyHandwrittenOrIllegible: boolean;
  ocrPageCount?: number;
}

export interface DocumentAnalysisResult {
  method: AnalysisMethod;
  rawText: string;
  normalizedText: string;
  characterCount: number;
  /** null for DOCX when the page-count render fails — never a fabricated guess (2026-07-21). */
  physicalPageCount: number | null;
  qualitySignals: AnalysisQualitySignals;
  requiresOperatorReview: boolean;
  reviewReasons: string[];
}

const MIN_CHARS_PER_PAGE_AFTER_OCR = 15;

function isDocx(mimeType: string): boolean {
  return mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
}

export interface AnalyzeDocumentOptions {
  /** Forwarded verbatim to extractTextFromPdf() — see its docblock (@/lib/ocr/mistral.ts). */
  mistralApiKey?: string;
}

export async function analyzeDocumentForPricing(
  buffer: Buffer,
  mimeType: string,
  options?: AnalyzeDocumentOptions,
): Promise<DocumentAnalysisResult> {
  const reviewReasons: string[] = [];
  let method: AnalysisMethod;
  let rawText: string;
  let physicalPageCount: number | null;
  let ocrPageCount: number | undefined;

  if (isDocx(mimeType)) {
    method = 'docx_text';
    try {
      rawText = await extractDocxText(buffer);
    } catch (err) {
      reviewReasons.push(`DOCX text extraction failed: ${err instanceof Error ? err.message : String(err)}`);
      rawText = '';
    }
    try {
      const pdfForPageCount = await convertToPdf(buffer, mimeType);
      physicalPageCount = await getPhysicalPageCount(pdfForPageCount);
    } catch {
      // Never fabricate a page count — a reliable count requires rendering, and rendering just
      // failed. Billing must fall back to characterPages (see calculateOfficialNotaryPrice's
      // reliablePhysicalPageCount gate) rather than silently billing off an invented "1 page".
      physicalPageCount = null;
    }
  } else {
    let pdfBuffer: Buffer;
    try {
      pdfBuffer = mimeType === 'application/pdf' ? buffer : await convertToPdf(buffer, mimeType);
    } catch (err) {
      return {
        method: 'manual', rawText: '', normalizedText: '', characterCount: 0, physicalPageCount: 1,
        qualitySignals: { method: 'manual', rawCharacterCount: 0, emptyOrNearEmpty: true, charsPerPhysicalPage: 0, possiblyHandwrittenOrIllegible: false },
        requiresOperatorReview: true,
        reviewReasons: [`Failed to prepare file for analysis: ${err instanceof Error ? err.message : String(err)}`],
      };
    }
    physicalPageCount = await getPhysicalPageCount(pdfBuffer);

    // Dynamic import — see the top-of-file comment; only PDFs/images ever reach this branch.
    const { extractPdfTextLayer, isTextLayerSufficient } = await import('./pdf-text-layer');
    const textLayer = await extractPdfTextLayer(pdfBuffer);
    if (isTextLayerSufficient(textLayer)) {
      method = 'pdf_text_layer';
      rawText = textLayer!.text;
    } else {
      method = 'ocr';
      try {
        const ocrResult = await extractTextFromPdf(pdfBuffer, { mistralApiKey: options?.mistralApiKey });
        rawText = ocrResult.markdown;
        ocrPageCount = ocrResult.pageCount;
      } catch (err) {
        reviewReasons.push(`OCR failed: ${err instanceof Error ? err.message : String(err)}`);
        rawText = '';
      }
    }
  }

  const { normalizedText, characterCount } = normalizeSourceTextForPricing(rawText);
  // physicalPageCount === null (DOCX render failure) means this sanity check can't run — there's
  // no reliable page count to compare against, and docx_text already means extraction succeeded.
  const charsPerPhysicalPage = physicalPageCount != null && physicalPageCount > 0 ? characterCount / physicalPageCount : 0;
  const emptyOrNearEmpty = characterCount === 0;
  const possiblyHandwrittenOrIllegible = physicalPageCount != null && !emptyOrNearEmpty && charsPerPhysicalPage < MIN_CHARS_PER_PAGE_AFTER_OCR;

  if (emptyOrNearEmpty) {
    reviewReasons.push('No text could be extracted from this document — requires operator review, no fallback estimate.');
  } else if (possiblyHandwrittenOrIllegible) {
    reviewReasons.push(`Extracted text is unusually short for ${physicalPageCount} physical page(s) (${charsPerPhysicalPage.toFixed(1)} chars/page) — possibly handwritten or illegible, requires operator review.`);
  }

  const qualitySignals: AnalysisQualitySignals = {
    method, rawCharacterCount: characterCount, emptyOrNearEmpty, charsPerPhysicalPage,
    possiblyHandwrittenOrIllegible, ocrPageCount,
  };

  return {
    method, rawText, normalizedText, characterCount, physicalPageCount,
    qualitySignals, requiresOperatorReview: reviewReasons.length > 0, reviewReasons,
  };
}
