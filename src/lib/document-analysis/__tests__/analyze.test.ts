/**
 * Tests for analyzeDocumentForPricing() — the shared orchestrator behind Pricing Lab's file
 * mode (and, once wired in, the real pre-payment document_analysis pipeline).
 */
export {};

const mockConvertToPdf = jest.fn();
const mockExtractTextFromPdf = jest.fn();
const mockExtractDocxText = jest.fn();
const mockExtractPdfTextLayer = jest.fn();
const mockGetPhysicalPageCount = jest.fn();

jest.mock('@/lib/convert-to-pdf', () => ({ convertToPdf: (...args: unknown[]) => mockConvertToPdf(...args) }));
jest.mock('@/lib/ocr/mistral', () => ({ extractTextFromPdf: (...args: unknown[]) => mockExtractTextFromPdf(...args) }));
jest.mock('../docx', () => ({ extractDocxText: (...args: unknown[]) => mockExtractDocxText(...args) }));
jest.mock('../pdf-text-layer', () => ({
  extractPdfTextLayer: (...args: unknown[]) => mockExtractPdfTextLayer(...args),
  isTextLayerSufficient: (result: { text: string; pageCount: number } | null) => {
    if (!result || result.pageCount <= 0) return false;
    return result.text.length / result.pageCount >= 20;
  },
}));
jest.mock('../physical-pages', () => ({ getPhysicalPageCount: (...args: unknown[]) => mockGetPhysicalPageCount(...args) }));

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const PDF_MIME = 'application/pdf';
const JPG_MIME = 'image/jpeg';
const PNG_MIME = 'image/png';

beforeEach(() => {
  jest.clearAllMocks();
  mockGetPhysicalPageCount.mockResolvedValue(1);
});

describe('analyzeDocumentForPricing', () => {
  it('DOCX: uses extractDocxText directly, method=docx_text, never calls OCR', async () => {
    mockExtractDocxText.mockResolvedValue('Настоящий текст документа для расчёта цены.');
    mockConvertToPdf.mockResolvedValue(Buffer.from('fake-pdf'));
    mockGetPhysicalPageCount.mockResolvedValue(1);

    const { analyzeDocumentForPricing } = await import('../analyze');
    const result = await analyzeDocumentForPricing(Buffer.from('fake-docx'), DOCX_MIME);

    expect(result.method).toBe('docx_text');
    expect(mockExtractDocxText).toHaveBeenCalled();
    expect(mockExtractTextFromPdf).not.toHaveBeenCalled();
    expect(result.characterCount).toBeGreaterThan(0);
    expect(result.requiresOperatorReview).toBe(false);
  });

  it('PDF with a sufficient text layer: uses pdf_text_layer, never calls OCR', async () => {
    mockExtractPdfTextLayer.mockResolvedValue({ text: 'A'.repeat(500), pageCount: 2 });
    mockGetPhysicalPageCount.mockResolvedValue(2);

    const { analyzeDocumentForPricing } = await import('../analyze');
    const result = await analyzeDocumentForPricing(Buffer.from('real-pdf'), PDF_MIME);

    expect(result.method).toBe('pdf_text_layer');
    expect(mockExtractTextFromPdf).not.toHaveBeenCalled();
    expect(result.physicalPageCount).toBe(2);
  });

  it('scanned PDF (empty/sparse text layer): falls back to OCR', async () => {
    mockExtractPdfTextLayer.mockResolvedValue({ text: '', pageCount: 3 });
    mockGetPhysicalPageCount.mockResolvedValue(3);
    mockExtractTextFromPdf.mockResolvedValue({ markdown: 'Распознанный OCR текст документа с достаточным объёмом символов для трёх страниц подряд.', pageMarkdowns: [], pageCount: 3 });

    const { analyzeDocumentForPricing } = await import('../analyze');
    const result = await analyzeDocumentForPricing(Buffer.from('scanned-pdf'), PDF_MIME);

    expect(result.method).toBe('ocr');
    expect(mockExtractTextFromPdf).toHaveBeenCalled();
    expect(result.qualitySignals.ocrPageCount).toBe(3);
  });

  it('mixed PDF (some pages textless): text layer insufficient overall -> OCR fallback', async () => {
    // 3 pages, only ~10 chars total -> well under the 20 chars/page threshold
    mockExtractPdfTextLayer.mockResolvedValue({ text: 'short text', pageCount: 3 });
    mockGetPhysicalPageCount.mockResolvedValue(3);
    mockExtractTextFromPdf.mockResolvedValue({ markdown: 'Полный текст после OCR для всех страниц документа целиком.', pageMarkdowns: [], pageCount: 3 });

    const { analyzeDocumentForPricing } = await import('../analyze');
    const result = await analyzeDocumentForPricing(Buffer.from('mixed-pdf'), PDF_MIME);

    expect(result.method).toBe('ocr');
  });

  it('image (JPG/PNG): converted to PDF first, then OCR — no separate image-OCR code path', async () => {
    mockConvertToPdf.mockResolvedValue(Buffer.from('image-as-pdf'));
    mockGetPhysicalPageCount.mockResolvedValue(1);
    mockExtractPdfTextLayer.mockResolvedValue(null); // an image-only PDF has no text layer at all
    mockExtractTextFromPdf.mockResolvedValue({ markdown: 'Текст, распознанный на фотографии документа.', pageMarkdowns: [], pageCount: 1 });

    const { analyzeDocumentForPricing } = await import('../analyze');
    const result = await analyzeDocumentForPricing(Buffer.from('fake-jpg'), JPG_MIME);

    expect(mockConvertToPdf).toHaveBeenCalledWith(expect.anything(), JPG_MIME);
    expect(result.method).toBe('ocr');
  });

  it('empty extracted text (all methods yield nothing) -> requires_operator_review, no fallback estimate', async () => {
    mockExtractPdfTextLayer.mockResolvedValue(null);
    mockGetPhysicalPageCount.mockResolvedValue(1);
    mockExtractTextFromPdf.mockResolvedValue({ markdown: '', pageMarkdowns: [], pageCount: 1 });

    const { analyzeDocumentForPricing } = await import('../analyze');
    const result = await analyzeDocumentForPricing(Buffer.from('empty-pdf'), PDF_MIME);

    expect(result.characterCount).toBe(0);
    expect(result.requiresOperatorReview).toBe(true);
    expect(result.reviewReasons.some((r) => r.includes('No text could be extracted'))).toBe(true);
  });

  it('OCR throwing an error -> requires_operator_review with the real reason, not a crash', async () => {
    mockExtractPdfTextLayer.mockResolvedValue(null);
    mockGetPhysicalPageCount.mockResolvedValue(1);
    mockExtractTextFromPdf.mockRejectedValue(new Error('Mistral OCR 500: server error'));

    const { analyzeDocumentForPricing } = await import('../analyze');
    const result = await analyzeDocumentForPricing(Buffer.from('bad-pdf'), PDF_MIME);

    expect(result.requiresOperatorReview).toBe(true);
    expect(result.reviewReasons.some((r) => r.includes('OCR failed'))).toBe(true);
  });

  it('critically low text yield relative to page count -> flagged as possibly handwritten/illegible', async () => {
    mockExtractPdfTextLayer.mockResolvedValue(null);
    mockGetPhysicalPageCount.mockResolvedValue(5);
    // Only a few characters recognized across 5 pages -> way under 15 chars/page
    mockExtractTextFromPdf.mockResolvedValue({ markdown: 'x x', pageMarkdowns: [], pageCount: 5 });

    const { analyzeDocumentForPricing } = await import('../analyze');
    const result = await analyzeDocumentForPricing(Buffer.from('handwritten-pdf'), PDF_MIME);

    expect(result.requiresOperatorReview).toBe(true);
    expect(result.qualitySignals.possiblyHandwrittenOrIllegible).toBe(true);
    expect(result.reviewReasons.some((r) => r.includes('handwritten'))).toBe(true);
  });

  it('PNG (2026-07-21 regression, spec #5): converted to a one-page PDF, physicalPageCount is always 1 — never invented separately from the render', async () => {
    mockConvertToPdf.mockResolvedValue(Buffer.from('image-as-pdf'));
    mockGetPhysicalPageCount.mockResolvedValue(1);
    mockExtractPdfTextLayer.mockResolvedValue(null);
    mockExtractTextFromPdf.mockResolvedValue({ markdown: 'Текст, распознанный на скане документа.', pageMarkdowns: [], pageCount: 1 });

    const { analyzeDocumentForPricing } = await import('../analyze');
    const result = await analyzeDocumentForPricing(Buffer.from('fake-png'), PNG_MIME);

    expect(mockConvertToPdf).toHaveBeenCalledWith(expect.anything(), PNG_MIME);
    expect(result.physicalPageCount).toBe(1);
  });

  it('DOCX (2026-07-21 regression, spec #7): page-count render fails -> physicalPageCount is null, never a fabricated 1', async () => {
    mockExtractDocxText.mockResolvedValue('Настоящий текст документа для расчёта цены без надёжного количества страниц.');
    mockConvertToPdf.mockRejectedValue(new Error('LibreOffice not available in this environment'));

    const { analyzeDocumentForPricing } = await import('../analyze');
    const result = await analyzeDocumentForPricing(Buffer.from('fake-docx'), DOCX_MIME);

    expect(result.method).toBe('docx_text');
    expect(result.physicalPageCount).toBeNull();
    expect(result.characterCount).toBeGreaterThan(0);
    expect(result.requiresOperatorReview).toBe(false); // extraction itself succeeded — a missing page count alone is not a review reason
  });

  it('never fabricates a confidence score — quality signals contain only real measured fields', async () => {
    mockExtractPdfTextLayer.mockResolvedValue({ text: 'A'.repeat(100), pageCount: 1 });
    mockGetPhysicalPageCount.mockResolvedValue(1);

    const { analyzeDocumentForPricing } = await import('../analyze');
    const result = await analyzeDocumentForPricing(Buffer.from('pdf'), PDF_MIME);

    expect(result.qualitySignals).not.toHaveProperty('ocrConfidence');
    expect(result.qualitySignals).not.toHaveProperty('confidence');
    expect(result.qualitySignals).toHaveProperty('rawCharacterCount');
    expect(result.qualitySignals).toHaveProperty('charsPerPhysicalPage');
  });
});
