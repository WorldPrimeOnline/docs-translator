/**
 * Tests for src/lib/order-drafts/upload-shared.ts — the module shared by the
 * init/complete direct-to-R2 endpoints and the legacy single-request upload endpoint.
 */
jest.mock('@/lib/order-drafts/service', () => ({
  getDraftRow: jest.fn(),
  // Inlined rather than jest.requireActual('../service') — the real module eagerly
  // constructs supabaseServer (@/lib/supabase/server) at import time, which throws
  // without real Supabase env vars. This mirrors service.ts's exported isOwner exactly.
  isOwner: (draft: { user_id: string | null; anonymous_session_id: string }, owner: { sessionToken: string | null; userId: string | null }): boolean =>
    draft.user_id ? draft.user_id === owner.userId : !!owner.sessionToken && draft.anonymous_session_id === owner.sessionToken,
}));
jest.mock('@/lib/order-drafts/session', () => ({
  getDraftSessionToken: jest.fn(),
}));
jest.mock('@/lib/order-drafts/request-context', () => ({
  getOptionalAuthUser: jest.fn(),
}));

import { getDraftRow } from '@/lib/order-drafts/service';
import { getDraftSessionToken } from '@/lib/order-drafts/session';
import { getOptionalAuthUser } from '@/lib/order-drafts/request-context';
import {
  loadOwnedDraft,
  resolveMimeType,
  isAllowedMimeType,
  sanitizeFilename,
  buildCombinedOriginalName,
  buildRawUploadKey,
  finalUploadKey,
  isValidRawUploadKey,
} from '../upload-shared';
import type { OrderDraftRow } from '../types';

const mockGetDraftRow = getDraftRow as jest.Mock;
const mockGetSessionToken = getDraftSessionToken as jest.Mock;
const mockGetOptionalAuthUser = getOptionalAuthUser as jest.Mock;

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

beforeEach(() => {
  jest.clearAllMocks();
});

describe('loadOwnedDraft', () => {
  it('returns DRAFT_NOT_FOUND when the draft does not exist', async () => {
    mockGetDraftRow.mockResolvedValueOnce(null);
    const result = await loadOwnedDraft('missing');
    expect(result).toEqual({ ok: false, error: 'DRAFT_NOT_FOUND' });
  });

  it('resolves ownership for an anonymous draft via the session cookie', async () => {
    mockGetDraftRow.mockResolvedValueOnce(BASE_DRAFT);
    mockGetSessionToken.mockResolvedValueOnce('sess-token');
    mockGetOptionalAuthUser.mockResolvedValueOnce(null);

    const result = await loadOwnedDraft('draft-1');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.owner).toEqual({ sessionToken: 'sess-token', userId: null });
  });

  it('returns FORBIDDEN when the anonymous session token does not match', async () => {
    mockGetDraftRow.mockResolvedValueOnce(BASE_DRAFT);
    mockGetSessionToken.mockResolvedValueOnce('someone-else');
    mockGetOptionalAuthUser.mockResolvedValueOnce(null);

    const result = await loadOwnedDraft('draft-1');
    expect(result).toEqual({ ok: false, error: 'FORBIDDEN' });
  });

  it('resolves ownership for an authenticated draft via user_id', async () => {
    const owned = { ...BASE_DRAFT, user_id: 'user-1' };
    mockGetDraftRow.mockResolvedValueOnce(owned);
    mockGetSessionToken.mockResolvedValueOnce(null);
    mockGetOptionalAuthUser.mockResolvedValueOnce({ id: 'user-1', email: 'a@b.com' });

    const result = await loadOwnedDraft('draft-1');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.owner.userId).toBe('user-1');
  });

  it('returns FORBIDDEN when a different authenticated user requests the draft', async () => {
    const owned = { ...BASE_DRAFT, user_id: 'user-1' };
    mockGetDraftRow.mockResolvedValueOnce(owned);
    mockGetSessionToken.mockResolvedValueOnce(null);
    mockGetOptionalAuthUser.mockResolvedValueOnce({ id: 'user-2', email: 'x@y.com' });

    const result = await loadOwnedDraft('draft-1');
    expect(result).toEqual({ ok: false, error: 'FORBIDDEN' });
  });
});

describe('resolveMimeType', () => {
  it('trusts a claimed MIME type when it is in the allow-list', () => {
    expect(resolveMimeType('scan.pdf', 'application/pdf')).toBe('application/pdf');
  });

  it('falls back to extension when the claimed MIME type is empty', () => {
    expect(resolveMimeType('scan.pdf', '')).toBe('application/pdf');
    expect(resolveMimeType('photo.jpg', undefined)).toBe('image/jpeg');
    expect(resolveMimeType('photo.jpeg', null)).toBe('image/jpeg');
    expect(resolveMimeType('image.png', '')).toBe('image/png');
    expect(resolveMimeType('doc.docx', '')).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  });

  it('falls back to extension when the claimed MIME type is not in the allow-list (e.g. a spoofed extension)', () => {
    expect(resolveMimeType('scan.pdf', 'application/octet-stream')).toBe('application/pdf');
  });

  it('returns the (rejected) claimed type verbatim when there is no usable extension', () => {
    expect(resolveMimeType('noext', 'application/octet-stream')).toBe('application/octet-stream');
  });
});

describe('isAllowedMimeType', () => {
  it('accepts the four supported MIME types and rejects everything else', () => {
    expect(isAllowedMimeType('application/pdf')).toBe(true);
    expect(isAllowedMimeType('image/jpeg')).toBe(true);
    expect(isAllowedMimeType('image/png')).toBe(true);
    expect(isAllowedMimeType('application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe(true);
    expect(isAllowedMimeType('application/octet-stream')).toBe(false);
    expect(isAllowedMimeType('')).toBe(false);
  });
});

describe('sanitizeFilename / buildCombinedOriginalName', () => {
  it('strips unsafe characters and truncates to 200 chars', () => {
    expect(sanitizeFilename('passport (2026)!.pdf')).toBe('passport _2026__.pdf');
    expect(sanitizeFilename('a'.repeat(300))).toHaveLength(200);
  });

  it('returns the sanitized single filename for one file', () => {
    expect(buildCombinedOriginalName(['passport.pdf'])).toBe('passport.pdf');
  });

  it('combines multiple filenames as "{n}_files_{first}"', () => {
    expect(buildCombinedOriginalName(['a.pdf', 'b.pdf', 'c.pdf'])).toBe('3_files_a.pdf');
  });
});

describe('buildRawUploadKey / finalUploadKey / isValidRawUploadKey', () => {
  it('generates a raw key under draft-upload-raw/{draftId}/{uuid}', () => {
    const key = buildRawUploadKey('draft-1');
    expect(key).toMatch(/^draft-upload-raw\/draft-1\/[0-9a-f-]{36}$/);
  });

  it('generates the final key at draft-uploads/{draftId}/original.pdf', () => {
    expect(finalUploadKey('draft-1')).toBe('draft-uploads/draft-1/original.pdf');
  });

  it('accepts a well-formed raw key for the matching draft', () => {
    const key = buildRawUploadKey('draft-1');
    expect(isValidRawUploadKey(key, 'draft-1')).toBe(true);
  });

  it('rejects a raw key belonging to another draft', () => {
    const key = buildRawUploadKey('draft-2');
    expect(isValidRawUploadKey(key, 'draft-1')).toBe(false);
  });

  it('rejects the final key format', () => {
    expect(isValidRawUploadKey(finalUploadKey('draft-1'), 'draft-1')).toBe(false);
  });

  it('rejects an arbitrary R2 key', () => {
    expect(isValidRawUploadKey('documents/user-1/doc-1/original.pdf', 'draft-1')).toBe(false);
  });

  it('rejects a key with path traversal', () => {
    expect(isValidRawUploadKey('draft-upload-raw/../secrets/x', 'draft-1')).toBe(false);
    expect(isValidRawUploadKey('draft-upload-raw/draft-1/../../secrets', 'draft-1')).toBe(false);
  });

  it('rejects a key with the wrong prefix', () => {
    expect(isValidRawUploadKey('draft-uploads-raw/draft-1/11111111-1111-1111-1111-111111111111', 'draft-1')).toBe(false);
  });

  it('rejects a non-UUID suffix', () => {
    expect(isValidRawUploadKey('draft-upload-raw/draft-1/not-a-uuid', 'draft-1')).toBe(false);
  });
});
