/**
 * DOCX text extraction — mammoth.extractRawText(), the SAME call already used pre-payment in
 * src/lib/convert-to-pdf.ts's docxBufferToPdf() (which uses it to render a plain-text PDF for
 * storage). Here we use mammoth's raw text directly, for character counting — never routed
 * through the lossy DOCX->plain-PDF rendering step, which would not preserve real text extent.
 */
import mammoth from 'mammoth';

export async function extractDocxText(docxBuffer: Buffer): Promise<string> {
  const { value } = await mammoth.extractRawText({ buffer: docxBuffer });
  return value;
}
