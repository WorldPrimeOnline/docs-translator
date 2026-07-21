import { PDFDocument } from 'pdf-lib';
import { preflightPdf } from '../lib/pdf-preflight';

describe('preflightPdf', () => {
  it('returns "ok" for a real, valid PDF', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([100, 100]);
    const buffer = Buffer.from(await doc.save());
    expect(await preflightPdf(buffer)).toBe('ok');
  });

  it('returns "corrupted" for garbage bytes', async () => {
    const buffer = Buffer.from('this is not a pdf at all');
    expect(await preflightPdf(buffer)).toBe('corrupted');
  });

  it('returns "encrypted" when pdf-lib throws EncryptedPDFError', async () => {
    // A real encrypted-PDF fixture would need a bundled binary asset; instead we assert the
    // classifier's own logic by constructing the exact error pdf-lib throws for encryption.
    const { EncryptedPDFError } = await import('pdf-lib');
    jest.spyOn(PDFDocument, 'load').mockRejectedValueOnce(new EncryptedPDFError());
    expect(await preflightPdf(Buffer.from('irrelevant'))).toBe('encrypted');
    jest.restoreAllMocks();
  });
});
