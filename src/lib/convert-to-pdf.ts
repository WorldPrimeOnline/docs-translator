import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import sharp from 'sharp';
import mammoth from 'mammoth';
import fs from 'fs';
import path from 'path';

export async function mergePdfs(pdfBuffers: Buffer[]): Promise<Buffer> {
  if (pdfBuffers.length === 1) return pdfBuffers[0]!;
  const merged = await PDFDocument.create();
  for (const buf of pdfBuffers) {
    const doc = await PDFDocument.load(buf, { ignoreEncryption: true });
    const pages = await merged.copyPages(doc, doc.getPageIndices());
    pages.forEach((p) => merged.addPage(p));
  }
  return Buffer.from(await merged.save());
}

export async function convertToPdf(buffer: Buffer, mimeType: string): Promise<Buffer> {
  if (mimeType === 'application/pdf') return buffer;

  if (mimeType === 'image/jpeg' || mimeType === 'image/png') {
    return imageBufferToPdf(buffer);
  }

  if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    return docxBufferToPdf(buffer);
  }

  throw new Error(`Unsupported file type: ${mimeType}`);
}

async function imageBufferToPdf(imageBuffer: Buffer): Promise<Buffer> {
  const pngBuffer = await sharp(imageBuffer).png().toBuffer();
  const metadata = await sharp(imageBuffer).metadata();

  const pdfDoc = await PDFDocument.create();
  const img = await pdfDoc.embedPng(pngBuffer);

  const pageWidth = metadata.width ?? img.width;
  const pageHeight = metadata.height ?? img.height;

  const page = pdfDoc.addPage([pageWidth, pageHeight]);
  page.drawImage(img, { x: 0, y: 0, width: pageWidth, height: pageHeight });

  const bytes = await pdfDoc.save();
  return Buffer.from(bytes);
}

// Load NotoSans-Regular once per process (sync, small — ~500 KB bundled in public/fonts/).
// NotoSans covers Latin, Cyrillic, Kazakh, Turkish, and most Unicode ranges required by WPO.
// This conversion is for upload intake / OCR / payment workflow only.
// It is NOT the final official translation output renderer.
// The frozen official DOCX renderer lives in worker/src/lib/docx-renderer.ts.
let notoSansFontBytes: Buffer | null = null;
function getNotoSansFont(): Buffer {
  if (!notoSansFontBytes) {
    const fontPath = path.join(process.cwd(), 'public', 'fonts', 'NotoSans-Regular.ttf');
    notoSansFontBytes = fs.readFileSync(fontPath);
  }
  return notoSansFontBytes;
}

async function docxBufferToPdf(docxBuffer: Buffer): Promise<Buffer> {
  // Extract plain text from DOCX; mammoth preserves Unicode content.
  const { value: text } = await mammoth.extractRawText({ buffer: docxBuffer });

  const fontBytes = getNotoSansFont();
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);
  const font = await pdfDoc.embedFont(fontBytes);

  const fontSize = 11;
  const margin = 50;
  const lineHeight = fontSize * 1.4;
  const pageWidth = 595;
  const pageHeight = 842;
  const maxWidth = pageWidth - margin * 2;

  const lines = wrapText(text, font, fontSize, maxWidth);

  let page = pdfDoc.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;

  for (const line of lines) {
    if (y < margin + lineHeight) {
      page = pdfDoc.addPage([pageWidth, pageHeight]);
      y = pageHeight - margin;
    }
    if (line) {
      page.drawText(line, { x: margin, y, size: fontSize, font, color: rgb(0, 0, 0) });
    }
    y -= lineHeight;
  }

  const bytes = await pdfDoc.save();
  return Buffer.from(bytes);
}

// pdf-lib doesn't export the font class type directly; use the inferred return type.
type EmbeddedFont = Awaited<ReturnType<PDFDocument['embedFont']>>;

function wrapText(
  text: string,
  font: EmbeddedFont,
  fontSize: number,
  maxWidth: number,
): string[] {
  const result: string[] = [];
  for (const paragraph of text.split('\n')) {
    if (paragraph.trim() === '') {
      result.push('');
      continue;
    }
    const words = paragraph.split(' ');
    let current = '';
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      try {
        const width: number = font.widthOfTextAtSize(candidate, fontSize);
        if (width > maxWidth && current) {
          result.push(current);
          current = word;
        } else {
          current = candidate;
        }
      } catch {
        // If a glyph is missing from the font, push what we have and continue.
        if (current) result.push(current);
        current = word;
      }
    }
    if (current) result.push(current);
  }
  return result;
}
