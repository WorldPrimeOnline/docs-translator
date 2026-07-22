/**
 * Cheap physical page count via pdf-lib — no OCR needed. Same API already used elsewhere in
 * this codebase (mergePdfs() in src/lib/convert-to-pdf.ts).
 */
import { PDFDocument } from 'pdf-lib';

export async function getPhysicalPageCount(pdfBuffer: Buffer): Promise<number> {
  try {
    const doc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
    return Math.max(1, doc.getPageCount());
  } catch {
    return 1;
  }
}
