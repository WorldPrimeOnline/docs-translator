/**
 * Universal input adapter for the Internal AI Translation Test Lab.
 *
 * File FORMAT (pdf/jpg/png/docx — a technical concept) is completely separate
 * from business DOCUMENT TYPE (passport, bank_statement, ... — always comes
 * from --document-type, never inferred from the filename or file content).
 *
 * OCR strategy: worker/src/lib/ocr.ts's extractTextFromPdf() always sends
 * `data:application/pdf;base64,...` to Mistral — it must never receive bytes
 * that aren't actually a PDF. So non-PDF input is converted to a REAL PDF
 * first via the existing production intake path (src/lib/convert-to-pdf.ts —
 * the same module src/app/api/documents/upload/route.ts and
 * upload-card/route.ts already use for JPG/PNG/DOCX uploads), not by
 * mislabeling the mime type. convertToPdf() has no env-dependent imports, so
 * it's safe to import once dotenv has loaded (imported lazily inside
 * preparePdfForOcr() below, consistent with this tool's dynamic-import rule).
 */
import * as path from 'node:path';
import * as crypto from 'node:crypto';

export type InputKind = 'pdf' | 'image' | 'docx';

export interface DetectedInputFile {
  path: string;
  filename: string;
  extension: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  inputKind: InputKind;
  /** false when the file's magic bytes disagree with what the extension implies. */
  magicBytesMatch: boolean;
  warnings: string[];
}

export class UnsupportedInputFormatError extends Error {}

const EXTENSION_MAP: Record<string, { mime: string; kind: InputKind }> = {
  '.pdf': { mime: 'application/pdf', kind: 'pdf' },
  '.jpg': { mime: 'image/jpeg', kind: 'image' },
  '.jpeg': { mime: 'image/jpeg', kind: 'image' },
  '.png': { mime: 'image/png', kind: 'image' },
  '.docx': { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', kind: 'docx' },
};

export const SUPPORTED_EXTENSIONS = Object.keys(EXTENSION_MAP);

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Best-effort magic-byte sniff. Returns null when the signature is unrecognized (not an error). */
function sniffMagicMime(buffer: Buffer): string | null {
  if (buffer.length >= 4 && buffer.subarray(0, 4).toString('latin1') === '%PDF') return 'application/pdf';
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return 'image/png';
  // DOCX (OOXML) is a ZIP container — shares its "PK" signature with xlsx/pptx/plain
  // zip files, so this is a coarse, warning-level check only, not a strict identity check.
  if (buffer.length >= 2 && buffer[0] === 0x50 && buffer[1] === 0x4b) {
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  }
  return null;
}

/**
 * Detects technical file format from extension (+ magic-byte cross-check).
 * Pure given an in-memory buffer — the caller reads the file from --file and
 * passes the buffer in, keeping this function unit-testable without disk I/O.
 * Throws UnsupportedInputFormatError for any extension outside
 * SUPPORTED_EXTENSIONS — never silently guesses a format.
 */
export function detectInputDocument(filePath: string, buffer: Buffer): DetectedInputFile {
  const extension = path.extname(filePath).toLowerCase();
  const mapped = EXTENSION_MAP[extension];
  if (!mapped) {
    throw new UnsupportedInputFormatError(
      `Unsupported input file extension "${extension || '(none)'}". Supported: ${SUPPORTED_EXTENSIONS.join(', ')}`,
    );
  }

  const warnings: string[] = [];
  const sniffed = sniffMagicMime(buffer);
  const magicBytesMatch = sniffed === null || sniffed === mapped.mime;
  if (!magicBytesMatch) {
    warnings.push(
      `File extension "${extension}" implies ${mapped.mime}, but the file's magic bytes look like ${sniffed}. Proceeding with the extension-declared type.`,
    );
  }

  return {
    path: filePath,
    filename: path.basename(filePath),
    extension,
    mimeType: mapped.mime,
    sizeBytes: buffer.length,
    sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
    inputKind: mapped.kind,
    magicBytesMatch,
    warnings,
  };
}

export interface PreparedPdf {
  pdfBuffer: Buffer;
  warnings: string[];
}

/**
 * Returns a real PDF buffer suitable for extractTextFromPdf(). PDFs pass
 * through unchanged; JPG/PNG/DOCX are genuinely converted via the existing
 * production convertToPdf() — never relabeled.
 */
export async function preparePdfForOcr(detected: DetectedInputFile, buffer: Buffer): Promise<PreparedPdf> {
  if (detected.inputKind === 'pdf') {
    return { pdfBuffer: buffer, warnings: [] };
  }

  const { convertToPdf } = await import('@/lib/convert-to-pdf');
  const warnings: string[] = [];

  if (detected.inputKind === 'docx') {
    warnings.push(
      'DOCX layout preservation is partial in CLI test mode (plain-text extraction via mammoth, then reflowed into a plain PDF — tables/headings/formatting are not preserved).',
    );
  } else {
    warnings.push(`Image input (${detected.mimeType}) converted to a single-page PDF before OCR.`);
  }

  const pdfBuffer = await convertToPdf(buffer, detected.mimeType);
  return { pdfBuffer, warnings };
}
