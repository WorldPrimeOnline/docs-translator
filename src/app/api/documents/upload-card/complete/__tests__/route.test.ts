/**
 * Tests for POST /api/documents/upload-card/complete — the second half of the
 * dashboard/card-payment direct-to-R2 upload flow. Covers key validation, HeadObject
 * verification, the existing magic-byte/convert/merge pipeline, idempotent replay
 * (document/job created only once), and pricing/status preservation.
 */
jest.mock('@/lib/payments/halyk/config', () => ({
  getHalykConfig: jest.fn(),
}));
jest.mock('@/lib/documents/upload-card-shared', () => {
  const actual = jest.requireActual('@/lib/documents/upload-card-shared');
  return {
    ...actual,
    getAuthUser: jest.fn(),
    getClientIp: jest.fn(),
    checkCardUploadRateLimit: jest.fn(),
    findExistingCardOrder: jest.fn(),
    createCardOrder: jest.fn(),
  };
});
jest.mock('@/lib/supabase/server', () => ({
  supabaseServer: { from: jest.fn() },
}));
jest.mock('@/lib/r2/client', () => ({
  downloadFile: jest.fn(),
  uploadFile: jest.fn(),
  deleteFile: jest.fn(),
  headFile: jest.fn(),
}));
jest.mock('@/lib/file-validation/signature', () => ({
  matchesClaimedMimeType: jest.fn(),
}));
jest.mock('@/lib/convert-to-pdf', () => ({
  convertToPdf: jest.fn(),
  mergePdfs: jest.fn(),
}));

import { NextRequest } from 'next/server';
import { POST } from '../route';
import { getHalykConfig } from '@/lib/payments/halyk/config';
import {
  getAuthUser,
  getClientIp,
  checkCardUploadRateLimit,
  findExistingCardOrder,
  createCardOrder,
} from '@/lib/documents/upload-card-shared';
import { supabaseServer } from '@/lib/supabase/server';
import { downloadFile, uploadFile, deleteFile, headFile } from '@/lib/r2/client';
import { matchesClaimedMimeType } from '@/lib/file-validation/signature';
import { convertToPdf, mergePdfs } from '@/lib/convert-to-pdf';

const mockGetHalykConfig = getHalykConfig as jest.Mock;
const mockGetAuthUser = getAuthUser as jest.Mock;
const mockGetClientIp = getClientIp as jest.Mock;
const mockCheckRateLimit = checkCardUploadRateLimit as jest.Mock;
const mockFindExisting = findExistingCardOrder as jest.Mock;
const mockCreateCardOrder = createCardOrder as jest.Mock;
const mockFrom = supabaseServer.from as jest.Mock;
const mockDownloadFile = downloadFile as jest.Mock;
const mockUploadFile = uploadFile as jest.Mock;
const mockDeleteFile = deleteFile as jest.Mock;
const mockHeadFile = headFile as jest.Mock;
const mockMatchesClaimedMimeType = matchesClaimedMimeType as jest.Mock;
const mockConvertToPdf = convertToPdf as jest.Mock;
const mockMergePdfs = mergePdfs as jest.Mock;

function chain(result: { data?: unknown; error?: unknown }) {
  const c: Record<string, unknown> = {};
  const methods = ['select', 'eq'];
  for (const m of methods) c[m] = jest.fn(() => c);
  c.maybeSingle = jest.fn(() => Promise.resolve(result));
  return c;
}

const UPLOAD_ATTEMPT_ID = '11111111-1111-4111-8111-111111111111';
const RAW_KEY = `card-upload-raw/user-1/${UPLOAD_ATTEMPT_ID}/22222222-2222-2222-2222-222222222222`;
const FINAL_KEY = `documents/user-1/${UPLOAD_ATTEMPT_ID}/original.pdf`;

const VALID_BODY_BASE = {
  uploadAttemptId: UPLOAD_ATTEMPT_ID,
  sourceLang: 'ru',
  targetLang: 'en',
  documentType: 'passport_id|pdf',
  serviceLevel: 'electronic',
};

const oneUpload = [{ key: RAW_KEY, originalName: 'passport.pdf', mimeType: 'application/pdf', sizeBytes: 100 }];

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/documents/upload-card/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  jest.resetAllMocks();
  mockGetHalykConfig.mockReturnValue({ enabled: true });
  mockGetAuthUser.mockResolvedValue({ id: 'user-1', email: 'a@b.com' });
  mockGetClientIp.mockReturnValue('1.2.3.4');
  mockFrom.mockReturnValue(chain({ data: { terms_accepted_at: '2026-01-01T00:00:00.000Z' }, error: null }));
  mockCheckRateLimit.mockResolvedValue(true);
  mockFindExisting.mockResolvedValue(null);
  mockMatchesClaimedMimeType.mockReturnValue(true);
  mockConvertToPdf.mockImplementation((buf: Buffer) => Promise.resolve(buf));
  mockMergePdfs.mockImplementation((parts: Buffer[]) => Promise.resolve(Buffer.concat(parts)));
  mockDownloadFile.mockResolvedValue(Buffer.from('raw-bytes'));
  mockUploadFile.mockResolvedValue(undefined);
  mockDeleteFile.mockResolvedValue(undefined);
  mockCreateCardOrder.mockResolvedValue({
    ok: true,
    value: { jobId: 'job-1', documentId: UPLOAD_ATTEMPT_ID, priceKzt: 15000, quoteId: 'quote-1', requiresOperatorReview: false },
  });
});

describe('gates', () => {
  it('returns 503 when Halyk is disabled', async () => {
    mockGetHalykConfig.mockReturnValue({ enabled: false });
    const res = await POST(makeRequest({ ...VALID_BODY_BASE, uploads: oneUpload }));
    expect(res.status).toBe(503);
  });

  it('returns 401 when unauthenticated', async () => {
    mockGetAuthUser.mockResolvedValueOnce(null);
    const res = await POST(makeRequest({ ...VALID_BODY_BASE, uploads: oneUpload }));
    expect(res.status).toBe(401);
  });

  it('returns 403 when terms not accepted', async () => {
    mockFrom.mockReturnValueOnce(chain({ data: { terms_accepted_at: null }, error: null }));
    const res = await POST(makeRequest({ ...VALID_BODY_BASE, uploads: oneUpload }));
    expect(res.status).toBe(403);
  });

  it('returns 422 when languages match', async () => {
    const res = await POST(makeRequest({ ...VALID_BODY_BASE, targetLang: 'ru', uploads: oneUpload }));
    expect(res.status).toBe(422);
  });
});

describe('key validation (ownership / wrong key)', () => {
  it('rejects a key belonging to another user', async () => {
    const res = await POST(makeRequest({
      ...VALID_BODY_BASE,
      uploads: [{ key: `card-upload-raw/other-user/${UPLOAD_ATTEMPT_ID}/22222222-2222-2222-2222-222222222222`, originalName: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 100 }],
    }));
    const body = await res.json() as { error?: string };
    expect(res.status).toBe(400);
    expect(body.error).toBe('INVALID_UPLOAD_KEY');
    expect(mockHeadFile).not.toHaveBeenCalled();
  });

  it('rejects an arbitrary R2 key without ever calling R2', async () => {
    const res = await POST(makeRequest({
      ...VALID_BODY_BASE,
      uploads: [{ key: 'documents/user-1/other-doc/original.pdf', originalName: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 100 }],
    }));
    expect(res.status).toBe(400);
    expect(mockHeadFile).not.toHaveBeenCalled();
  });

  it('rejects a key belonging to a different uploadAttemptId, without ever calling R2', async () => {
    const res = await POST(makeRequest({
      ...VALID_BODY_BASE,
      uploads: [{ key: 'card-upload-raw/user-1/22222222-2222-4222-8222-222222222222/33333333-3333-3333-3333-333333333333', originalName: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 100 }],
    }));
    const body = await res.json() as { error?: string };
    expect(res.status).toBe(400);
    expect(body.error).toBe('INVALID_UPLOAD_KEY');
    expect(mockHeadFile).not.toHaveBeenCalled();
  });

  it('rejects a key containing path traversal, without ever calling R2', async () => {
    const res = await POST(makeRequest({
      ...VALID_BODY_BASE,
      uploads: [{ key: `card-upload-raw/user-1/${UPLOAD_ATTEMPT_ID}/../../secrets`, originalName: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 100 }],
    }));
    const body = await res.json() as { error?: string };
    expect(res.status).toBe(400);
    expect(body.error).toBe('INVALID_UPLOAD_KEY');
    expect(mockHeadFile).not.toHaveBeenCalled();
  });

  it('rejects duplicate keys without ever calling R2', async () => {
    const res = await POST(makeRequest({ ...VALID_BODY_BASE, uploads: [...oneUpload, ...oneUpload] }));
    const body = await res.json() as { error?: string };
    expect(res.status).toBe(400);
    expect(body.error).toBe('INVALID_UPLOAD_KEY');
    expect(mockHeadFile).not.toHaveBeenCalled();
  });
});

describe('HeadObject verification', () => {
  it('returns UPLOAD_OBJECT_NOT_FOUND when the raw object is missing (R2 error path)', async () => {
    mockHeadFile.mockResolvedValueOnce(null);
    const res = await POST(makeRequest({ ...VALID_BODY_BASE, uploads: oneUpload }));
    expect(res.status).toBe(404);
    expect((await res.json() as { error?: string }).error).toBe('UPLOAD_OBJECT_NOT_FOUND');
  });

  it('rejects and deletes raw objects when the actual size differs from the declared size (size mismatch)', async () => {
    mockHeadFile.mockResolvedValueOnce({ contentLength: 50, contentType: 'application/pdf' }); // declared 100
    const res = await POST(makeRequest({ ...VALID_BODY_BASE, uploads: oneUpload }));
    expect(res.status).toBe(400);
    expect((await res.json() as { error?: string }).error).toBe('UPLOAD_SIZE_MISMATCH');
    expect(mockDeleteFile).toHaveBeenCalledWith(RAW_KEY);
  });

  it('rejects a file over the 25 MB limit', async () => {
    const size = 26 * 1024 * 1024;
    mockHeadFile.mockResolvedValueOnce({ contentLength: size, contentType: 'application/pdf' });
    const res = await POST(makeRequest({ ...VALID_BODY_BASE, uploads: [{ ...oneUpload[0], sizeBytes: size }] }));
    expect(res.status).toBe(400);
    expect((await res.json() as { error?: string }).error).toBe('FILE_SIZE_EXCEEDED');
  });

  it('rejects a Content-Type mismatch (MIME mismatch) when R2 reports one', async () => {
    mockHeadFile.mockResolvedValueOnce({ contentLength: 100, contentType: 'image/png' });
    const res = await POST(makeRequest({ ...VALID_BODY_BASE, uploads: oneUpload }));
    expect(res.status).toBe(400);
    expect((await res.json() as { error?: string }).error).toBe('UPLOAD_CONTENT_TYPE_MISMATCH');
  });
});

describe('magic-byte check', () => {
  it('rejects on signature mismatch', async () => {
    mockHeadFile.mockResolvedValueOnce({ contentLength: 100, contentType: 'application/pdf' });
    mockMatchesClaimedMimeType.mockReturnValueOnce(false);
    const res = await POST(makeRequest({ ...VALID_BODY_BASE, uploads: oneUpload }));
    expect(res.status).toBe(400);
    expect((await res.json() as { error?: string }).error).toBe('INVALID_FILE_SIGNATURE');
    expect(mockCreateCardOrder).not.toHaveBeenCalled();
  });
});

describe('successful conversion — 1 MB and 8-10 MB files', () => {
  it('accepts a 1 MB file end to end', async () => {
    const size = 1 * 1024 * 1024;
    mockHeadFile.mockResolvedValueOnce({ contentLength: size, contentType: 'application/pdf' });
    const res = await POST(makeRequest({ ...VALID_BODY_BASE, uploads: [{ ...oneUpload[0], sizeBytes: size }] }));
    expect(res.status).toBe(200);
  });

  it('accepts a 9 MB file end to end (the size that previously triggered Vercel 413)', async () => {
    const size = 9 * 1024 * 1024;
    mockHeadFile.mockResolvedValueOnce({ contentLength: size, contentType: 'application/pdf' });
    const res = await POST(makeRequest({ ...VALID_BODY_BASE, uploads: [{ ...oneUpload[0], sizeBytes: size }] }));
    expect(res.status).toBe(200);
    expect(mockUploadFile).toHaveBeenCalledWith(FINAL_KEY, expect.any(Buffer), 'application/pdf');
  });
});

describe('createCardOrder invocation and R2 error handling', () => {
  it('uploads the final PDF to the deterministic per-attempt key and calls createCardOrder once', async () => {
    mockHeadFile.mockResolvedValueOnce({ contentLength: 100, contentType: 'application/pdf' });
    const res = await POST(makeRequest({ ...VALID_BODY_BASE, uploads: oneUpload }));

    expect(res.status).toBe(200);
    expect(mockCreateCardOrder).toHaveBeenCalledTimes(1);
    expect(mockCreateCardOrder).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      uploadAttemptId: UPLOAD_ATTEMPT_ID,
      fileKey: FINAL_KEY,
      sourceLang: 'ru',
      targetLang: 'en',
    }));
  });

  it('deletes raw objects only after createCardOrder succeeds', async () => {
    mockHeadFile.mockResolvedValueOnce({ contentLength: 100, contentType: 'application/pdf' });
    await POST(makeRequest({ ...VALID_BODY_BASE, uploads: oneUpload }));

    expect(mockDeleteFile).toHaveBeenCalledWith(RAW_KEY);
    const uploadOrder = mockUploadFile.mock.invocationCallOrder[0]!;
    const createOrder = mockCreateCardOrder.mock.invocationCallOrder[0]!;
    const deleteOrder = mockDeleteFile.mock.invocationCallOrder[0]!;
    expect(uploadOrder).toBeLessThan(createOrder);
    expect(createOrder).toBeLessThan(deleteOrder);
  });

  it('does not delete raw objects when createCardOrder fails (document/job not created — retry-safe)', async () => {
    mockHeadFile.mockResolvedValueOnce({ contentLength: 100, contentType: 'application/pdf' });
    mockCreateCardOrder.mockResolvedValueOnce({ ok: false, status: 503, error: 'PRICING_NOT_CONFIGURED' });
    const res = await POST(makeRequest({ ...VALID_BODY_BASE, uploads: oneUpload }));

    expect(res.status).toBe(503);
    expect(mockDeleteFile).not.toHaveBeenCalled();
  });

  it('returns DIRECT_UPLOAD_FAILED and does not call createCardOrder when the final R2 upload fails (R2 error)', async () => {
    mockHeadFile.mockResolvedValueOnce({ contentLength: 100, contentType: 'application/pdf' });
    mockUploadFile.mockRejectedValueOnce(new Error('R2 unavailable'));
    const res = await POST(makeRequest({ ...VALID_BODY_BASE, uploads: oneUpload }));

    expect(res.status).toBe(500);
    expect((await res.json() as { error?: string }).error).toBe('DIRECT_UPLOAD_FAILED');
    expect(mockCreateCardOrder).not.toHaveBeenCalled();
  });

  it('returns FILE_PROCESSING_FAILED and keeps raw objects when conversion throws (R2/processing error)', async () => {
    mockHeadFile.mockResolvedValueOnce({ contentLength: 100, contentType: 'application/pdf' });
    mockConvertToPdf.mockRejectedValueOnce(new Error('corrupt file'));
    const res = await POST(makeRequest({ ...VALID_BODY_BASE, uploads: oneUpload }));

    expect(res.status).toBe(500);
    expect((await res.json() as { error?: string }).error).toBe('FILE_PROCESSING_FAILED');
    expect(mockDeleteFile).not.toHaveBeenCalled();
  });

  it('preserves the existing statuses/pricing shape returned by createCardOrder', async () => {
    mockHeadFile.mockResolvedValueOnce({ contentLength: 100, contentType: 'application/pdf' });
    mockCreateCardOrder.mockResolvedValueOnce({
      ok: true,
      value: {
        jobId: 'job-1', documentId: UPLOAD_ATTEMPT_ID, priceKzt: 13500,
        priceBeforeDiscountKzt: 15000, discountAppliedKzt: 1500, discountCode: 'PARTNER1',
        quoteId: 'quote-1', requiresOperatorReview: true, reviewReasons: ['low_confidence'],
      },
    });
    const res = await POST(makeRequest({ ...VALID_BODY_BASE, uploads: oneUpload }));
    const body = await res.json() as Record<string, unknown>;

    expect(body).toEqual(expect.objectContaining({
      jobId: 'job-1', documentId: UPLOAD_ATTEMPT_ID, priceKzt: 13500,
      priceBeforeDiscountKzt: 15000, discountAppliedKzt: 1500, discountCode: 'PARTNER1',
      quoteId: 'quote-1', requiresOperatorReview: true, reviewReasons: ['low_confidence'],
      currency: 'KZT', paymentRequired: true,
    }));
  });
});

describe('idempotent replay — document/job not created twice', () => {
  it('returns success without touching R2 or createCardOrder when an order already exists for this uploadAttemptId', async () => {
    mockFindExisting.mockResolvedValueOnce({
      jobId: 'job-1', documentId: UPLOAD_ATTEMPT_ID, priceKzt: 15000,
    });

    const res = await POST(makeRequest({ ...VALID_BODY_BASE, uploads: oneUpload }));
    const body = await res.json() as { jobId: string; documentId: string; priceKzt: number };

    expect(res.status).toBe(200);
    expect(body).toEqual(expect.objectContaining({ jobId: 'job-1', documentId: UPLOAD_ATTEMPT_ID, priceKzt: 15000 }));
    expect(mockHeadFile).not.toHaveBeenCalled();
    expect(mockDownloadFile).not.toHaveBeenCalled();
    expect(mockCreateCardOrder).not.toHaveBeenCalled();
    expect(mockDeleteFile).not.toHaveBeenCalled();
  });

  it('a repeated /complete call for the same uploadAttemptId does not create a second document/job', async () => {
    mockHeadFile.mockResolvedValueOnce({ contentLength: 100, contentType: 'application/pdf' });
    const first = await POST(makeRequest({ ...VALID_BODY_BASE, uploads: oneUpload }));
    expect(first.status).toBe(200);
    expect(mockCreateCardOrder).toHaveBeenCalledTimes(1);

    // Simulate: raw objects are now gone (deleted after the first success), and the
    // idempotency lookup now finds the order that createCardOrder just created.
    mockFindExisting.mockResolvedValueOnce({ jobId: 'job-1', documentId: UPLOAD_ATTEMPT_ID, priceKzt: 15000 });

    const second = await POST(makeRequest({ ...VALID_BODY_BASE, uploads: oneUpload }));
    expect(second.status).toBe(200);
    expect(mockCreateCardOrder).toHaveBeenCalledTimes(1); // still only once
  });

  it('preserves rate limiting for genuinely new uploads even when idempotency finds nothing, and never touches R2 (checked before HeadObject/download — an intentional improvement over the legacy endpoint, which only checked the limit after already uploading to R2)', async () => {
    mockCheckRateLimit.mockResolvedValueOnce(false);
    const res = await POST(makeRequest({ ...VALID_BODY_BASE, uploads: oneUpload }));
    expect(res.status).toBe(429);
    expect(mockCreateCardOrder).not.toHaveBeenCalled();
    expect(mockHeadFile).not.toHaveBeenCalled();
    expect(mockDownloadFile).not.toHaveBeenCalled();
  });
});

describe('UTM/refCode fields — regression for production 400 INVALID_UPLOAD_METADATA', () => {
  it('accepts all UTM/refCode fields as explicit null', async () => {
    mockHeadFile.mockResolvedValueOnce({ contentLength: 100, contentType: 'application/pdf' });
    const res = await POST(makeRequest({
      ...VALID_BODY_BASE,
      uploads: oneUpload,
      refCode: null, utmSource: null, utmMedium: null, utmCampaign: null, utmContent: null, utmTerm: null,
    }));
    expect(res.status).toBe(200);
  });

  it('accepts all UTM/refCode fields entirely absent', async () => {
    mockHeadFile.mockResolvedValueOnce({ contentLength: 100, contentType: 'application/pdf' });
    const res = await POST(makeRequest({ ...VALID_BODY_BASE, uploads: oneUpload }));
    expect(res.status).toBe(200);
  });

  it('accepts and forwards non-empty valid UTM/refCode values to createCardOrder', async () => {
    mockHeadFile.mockResolvedValueOnce({ contentLength: 100, contentType: 'application/pdf' });
    const res = await POST(makeRequest({
      ...VALID_BODY_BASE,
      uploads: oneUpload,
      refCode: 'PARTNER1', utmSource: 'google', utmMedium: 'cpc', utmCampaign: 'summer', utmContent: 'ad1', utmTerm: 'translate',
    }));
    expect(res.status).toBe(200);
    expect(mockCreateCardOrder).toHaveBeenCalledWith(expect.objectContaining({
      refCode: 'PARTNER1', utmSource: 'google', utmMedium: 'cpc', utmCampaign: 'summer', utmContent: 'ad1', utmTerm: 'translate',
    }));
  });

  it('rejects a wrong type (object) for a UTM field', async () => {
    const res = await POST(makeRequest({ ...VALID_BODY_BASE, uploads: oneUpload, utmSource: { nested: 'object' } }));
    expect(res.status).toBe(400);
    expect(mockHeadFile).not.toHaveBeenCalled();
  });

  it('rejects a wrong type (array) for a UTM field', async () => {
    const res = await POST(makeRequest({ ...VALID_BODY_BASE, uploads: oneUpload, utmCampaign: ['array'] }));
    expect(res.status).toBe(400);
    expect(mockHeadFile).not.toHaveBeenCalled();
  });

  // This is the exact shape OrderForm.tsx (dashboard mode) sent before the fix:
  // loadReferralParams() returns a ReferralParams object whose UTM fields are typed
  // `string | null`, so spreading it into the request body without an `?? undefined`
  // guard produced literal nulls — reproducing the production 400 end to end at the
  // route level. The pre-existing test suite never sent explicit null (only
  // undefined/absent), which is exactly why it didn't catch this before it shipped.
  it('reproduces the real frontend-shaped payload (loadReferralParams() output spread with explicit nulls)', async () => {
    mockHeadFile.mockResolvedValueOnce({ contentLength: 100, contentType: 'application/pdf' });
    const frontendShapedBody = {
      ...VALID_BODY_BASE,
      uploads: oneUpload,
      refCode: undefined, // activeCode || undefined — already safe pre-fix
      utmSource: null,    // referralParams?.utmSource — was unsafe pre-fix
      utmMedium: null,
      utmCampaign: null,
      utmContent: null,
      utmTerm: null,
    };
    const res = await POST(makeRequest(frontendShapedBody));
    expect(res.status).toBe(200);
  });
});
