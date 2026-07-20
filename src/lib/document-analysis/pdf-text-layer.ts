/**
 * PDF text-layer extraction — tried BEFORE falling back to OCR, since a born-digital PDF
 * already has an embedded text layer and doesn't need (costly, slower) OCR at all.
 *
 * Uses `pdf-parse` (pure-JS, wraps pdf.js, no native bindings — runs identically in any Node
 * runtime). Returns null (never throws) on encrypted/corrupted/unextractable PDFs so the
 * caller can fall back to OCR without special-casing exceptions.
 */
import { PDFParse } from 'pdf-parse';

export interface PdfTextLayerResult {
  text: string;
  pageCount: number;
}

export async function extractPdfTextLayer(pdfBuffer: Buffer): Promise<PdfTextLayerResult | null> {
  let parser: InstanceType<typeof PDFParse> | null = null;
  try {
    parser = new PDFParse({ data: new Uint8Array(pdfBuffer) });
    const result = await parser.getText();
    return { text: result.text ?? '', pageCount: result.total ?? 0 };
  } catch {
    // Encrypted, corrupted, or otherwise unparseable — signal "no text layer", not an error.
    return null;
  } finally {
    await parser?.destroy().catch(() => undefined);
  }
}

/** Heuristic: is the extracted text layer substantial enough to trust, or is this really a scanned/image PDF needing OCR? */
export function isTextLayerSufficient(result: PdfTextLayerResult | null): boolean {
  if (!result || result.pageCount <= 0) return false;
  const charsPerPage = result.text.length / result.pageCount;
  // A born-digital page of real prose has at least a few dozen characters; a scanned page
  // with no text layer returns ~0. 20 chars/page is a deliberately low bar (never falsely
  // reject a real but sparse document), not a quality threshold.
  return charsPerPage >= 20;
}
