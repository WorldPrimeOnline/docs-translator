/**
 * Tests for resolveDocumentAnalysisForPricing() (service.ts) — the idempotent, DB-backed
 * wrapper around analyzeDocumentForPricing() (analyze.ts, untouched) that checkout uses so a
 * retry never re-runs OCR for the same document (2026-07-22).
 */
jest.mock('@/lib/supabase/server', () => ({
  supabaseServer: { from: jest.fn() },
}));
const mockAnalyze = jest.fn();
jest.mock('../analyze', () => ({
  analyzeDocumentForPricing: (...args: unknown[]) => mockAnalyze(...args),
}));

import { supabaseServer } from '@/lib/supabase/server';
import { resolveDocumentAnalysisForPricing } from '../service';

const mockFrom = supabaseServer.from as jest.Mock;

function chain(result: { data?: unknown; error?: unknown }) {
  const c: Record<string, unknown> = {};
  const methods = ['select', 'eq', 'order', 'limit', 'insert', 'update'];
  for (const m of methods) c[m] = jest.fn(() => c);
  c.single = jest.fn(() => Promise.resolve(result));
  c.maybeSingle = jest.fn(() => Promise.resolve(result));
  return c;
}

const analysisResult = (overrides: Record<string, unknown> = {}) => ({
  method: 'pdf_text_layer',
  rawText: 'x',
  normalizedText: 'x'.repeat(1800),
  characterCount: 1800,
  physicalPageCount: 1,
  qualitySignals: { method: 'pdf_text_layer', rawCharacterCount: 1800, emptyOrNearEmpty: false, charsPerPhysicalPage: 1800, possiblyHandwrittenOrIllegible: false },
  requiresOperatorReview: false,
  reviewReasons: [],
  ...overrides,
});

describe('resolveDocumentAnalysisForPricing', () => {
  beforeEach(() => jest.clearAllMocks());

  it('reuses a completed revision — never calls analyzeDocumentForPricing again', async () => {
    mockFrom.mockReturnValueOnce(chain({
      data: { id: 'a-1', document_id: 'doc-1', revision: 1, status: 'completed', method: 'pdf_text_layer', source_character_count_with_spaces: 1800, physical_page_count: 1 },
      error: null,
    }));

    const result = await resolveDocumentAnalysisForPricing('doc-1', 'application/pdf', jest.fn());

    expect(result).toEqual({ kind: 'completed', row: expect.objectContaining({ id: 'a-1', sourceCharacterCountWithSpaces: 1800, physicalPageCount: 1 }) });
    expect(mockAnalyze).not.toHaveBeenCalled();
  });

  it('reuses a requires_operator_review revision without re-analyzing', async () => {
    mockFrom.mockReturnValueOnce(chain({
      data: { id: 'a-1', document_id: 'doc-1', revision: 1, status: 'requires_operator_review', failure_reason: 'No text could be extracted' },
      error: null,
    }));

    const result = await resolveDocumentAnalysisForPricing('doc-1', 'application/pdf', jest.fn());

    expect(result.kind).toBe('requires_operator_review');
    expect(mockAnalyze).not.toHaveBeenCalled();
  });

  it('an in-flight (pending/processing) revision never triggers a second analysis', async () => {
    mockFrom.mockReturnValueOnce(chain({ data: { id: 'a-1', document_id: 'doc-1', revision: 1, status: 'processing' }, error: null }));

    const result = await resolveDocumentAnalysisForPricing('doc-1', 'application/pdf', jest.fn());

    expect(result).toEqual({ kind: 'in_progress' });
    expect(mockAnalyze).not.toHaveBeenCalled();
  });

  it('no existing row: claims exactly one new revision, runs analysis once, marks it completed', async () => {
    const fetchBuffer = jest.fn().mockResolvedValue(Buffer.from('pdf-bytes'));
    mockAnalyze.mockResolvedValueOnce(analysisResult());

    const latestChain = chain({ data: null, error: null }); // no existing row
    const insertChain = chain({ data: { id: 'a-new' }, error: null });
    const processingChain = chain({ data: null, error: null });
    const finalUpdateChain = chain({ data: { id: 'a-new', document_id: 'doc-1', revision: 1, status: 'completed', method: 'pdf_text_layer', source_character_count_with_spaces: 1800, physical_page_count: 1 }, error: null });

    mockFrom
      .mockReturnValueOnce(latestChain)
      .mockReturnValueOnce(insertChain)
      .mockReturnValueOnce(processingChain)
      .mockReturnValueOnce(finalUpdateChain);

    const result = await resolveDocumentAnalysisForPricing('doc-1', 'application/pdf', fetchBuffer);

    expect(mockAnalyze).toHaveBeenCalledTimes(1);
    expect(insertChain.insert).toHaveBeenCalledWith(expect.objectContaining({ document_id: 'doc-1', revision: 1, status: 'pending', supersedes_analysis_id: null }));
    expect(result).toEqual({ kind: 'completed', row: expect.objectContaining({ id: 'a-new', sourceCharacterCountWithSpaces: 1800, physicalPageCount: 1 }) });
  });

  it('a concurrent request racing the insert (unique-index violation) is treated as in-flight, never a hard error', async () => {
    const latestChain = chain({ data: null, error: null });
    const insertChain = chain({ data: null, error: { message: 'duplicate key value violates unique constraint "idx_document_analysis_one_active"' } });

    mockFrom.mockReturnValueOnce(latestChain).mockReturnValueOnce(insertChain);

    const result = await resolveDocumentAnalysisForPricing('doc-1', 'application/pdf', jest.fn());

    expect(result).toEqual({ kind: 'in_progress' });
    expect(mockAnalyze).not.toHaveBeenCalled();
  });

  it('analyzeDocumentForPricing resolving requiresOperatorReview:true marks the row requires_operator_review, no quote-eligible outcome', async () => {
    mockAnalyze.mockResolvedValueOnce(analysisResult({ requiresOperatorReview: true, reviewReasons: ['No text could be extracted from this document — requires operator review, no fallback estimate.'] }));

    const latestChain = chain({ data: null, error: null });
    const insertChain = chain({ data: { id: 'a-new' }, error: null });
    const processingChain = chain({ data: null, error: null });
    const finalUpdateChain = chain({ data: { id: 'a-new', document_id: 'doc-1', revision: 1, status: 'requires_operator_review' }, error: null });

    mockFrom.mockReturnValueOnce(latestChain).mockReturnValueOnce(insertChain).mockReturnValueOnce(processingChain).mockReturnValueOnce(finalUpdateChain);

    const result = await resolveDocumentAnalysisForPricing('doc-1', 'application/pdf', jest.fn().mockResolvedValue(Buffer.from('x')));

    expect(result.kind).toBe('requires_operator_review');
  });

  it('a downloadFile/analysis exception marks the row failed and never throws to the caller', async () => {
    const latestChain = chain({ data: null, error: null });
    const insertChain = chain({ data: { id: 'a-new' }, error: null });
    const processingChain = chain({ data: null, error: null });
    const failChain = chain({ data: null, error: null });

    mockFrom.mockReturnValueOnce(latestChain).mockReturnValueOnce(insertChain).mockReturnValueOnce(processingChain).mockReturnValueOnce(failChain);

    const result = await resolveDocumentAnalysisForPricing('doc-1', 'application/pdf', jest.fn().mockRejectedValue(new Error('R2 download failed')));

    expect(result).toEqual({ kind: 'failed', reason: 'R2 download failed' });
    expect(failChain.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed', failure_reason: 'R2 download failed' }));
  });

  it('a prior failed revision does not get retried in place — a new revision is claimed instead', async () => {
    const fetchBuffer = jest.fn().mockResolvedValue(Buffer.from('pdf-bytes'));
    mockAnalyze.mockResolvedValueOnce(analysisResult());

    const latestChain = chain({ data: { id: 'a-old', document_id: 'doc-1', revision: 1, status: 'failed' }, error: null });
    const insertChain = chain({ data: { id: 'a-new' }, error: null });
    const processingChain = chain({ data: null, error: null });
    const finalUpdateChain = chain({ data: { id: 'a-new', document_id: 'doc-1', revision: 2, status: 'completed' }, error: null });

    mockFrom.mockReturnValueOnce(latestChain).mockReturnValueOnce(insertChain).mockReturnValueOnce(processingChain).mockReturnValueOnce(finalUpdateChain);

    await resolveDocumentAnalysisForPricing('doc-1', 'application/pdf', fetchBuffer);

    expect(insertChain.insert).toHaveBeenCalledWith(expect.objectContaining({ revision: 2, supersedes_analysis_id: 'a-old' }));
  });
});
