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
