/**
 * Tests for src/lib/documents/upload-card-shared.ts — shared logic behind both the
 * legacy upload-card endpoint and the new direct-to-R2 init/complete endpoints.
 */
jest.mock('@/lib/supabase/server', () => ({
  supabaseServer: { from: jest.fn() },
}));
jest.mock('@/lib/pricing/service', () => ({
  computeQuoteForJob: jest.fn(),
  saveQuote: jest.fn(),
  extractNotaryUrgencySnapshot: jest.fn(() => null),
}));
jest.mock('@/lib/referral/server', () => ({
  attachReferralToOrder: jest.fn(),
}));

import { supabaseServer } from '@/lib/supabase/server';
import { computeQuoteForJob, saveQuote } from '@/lib/pricing/service';
import { attachReferralToOrder } from '@/lib/referral/server';
import {
  checkCardUploadRateLimit,
  findExistingCardOrder,
  buildCardRawUploadKey,
  isValidCardRawUploadKey,
  cardFinalUploadKey,
  createCardOrder,
  OptionalUtmFieldsSchema,
  type CardOrderInput,
} from '../upload-card-shared';

const mockFrom = supabaseServer.from as jest.Mock;
const mockComputeQuote = computeQuoteForJob as jest.Mock;
const mockSaveQuote = saveQuote as jest.Mock;
const mockAttachReferral = attachReferralToOrder as jest.Mock;

function chain(result: { data?: unknown; error?: unknown; count?: number }) {
  const c: Record<string, unknown> = {};
  const methods = ['select', 'eq', 'neq', 'gte', 'lt', 'in', 'insert', 'update', 'upsert', 'delete', 'order', 'limit'];
  for (const m of methods) c[m] = jest.fn(() => c);
  c.single = jest.fn(() => Promise.resolve(result));
  c.maybeSingle = jest.fn(() => Promise.resolve(result));
  c.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return c;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAttachReferral.mockResolvedValue(undefined);
});

describe('checkCardUploadRateLimit', () => {
  it('allows uploads under the 10/hour limit', async () => {
    mockFrom.mockReturnValueOnce(chain({ count: 3, error: null }));
    expect(await checkCardUploadRateLimit('user-1')).toBe(true);
  });

  it('blocks at 10 uploads in the last hour', async () => {
    mockFrom.mockReturnValueOnce(chain({ count: 10, error: null }));
    expect(await checkCardUploadRateLimit('user-1')).toBe(false);
  });
});

describe('card raw key helpers', () => {
  it('builds a key under card-upload-raw/{userId}/{uploadAttemptId}/{uuid}', () => {
    const key = buildCardRawUploadKey('user-1', 'attempt-1');
    expect(key).toMatch(/^card-upload-raw\/user-1\/attempt-1\/[0-9a-f-]{36}$/);
  });

  it('accepts a well-formed key for the matching user+attempt', () => {
    const key = buildCardRawUploadKey('user-1', 'attempt-1');
    expect(isValidCardRawUploadKey(key, 'user-1', 'attempt-1')).toBe(true);
  });

  it('rejects a key belonging to a different user (ownership)', () => {
    const key = buildCardRawUploadKey('user-1', 'attempt-1');
    expect(isValidCardRawUploadKey(key, 'user-2', 'attempt-1')).toBe(false);
  });

  it('rejects a key belonging to a different upload attempt', () => {
    const key = buildCardRawUploadKey('user-1', 'attempt-1');
    expect(isValidCardRawUploadKey(key, 'user-1', 'attempt-2')).toBe(false);
  });

  it('rejects an arbitrary/attacker-supplied key', () => {
    expect(isValidCardRawUploadKey('documents/user-1/doc-1/original.pdf', 'user-1', 'attempt-1')).toBe(false);
  });

  it('rejects path traversal', () => {
    expect(isValidCardRawUploadKey('card-upload-raw/user-1/attempt-1/../../secrets', 'user-1', 'attempt-1')).toBe(false);
  });

  it('builds the final key at documents/{userId}/{uploadAttemptId}/original.pdf', () => {
    expect(cardFinalUploadKey('user-1', 'attempt-1')).toBe('documents/user-1/attempt-1/original.pdf');
  });
});

describe('findExistingCardOrder', () => {
  it('returns null when no document exists for this user+uploadAttemptId', async () => {
    mockFrom.mockReturnValueOnce(chain({ data: null, error: null }));
    const result = await findExistingCardOrder('user-1', 'attempt-1');
    expect(result).toBeNull();
  });

  it('returns null when the document exists but has no linked job', async () => {
    mockFrom
      .mockReturnValueOnce(chain({ data: { id: 'attempt-1' }, error: null }))
      .mockReturnValueOnce(chain({ data: null, error: null }));
    const result = await findExistingCardOrder('user-1', 'attempt-1');
    expect(result).toBeNull();
  });

  it('returns the existing job/document/price when both exist (idempotent replay)', async () => {
    mockFrom
      .mockReturnValueOnce(chain({ data: { id: 'attempt-1' }, error: null }))
      .mockReturnValueOnce(chain({
        data: { id: 'job-1', price_kzt: 15000, price_before_discount_kzt: 18000, discount_applied_kzt: 3000, discount_code: 'PARTNER1' },
        error: null,
      }));
    const result = await findExistingCardOrder('user-1', 'attempt-1');
    expect(result).toEqual({
      jobId: 'job-1',
      documentId: 'attempt-1',
      priceKzt: 15000,
      priceBeforeDiscountKzt: 18000,
      discountAppliedKzt: 3000,
      discountCode: 'PARTNER1',
    });
  });
});

describe('createCardOrder', () => {
  function baseInput(overrides: Partial<CardOrderInput> = {}): CardOrderInput {
    return {
      userId: 'user-1',
      userEmail: 'user@example.com',
      uploadAttemptId: 'attempt-1',
      fileKey: 'documents/user-1/attempt-1/original.pdf',
      filename: 'passport.pdf',
      originalFileSize: 1_000_000,
      ipAddress: '1.2.3.4',
      sourceLang: 'ru',
      targetLang: 'en',
      documentType: 'passport_id|pdf',
      serviceLevel: 'electronic',
      notaryUrgencyLevel: 'standard',
      ...overrides,
    };
  }

  it('creates document (status=processing) + job (status=payment_pending, payment_source=card_payment) and preserves pricing', async () => {
    mockComputeQuote.mockResolvedValueOnce({
      result: { amountKzt: 15000, currency: 'KZT', requiresOperatorReview: false, reviewReasons: [], context: {}, items: [] },
    });
    mockSaveQuote.mockResolvedValueOnce({ quoteId: 'quote-1' });

    const usersUpsertChain = chain({ data: null, error: null });
    const docInsertChain = chain({ data: { id: 'attempt-1' }, error: null });
    const jobInsertChain = chain({ data: { id: 'job-1' }, error: null });
    const auditChain = chain({ error: null });

    mockFrom
      .mockReturnValueOnce(usersUpsertChain)
      .mockReturnValueOnce(chain({ data: null, error: null })) // existing-document lookup — none found
      .mockReturnValueOnce(docInsertChain)
      .mockReturnValueOnce(jobInsertChain)
      .mockReturnValueOnce(auditChain);

    const result = await createCardOrder(baseInput());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual(expect.objectContaining({ jobId: 'job-1', documentId: 'attempt-1', priceKzt: 15000, quoteId: 'quote-1' }));

    expect(docInsertChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'attempt-1', user_id: 'user-1', status: 'processing', file_key: baseInput().fileKey }),
    );
    expect(jobInsertChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'payment_pending', payment_source: 'card_payment', price_kzt: 15000 }),
    );
  });

  it('applies a partner discount and stores discount fields on the job', async () => {
    mockComputeQuote.mockResolvedValueOnce({
      result: { amountKzt: 15000, currency: 'KZT', requiresOperatorReview: false, reviewReasons: [], context: {}, items: [] },
    });
    mockSaveQuote.mockResolvedValueOnce({ quoteId: 'quote-1' });

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
    const jobInsertChain = chain({ data: { id: 'job-1' }, error: null });

    mockFrom
      .mockReturnValueOnce(chain({ data: null, error: null })) // users upsert
      .mockReturnValueOnce(chain({ data: null, error: null })) // existing-document lookup — none found
      .mockReturnValueOnce(chain({ data: { id: 'attempt-1' }, error: null })) // documents insert
      .mockReturnValueOnce(partnerChain) // partners lookup
      .mockReturnValueOnce(jobInsertChain) // jobs insert
      .mockReturnValueOnce(chain({ error: null })); // job_audit_log

    const result = await createCardOrder(baseInput({ refCode: 'partner1' }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.priceKzt).toBe(13500);
    expect(jobInsertChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ price_kzt: 13500, price_before_discount_kzt: 15000, discount_applied_kzt: 1500, discount_code: 'PARTNER1' }),
    );
  });

  it('marks the document failed and returns PRICING_NOT_CONFIGURED when pricing errors', async () => {
    mockComputeQuote.mockResolvedValueOnce({ error: 'PRICING_NOT_CONFIGURED' });
    const docInsertChain = chain({ data: { id: 'attempt-1' }, error: null });
    const docUpdateChain = chain({ data: null, error: null });

    mockFrom
      .mockReturnValueOnce(chain({ data: null, error: null })) // users upsert
      .mockReturnValueOnce(chain({ data: null, error: null })) // existing-document lookup — none found
      .mockReturnValueOnce(docInsertChain)
      .mockReturnValueOnce(docUpdateChain);

    const result = await createCardOrder(baseInput());

    expect(result).toEqual({ ok: false, status: 503, error: 'PRICING_NOT_CONFIGURED' });
    expect(docUpdateChain.update).toHaveBeenCalledWith({ status: 'failed' });
  });

  it('marks the document failed and returns an error when job insert fails', async () => {
    mockComputeQuote.mockResolvedValueOnce({
      result: { amountKzt: 15000, currency: 'KZT', requiresOperatorReview: false, reviewReasons: [], context: {}, items: [] },
    });
    const docInsertChain = chain({ data: { id: 'attempt-1' }, error: null });
    const jobInsertChain = chain({ data: null, error: { message: 'insert failed' } });
    const docUpdateChain = chain({ data: null, error: null });

    mockFrom
      .mockReturnValueOnce(chain({ data: null, error: null })) // users upsert
      .mockReturnValueOnce(chain({ data: null, error: null })) // existing-document lookup — none found
      .mockReturnValueOnce(docInsertChain)
      .mockReturnValueOnce(jobInsertChain)
      .mockReturnValueOnce(docUpdateChain);

    const result = await createCardOrder(baseInput());

    expect(result).toEqual({ ok: false, status: 500, error: 'Failed to create job' });
    expect(docUpdateChain.update).toHaveBeenCalledWith({ status: 'failed' });
  });

  it('does not block on referral attach failure (best-effort)', async () => {
    mockComputeQuote.mockResolvedValueOnce({
      result: { amountKzt: 15000, currency: 'KZT', requiresOperatorReview: false, reviewReasons: [], context: {}, items: [] },
    });
    mockSaveQuote.mockResolvedValueOnce({ quoteId: 'quote-1' });
    mockAttachReferral.mockRejectedValueOnce(new Error('referral service down'));

    mockFrom
      .mockReturnValueOnce(chain({ data: null, error: null })) // users upsert
      .mockReturnValueOnce(chain({ data: null, error: null })) // existing-document lookup — none found
      .mockReturnValueOnce(chain({ data: { id: 'attempt-1' }, error: null })) // documents insert
      .mockReturnValueOnce(chain({ data: null, error: null })) // partners lookup (no matching discount partner)
      .mockReturnValueOnce(chain({ data: { id: 'job-1' }, error: null })) // jobs insert
      .mockReturnValueOnce(chain({ error: null })); // job_audit_log

    const result = await createCardOrder(baseInput({ refCode: 'PARTNER1' }));
    expect(result.ok).toBe(true);
  });

  it('reuses (does not re-insert) a document left behind by a prior failed attempt, and completes the order on retry', async () => {
    // Simulates: a first createCardOrder() call inserted the document, then failed at
    // pricing/job-insert and marked it status='failed'. A retry must not hit a PK
    // conflict on a second .insert() with the same uploadAttemptId.
    mockComputeQuote.mockResolvedValueOnce({
      result: { amountKzt: 15000, currency: 'KZT', requiresOperatorReview: false, reviewReasons: [], context: {}, items: [] },
    });
    mockSaveQuote.mockResolvedValueOnce({ quoteId: 'quote-1' });

    const docUpdateChain = chain({ data: { id: 'attempt-1' }, error: null });
    const jobInsertChain = chain({ data: { id: 'job-1' }, error: null });

    mockFrom
      .mockReturnValueOnce(chain({ data: null, error: null })) // users upsert
      .mockReturnValueOnce(chain({ data: { id: 'attempt-1' }, error: null })) // existing-document lookup — FOUND (left over from failed attempt)
      .mockReturnValueOnce(chain({ data: null, error: null })) // existing-job lookup for that document — none (job insert never got that far)
      .mockReturnValueOnce(docUpdateChain) // document UPDATE (not insert) — reused
      .mockReturnValueOnce(jobInsertChain) // jobs insert succeeds this time
      .mockReturnValueOnce(chain({ error: null })); // job_audit_log

    const result = await createCardOrder(baseInput());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual(expect.objectContaining({ jobId: 'job-1', documentId: 'attempt-1', priceKzt: 15000 }));
    // Must have gone through UPDATE, never a duplicate INSERT.
    expect(docUpdateChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'attempt-1', status: 'processing' }),
    );
  });

  it('replays the existing job instead of creating a second one when a job already exists for this document (race defense)', async () => {
    mockFrom
      .mockReturnValueOnce(chain({ data: null, error: null })) // users upsert
      .mockReturnValueOnce(chain({ data: { id: 'attempt-1' }, error: null })) // existing-document lookup — found
      .mockReturnValueOnce(chain({ // existing-job lookup — a job already exists (concurrent complete finished first)
        data: { id: 'job-existing', price_kzt: 15000, price_before_discount_kzt: null, discount_applied_kzt: null, discount_code: null },
        error: null,
      }));

    const result = await createCardOrder(baseInput());

    expect(result).toEqual({
      ok: true,
      value: expect.objectContaining({ jobId: 'job-existing', documentId: 'attempt-1', priceKzt: 15000 }),
    });
    // Pricing/job-insert must never run a second time for the same document.
    expect(mockComputeQuote).not.toHaveBeenCalled();
  });
});

describe('OptionalUtmFieldsSchema — regression for the production 400 (explicit null rejected)', () => {
  const ALL_NULL = { refCode: null, utmSource: null, utmMedium: null, utmCampaign: null, utmContent: null, utmTerm: null };
  const ALL_ABSENT = {};
  const ALL_VALID = { refCode: 'PARTNER1', utmSource: 'google', utmMedium: 'cpc', utmCampaign: 'summer', utmContent: 'ad1', utmTerm: 'translate' };

  it('accepts every field as explicit null (root cause: ReferralParams sends null, not undefined)', () => {
    const result = OptionalUtmFieldsSchema.safeParse(ALL_NULL);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({});
    }
  });

  it('accepts every field entirely absent', () => {
    const result = OptionalUtmFieldsSchema.safeParse(ALL_ABSENT);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({});
    }
  });

  it('normalizes empty strings to undefined as well', () => {
    const result = OptionalUtmFieldsSchema.safeParse({ refCode: '', utmSource: '', utmMedium: '', utmCampaign: '', utmContent: '', utmTerm: '' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({});
    }
  });

  it('preserves non-empty valid values unchanged', () => {
    const result = OptionalUtmFieldsSchema.safeParse(ALL_VALID);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(ALL_VALID);
    }
  });

  it('rejects a wrong type (object) for a UTM field', () => {
    const result = OptionalUtmFieldsSchema.safeParse({ utmSource: { nested: 'object' } });
    expect(result.success).toBe(false);
  });

  it('rejects a wrong type (array) for a UTM field', () => {
    const result = OptionalUtmFieldsSchema.safeParse({ utmCampaign: ['array', 'value'] });
    expect(result.success).toBe(false);
  });

  it('still enforces the max-length constraint on non-empty values', () => {
    const result = OptionalUtmFieldsSchema.safeParse({ utmSource: 'x'.repeat(201) });
    expect(result.success).toBe(false);
  });
});
