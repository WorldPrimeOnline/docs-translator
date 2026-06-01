import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import sharp from 'sharp';
import mammoth from 'mammoth';

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

async function docxBufferToPdf(docxBuffer: Buffer): Promise<Buffer> {
  const { value: text } = await mammoth.extractRawText({ buffer: docxBuffer });

  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
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
    page.drawText(line, { x: margin, y, size: fontSize, font, color: rgb(0, 0, 0) });
    y -= lineHeight;
  }

  const bytes = await pdfDoc.save();
  return Buffer.from(bytes);
}

function wrapText(text: string, font: ReturnType<typeof Object.create>, fontSize: number, maxWidth: number): string[] {
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
      const width: number = font.widthOfTextAtSize(candidate, fontSize);
      if (width > maxWidth && current) {
        result.push(current);
        current = word;
      } else {
        current = candidate;
      }
    }
    if (current) result.push(current);
  }
  return result;
}
