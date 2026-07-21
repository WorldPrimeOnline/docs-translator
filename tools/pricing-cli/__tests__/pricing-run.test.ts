const analyzeLocalFile = jest.fn();
jest.mock('../lib/analyze-file', () => {
  const actual = jest.requireActual('../lib/analyze-file');
  return { ...actual, analyzeLocalFile: (...args: unknown[]) => analyzeLocalFile(...args) };
});

// Imported AFTER the mock so it picks it up.
import { runPricingForFile } from '../lib/pricing-run';
import { resolveFileParams } from '../lib/params-resolver';
import type { DocumentAnalysisResult } from '@/lib/document-analysis/analyze';

function analysisResult(overrides: Partial<DocumentAnalysisResult> = {}): DocumentAnalysisResult {
  return {
    method: 'pdf_text_layer',
    rawText: 'raw',
    normalizedText: 'x'.repeat(1800),
    characterCount: 1800,
    physicalPageCount: 1,
    qualitySignals: { method: 'pdf_text_layer', rawCharacterCount: 1800, emptyOrNearEmpty: false, charsPerPhysicalPage: 1800, possiblyHandwrittenOrIllegible: false },
    requiresOperatorReview: false,
    reviewReasons: [],
    ...overrides,
  };
}

const RUN_OPTS = { noOcr: false, noCache: false, cacheDir: '/tmp/unused-in-these-tests' };

describe('runPricingForFile — classification', () => {
  beforeEach(() => jest.clearAllMocks());

  it('forwards mistralApiKey to analyzeLocalFile untouched (dependency injection, never read from @/lib/env)', async () => {
    analyzeLocalFile.mockResolvedValue({ kind: 'analyzed', fromCache: false, result: analysisResult() });
    const params = resolveFileParams({ sourceLanguage: 'ru', targetLanguage: 'en' }, 'test');
    await runPricingForFile('f.pdf', 'f.pdf', Buffer.from(''), '.pdf', params, { ...RUN_OPTS, mistralApiKey: 'injected-key' });

    expect(analyzeLocalFile).toHaveBeenCalledWith(
      expect.anything(),
      '.pdf',
      expect.objectContaining({ mistralApiKey: 'injected-key' }),
    );
  });

  it('unsupported_type -> failed / unsupported_type', async () => {
    analyzeLocalFile.mockResolvedValue({ kind: 'unsupported_type' });
    const params = resolveFileParams({}, 'test');
    const result = await runPricingForFile('f.txt', 'f.txt', Buffer.from(''), '.txt', params, RUN_OPTS);
    expect(result.status).toBe('failed');
    expect(result.reasonCode).toBe('unsupported_type');
  });

  it('preflight encrypted -> failed / encrypted_pdf', async () => {
    analyzeLocalFile.mockResolvedValue({ kind: 'preflight_failed', status: 'encrypted' });
    const params = resolveFileParams({}, 'test');
    const result = await runPricingForFile('f.pdf', 'f.pdf', Buffer.from(''), '.pdf', params, RUN_OPTS);
    expect(result.status).toBe('failed');
    expect(result.reasonCode).toBe('encrypted_pdf');
  });

  it('preflight corrupted -> failed / corrupted_pdf', async () => {
    analyzeLocalFile.mockResolvedValue({ kind: 'preflight_failed', status: 'corrupted' });
    const params = resolveFileParams({}, 'test');
    const result = await runPricingForFile('f.pdf', 'f.pdf', Buffer.from(''), '.pdf', params, RUN_OPTS);
    expect(result.status).toBe('failed');
    expect(result.reasonCode).toBe('corrupted_pdf');
  });

  it('skipped_ocr (--no-ocr) -> operator_review', async () => {
    analyzeLocalFile.mockResolvedValue({ kind: 'skipped_ocr', reason: 'no-ocr' });
    const params = resolveFileParams({}, 'test');
    const result = await runPricingForFile('f.jpg', 'f.jpg', Buffer.from(''), '.jpg', params, RUN_OPTS);
    expect(result.status).toBe('operator_review');
  });

  it('OCR failure inside analysis -> failed / ocr_failed', async () => {
    analyzeLocalFile.mockResolvedValue({
      kind: 'analyzed',
      fromCache: false,
      result: analysisResult({ characterCount: 0, reviewReasons: ['OCR failed: network timeout', 'No text could be extracted from this document — requires operator review, no fallback estimate.'] }),
    });
    const params = resolveFileParams({}, 'test');
    const result = await runPricingForFile('f.pdf', 'f.pdf', Buffer.from(''), '.pdf', params, RUN_OPTS);
    expect(result.status).toBe('failed');
    expect(result.reasonCode).toBe('ocr_failed');
  });

  it('an OCR/config failure never cascades into a misleading "no text" reason (requirement: config error != document error)', async () => {
    // analyze.ts always pushes a generic "No text could be extracted" reason once
    // characterCount lands at 0 — which it always does after an OCR exception. That reason is
    // misleading here: extraction never even ran. Only the real "OCR failed:" reason must survive.
    analyzeLocalFile.mockResolvedValue({
      kind: 'analyzed',
      fromCache: false,
      result: analysisResult({
        characterCount: 0,
        reviewReasons: [
          'OCR failed: Mistral OCR error 401: {"detail":"Unauthorized"}',
          'No text could be extracted from this document — requires operator review, no fallback estimate.',
        ],
      }),
    });
    const params = resolveFileParams({}, 'test');
    const result = await runPricingForFile('f.pdf', 'f.pdf', Buffer.from(''), '.pdf', params, RUN_OPTS);

    expect(result.status).toBe('failed');
    expect(result.reasonCode).toBe('ocr_failed');
    expect(result.reasons).toEqual(['OCR failed: Mistral OCR error 401: {"detail":"Unauthorized"}']);
    expect(result.reasons.some((r) => r.includes('No text could be extracted'))).toBe(false);
  });

  it('zero characters extracted (no OCR failure) -> operator_review / no_text', async () => {
    analyzeLocalFile.mockResolvedValue({
      kind: 'analyzed',
      fromCache: false,
      result: analysisResult({ characterCount: 0, reviewReasons: ['No text could be extracted from this document — requires operator review, no fallback estimate.'] }),
    });
    const params = resolveFileParams({}, 'test');
    const result = await runPricingForFile('f.pdf', 'f.pdf', Buffer.from(''), '.pdf', params, RUN_OPTS);
    expect(result.status).toBe('operator_review');
    expect(result.reasonCode).toBe('no_text');
  });

  it('real text + supported ru->en pair -> success, real calculatePrice(), reconciliation OK', async () => {
    analyzeLocalFile.mockResolvedValue({ kind: 'analyzed', fromCache: false, result: analysisResult() });
    const params = resolveFileParams({ sourceLanguage: 'ru', targetLanguage: 'en', serviceLevel: 'official' }, 'test');
    const result = await runPricingForFile('f.pdf', 'f.pdf', Buffer.from(''), '.pdf', params, RUN_OPTS);
    expect(result.status).toBe('success');
    expect(result.reconciliationOk).toBe(true);
    expect(result.pricingResult?.newModel?.translationAmountKzt).toBe(3000); // 1800 chars @ 3000/page
  });

  // 2026-07-26: pricing_language_rates rows are RU->X base rates, not directional pairs — en ->
  // ru resolves symmetrically from the same seeded ru -> en row and prices normally.
  it('reverse-direction pair (en->ru) resolves symmetrically to the same rate as ru->en -> success', async () => {
    analyzeLocalFile.mockResolvedValue({ kind: 'analyzed', fromCache: false, result: analysisResult() });
    const params = resolveFileParams({ sourceLanguage: 'en', targetLanguage: 'ru', serviceLevel: 'official' }, 'test');
    const result = await runPricingForFile('f.pdf', 'f.pdf', Buffer.from(''), '.pdf', params, RUN_OPTS);
    expect(result.status).toBe('success');
    expect(result.pricingResult?.newModel?.translationAmountKzt).toBe(3000); // 1800 chars @ 3000/page
  });

  it('genuinely unseeded language pair -> operator_review / no_language_rate (never fabricates a rate)', async () => {
    analyzeLocalFile.mockResolvedValue({ kind: 'analyzed', fromCache: false, result: analysisResult() });
    const params = resolveFileParams({ sourceLanguage: 'en', targetLanguage: 'xx', serviceLevel: 'official' }, 'test');
    const result = await runPricingForFile('f.pdf', 'f.pdf', Buffer.from(''), '.pdf', params, RUN_OPTS);
    expect(result.status).toBe('operator_review');
    expect(result.reasonCode).toBe('no_language_rate');
  });

  it('invalid pricingVersionCode in local mode -> failed / invalid_config', async () => {
    analyzeLocalFile.mockResolvedValue({ kind: 'analyzed', fromCache: false, result: analysisResult() });
    const params = resolveFileParams({ pricingVersionCode: 'NOT-A-REAL-CODE' }, 'test');
    const result = await runPricingForFile('f.pdf', 'f.pdf', Buffer.from(''), '.pdf', params, RUN_OPTS);
    expect(result.status).toBe('failed');
    expect(result.reasonCode).toBe('invalid_config');
  });

  it('marks usedTemporaryOverrides when versionOverrides is non-empty', async () => {
    analyzeLocalFile.mockResolvedValue({ kind: 'analyzed', fromCache: false, result: analysisResult() });
    const params = resolveFileParams({ sourceLanguage: 'ru', targetLanguage: 'en', versionOverrides: { mrpValue: 9 } }, 'test');
    const result = await runPricingForFile('f.pdf', 'f.pdf', Buffer.from(''), '.pdf', params, RUN_OPTS);
    expect(result.usedTemporaryOverrides).toBe(true);
  });
});

describe('2026-07-21 regression #8: manualPhysicalPageCountOverride (DOCX without a reliable rendered page count)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('DOCX render failure (physicalPageCount: null from analysis) + no override -> billing falls back to characterPages', async () => {
    analyzeLocalFile.mockResolvedValue({
      kind: 'analyzed', fromCache: false,
      result: analysisResult({ method: 'docx_text', physicalPageCount: null, characterCount: 4000, normalizedText: 'x'.repeat(4000) }),
    });
    const params = resolveFileParams({ sourceLanguage: 'ru', targetLanguage: 'en', serviceLevel: 'official' }, 'test');
    const result = await runPricingForFile('f.docx', 'f.docx', Buffer.from(''), '.docx', params, RUN_OPTS);

    expect(result.status).toBe('success');
    expect(result.analysis?.physicalPageCount).toBeNull();
    expect(result.pricingResult?.newModel?.physicalPageCount).toBeNull();
    expect(result.pricingResult?.newModel?.translationPageBasis).toBe('character_count');
  });

  it('DOCX render failure + manualPhysicalPageCountOverride set -> override wins, billing uses physical_pages basis', async () => {
    analyzeLocalFile.mockResolvedValue({
      kind: 'analyzed', fromCache: false,
      result: analysisResult({ method: 'docx_text', physicalPageCount: null, characterCount: 4000, normalizedText: 'x'.repeat(4000) }),
    });
    const params = resolveFileParams(
      { sourceLanguage: 'ru', targetLanguage: 'en', serviceLevel: 'official', manualPhysicalPageCountOverride: 10 },
      'test',
    );
    const result = await runPricingForFile('f.docx', 'f.docx', Buffer.from(''), '.docx', params, RUN_OPTS);

    expect(result.status).toBe('success');
    expect(result.analysis?.physicalPageCount).toBe(10); // override reflected in the displayed analysis too
    expect(result.pricingResult?.newModel?.physicalPageCount).toBe(10);
    expect(result.pricingResult?.newModel?.translationPageBasis).toBe('physical_pages');
    expect(result.pricingResult?.newModel?.billableTranslationPages).toBe(10); // 10 physical pages beats 4000/1800 ≈ 2.22 character pages
  });
});

describe('batch resilience — one bad file does not stop the rest', () => {
  it('processes every file independently even when one throws unexpectedly', async () => {
    analyzeLocalFile
      .mockResolvedValueOnce({ kind: 'analyzed', fromCache: false, result: analysisResult() })
      .mockRejectedValueOnce(new Error('unexpected crash analyzing this one file'))
      .mockResolvedValueOnce({ kind: 'analyzed', fromCache: false, result: analysisResult() });

    const params = resolveFileParams({ sourceLanguage: 'ru', targetLanguage: 'en' }, 'test');
    const filenames = ['a.pdf', 'b.pdf', 'c.pdf'];
    const results = [];
    // Mirrors index.ts's per-file try/catch — one throw must not prevent the others from running.
    for (const filename of filenames) {
      try {
        results.push(await runPricingForFile(filename, filename, Buffer.from(''), '.pdf', params, RUN_OPTS));
      } catch (err) {
        results.push({ filename, status: 'failed' as const, reasonCode: 'invalid_config' as const, reasons: [String(err)], usedTemporaryOverrides: false });
      }
    }

    expect(results).toHaveLength(3);
    expect(results[0].status).toBe('success');
    expect(results[1].status).toBe('failed');
    expect(results[2].status).toBe('success');
  });
});
