/**
 * Tests for POST /api/order-drafts/[draftId]/upload/init — the metadata-only first
 * step of the direct-to-R2 upload flow. Covers ownership, ordering, and every limit
 * enforced before a presigned PUT URL is handed out.
 */
jest.mock('@/lib/order-drafts/service', () => ({
  getDraftRow: jest.fn(),
  isOwner: (draft: { user_id: string | null; anonymous_session_id: string }, owner: { sessionToken: string | null; userId: string | null }): boolean =>
    draft.user_id ? draft.user_id === owner.userId : !!owner.sessionToken && draft.anonymous_session_id === owner.sessionToken,
}));
jest.mock('@/lib/order-drafts/session', () => ({
  getDraftSessionToken: jest.fn(),
}));
jest.mock('@/lib/order-drafts/request-context', () => ({
  getOptionalAuthUser: jest.fn(),
}));
jest.mock('@/lib/r2/client', () => ({
  getPresignedPutUrl: jest.fn(),
}));

import { NextRequest } from 'next/server';
import { POST } from '../route';
import { getDraftRow } from '@/lib/order-drafts/service';
import { getDraftSessionToken } from '@/lib/order-drafts/session';
import { getOptionalAuthUser } from '@/lib/order-drafts/request-context';
import { getPresignedPutUrl } from '@/lib/r2/client';
import type { OrderDraftRow } from '@/lib/order-drafts/types';

const mockGetDraftRow = getDraftRow as jest.Mock;
const mockGetSessionToken = getDraftSessionToken as jest.Mock;
const mockGetOptionalAuthUser = getOptionalAuthUser as jest.Mock;
const mockGetPresignedPutUrl = getPresignedPutUrl as jest.Mock;

const BASE_DRAFT: OrderDraftRow = {
  id: 'draft-1',
  user_id: null,
  anonymous_session_id: 'sess-token',
  status: 'draft_created',
  source_language: 'ru',
  target_language: 'en',
  document_type: null,
  output_format: null,
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
  consent_accepted_at: null,
  ip_address: '1.2.3.4',
  expires_at: '2099-01-01T00:00:00.000Z',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

function makeRequest(draftId: string, body: unknown): { request: NextRequest; params: Promise<{ draftId: string }> } {
  const request = new NextRequest(`http://localhost/api/order-drafts/${draftId}/upload/init`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { request, params: Promise.resolve({ draftId }) };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetPresignedPutUrl.mockImplementation((key: string) => Promise.resolve(`https://r2.example/${key}?sig=abc`));
});

describe('anonymous ownership', () => {
  it('succeeds when the session cookie matches the anonymous draft', async () => {
    mockGetDraftRow.mockResolvedValueOnce(BASE_DRAFT);
    mockGetSessionToken.mockResolvedValueOnce('sess-token');
    mockGetOptionalAuthUser.mockResolvedValueOnce(null);

    const { request, params } = makeRequest('draft-1', {
      files: [{ originalName: 'passport.pdf', mimeType: 'application/pdf', sizeBytes: 1000 }],
    });
    const res = await POST(request, { params });
    expect(res.status).toBe(200);
  });

  it('returns 403 for a draft owned by a different anonymous session', async () => {
    mockGetDraftRow.mockResolvedValueOnce(BASE_DRAFT);
    mockGetSessionToken.mockResolvedValueOnce('someone-else');
    mockGetOptionalAuthUser.mockResolvedValueOnce(null);

    const { request, params } = makeRequest('draft-1', {
      files: [{ originalName: 'passport.pdf', mimeType: 'application/pdf', sizeBytes: 1000 }],
    });
    const res = await POST(request, { params });
    const body = await res.json() as { error?: string };
    expect(res.status).toBe(403);
    expect(body.error).toBe('FORBIDDEN');
  });
});

describe('authenticated ownership', () => {
  it('succeeds when the requesting user owns the draft', async () => {
    mockGetDraftRow.mockResolvedValueOnce({ ...BASE_DRAFT, user_id: 'user-1' });
    mockGetSessionToken.mockResolvedValueOnce(null);
    mockGetOptionalAuthUser.mockResolvedValueOnce({ id: 'user-1', email: 'a@b.com' });

    const { request, params } = makeRequest('draft-1', {
      files: [{ originalName: 'passport.pdf', mimeType: 'application/pdf', sizeBytes: 1000 }],
    });
    const res = await POST(request, { params });
    expect(res.status).toBe(200);
  });

  it('returns 403 for a draft owned by a different authenticated user', async () => {
    mockGetDraftRow.mockResolvedValueOnce({ ...BASE_DRAFT, user_id: 'user-1' });
    mockGetSessionToken.mockResolvedValueOnce(null);
    mockGetOptionalAuthUser.mockResolvedValueOnce({ id: 'user-2', email: 'x@y.com' });

    const { request, params } = makeRequest('draft-1', {
      files: [{ originalName: 'passport.pdf', mimeType: 'application/pdf', sizeBytes: 1000 }],
    });
    const res = await POST(request, { params });
    expect(res.status).toBe(403);
  });
});

it('returns 404 for a nonexistent draft', async () => {
  mockGetDraftRow.mockResolvedValueOnce(null);
  const { request, params } = makeRequest('missing', { files: [{ originalName: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 100 }] });
  const res = await POST(request, { params });
  expect(res.status).toBe(404);
  expect((await res.json() as { error?: string }).error).toBe('DRAFT_NOT_FOUND');
});

it('returns 409 for an already-converted draft', async () => {
  mockGetDraftRow.mockResolvedValueOnce({ ...BASE_DRAFT, status: 'converted' });
  mockGetSessionToken.mockResolvedValueOnce('sess-token');
  mockGetOptionalAuthUser.mockResolvedValueOnce(null);

  const { request, params } = makeRequest('draft-1', { files: [{ originalName: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 100 }] });
  const res = await POST(request, { params });
  expect(res.status).toBe(409);
  expect((await res.json() as { error?: string }).error).toBe('DRAFT_ALREADY_CONVERTED');
});

describe('validation', () => {
  beforeEach(() => {
    mockGetDraftRow.mockResolvedValue(BASE_DRAFT);
    mockGetSessionToken.mockResolvedValue('sess-token');
    mockGetOptionalAuthUser.mockResolvedValue(null);
  });

  it('rejects an unsupported MIME type / spoofed extension', async () => {
    const { request, params } = makeRequest('draft-1', {
      files: [{ originalName: 'malware.exe', mimeType: 'application/x-msdownload', sizeBytes: 100 }],
    });
    const res = await POST(request, { params });
    expect(res.status).toBe(400);
    expect((await res.json() as { error?: string }).error).toBe('INVALID_UPLOAD_METADATA');
  });

  it('rejects a single file over the 20 MB per-file limit', async () => {
    const { request, params } = makeRequest('draft-1', {
      files: [{ originalName: 'big.pdf', mimeType: 'application/pdf', sizeBytes: 21 * 1024 * 1024 }],
    });
    const res = await POST(request, { params });
    const body = await res.json() as { error?: string };
    expect(res.status).toBe(400);
    expect(body.error).toBe('FILE_SIZE_EXCEEDED');
  });

  it('rejects an anonymous batch whose total exceeds 20 MB even if each file is under the per-file limit', async () => {
    mockGetOptionalAuthUser.mockResolvedValue(null);
    const { request, params } = makeRequest('draft-1', {
      files: [
        { originalName: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 12 * 1024 * 1024 },
        { originalName: 'b.pdf', mimeType: 'application/pdf', sizeBytes: 12 * 1024 * 1024 },
      ],
    });
    const res = await POST(request, { params });
    const body = await res.json() as { error?: string };
    expect(res.status).toBe(400);
    expect(body.error).toBe('TOTAL_SIZE_EXCEEDED');
  });

  it('allows an authenticated batch up to 50 MB total (above the anonymous cap)', async () => {
    mockGetSessionToken.mockResolvedValue(null);
    mockGetOptionalAuthUser.mockResolvedValue({ id: 'user-1', email: 'a@b.com' });
    mockGetDraftRow.mockResolvedValue({ ...BASE_DRAFT, user_id: 'user-1' });

    const { request, params } = makeRequest('draft-1', {
      files: [
        { originalName: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 19 * 1024 * 1024 },
        { originalName: 'b.pdf', mimeType: 'application/pdf', sizeBytes: 19 * 1024 * 1024 },
      ],
    });
    const res = await POST(request, { params });
    expect(res.status).toBe(200);
  });

  it('rejects an authenticated batch whose total exceeds 50 MB', async () => {
    mockGetSessionToken.mockResolvedValue(null);
    mockGetOptionalAuthUser.mockResolvedValue({ id: 'user-1', email: 'a@b.com' });
    mockGetDraftRow.mockResolvedValue({ ...BASE_DRAFT, user_id: 'user-1' });

    const { request, params } = makeRequest('draft-1', {
      files: [
        { originalName: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 20 * 1024 * 1024 },
        { originalName: 'b.pdf', mimeType: 'application/pdf', sizeBytes: 20 * 1024 * 1024 },
        { originalName: 'c.pdf', mimeType: 'application/pdf', sizeBytes: 20 * 1024 * 1024 },
      ],
    });
    const res = await POST(request, { params });
    const body = await res.json() as { error?: string };
    expect(res.status).toBe(400);
    expect(body.error).toBe('TOTAL_SIZE_EXCEEDED');
  });

  it('rejects a batch above the max file count', async () => {
    const files = Array.from({ length: 11 }, (_, i) => ({ originalName: `f${i}.pdf`, mimeType: 'application/pdf', sizeBytes: 100 }));
    const { request, params } = makeRequest('draft-1', { files });
    const res = await POST(request, { params });
    const body = await res.json() as { error?: string };
    expect(res.status).toBe(400);
    expect(body.error).toBe('FILE_COUNT_EXCEEDED');
  });

  it('rejects an empty files array', async () => {
    const { request, params } = makeRequest('draft-1', { files: [] });
    const res = await POST(request, { params });
    expect(res.status).toBe(400);
  });
});

describe('success path', () => {
  beforeEach(() => {
    mockGetDraftRow.mockResolvedValue(BASE_DRAFT);
    mockGetSessionToken.mockResolvedValue('sess-token');
    mockGetOptionalAuthUser.mockResolvedValue(null);
  });

  it('returns presigned uploads in the same order as the request, each under draft-upload-raw/{draftId}/{uuid}', async () => {
    const { request, params } = makeRequest('draft-1', {
      files: [
        { originalName: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 100 },
        { originalName: 'b.png', mimeType: 'image/png', sizeBytes: 200 },
      ],
    });
    const res = await POST(request, { params });
    const body = await res.json() as { uploads: Array<{ key: string; uploadUrl: string; originalName: string; mimeType: string }>; expiresInSeconds: number };

    expect(res.status).toBe(200);
    expect(body.uploads).toHaveLength(2);
    expect(body.uploads[0]!.originalName).toBe('a.pdf');
    expect(body.uploads[1]!.originalName).toBe('b.png');
    expect(body.uploads[0]!.key).toMatch(/^draft-upload-raw\/draft-1\/[0-9a-f-]{36}$/);
    expect(body.uploads[1]!.key).toMatch(/^draft-upload-raw\/draft-1\/[0-9a-f-]{36}$/);
    expect(body.uploads[0]!.key).not.toBe(body.uploads[1]!.key);
    expect(body.expiresInSeconds).toBe(600);
  });

  it('signs each presigned URL with the resolved MIME type and the 10-minute TTL', async () => {
    const { request, params } = makeRequest('draft-1', {
      files: [{ originalName: 'scan.jpg', mimeType: '', sizeBytes: 100 }], // empty claimed type -> extension fallback
    });
    await POST(request, { params });

    expect(mockGetPresignedPutUrl).toHaveBeenCalledWith(
      expect.stringMatching(/^draft-upload-raw\/draft-1\//),
      'image/jpeg',
      600,
    );
  });

  it('never accepts a client-supplied object key', async () => {
    const { request, params } = makeRequest('draft-1', {
      files: [{ originalName: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 100, key: 'documents/attacker/x' } as unknown as Record<string, unknown>],
    });
    const res = await POST(request, { params });
    const body = await res.json() as { uploads: Array<{ key: string }> };
    expect(res.status).toBe(200);
    expect(body.uploads[0]!.key).not.toBe('documents/attacker/x');
    expect(body.uploads[0]!.key).toMatch(/^draft-upload-raw\//);
  });
});
