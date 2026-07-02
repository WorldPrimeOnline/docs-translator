import { detectInputDocument, UnsupportedInputFormatError } from '../lib/input-document';

const PDF_BYTES = Buffer.from('%PDF-1.4\n%mock pdf content for tests');
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
const DOCX_BYTES = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00]); // ZIP/OOXML signature

describe('detectInputDocument — technical file format detection', () => {
  it('1. detects .pdf as application/pdf', () => {
    const result = detectInputDocument('/tmp/doc.pdf', PDF_BYTES);
    expect(result.mimeType).toBe('application/pdf');
    expect(result.inputKind).toBe('pdf');
  });

  it('2. detects .jpg as image/jpeg', () => {
    const result = detectInputDocument('/tmp/photo.jpg', JPEG_BYTES);
    expect(result.mimeType).toBe('image/jpeg');
    expect(result.inputKind).toBe('image');
  });

  it('3. detects .jpeg as image/jpeg', () => {
    const result = detectInputDocument('/tmp/photo.jpeg', JPEG_BYTES);
    expect(result.mimeType).toBe('image/jpeg');
    expect(result.inputKind).toBe('image');
  });

  it('4. detects .png as image/png', () => {
    const result = detectInputDocument('/tmp/scan.png', PNG_BYTES);
    expect(result.mimeType).toBe('image/png');
    expect(result.inputKind).toBe('image');
  });

  it('5. detects .docx as the OOXML wordprocessingml mime type', () => {
    const result = detectInputDocument('/tmp/contract.docx', DOCX_BYTES);
    expect(result.mimeType).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    expect(result.inputKind).toBe('docx');
  });

  it('6. fails clearly for an unsupported extension (.txt)', () => {
    expect(() => detectInputDocument('/tmp/notes.txt', Buffer.from('hello'))).toThrow(UnsupportedInputFormatError);
    try {
      detectInputDocument('/tmp/notes.txt', Buffer.from('hello'));
      fail('expected throw');
    } catch (err) {
      expect((err as Error).message).toContain('.txt');
      expect((err as Error).message).toMatch(/pdf.*jpg.*jpeg.*png.*docx/i);
    }
  });

  it('7. business document type is never inferred from the filename', () => {
    // A file literally named "passport.pdf" must not cause the adapter to know
    // or report anything about business document type — that comes only from
    // --document-type in the CLI layer. DetectedInputFile carries technical
    // fields only.
    const result = detectInputDocument('/tmp/passport.pdf', PDF_BYTES);
    expect(Object.keys(result).sort()).toEqual(
      ['extension', 'filename', 'inputKind', 'magicBytesMatch', 'mimeType', 'path', 'sha256', 'sizeBytes', 'warnings'].sort(),
    );
    expect(JSON.stringify(result)).not.toMatch(/passport_id|documentType|businessType/i);
  });

  it('flags a mismatch when the extension and magic bytes disagree', () => {
    const result = detectInputDocument('/tmp/fake.pdf', JPEG_BYTES);
    expect(result.magicBytesMatch).toBe(false);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('does not flag a mismatch when magic bytes agree', () => {
    const result = detectInputDocument('/tmp/real.pdf', PDF_BYTES);
    expect(result.magicBytesMatch).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it('computes a stable sha256 for the given buffer', () => {
    const a = detectInputDocument('/tmp/a.pdf', PDF_BYTES);
    const b = detectInputDocument('/tmp/b.pdf', PDF_BYTES);
    expect(a.sha256).toBe(b.sha256);
    expect(a.sha256).toHaveLength(64);
  });
});

describe('preparePdfForOcr — never lies about file format to the OCR/vision providers', () => {
  it('passes PDF input through unchanged, without calling convertToPdf', async () => {
    jest.resetModules();
    const convertToPdf = jest.fn();
    jest.doMock('@/lib/convert-to-pdf', () => ({ convertToPdf }));
    const fresh = await import('../lib/input-document');
    const freshPreparePdfForOcr = fresh.preparePdfForOcr;
    const freshDetect = fresh.detectInputDocument;

    const detected = freshDetect('/tmp/doc.pdf', PDF_BYTES);
    const result = await freshPreparePdfForOcr(detected, PDF_BYTES);

    expect(convertToPdf).not.toHaveBeenCalled();
    expect(result.pdfBuffer).toBe(PDF_BYTES);
    expect(result.warnings).toEqual([]);
    jest.dontMock('@/lib/convert-to-pdf');
  });

  it('8. JPG input is converted via convertToPdf — never sent as application/pdf directly', async () => {
    jest.resetModules();
    const converted = Buffer.from('%PDF-fake-converted-from-jpg');
    const convertToPdf = jest.fn().mockResolvedValue(converted);
    jest.doMock('@/lib/convert-to-pdf', () => ({ convertToPdf }));
    const fresh = await import('../lib/input-document');
    const freshPreparePdfForOcr = fresh.preparePdfForOcr;
    const freshDetect = fresh.detectInputDocument;

    const detected = freshDetect('/tmp/photo.jpg', JPEG_BYTES);
    const result = await freshPreparePdfForOcr(detected, JPEG_BYTES);

    expect(convertToPdf).toHaveBeenCalledWith(JPEG_BYTES, 'image/jpeg');
    expect(result.pdfBuffer).toBe(converted);
    expect(result.pdfBuffer).not.toBe(JPEG_BYTES);
    jest.dontMock('@/lib/convert-to-pdf');
  });

  it('9. PNG input is converted via convertToPdf — never sent as application/pdf directly', async () => {
    jest.resetModules();
    const converted = Buffer.from('%PDF-fake-converted-from-png');
    const convertToPdf = jest.fn().mockResolvedValue(converted);
    jest.doMock('@/lib/convert-to-pdf', () => ({ convertToPdf }));
    const fresh = await import('../lib/input-document');
    const freshPreparePdfForOcr = fresh.preparePdfForOcr;
    const freshDetect = fresh.detectInputDocument;

    const detected = freshDetect('/tmp/scan.png', PNG_BYTES);
    const result = await freshPreparePdfForOcr(detected, PNG_BYTES);

    expect(convertToPdf).toHaveBeenCalledWith(PNG_BYTES, 'image/png');
    expect(result.pdfBuffer).toBe(converted);
    jest.dontMock('@/lib/convert-to-pdf');
  });

  it('10. DOCX input goes through convertToPdf (real conversion), not the raw PDF OCR path, and records a layout-preservation warning', async () => {
    jest.resetModules();
    const converted = Buffer.from('%PDF-fake-converted-from-docx');
    const convertToPdf = jest.fn().mockResolvedValue(converted);
    jest.doMock('@/lib/convert-to-pdf', () => ({ convertToPdf }));
    const fresh = await import('../lib/input-document');
    const freshPreparePdfForOcr = fresh.preparePdfForOcr;
    const freshDetect = fresh.detectInputDocument;

    const detected = freshDetect('/tmp/contract.docx', DOCX_BYTES);
    const result = await freshPreparePdfForOcr(detected, DOCX_BYTES);

    expect(convertToPdf).toHaveBeenCalledWith(
      DOCX_BYTES,
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    expect(result.pdfBuffer).toBe(converted);
    expect(result.warnings.some((w: string) => w.toLowerCase().includes('layout preservation is partial'))).toBe(true);
    jest.dontMock('@/lib/convert-to-pdf');
  });
});
