/**
 * Tests for src/lib/order-drafts/service.ts
 *
 * Covers:
 * 1. updateDraftFields — ownership guard, already-converted guard, field mapping,
 *    pricing_snapshot invalidation on edit after a price was shown
 * 2. calculateDraftPrice — missing fields, language-pair-must-differ, pricing engine
 *    error passthrough, success path
 * 3. attachDraftToUser — already attached, owned by another user, session mismatch, success
 * 4. convertDraftToOrder — forbidden, idempotent replay, missing price snapshot, no file,
 *    concurrent claim (both still-in-progress and already-completed), happy path
 * 5. Structural check: conversion never reaches processJob/Jira/Drive — those stay
 *    worker-only, gated on a paid payment_transactions row, exactly as today.
 */
import fs from 'fs';
import path from 'path';

jest.mock('@/lib/supabase/server', () => ({
  supabaseServer: { from: jest.fn() },
}));
jest.mock('@/lib/r2/client', () => ({
  downloadFile: jest.fn(),
  uploadFile: jest.fn(),
}));
jest.mock('@/lib/pricing/service', () => ({
  computeQuoteForJob: jest.fn(),
  saveQuote: jest.fn(),
  extractNotaryUrgencySnapshot: jest.fn(() => null),
}));
const mockAnalyzeDocument = jest.fn();
jest.mock('@/lib/document-analysis/analyze', () => ({
  analyzeDocumentForPricing: (...args: unknown[]) => mockAnalyzeDocument(...args),
}));
jest.mock('@/lib/referral/server', () => ({
  attachReferralToOrder: jest.fn(),
}));

import { supabaseServer } from '@/lib/supabase/server';
import { downloadFile, uploadFile } from '@/lib/r2/client';
import { computeQuoteForJob, saveQuote } from '@/lib/pricing/service';
import { attachReferralToOrder } from '@/lib/referral/server';
import {
  updateDraftFields,
  calculateDraftPrice,
  attachDraftToUser,
  convertDraftToOrder,
} from '../service';
import type { OrderDraftRow } from '../types';

const mockFrom = supabaseServer.from as jest.Mock;
const mockDownloadFile = downloadFile as jest.Mock;
const mockUploadFile = uploadFile as jest.Mock;
const mockComputeQuote = computeQuoteForJob as jest.Mock;
const mockSaveQuote = saveQuote as jest.Mock;
const mockAttachReferral = attachReferralToOrder as jest.Mock;

// ─── Chain helper — mimics supabase-js: every method returns `this`, and the
// chain itself is awaitable (thenable) so callers that never call .single()/
// .maybeSingle() (e.g. `await db.from(x).update(...).eq(...)`) still resolve. ───
function chain(result: { data?: unknown; error?: unknown; count?: number }) {
  const c: Record<string, unknown> = {};
  const methods = ['select', 'eq', 'neq', 'gte', 'lt', 'or', 'in', 'insert', 'update', 'upsert', 'delete', 'order', 'limit'];
  for (const m of methods) c[m] = jest.fn(() => c);
  c.single = jest.fn(() => Promise.resolve(result));
  c.maybeSingle = jest.fn(() => Promise.resolve(result));
  c.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return c;
}

const BASE_DRAFT: OrderDraftRow = {
  id: 'draft-1',
  user_id: null,
  anonymous_session_id: 'sess-token',
  status: 'draft_created',
  source_language: 'ru',
  target_language: 'en',
  document_type: 'passport_id',
  output_format: 'docx',
  service_level: 'electronic',
  applicant_type: 'individual',
  notary_urgency_level: 'standard',
  notary_city: null,
  fulfillment_method: null,
  delivery_phone: null,
  delivery_address: null,
  delivery_zone: null,
  customer_comment: null,
  file_keys: [],
  pricing_snapshot: null,
  analysis_snapshot: null,
  ref_code: null,
  utm_source: null,
  utm_medium: null,
  utm_campaign: null,
  utm_content: null,
  utm_term: null,
  converted_job_id: null,
  converted_document_id: null,
  converted_quote_id: null,
  converted_price_kzt: null,
  consent_accepted_at: '2026-01-01T00:00:00.000Z',
  ip_address: '1.2.3.4',
  expires_at: '2099-01-01T00:00:00.000Z',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

beforeEach(() => {
  jest.clearAllMocks();
});

// ─── updateDraftFields ─────────────────────────────────────────────────────

describe('updateDraftFields', () => {
  it('returns DRAFT_NOT_FOUND when the draft does not exist', async () => {
    mockFrom.mockReturnValueOnce(chain({ data: null, error: null }));
    const result = await updateDraftFields('missing', { sourceLanguage: 'en' }, { sessionToken: 'sess-token' });
    expect(result).toEqual({ ok: false, error: 'DRAFT_NOT_FOUND' });
  });

  it('returns FORBIDDEN when the session token does not match an anonymous draft', async () => {
    mockFrom.mockReturnValueOnce(chain({ data: BASE_DRAFT, error: null }));
    const result = await updateDraftFields('draft-1', { sourceLanguage: 'en' }, { sessionToken: 'someone-else' });
    expect(result).toEqual({ ok: false, error: 'FORBIDDEN' });
  });

  it('returns DRAFT_ALREADY_CONVERTED and refuses to edit a converted draft', async () => {
    mockFrom.mockReturnValueOnce(chain({ data: { ...BASE_DRAFT, status: 'converted' }, error: null }));
    const result = await updateDraftFields('draft-1', { sourceLanguage: 'en' }, { sessionToken: 'sess-token' });
    expect(result).toEqual({ ok: false, error: 'DRAFT_ALREADY_CONVERTED' });
  });

  it('maps camelCase fields to the correct snake_case columns', async () => {
    const updateChain = chain({ data: { ...BASE_DRAFT, target_language: 'kk' }, error: null });
    mockFrom
      .mockReturnValueOnce(chain({ data: BASE_DRAFT, error: null })) // getDraftRow
      .mockReturnValueOnce(updateChain); // update

    await updateDraftFields('draft-1', { targetLanguage: 'kk', notaryCity: 'almaty' }, { sessionToken: 'sess-token' });

    expect(updateChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ target_language: 'kk', notary_city: 'almaty' }),
    );
  });

  it('invalidates the pricing snapshot when editing a draft that already has a price', async () => {
    const priced = { ...BASE_DRAFT, status: 'price_calculated' as const, pricing_snapshot: { result: {}, computedAt: 'x' } as never };
    const updateChain = chain({ data: priced, error: null });
    mockFrom.mockReturnValueOnce(chain({ data: priced, error: null })).mockReturnValueOnce(updateChain);

    await updateDraftFields('draft-1', { documentType: 'diploma_transcript' }, { sessionToken: 'sess-token' });

    expect(updateChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'draft_created', pricing_snapshot: null }),
    );
  });

  it('records consent_accepted_at the first time consentAccepted:true is patched on a draft with no prior consent', async () => {
    const unconsented = { ...BASE_DRAFT, consent_accepted_at: null };
    const updateChain = chain({ data: unconsented, error: null });
    mockFrom.mockReturnValueOnce(chain({ data: unconsented, error: null })).mockReturnValueOnce(updateChain);

    await updateDraftFields('draft-1', { consentAccepted: true }, { sessionToken: 'sess-token' });

    expect(updateChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ consent_accepted_at: expect.any(String) }),
    );
  });

  it('does not overwrite an already-recorded consent_accepted_at on a later patch', async () => {
    const updateChain = chain({ data: BASE_DRAFT, error: null });
    mockFrom.mockReturnValueOnce(chain({ data: BASE_DRAFT, error: null })).mockReturnValueOnce(updateChain);

    await updateDraftFields('draft-1', { consentAccepted: true, documentType: 'contract' }, { sessionToken: 'sess-token' });

    const patchArg = (updateChain.update as jest.Mock).mock.calls[0][0] as Record<string, unknown>;
    expect(patchArg.consent_accepted_at).toBeUndefined();
  });

  it('never sets consent_accepted_at when consentAccepted is false or omitted', async () => {
    const unconsented = { ...BASE_DRAFT, consent_accepted_at: null };
    const updateChain = chain({ data: unconsented, error: null });
    mockFrom.mockReturnValueOnce(chain({ data: unconsented, error: null })).mockReturnValueOnce(updateChain);

    await updateDraftFields('draft-1', { consentAccepted: false, documentType: 'contract' }, { sessionToken: 'sess-token' });

    const patchArg = (updateChain.update as jest.Mock).mock.calls[0][0] as Record<string, unknown>;
    expect(patchArg.consent_accepted_at).toBeUndefined();
  });
});

// ─── calculateDraftPrice ────────────────────────────────────────────────────

describe('calculateDraftPrice', () => {
  it('returns MISSING_FIELDS when service_level/source/target are not set', async () => {
    mockFrom.mockReturnValueOnce(chain({ data: { ...BASE_DRAFT, service_level: null }, error: null }));
    const result = await calculateDraftPrice('draft-1', { sessionToken: 'sess-token' });
    expect(result).toEqual({ ok: false, error: 'MISSING_FIELDS' });
    expect(mockComputeQuote).not.toHaveBeenCalled();
  });

  it('returns LANGUAGE_PAIR_MUST_DIFFER when source and target languages match', async () => {
    mockFrom.mockReturnValueOnce(chain({ data: { ...BASE_DRAFT, target_language: 'ru' }, error: null }));
    const result = await calculateDraftPrice('draft-1', { sessionToken: 'sess-token' });
    expect(result).toEqual({ ok: false, error: 'LANGUAGE_PAIR_MUST_DIFFER' });
    expect(mockComputeQuote).not.toHaveBeenCalled();
  });

  it('passes through a pricing engine error without writing to the draft', async () => {
    mockFrom.mockReturnValueOnce(chain({ data: BASE_DRAFT, error: null }));
    mockComputeQuote.mockResolvedValueOnce({ error: 'PRICING_NOT_CONFIGURED' });

    const result = await calculateDraftPrice('draft-1', { sessionToken: 'sess-token' });

    expect(result).toEqual({ ok: false, error: 'PRICING_NOT_CONFIGURED' });
    expect(mockFrom).toHaveBeenCalledTimes(1); // only the read — no update attempted
  });

  it('regression (2026-07-23): requiresOperatorReview=true from computeQuoteForJob is a terminal, CLASSIFIED failure — never a priced draft with a note (WPO has no manual operator pricing)', async () => {
    mockFrom.mockReturnValueOnce(chain({ data: BASE_DRAFT, error: null }));
    mockComputeQuote.mockResolvedValueOnce({
      result: { amountKzt: 300, currency: 'KZT', requiresOperatorReview: true, reviewReasons: ['No active language rate found for ru→en — requires operator review'], context: {}, items: [] },
      version: { code: '2026-Q3-KZ-MVP' },
    });

    const result = await calculateDraftPrice('draft-1', { sessionToken: 'sess-token' });

    // The exact staging incident's cause (missing language rate) classifies as
    // LANGUAGE_RATE_MISSING, not a generic UNSUPPORTED_DOCUMENT.
    expect(result).toEqual({ ok: false, error: 'LANGUAGE_RATE_MISSING' });
    expect(mockFrom).toHaveBeenCalledTimes(1); // only the read — no pricing_snapshot/status write
  });

  it('stores the pricing snapshot and flips status to price_calculated on success', async () => {
    const pricingResult = { amountKzt: 15000, currency: 'KZT', requiresOperatorReview: false, reviewReasons: [], context: {} };
    const updateChain = chain({ data: { ...BASE_DRAFT, status: 'price_calculated' }, error: null });
    mockFrom.mockReturnValueOnce(chain({ data: BASE_DRAFT, error: null })).mockReturnValueOnce(updateChain);
    mockComputeQuote.mockResolvedValueOnce({ result: pricingResult, version: { id: 'v1' } });

    const result = await calculateDraftPrice('draft-1', { sessionToken: 'sess-token' });

    expect(result.ok).toBe(true);
    expect(updateChain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'price_calculated',
        pricing_snapshot: expect.objectContaining({ result: pricingResult }),
      }),
    );
  });

  describe('non-electronic — document analysis wiring (2026-07-22)', () => {
    const draftWithFile = {
      ...BASE_DRAFT,
      service_level: 'official_with_translator_signature_and_provider_stamp',
      file_keys: [{ key: 'draft-uploads/draft-1/original.pdf', originalName: 'passport.pdf', mimeType: 'application/pdf', sizeBytes: 1000 }],
    };

    beforeEach(() => jest.clearAllMocks());

    it('no cached analysis_snapshot: runs analyzeDocumentForPricing once, caches the result on order_drafts, uses real counts in pricingInput', async () => {
      mockAnalyzeDocument.mockResolvedValueOnce({
        method: 'pdf_text_layer', characterCount: 671, physicalPageCount: 2,
        requiresOperatorReview: false, reviewReasons: [],
      });
      mockDownloadFile.mockResolvedValueOnce(Buffer.from('pdf-bytes'));
      const cacheUpdateChain = chain({ data: null, error: null });
      const snapshotUpdateChain = chain({ data: { ...draftWithFile, status: 'price_calculated' }, error: null });
      mockFrom
        .mockReturnValueOnce(chain({ data: draftWithFile, error: null })) // getDraftRow
        .mockReturnValueOnce(cacheUpdateChain)                            // analysis_snapshot cache write
        .mockReturnValueOnce(snapshotUpdateChain);                        // pricing_snapshot write
      mockComputeQuote.mockResolvedValueOnce({
        result: { amountKzt: 14700, currency: 'KZT', requiresOperatorReview: false, reviewReasons: [], context: {} },
        version: { id: 'v1' },
      });

      const result = await calculateDraftPrice('draft-1', { sessionToken: 'sess-token' });

      expect(result.ok).toBe(true);
      expect(mockAnalyzeDocument).toHaveBeenCalledTimes(1);
      expect(cacheUpdateChain.update).toHaveBeenCalledWith(
        expect.objectContaining({ analysis_snapshot: expect.objectContaining({ characterCount: 671, physicalPageCount: 2 }) }),
      );
      expect(mockComputeQuote).toHaveBeenCalledWith(
        expect.objectContaining({ physicalPageCount: 2, sourceCharacterCountWithSpaces: 671 }),
      );
    });

    it('a cached analysis_snapshot for the SAME file key is reused — never calls analyzeDocumentForPricing again', async () => {
      const draftWithCache = {
        ...draftWithFile,
        analysis_snapshot: { fileKey: 'draft-uploads/draft-1/original.pdf', method: 'pdf_text_layer', characterCount: 3366, physicalPageCount: 1, requiresOperatorReview: false, reviewReasons: [] },
      };
      const snapshotUpdateChain = chain({ data: { ...draftWithCache, status: 'price_calculated' }, error: null });
      mockFrom.mockReturnValueOnce(chain({ data: draftWithCache, error: null })).mockReturnValueOnce(snapshotUpdateChain);
      mockComputeQuote.mockResolvedValueOnce({
        result: { amountKzt: 5610, currency: 'KZT', requiresOperatorReview: false, reviewReasons: [], context: {} },
        version: { id: 'v1' },
      });

      const result = await calculateDraftPrice('draft-1', { sessionToken: 'sess-token' });

      expect(result.ok).toBe(true);
      expect(mockAnalyzeDocument).not.toHaveBeenCalled();
      expect(mockDownloadFile).not.toHaveBeenCalled();
      expect(mockComputeQuote).toHaveBeenCalledWith(
        expect.objectContaining({ physicalPageCount: 1, sourceCharacterCountWithSpaces: 3366 }),
      );
    });

    it('a re-uploaded file (different file key) invalidates the cache and re-analyzes', async () => {
      const draftWithStaleCache = {
        ...draftWithFile,
        file_keys: [{ key: 'draft-uploads/draft-1/reuploaded.pdf', originalName: 'passport2.pdf', mimeType: 'application/pdf', sizeBytes: 2000 }],
        analysis_snapshot: { fileKey: 'draft-uploads/draft-1/original.pdf', method: 'pdf_text_layer', characterCount: 100, physicalPageCount: 1, requiresOperatorReview: false, reviewReasons: [] },
      };
      mockAnalyzeDocument.mockResolvedValueOnce({ method: 'pdf_text_layer', characterCount: 5000, physicalPageCount: 3, requiresOperatorReview: false, reviewReasons: [] });
      mockDownloadFile.mockResolvedValueOnce(Buffer.from('new-pdf-bytes'));
      mockFrom
        .mockReturnValueOnce(chain({ data: draftWithStaleCache, error: null }))
        .mockReturnValueOnce(chain({ data: null, error: null }))
        .mockReturnValueOnce(chain({ data: { ...draftWithStaleCache, status: 'price_calculated' }, error: null }));
      mockComputeQuote.mockResolvedValueOnce({ result: { amountKzt: 8333, currency: 'KZT', requiresOperatorReview: false, reviewReasons: [], context: {} }, version: { id: 'v1' } });

      await calculateDraftPrice('draft-1', { sessionToken: 'sess-token' });

      expect(mockAnalyzeDocument).toHaveBeenCalledTimes(1);
      expect(mockDownloadFile).toHaveBeenCalledWith('draft-uploads/draft-1/reuploaded.pdf');
    });

    it('analysis requiring operator review: no snapshot saved, ANALYSIS_REQUIRES_OPERATOR_REVIEW returned, computeQuoteForJob never called', async () => {
      mockAnalyzeDocument.mockResolvedValueOnce({ method: 'ocr', characterCount: 0, physicalPageCount: 1, requiresOperatorReview: true, reviewReasons: ['No text could be extracted'] });
      mockDownloadFile.mockResolvedValueOnce(Buffer.from('pdf-bytes'));
      mockFrom.mockReturnValueOnce(chain({ data: draftWithFile, error: null })).mockReturnValueOnce(chain({ data: null, error: null }));

      const result = await calculateDraftPrice('draft-1', { sessionToken: 'sess-token' });

      expect(result).toEqual({ ok: false, error: 'ANALYSIS_REQUIRES_OPERATOR_REVIEW' });
      expect(mockComputeQuote).not.toHaveBeenCalled();
    });

    it('no file uploaded yet: ANALYSIS_FAILED, never calls analyzeDocumentForPricing', async () => {
      mockFrom.mockReturnValueOnce(chain({ data: { ...BASE_DRAFT, service_level: 'notarization_through_partners', file_keys: [] }, error: null }));

      const result = await calculateDraftPrice('draft-1', { sessionToken: 'sess-token' });

      expect(result).toEqual({ ok: false, error: 'ANALYSIS_FAILED' });
      expect(mockAnalyzeDocument).not.toHaveBeenCalled();
    });
  });

  it('applies the partner discount and patches the snapshot amount when ref_code matches an active discount partner', async () => {
    const pricingResult = { amountKzt: 15000, currency: 'KZT', requiresOperatorReview: false, reviewReasons: [], context: {} };
    const partnerChain = chain({
      data: {
        is_active: true,
        client_discount_enabled: true,
        client_discount_type: 'percent',
        client_discount_value: 10,
        client_discount_min_order_amount: 0,
        client_discount_max_amount: null,
      },
      error: null,
    });
    const updateChain = chain({ data: { ...BASE_DRAFT, ref_code: 'partner1', status: 'price_calculated' }, error: null });
    mockFrom
      .mockReturnValueOnce(chain({ data: { ...BASE_DRAFT, ref_code: 'partner1' }, error: null })) // getDraftRow
      .mockReturnValueOnce(partnerChain) // partners lookup
      .mockReturnValueOnce(updateChain); // order_drafts update
    mockComputeQuote.mockResolvedValueOnce({ result: pricingResult, version: { id: 'v1' } });

    const result = await calculateDraftPrice('draft-1', { sessionToken: 'sess-token' });

    expect(result.ok).toBe(true);
    // ref_code is normalized to uppercase before the partner lookup, matching upload-card.
    expect(partnerChain.eq).toHaveBeenCalledWith('referral_code', 'PARTNER1');
    expect(updateChain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        pricing_snapshot: expect.objectContaining({
          result: expect.objectContaining({ amountKzt: 13500 }),
          priceBeforeDiscountKzt: 15000,
          discountAppliedKzt: 1500,
          discountCode: 'PARTNER1',
        }),
      }),
    );
  });

  it('does not apply a discount and leaves the snapshot amount untouched when the partner code is invalid/inactive', async () => {
    const pricingResult = { amountKzt: 15000, currency: 'KZT', requiresOperatorReview: false, reviewReasons: [], context: {} };
    const partnerChain = chain({ data: null, error: null }); // no matching partner
    const updateChain = chain({ data: { ...BASE_DRAFT, ref_code: 'BOGUS', status: 'price_calculated' }, error: null });
    mockFrom
      .mockReturnValueOnce(chain({ data: { ...BASE_DRAFT, ref_code: 'BOGUS' }, error: null }))
      .mockReturnValueOnce(partnerChain)
      .mockReturnValueOnce(updateChain);
    mockComputeQuote.mockResolvedValueOnce({ result: pricingResult, version: { id: 'v1' } });

    const result = await calculateDraftPrice('draft-1', { sessionToken: 'sess-token' });

    expect(result.ok).toBe(true);
    expect(updateChain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        pricing_snapshot: expect.objectContaining({
          result: expect.objectContaining({ amountKzt: 15000 }),
          priceBeforeDiscountKzt: undefined,
          discountAppliedKzt: undefined,
          discountCode: undefined,
        }),
      }),
    );
  });
});

// ─── attachDraftToUser ──────────────────────────────────────────────────────

describe('attachDraftToUser', () => {
  it('is a no-op success when the draft is already attached to this user', async () => {
    const owned = { ...BASE_DRAFT, user_id: 'user-1' };
    mockFrom.mockReturnValueOnce(chain({ data: owned, error: null }));

    const result = await attachDraftToUser('draft-1', 'user-1', 'sess-token');

    expect(result).toEqual({ ok: true, value: owned });
    expect(mockFrom).toHaveBeenCalledTimes(1); // no update call needed
  });

  it('returns DRAFT_OWNED_BY_ANOTHER_USER when attached to a different user', async () => {
    mockFrom.mockReturnValueOnce(chain({ data: { ...BASE_DRAFT, user_id: 'other-user' }, error: null }));
    const result = await attachDraftToUser('draft-1', 'user-1', 'sess-token');
    expect(result).toEqual({ ok: false, error: 'DRAFT_OWNED_BY_ANOTHER_USER' });
  });

  it('returns SESSION_MISMATCH when the session cookie does not match the anonymous draft', async () => {
    mockFrom.mockReturnValueOnce(chain({ data: BASE_DRAFT, error: null }));
    const result = await attachDraftToUser('draft-1', 'user-1', 'wrong-session');
    expect(result).toEqual({ ok: false, error: 'SESSION_MISMATCH' });
  });

  it('returns SESSION_MISMATCH when there is no session cookie at all', async () => {
    mockFrom.mockReturnValueOnce(chain({ data: BASE_DRAFT, error: null }));
    const result = await attachDraftToUser('draft-1', 'user-1', null);
    expect(result).toEqual({ ok: false, error: 'SESSION_MISMATCH' });
  });

  it('attaches the draft to the user when the session token matches', async () => {
    const updateChain = chain({ data: { ...BASE_DRAFT, user_id: 'user-1' }, error: null });
    mockFrom.mockReturnValueOnce(chain({ data: BASE_DRAFT, error: null })).mockReturnValueOnce(updateChain);

    const result = await attachDraftToUser('draft-1', 'user-1', 'sess-token');

    expect(result.ok).toBe(true);
    expect(updateChain.update).toHaveBeenCalledWith(expect.objectContaining({ user_id: 'user-1' }));
  });

  it('preserves the partner ref_code across login — attach only patches user_id', async () => {
    const withRefCode = { ...BASE_DRAFT, ref_code: 'PARTNER1' };
    const updateChain = chain({ data: { ...withRefCode, user_id: 'user-1' }, error: null });
    mockFrom.mockReturnValueOnce(chain({ data: withRefCode, error: null })).mockReturnValueOnce(updateChain);

    const result = await attachDraftToUser('draft-1', 'user-1', 'sess-token');

    expect(result).toEqual({ ok: true, value: { ...withRefCode, user_id: 'user-1' } });
    expect(updateChain.update).not.toHaveBeenCalledWith(expect.objectContaining({ ref_code: expect.anything() }));
    if (result.ok) expect(result.value.ref_code).toBe('PARTNER1');
  });
});

// ─── convertDraftToOrder ────────────────────────────────────────────────────

describe('convertDraftToOrder', () => {
  it('returns FORBIDDEN when the draft belongs to a different user', async () => {
    mockFrom.mockReturnValueOnce(chain({ data: { ...BASE_DRAFT, user_id: 'other-user' }, error: null }));
    const result = await convertDraftToOrder('draft-1', 'user-1');
    expect(result).toEqual({ ok: false, error: 'FORBIDDEN' });
  });

  it('is idempotent — a second call after conversion returns the existing ids without re-inserting', async () => {
    const converted = {
      ...BASE_DRAFT,
      user_id: 'user-1',
      status: 'converted' as const,
      converted_job_id: 'job-1',
      converted_document_id: 'doc-1',
      converted_quote_id: 'quote-1',
      converted_price_kzt: 15000,
    };
    mockFrom.mockReturnValueOnce(chain({ data: converted, error: null }));

    const result = await convertDraftToOrder('draft-1', 'user-1');

    expect(result).toEqual({
      ok: true,
      value: { jobId: 'job-1', documentId: 'doc-1', quoteId: 'quote-1', priceKzt: 15000 },
    });
    expect(mockFrom).toHaveBeenCalledTimes(1); // no new insert attempted
    expect(mockDownloadFile).not.toHaveBeenCalled();
  });

  it('returns CONSENT_NOT_ACCEPTED and never creates a document/job when the draft has no recorded consent', async () => {
    const unconsented = { ...BASE_DRAFT, user_id: 'user-1', consent_accepted_at: null };
    mockFrom.mockReturnValueOnce(chain({ data: unconsented, error: null }));
    const result = await convertDraftToOrder('draft-1', 'user-1');
    expect(result).toEqual({ ok: false, error: 'CONSENT_NOT_ACCEPTED' });
    expect(mockDownloadFile).not.toHaveBeenCalled();
  });

  it('returns PRICE_NOT_CALCULATED when no pricing snapshot exists yet', async () => {
    mockFrom.mockReturnValueOnce(chain({ data: { ...BASE_DRAFT, user_id: 'user-1' }, error: null }));
    const result = await convertDraftToOrder('draft-1', 'user-1');
    expect(result).toEqual({ ok: false, error: 'PRICE_NOT_CALCULATED' });
  });

  it('returns NO_FILE when a price was calculated but no file was uploaded', async () => {
    const priced = {
      ...BASE_DRAFT,
      user_id: 'user-1',
      status: 'price_calculated' as const,
      pricing_snapshot: { result: { amountKzt: 1000 }, computedAt: 'x' } as never,
      file_keys: [],
    };
    mockFrom.mockReturnValueOnce(chain({ data: priced, error: null }));
    const result = await convertDraftToOrder('draft-1', 'user-1');
    expect(result).toEqual({ ok: false, error: 'NO_FILE' });
  });

  function pricedDraftWithFile(overrides: Partial<OrderDraftRow> = {}): OrderDraftRow {
    return {
      ...BASE_DRAFT,
      user_id: 'user-1',
      status: 'price_calculated',
      pricing_snapshot: {
        result: {
          amountKzt: 15000,
          currency: 'KZT',
          status: 'quoted',
          items: [],
          pricingVersionId: 'v1',
          pricingVersionCode: 'v1',
          internalCosts: {} as never,
          margin: {} as never,
          requiresOperatorReview: false,
          reviewReasons: [],
          context: { languagePair: 'ru-en', baseMinimumKzt: 0, extraWords: 0, additionalPages: 0, documentCoefficient: 1, urgencyCoefficient: 1, includedWordCount: 0, includedPageCount: 1 },
        },
        version: {} as never,
        computedAt: '2026-01-01T00:00:00.000Z',
      },
      file_keys: [{ key: 'draft-uploads/draft-1/original.pdf', originalName: 'passport.pdf', mimeType: 'application/pdf', sizeBytes: 1000 }],
      ...overrides,
    };
  }

  it('returns CONVERSION_IN_PROGRESS when a concurrent claim is in flight and not yet done', async () => {
    const priced = pricedDraftWithFile();
    mockFrom
      .mockReturnValueOnce(chain({ data: priced, error: null })) // existing check
      .mockReturnValueOnce(chain({ data: null, error: null }))   // atomic claim lost the race
      .mockReturnValueOnce(chain({ data: { ...priced, status: 'checkout_started' }, error: null })); // reload — still not converted

    const result = await convertDraftToOrder('draft-1', 'user-1');
    expect(result).toEqual({ ok: false, error: 'CONVERSION_IN_PROGRESS' });
  });

  it('returns the existing ids when a concurrent caller already finished the conversion', async () => {
    const priced = pricedDraftWithFile();
    const alreadyConverted = { ...priced, status: 'converted' as const, converted_job_id: 'job-x', converted_document_id: 'doc-x', converted_quote_id: 'quote-x', converted_price_kzt: 15000 };
    mockFrom
      .mockReturnValueOnce(chain({ data: priced, error: null }))
      .mockReturnValueOnce(chain({ data: null, error: null }))
      .mockReturnValueOnce(chain({ data: alreadyConverted, error: null }));

    const result = await convertDraftToOrder('draft-1', 'user-1');
    expect(result).toEqual({
      ok: true,
      value: { jobId: 'job-x', documentId: 'doc-x', quoteId: 'quote-x', priceKzt: 15000 },
    });
  });

  it('happy path: creates document + job (payment_pending) + quote, never touches processJob/Jira/Drive', async () => {
    const priced = pricedDraftWithFile({ ref_code: 'PARTNER1' });

    mockDownloadFile.mockResolvedValueOnce(Buffer.from('pdf-bytes'));
    mockUploadFile.mockResolvedValueOnce(undefined);
    mockSaveQuote.mockResolvedValueOnce({ quoteId: 'quote-99' });
    mockAttachReferral.mockResolvedValueOnce(undefined);

    const docInsertChain = chain({ data: { id: 'doc-99' }, error: null });
    const jobInsertChain = chain({ data: { id: 'job-99' }, error: null });
    const usersUpsertChain = chain({ data: null, error: null });
    const auditInsertChain = chain({ error: null });
    const finalMarkChain = chain({ data: null, error: null });

    mockFrom
      .mockReturnValueOnce(chain({ data: priced, error: null })) // existing check
      .mockReturnValueOnce(chain({ data: priced, error: null })) // atomic claim succeeds
      .mockReturnValueOnce(usersUpsertChain)                     // users upsert
      .mockReturnValueOnce(docInsertChain)                       // documents insert
      .mockReturnValueOnce(jobInsertChain)                       // jobs insert
      .mockReturnValueOnce(auditInsertChain)                     // job_audit_log insert
      .mockReturnValueOnce(finalMarkChain);                      // final order_drafts update

    const result = await convertDraftToOrder('draft-1', 'user-1');

    expect(result).toEqual({
      ok: true,
      value: { jobId: 'job-99', documentId: 'doc-99', quoteId: 'quote-99', priceKzt: 15000 },
    });

    expect(mockDownloadFile).toHaveBeenCalledWith('draft-uploads/draft-1/original.pdf');
    expect(mockUploadFile).toHaveBeenCalledWith(expect.stringMatching(/^documents\/user-1\/.+\/original\.pdf$/), expect.any(Buffer), 'application/pdf');

    expect(docInsertChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'user-1', status: 'processing', source_language: 'ru', target_language: 'en' }),
    );
    expect(jobInsertChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'payment_pending', payment_source: 'card_payment', price_kzt: 15000 }),
    );
    expect(mockSaveQuote).toHaveBeenCalled();
    expect(mockAttachReferral).toHaveBeenCalledWith(expect.objectContaining({ jobId: 'job-99', refCode: 'PARTNER1' }));
    expect(finalMarkChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'converted', converted_job_id: 'job-99', converted_document_id: 'doc-99', converted_quote_id: 'quote-99' }),
    );
  });

  it('non-electronic with a cached analysis_snapshot: materializes exactly one document_analysis row (never re-analyzes), analysisId flows into saveQuote', async () => {
    const priced = pricedDraftWithFile({
      service_level: 'official_with_translator_signature_and_provider_stamp',
      analysis_snapshot: { fileKey: 'draft-uploads/draft-1/original.pdf', method: 'pdf_text_layer', characterCount: 671, physicalPageCount: 2, requiresOperatorReview: false, reviewReasons: [] },
    });

    mockDownloadFile.mockResolvedValueOnce(Buffer.from('pdf-bytes'));
    mockUploadFile.mockResolvedValueOnce(undefined);
    mockSaveQuote.mockResolvedValueOnce({ quoteId: 'quote-99' });

    const docInsertChain = chain({ data: { id: 'doc-99' }, error: null });
    const analysisInsertChain = chain({ data: { id: 'analysis-99' }, error: null });
    const jobInsertChain = chain({ data: { id: 'job-99' }, error: null });

    mockFrom
      .mockReturnValueOnce(chain({ data: priced, error: null })) // existing check
      .mockReturnValueOnce(chain({ data: priced, error: null })) // atomic claim succeeds
      .mockReturnValueOnce(chain({ data: null, error: null }))   // users upsert
      .mockReturnValueOnce(docInsertChain)                       // documents insert
      .mockReturnValueOnce(analysisInsertChain)                  // document_analysis insert
      .mockReturnValueOnce(jobInsertChain)                       // jobs insert
      .mockReturnValueOnce(chain({ error: null }))               // job_audit_log insert
      .mockReturnValueOnce(chain({ data: null, error: null }));  // final order_drafts update

    const result = await convertDraftToOrder('draft-1', 'user-1');

    expect(result.ok).toBe(true);
    expect(analysisInsertChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ document_id: 'doc-99', revision: 1, status: 'completed', source_character_count_with_spaces: 671, physical_page_count: 2 }),
    );
    expect(mockSaveQuote).toHaveBeenCalledWith(
      expect.objectContaining({ analysisId: 'analysis-99' }),
      expect.anything(),
      expect.anything(),
      24,
      undefined,
    );
  });

  it('persists the discounted quote into the real order: job carries discount fields and the discounted amount is what saveQuote/Halyk see', async () => {
    const priced = pricedDraftWithFile({
      ref_code: 'PARTNER1',
      pricing_snapshot: {
        result: {
          amountKzt: 13500, // already discounted by calculateDraftPrice (15000 base - 1500 discount)
          currency: 'KZT',
          status: 'quoted',
          items: [],
          pricingVersionId: 'v1',
          pricingVersionCode: 'v1',
          internalCosts: {} as never,
          margin: {} as never,
          requiresOperatorReview: false,
          reviewReasons: [],
          context: { languagePair: 'ru-en', baseMinimumKzt: 0, extraWords: 0, additionalPages: 0, documentCoefficient: 1, urgencyCoefficient: 1, includedWordCount: 0, includedPageCount: 1 },
        },
        version: {} as never,
        computedAt: '2026-01-01T00:00:00.000Z',
        priceBeforeDiscountKzt: 15000,
        discountAppliedKzt: 1500,
        discountCode: 'PARTNER1',
      },
    });

    mockDownloadFile.mockResolvedValueOnce(Buffer.from('pdf-bytes'));
    mockUploadFile.mockResolvedValueOnce(undefined);
    mockSaveQuote.mockResolvedValueOnce({ quoteId: 'quote-99' });
    mockAttachReferral.mockResolvedValueOnce(undefined);

    const jobInsertChain = chain({ data: { id: 'job-99' }, error: null });
    mockFrom
      .mockReturnValueOnce(chain({ data: priced, error: null })) // existing check
      .mockReturnValueOnce(chain({ data: priced, error: null })) // atomic claim succeeds
      .mockReturnValueOnce(chain({ data: null, error: null }))   // users upsert
      .mockReturnValueOnce(chain({ data: { id: 'doc-99' }, error: null })) // documents insert
      .mockReturnValueOnce(jobInsertChain)                       // jobs insert
      .mockReturnValueOnce(chain({ error: null }))                // job_audit_log insert
      .mockReturnValueOnce(chain({ data: null, error: null }));   // final order_drafts update

    const result = await convertDraftToOrder('draft-1', 'user-1');

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.priceKzt).toBe(13500);

    // The saved quote / job.price_kzt must be the discounted amount — this is the
    // amount Halyk initiate reads via price_quotes.amount_kzt.
    expect(jobInsertChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        price_kzt: 13500,
        price_before_discount_kzt: 15000,
        discount_applied_kzt: 1500,
        discount_code: 'PARTNER1',
      }),
    );
    expect(mockSaveQuote).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ amountKzt: 13500 }),
      expect.anything(),
      24,
      undefined,
    );

    // Referral commission must be computed off the pre-discount base, with the
    // discount surfaced separately — never off the discounted total.
    expect(mockAttachReferral).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: 'job-99',
        refCode: 'PARTNER1',
        orderAmountKzt: 15000,
        clientDiscountAppliedKzt: 1500,
      }),
    );
  });

  it('does not skip the file-signature-checked upload path — jobs insert never carries a "queued" status', async () => {
    const priced = pricedDraftWithFile();
    mockDownloadFile.mockResolvedValueOnce(Buffer.from('pdf-bytes'));
    mockUploadFile.mockResolvedValueOnce(undefined);
    mockSaveQuote.mockResolvedValueOnce({ quoteId: 'quote-99' });

    const jobInsertChain = chain({ data: { id: 'job-99' }, error: null });
    mockFrom
      .mockReturnValueOnce(chain({ data: priced, error: null }))
      .mockReturnValueOnce(chain({ data: priced, error: null }))
      .mockReturnValueOnce(chain({ data: null, error: null }))
      .mockReturnValueOnce(chain({ data: { id: 'doc-99' }, error: null }))
      .mockReturnValueOnce(jobInsertChain)
      .mockReturnValueOnce(chain({ error: null }))
      .mockReturnValueOnce(chain({ data: null, error: null }));

    await convertDraftToOrder('draft-1', 'user-1');

    const insertedJob = (jobInsertChain.insert as jest.Mock).mock.calls[0][0] as Record<string, unknown>;
    expect(insertedJob.status).toBe('payment_pending');
    expect(insertedJob.status).not.toBe('queued');
  });
});

// ─── Structural guarantee — conversion never reaches the paid-order pipeline ──

describe('conversion never reaches Jira/Drive/translation', () => {
  it('service.ts does not import the worker job processor, Jira client, Drive client, or integrations workflow', () => {
    // Note: explanatory comments in service.ts legitimately mention "processJob()" and
    // "Jira/Drive" by name (documenting what it deliberately does NOT call) — so this
    // checks import specifiers, not a bare substring match, to avoid a false positive
    // on those comments.
    const src = fs.readFileSync(path.join(__dirname, '..', 'service.ts'), 'utf8');
    expect(src).not.toMatch(/from ['"]@\/lib\/jobs\/processor['"]/);
    expect(src).not.toMatch(/from ['"]@\/lib\/jira\//);
    expect(src).not.toMatch(/from ['"]@\/lib\/google-drive\//);
    expect(src).not.toMatch(/from ['"]@\/lib\/integrations\/workflow['"]/);
  });
});
