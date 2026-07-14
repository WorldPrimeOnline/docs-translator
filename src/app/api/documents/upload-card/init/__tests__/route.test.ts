/**
 * Tests for POST /api/documents/upload-card/init — the metadata-only first step of
 * the dashboard/card-payment direct-to-R2 upload flow.
 */
jest.mock('@/lib/payments/halyk/config', () => ({
  getHalykConfig: jest.fn(),
}));
jest.mock('@/lib/documents/upload-card-shared', () => {
  const actual = jest.requireActual('@/lib/documents/upload-card-shared');
  return {
    ...actual,
    getAuthUser: jest.fn(),
    checkCardUploadRateLimit: jest.fn(),
  };
});
jest.mock('@/lib/supabase/server', () => ({
  supabaseServer: { from: jest.fn() },
}));
jest.mock('@/lib/r2/client', () => ({
  getPresignedPutUrl: jest.fn(),
}));

import { NextRequest } from 'next/server';
import { POST } from '../route';
import { getHalykConfig } from '@/lib/payments/halyk/config';
import { getAuthUser, checkCardUploadRateLimit } from '@/lib/documents/upload-card-shared';
import { supabaseServer } from '@/lib/supabase/server';
import { getPresignedPutUrl } from '@/lib/r2/client';

const mockGetHalykConfig = getHalykConfig as jest.Mock;
const mockGetAuthUser = getAuthUser as jest.Mock;
const mockCheckRateLimit = checkCardUploadRateLimit as jest.Mock;
const mockFrom = supabaseServer.from as jest.Mock;
const mockGetPresignedPutUrl = getPresignedPutUrl as jest.Mock;

function chain(result: { data?: unknown; error?: unknown }) {
  const c: Record<string, unknown> = {};
  const methods = ['select', 'eq'];
  for (const m of methods) c[m] = jest.fn(() => c);
  c.maybeSingle = jest.fn(() => Promise.resolve(result));
  return c;
}

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/documents/upload-card/init', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const VALID_BODY_BASE = {
  sourceLang: 'ru',
  targetLang: 'en',
  documentType: 'passport_id|pdf',
  serviceLevel: 'electronic',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockGetHalykConfig.mockReturnValue({ enabled: true });
  mockGetAuthUser.mockResolvedValue({ id: 'user-1', email: 'a@b.com' });
  mockFrom.mockReturnValue(chain({ data: { terms_accepted_at: '2026-01-01T00:00:00.000Z' }, error: null }));
  mockCheckRateLimit.mockResolvedValue(true);
  mockGetPresignedPutUrl.mockImplementation((key: string) => Promise.resolve(`https://r2.example/${key}?sig=abc`));
});

it('returns 503 when Halyk card payments are disabled', async () => {
  mockGetHalykConfig.mockReturnValue({ enabled: false });
  const res = await POST(makeRequest({ ...VALID_BODY_BASE, files: [{ originalName: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 100 }] }));
  expect(res.status).toBe(503);
});

it('returns 401 when unauthenticated', async () => {
  mockGetAuthUser.mockResolvedValueOnce(null);
  const res = await POST(makeRequest({ ...VALID_BODY_BASE, files: [{ originalName: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 100 }] }));
  expect(res.status).toBe(401);
});

it('returns 403 when terms have not been accepted', async () => {
  mockFrom.mockReturnValueOnce(chain({ data: { terms_accepted_at: null }, error: null }));
  const res = await POST(makeRequest({ ...VALID_BODY_BASE, files: [{ originalName: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 100 }] }));
  expect(res.status).toBe(403);
});

it('returns 422 when source and target languages match', async () => {
  const res = await POST(makeRequest({ ...VALID_BODY_BASE, targetLang: 'ru', files: [{ originalName: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 100 }] }));
  expect(res.status).toBe(422);
});

it('returns 429 when the per-user rate limit is exceeded, and never issues a presigned URL (checked before any R2 call — an intentional improvement over the legacy endpoint, which only checked the limit after already uploading to R2)', async () => {
  mockCheckRateLimit.mockResolvedValueOnce(false);
  const res = await POST(makeRequest({ ...VALID_BODY_BASE, files: [{ originalName: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 100 }] }));
  expect(res.status).toBe(429);
  expect(mockGetPresignedPutUrl).not.toHaveBeenCalled();
});

it('accepts a 1 MB file', async () => {
  const res = await POST(makeRequest({ ...VALID_BODY_BASE, files: [{ originalName: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 1 * 1024 * 1024 }] }));
  expect(res.status).toBe(200);
});

it('accepts an 8-10 MB file (the size that previously triggered Vercel 413)', async () => {
  const res = await POST(makeRequest({ ...VALID_BODY_BASE, files: [{ originalName: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 9 * 1024 * 1024 }] }));
  expect(res.status).toBe(200);
});

it('rejects a single file over the 25 MB per-file limit', async () => {
  const res = await POST(makeRequest({ ...VALID_BODY_BASE, files: [{ originalName: 'big.pdf', mimeType: 'application/pdf', sizeBytes: 26 * 1024 * 1024 }] }));
  const body = await res.json() as { error?: string };
  expect(res.status).toBe(400);
  expect(body.error).toBe('File "big.pdf" exceeds 25 MB limit');
});

it('rejects a batch whose total exceeds 50 MB even though every individual file is under the 25 MB per-file limit', async () => {
  const res = await POST(makeRequest({
    ...VALID_BODY_BASE,
    files: [
      { originalName: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 20 * 1024 * 1024 },
      { originalName: 'b.pdf', mimeType: 'application/pdf', sizeBytes: 20 * 1024 * 1024 },
      { originalName: 'c.pdf', mimeType: 'application/pdf', sizeBytes: 20 * 1024 * 1024 },
    ],
  }));
  const body = await res.json() as { error?: string };
  expect(res.status).toBe(400);
  expect(body.error).toBe('Total file size exceeds 50 MB');
});

it('returns a presigned upload under card-upload-raw/{userId}/{uploadAttemptId}/{uuid} and an uploadAttemptId', async () => {
  const res = await POST(makeRequest({ ...VALID_BODY_BASE, files: [{ originalName: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 1000 }] }));
  const body = await res.json() as { uploadAttemptId: string; uploads: Array<{ key: string; uploadUrl: string }> };

  expect(res.status).toBe(200);
  expect(body.uploadAttemptId).toMatch(/^[0-9a-f-]{36}$/);
  expect(body.uploads[0]!.key).toMatch(new RegExp(`^card-upload-raw/user-1/${body.uploadAttemptId}/[0-9a-f-]{36}$`));
});

it('rejects invalid business-field metadata (e.g. missing documentType)', async () => {
  const res = await POST(makeRequest({ sourceLang: 'ru', targetLang: 'en', files: [{ originalName: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 100 }] }));
  expect(res.status).toBe(400);
});
