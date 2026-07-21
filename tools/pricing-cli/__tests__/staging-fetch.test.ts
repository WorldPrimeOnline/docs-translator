/**
 * Proves the --from-staging code path (mocked at the @/lib/pricing/service boundary — the only
 * feasible way to test it without real staging credentials) resolves a version + language rate
 * and produces a real pricing breakdown for a text PDF, via calculatePrice() directly.
 */
const getPricingVersionByCode = jest.fn();
const getLanguageRate = jest.fn();
const validateChannelReserveInvariant = jest.fn();

jest.mock('@/lib/pricing/service', () => ({
  getPricingVersionByCode: (...args: unknown[]) => getPricingVersionByCode(...args),
  getLanguageRate: (...args: unknown[]) => getLanguageRate(...args),
  validateChannelReserveInvariant: (...args: unknown[]) => validateChannelReserveInvariant(...args),
}));

const analyzeLocalFile = jest.fn();
jest.mock('../lib/analyze-file', () => {
  const actual = jest.requireActual('../lib/analyze-file');
  return { ...actual, analyzeLocalFile: (...args: unknown[]) => analyzeLocalFile(...args) };
});

import { resolvePricingVersion } from '../lib/version-source';
import { runPricingForFile } from '../lib/pricing-run';
import { resolveFileParams } from '../lib/params-resolver';
import { DEFAULT_PRICING_VERSION } from '../lib/default-pricing-version';
import type { DocumentAnalysisResult } from '@/lib/document-analysis/analyze';

const STAGING_VERSION = { ...DEFAULT_PRICING_VERSION, id: 'staging-version-id', code: 'STAGING-CODE' };
const STAGING_RATE = {
  id: 'staging-rate-id', pricingVersionId: 'staging-version-id',
  sourceLanguage: 'ru', targetLanguage: 'en', rateKztPerTranslationPage: 3000,
  active: true, requiresOperatorReview: false,
};

describe('--from-staging: resolvePricingVersion', () => {
  beforeEach(() => jest.clearAllMocks());

  it('fetches the version + language rate via the real service.ts functions (mocked at the boundary)', async () => {
    getPricingVersionByCode.mockResolvedValue(STAGING_VERSION);
    getLanguageRate.mockResolvedValue(STAGING_RATE);
    validateChannelReserveInvariant.mockResolvedValue(undefined);

    const params = resolveFileParams({ pricingVersionCode: 'STAGING-CODE', pricingVersionSource: 'staging' }, 'test');
    const resolved = await resolvePricingVersion(params);

    expect(getPricingVersionByCode).toHaveBeenCalledWith('STAGING-CODE');
    expect(resolved.version.code).toBe('STAGING-CODE');
    expect(resolved.languageRate).toEqual(STAGING_RATE);
    expect(resolved.languageRateSource).toBe('db');
  });

  it('never calls saveQuote/markQuotePaid — only reads (the mock module has no such export)', async () => {
    getPricingVersionByCode.mockResolvedValue(STAGING_VERSION);
    getLanguageRate.mockResolvedValue(STAGING_RATE);
    validateChannelReserveInvariant.mockResolvedValue(undefined);

    await resolvePricingVersion(resolveFileParams({ pricingVersionCode: 'STAGING-CODE', pricingVersionSource: 'staging' }, 'test'));
    const service = await import('@/lib/pricing/service');
    expect((service as Record<string, unknown>).saveQuote).toBeUndefined();
    expect((service as Record<string, unknown>).markQuotePaid).toBeUndefined();
  });
});

describe('--from-staging: end-to-end text PDF pricing breakdown', () => {
  beforeEach(() => jest.clearAllMocks());

  it('produces a real pricing breakdown for a text PDF after a successful staging fetch', async () => {
    getPricingVersionByCode.mockResolvedValue(STAGING_VERSION);
    getLanguageRate.mockResolvedValue(STAGING_RATE);
    validateChannelReserveInvariant.mockResolvedValue(undefined);

    const analysis: DocumentAnalysisResult = {
      method: 'pdf_text_layer',
      rawText: 'raw',
      normalizedText: 'x'.repeat(1800),
      characterCount: 1800,
      physicalPageCount: 1,
      qualitySignals: { method: 'pdf_text_layer', rawCharacterCount: 1800, emptyOrNearEmpty: false, charsPerPhysicalPage: 1800, possiblyHandwrittenOrIllegible: false },
      requiresOperatorReview: false,
      reviewReasons: [],
    };
    analyzeLocalFile.mockResolvedValue({ kind: 'analyzed', fromCache: false, result: analysis });

    const params = resolveFileParams(
      { sourceLanguage: 'ru', targetLanguage: 'en', serviceLevel: 'official', pricingVersionCode: 'STAGING-CODE', pricingVersionSource: 'staging' },
      'test',
    );
    const result = await runPricingForFile('source (1).pdf', 'source (1).pdf', Buffer.from(''), '.pdf', params, {
      noOcr: false, noCache: false, cacheDir: '/tmp/unused',
    });

    expect(result.status).toBe('success');
    expect(result.pricingResult?.pricingVersionCode).toBe('STAGING-CODE');
    expect(result.pricingResult?.newModel?.translationAmountKzt).toBe(3000);
    expect(result.reconciliationOk).toBe(true);
  });
});
