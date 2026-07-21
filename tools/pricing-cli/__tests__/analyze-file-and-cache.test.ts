import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const analyzeDocumentForPricing = jest.fn();
jest.mock('@/lib/document-analysis/analyze', () => ({
  analyzeDocumentForPricing: (...args: unknown[]) => analyzeDocumentForPricing(...args),
}));

const extractPdfTextLayer = jest.fn();
const isTextLayerSufficient = jest.fn();
jest.mock('@/lib/document-analysis/pdf-text-layer', () => ({
  extractPdfTextLayer: (...args: unknown[]) => extractPdfTextLayer(...args),
  isTextLayerSufficient: (...args: unknown[]) => isTextLayerSufficient(...args),
}));

const preflightPdf = jest.fn();
jest.mock('../lib/pdf-preflight', () => ({ preflightPdf: (...args: unknown[]) => preflightPdf(...args) }));

// Imported AFTER the mocks above so it picks them up.
import { analyzeLocalFile } from '../lib/analyze-file';
import { hashFile, readCacheEntry, clearCacheDir } from '../lib/cache';

const FAKE_RESULT = {
  method: 'docx_text',
  rawText: 'raw',
  normalizedText: 'normalized',
  characterCount: 1234,
  physicalPageCount: 2,
  qualitySignals: { method: 'docx_text', rawCharacterCount: 1234, emptyOrNearEmpty: false, charsPerPhysicalPage: 617, possiblyHandwrittenOrIllegible: false },
  requiresOperatorReview: false,
  reviewReasons: [],
};

describe('analyzeLocalFile', () => {
  let cacheDir: string;
  const buffer = Buffer.from('fake file bytes');

  beforeEach(() => {
    cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pricing-cache-test-'));
    jest.clearAllMocks();
    preflightPdf.mockResolvedValue('ok');
    analyzeDocumentForPricing.mockResolvedValue(FAKE_RESULT);
  });

  afterEach(() => {
    clearCacheDir(cacheDir);
  });

  it('returns unsupported_type for an unknown extension without touching preflight/cache/analysis', async () => {
    const outcome = await analyzeLocalFile(buffer, '.txt', { noOcr: false, noCache: false, cacheDir });
    expect(outcome.kind).toBe('unsupported_type');
    expect(preflightPdf).not.toHaveBeenCalled();
    expect(analyzeDocumentForPricing).not.toHaveBeenCalled();
  });

  it('calls analyzeDocumentForPricing for a DOCX and writes the cache', async () => {
    const outcome = await analyzeLocalFile(buffer, '.docx', { noOcr: false, noCache: false, cacheDir });
    expect(outcome).toEqual({ kind: 'analyzed', result: FAKE_RESULT, fromCache: false });
    expect(analyzeDocumentForPricing).toHaveBeenCalledWith(
      buffer,
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      expect.objectContaining({ mistralApiKey: undefined }),
    );

    const hash = hashFile(buffer, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    expect(readCacheEntry(cacheDir, hash)).toEqual(FAKE_RESULT);
  });

  it('forwards mistralApiKey to analyzeDocumentForPricing untouched (never reads @/lib/env)', async () => {
    await analyzeLocalFile(buffer, '.docx', { noOcr: false, noCache: false, cacheDir, mistralApiKey: 'injected-key' });
    expect(analyzeDocumentForPricing).toHaveBeenCalledWith(
      buffer,
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      { mistralApiKey: 'injected-key' },
    );
  });

  it('reuses a cache hit instead of re-analyzing (no OCR re-invoked on rerun)', async () => {
    await analyzeLocalFile(buffer, '.docx', { noOcr: false, noCache: false, cacheDir });
    analyzeDocumentForPricing.mockClear();

    const second = await analyzeLocalFile(buffer, '.docx', { noOcr: false, noCache: false, cacheDir });
    expect(second).toEqual({ kind: 'analyzed', result: FAKE_RESULT, fromCache: true });
    expect(analyzeDocumentForPricing).not.toHaveBeenCalled();
  });

  it('--no-cache ignores an existing cache entry and re-analyzes', async () => {
    await analyzeLocalFile(buffer, '.docx', { noOcr: false, noCache: false, cacheDir });
    analyzeDocumentForPricing.mockClear();

    const second = await analyzeLocalFile(buffer, '.docx', { noOcr: false, noCache: true, cacheDir });
    expect(second.kind).toBe('analyzed');
    expect((second as { fromCache: boolean }).fromCache).toBe(false);
    expect(analyzeDocumentForPricing).toHaveBeenCalledTimes(1);
  });

  it('short-circuits an encrypted PDF without calling analyzeDocumentForPricing', async () => {
    preflightPdf.mockResolvedValue('encrypted');
    const outcome = await analyzeLocalFile(buffer, '.pdf', { noOcr: false, noCache: false, cacheDir });
    expect(outcome).toEqual({ kind: 'preflight_failed', status: 'encrypted' });
    expect(analyzeDocumentForPricing).not.toHaveBeenCalled();
  });

  it('short-circuits a corrupted PDF without calling analyzeDocumentForPricing', async () => {
    preflightPdf.mockResolvedValue('corrupted');
    const outcome = await analyzeLocalFile(buffer, '.pdf', { noOcr: false, noCache: false, cacheDir });
    expect(outcome).toEqual({ kind: 'preflight_failed', status: 'corrupted' });
    expect(analyzeDocumentForPricing).not.toHaveBeenCalled();
  });

  it('--no-ocr marks an image for operator review without calling analysis', async () => {
    const outcome = await analyzeLocalFile(buffer, '.jpg', { noOcr: true, noCache: false, cacheDir });
    expect(outcome.kind).toBe('skipped_ocr');
    expect(analyzeDocumentForPricing).not.toHaveBeenCalled();
  });

  it('--no-ocr marks a scanned PDF (insufficient text layer) for operator review without calling paid OCR', async () => {
    isTextLayerSufficient.mockReturnValue(false);
    const outcome = await analyzeLocalFile(buffer, '.pdf', { noOcr: true, noCache: false, cacheDir });
    expect(outcome.kind).toBe('skipped_ocr');
    expect(analyzeDocumentForPricing).not.toHaveBeenCalled();
  });

  it('--no-ocr still prices a PDF with a sufficient text layer (never needs OCR)', async () => {
    isTextLayerSufficient.mockReturnValue(true);
    const outcome = await analyzeLocalFile(buffer, '.pdf', { noOcr: true, noCache: false, cacheDir });
    expect(outcome.kind).toBe('analyzed');
    expect(analyzeDocumentForPricing).toHaveBeenCalledTimes(1);
  });
});
