/**
 * Classifies a PDF as encrypted vs. corrupted BEFORE handing it to the shared document-analysis
 * pipeline (which always passes `ignoreEncryption: true` and so can't tell the two apart on its
 * own — see src/lib/document-analysis/physical-pages.ts). This is a CLI-only classification
 * step for the report's failure-reason taxonomy (README §Error handling); it never re-implements
 * extraction — analyzeDocumentForPricing() still does all the real work afterward.
 */
import { PDFDocument, EncryptedPDFError } from 'pdf-lib';

export type PdfPreflightStatus = 'ok' | 'encrypted' | 'corrupted';

export async function preflightPdf(buffer: Buffer): Promise<PdfPreflightStatus> {
  try {
    await PDFDocument.load(buffer);
    return 'ok';
  } catch (err) {
    if (err instanceof EncryptedPDFError) return 'encrypted';
    const message = err instanceof Error ? err.message : String(err);
    if (/encrypt/i.test(message)) return 'encrypted';
    return 'corrupted';
  }
}
