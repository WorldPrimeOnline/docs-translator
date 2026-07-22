/**
 * Tests for POST /api/order-drafts/[draftId]/upload/complete — the second half of the
 * direct-to-R2 upload flow. Covers key validation, HeadObject verification, the
 * existing magic-byte/convert/merge pipeline, and — most importantly — the
 * idempotent-replay behavior needed because raw objects are deleted after success
 * (see src/lib/order-drafts/service.ts's setDraftFile and the module doc comment on
 * this route for why a naive retry would otherwise 404).
 */
jest.mock('@/lib/order-drafts/service', () => ({
  getDraftRow: jest.fn(),
  setDraftFile: jest.fn(),
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
jest.mock('@/lib/document-analysis/physical-pages', () => ({
  getPhysicalPageCount: jest.fn(),
}));

import { NextRequest } from 'next/server';
import { POST } from '../route';
import { getDraftRow, setDraftFile } from '@/lib/order-drafts/service';
import { getDraftSessionToken } from '@/lib/order-drafts/session';
import { getOptionalAuthUser } from '@/lib/order-drafts/request-context';
import { downloadFile, uploadFile, deleteFile, headFile } from '@/lib/r2/client';
import { matchesClaimedMimeType } from '@/lib/file-validation/signature';
import { convertToPdf, mergePdfs } from '@/lib/convert-to-pdf';
import { getPhysicalPageCount } from '@/lib/document-analysis/physical-pages';
import type { OrderDraftRow } from '@/lib/order-drafts/types';

const mockGetDraftRow = getDraftRow as jest.Mock;
const mockSetDraftFile = setDraftFile as jest.Mock;
const mockGetSessionToken = getDraftSessionToken as jest.Mock;
const mockGetOptionalAuthUser = getOptionalAuthUser as jest.Mock;
const mockDownloadFile = downloadFile as jest.Mock;
const mockUploadFile = uploadFile as jest.Mock;
const mockDeleteFile = deleteFile as jest.Mock;
const mockHeadFile = headFile as jest.Mock;
const mockMatchesClaimedMimeType = matchesClaimedMimeType as jest.Mock;
const mockConvertToPdf = convertToPdf as jest.Mock;
const mockMergePdfs = mergePdfs as jest.Mock;
const mockGetPhysicalPageCount = getPhysicalPageCount as jest.Mock;

const RAW_KEY_1 = 'draft-upload-raw/draft-1/11111111-1111-1111-1111-111111111111';
const RAW_KEY_2 = 'draft-upload-raw/draft-1/22222222-2222-2222-2222-222222222222';
const FINAL_KEY = 'draft-uploads/draft-1/original.pdf';

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
  const request = new NextRequest(`http://localhost/api/order-drafts/${draftId}/upload/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { request, params: Promise.resolve({ draftId }) };
}

const oneUpload = [{ key: RAW_KEY_1, originalName: 'passport.pdf', mimeType: 'application/pdf', sizeBytes: 100 }];

beforeEach(() => {
  // resetAllMocks (not clearAllMocks) — clearAllMocks leaves queued
  // mockResolvedValueOnce/mockReturnValueOnce implementations in place, which would
  // otherwise leak into the next test whenever a test queues more .Once() values than
  // the code path under test actually consumes.
  jest.resetAllMocks();
  mockGetDraftRow.mockResolvedValue(BASE_DRAFT);
  mockGetSessionToken.mockResolvedValue('sess-token');
  mockGetOptionalAuthUser.mockResolvedValue(null);
  mockMatchesClaimedMimeType.mockReturnValue(true);
  mockConvertToPdf.mockImplementation((buf: Buffer) => Promise.resolve(buf));
  mockMergePdfs.mockImplementation((parts: Buffer[]) => Promise.resolve(Buffer.concat(parts)));
  mockDownloadFile.mockResolvedValue(Buffer.from('raw-bytes'));
  mockUploadFile.mockResolvedValue(undefined);
  mockDeleteFile.mockResolvedValue(undefined);
  mockSetDraftFile.mockResolvedValue({ ok: true, value: { ...BASE_DRAFT, file_keys: [{ key: FINAL_KEY, originalName: 'passport.pdf', mimeType: 'application/pdf', sizeBytes: 9 }] } });
  mockGetPhysicalPageCount.mockResolvedValue(1);
});

describe('ownership / draft state', () => {
  it('returns 404 for a nonexistent draft', async () => {
    mockGetDraftRow.mockResolvedValueOnce(null);
    const { request, params } = makeRequest('missing', { uploads: oneUpload });
    const res = await POST(request, { params });
    expect(res.status).toBe(404);
  });

  it('returns 403 for a draft owned by someone else', async () => {
    mockGetSessionToken.mockResolvedValueOnce('someone-else');
    const { request, params } = makeRequest('draft-1', { uploads: oneUpload });
    const res = await POST(request, { params });
    expect(res.status).toBe(403);
  });

  it('returns 409 for an already-converted draft', async () => {
    mockGetDraftRow.mockResolvedValueOnce({ ...BASE_DRAFT, status: 'converted' });
    const { request, params } = makeRequest('draft-1', { uploads: oneUpload });
    const res = await POST(request, { params });
    expect(res.status).toBe(409);
  });
});

describe('key validation', () => {
  it('rejects a key belonging to another draft', async () => {
    const { request, params } = makeRequest('draft-1', {
      uploads: [{ key: 'draft-upload-raw/other-draft/11111111-1111-1111-1111-111111111111', originalName: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 100 }],
    });
    const res = await POST(request, { params });
    const body = await res.json() as { error?: string };
    expect(res.status).toBe(400);
    expect(body.error).toBe('INVALID_UPLOAD_KEY');
    expect(mockHeadFile).not.toHaveBeenCalled();
  });

  it('rejects an arbitrary R2 key (e.g. a real documents/ path)', async () => {
    const { request, params } = makeRequest('draft-1', {
      uploads: [{ key: 'documents/user-1/doc-1/original.pdf', originalName: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 100 }],
    });
    const res = await POST(request, { params });
    expect(res.status).toBe(400);
    expect((await res.json() as { error?: string }).error).toBe('INVALID_UPLOAD_KEY');
  });

  it('rejects the final key format submitted as a raw key', async () => {
    const { request, params } = makeRequest('draft-1', {
      uploads: [{ key: FINAL_KEY, originalName: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 100 }],
    });
    const res = await POST(request, { params });
    expect(res.status).toBe(400);
  });

  it('rejects duplicate keys in the same request', async () => {
    const { request, params } = makeRequest('draft-1', {
      uploads: [
        { key: RAW_KEY_1, originalName: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 100 },
        { key: RAW_KEY_1, originalName: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 100 },
      ],
    });
    const res = await POST(request, { params });
    expect(res.status).toBe(400);
    expect((await res.json() as { error?: string }).error).toBe('INVALID_UPLOAD_KEY');
  });

  it('rejects a batch above the max file count', async () => {
    const uploads = Array.from({ length: 11 }, (_, i) =>
      ({ key: `draft-upload-raw/draft-1/${String(i).padStart(8, '0')}-1111-1111-1111-111111111111`, originalName: `f${i}.pdf`, mimeType: 'application/pdf', sizeBytes: 100 }));
    const { request, params } = makeRequest('draft-1', { uploads });
    const res = await POST(request, { params });
    expect(res.status).toBe(400);
    expect((await res.json() as { error?: string }).error).toBe('FILE_COUNT_EXCEEDED');
  });
});

describe('HeadObject verification', () => {
  it('returns UPLOAD_OBJECT_NOT_FOUND when a raw object is missing', async () => {
    // BASE_DRAFT.file_keys is empty, so the finalKey idempotency probe is never
    // reached — this single resolved value is consumed by the raw-key HeadObject call.
    mockHeadFile.mockResolvedValueOnce(null);
    const { request, params } = makeRequest('draft-1', { uploads: oneUpload });
    const res = await POST(request, { params });
    expect(res.status).toBe(404);
    expect((await res.json() as { error?: string }).error).toBe('UPLOAD_OBJECT_NOT_FOUND');
  });

  it('rejects and deletes raw objects when actual size exceeds the 20 MB per-file limit', async () => {
    mockHeadFile.mockResolvedValueOnce({ contentLength: 21 * 1024 * 1024, contentType: 'application/pdf' });
    const uploads = [{ key: RAW_KEY_1, originalName: 'big.pdf', mimeType: 'application/pdf', sizeBytes: 21 * 1024 * 1024 }];
    const { request, params } = makeRequest('draft-1', { uploads });
    const res = await POST(request, { params });
    expect(res.status).toBe(400);
    expect((await res.json() as { error?: string }).error).toBe('FILE_SIZE_EXCEEDED');
    expect(mockDeleteFile).toHaveBeenCalledWith(RAW_KEY_1);
  });

  it('rejects when the actual size differs from the client-declared size', async () => {
    mockHeadFile.mockResolvedValueOnce({ contentLength: 50, contentType: 'application/pdf' }); // actual 50, declared 100
    const { request, params } = makeRequest('draft-1', { uploads: oneUpload });
    const res = await POST(request, { params });
    expect(res.status).toBe(400);
    expect((await res.json() as { error?: string }).error).toBe('UPLOAD_SIZE_MISMATCH');
    expect(mockDeleteFile).toHaveBeenCalledWith(RAW_KEY_1);
  });

  it('rejects when the total actual size exceeds the cap for an anonymous draft', async () => {
    mockHeadFile
      .mockResolvedValueOnce({ contentLength: 12 * 1024 * 1024, contentType: 'application/pdf' })
      .mockResolvedValueOnce({ contentLength: 12 * 1024 * 1024, contentType: 'application/pdf' });
    const uploads = [
      { key: RAW_KEY_1, originalName: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 12 * 1024 * 1024 },
      { key: RAW_KEY_2, originalName: 'b.pdf', mimeType: 'application/pdf', sizeBytes: 12 * 1024 * 1024 },
    ];
    const { request, params } = makeRequest('draft-1', { uploads });
    const res = await POST(request, { params });
    expect(res.status).toBe(400);
    expect((await res.json() as { error?: string }).error).toBe('TOTAL_SIZE_EXCEEDED');
  });

  it('rejects a Content-Type mismatch when R2 reports one', async () => {
    mockHeadFile.mockResolvedValueOnce({ contentLength: 100, contentType: 'image/png' }); // declared pdf, actual png
    const { request, params } = makeRequest('draft-1', { uploads: oneUpload });
    const res = await POST(request, { params });
    expect(res.status).toBe(400);
    expect((await res.json() as { error?: string }).error).toBe('UPLOAD_CONTENT_TYPE_MISMATCH');
  });
});

describe('magic-byte check', () => {
  it('rejects and deletes raw objects on a signature mismatch', async () => {
    mockHeadFile.mockResolvedValueOnce({ contentLength: 100, contentType: 'application/pdf' });
    mockMatchesClaimedMimeType.mockReturnValueOnce(false);
    const { request, params } = makeRequest('draft-1', { uploads: oneUpload });
    const res = await POST(request, { params });
    expect(res.status).toBe(400);
    expect((await res.json() as { error?: string }).error).toBe('INVALID_FILE_SIGNATURE');
    expect(mockDeleteFile).toHaveBeenCalledWith(RAW_KEY_1);
    expect(mockConvertToPdf).not.toHaveBeenCalled();
  });
});

describe('successful conversion and merge', () => {
  it('downloads, converts, merges, uploads the final PDF, and calls setDraftFile', async () => {
    mockHeadFile.mockResolvedValueOnce({ contentLength: 100, contentType: 'application/pdf' });
    const { request, params } = makeRequest('draft-1', { uploads: oneUpload });
    const res = await POST(request, { params });
    const body = await res.json() as { ok: boolean; sizeBytes: number };

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(mockDownloadFile).toHaveBeenCalledWith(RAW_KEY_1);
    expect(mockConvertToPdf).toHaveBeenCalled();
    expect(mockMergePdfs).toHaveBeenCalled();
    expect(mockUploadFile).toHaveBeenCalledWith(FINAL_KEY, expect.any(Buffer), 'application/pdf');
    expect(mockSetDraftFile).toHaveBeenCalledWith(
      'draft-1',
      expect.objectContaining({ key: FINAL_KEY, mimeType: 'application/pdf' }),
      expect.anything(),
    );
  });

  it('merges multiple files in request order', async () => {
    mockHeadFile
      .mockResolvedValueOnce({ contentLength: 3, contentType: 'application/pdf' })
      .mockResolvedValueOnce({ contentLength: 3, contentType: 'application/pdf' });
    mockDownloadFile.mockResolvedValueOnce(Buffer.from('AAA')).mockResolvedValueOnce(Buffer.from('BBB'));

    const uploads = [
      { key: RAW_KEY_1, originalName: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 3 },
      { key: RAW_KEY_2, originalName: 'b.pdf', mimeType: 'application/pdf', sizeBytes: 3 },
    ];
    const { request, params } = makeRequest('draft-1', { uploads });
    await POST(request, { params });

    const mergedArg = mockMergePdfs.mock.calls[0]![0] as Buffer[];
    expect(mergedArg.map((b) => b.toString())).toEqual(['AAA', 'BBB']);
  });

  it('never calls setDraftFile when the permanent per-source upload fails', async () => {
    mockHeadFile.mockResolvedValueOnce({ contentLength: 100, contentType: 'application/pdf' });
    mockUploadFile.mockRejectedValueOnce(new Error('R2 down')); // first uploadFile call = permanent source key
    const { request, params } = makeRequest('draft-1', { uploads: oneUpload });
    const res = await POST(request, { params });

    expect(res.status).toBe(500);
    expect((await res.json() as { error?: string }).error).toBe('SOURCE_UPLOAD_FAILED');
    expect(mockSetDraftFile).not.toHaveBeenCalled();
    expect(mockDeleteFile).not.toHaveBeenCalled(); // retry-safe: raw objects kept
  });

  it('never calls setDraftFile when the merged-bundle upload fails', async () => {
    mockHeadFile.mockResolvedValueOnce({ contentLength: 100, contentType: 'application/pdf' });
    mockUploadFile
      .mockResolvedValueOnce(undefined) // permanent source ORIGINAL key upload succeeds
      .mockResolvedValueOnce(undefined) // permanent source CONVERTED-PDF key upload succeeds
      .mockRejectedValueOnce(new Error('R2 down')); // merged-bundle (finalKey) upload fails
    const { request, params } = makeRequest('draft-1', { uploads: oneUpload });
    const res = await POST(request, { params });

    expect(res.status).toBe(500);
    expect((await res.json() as { error?: string }).error).toBe('DIRECT_UPLOAD_FAILED');
    expect(mockSetDraftFile).not.toHaveBeenCalled();
    expect(mockDeleteFile).not.toHaveBeenCalled(); // retry-safe: raw objects kept
  });

  it('returns FILE_PROCESSING_FAILED and keeps raw objects when conversion throws', async () => {
    mockHeadFile.mockResolvedValueOnce({ contentLength: 100, contentType: 'application/pdf' });
    mockConvertToPdf.mockRejectedValueOnce(new Error('corrupt docx'));
    const { request, params } = makeRequest('draft-1', { uploads: oneUpload });
    const res = await POST(request, { params });

    expect(res.status).toBe(500);
    expect((await res.json() as { error?: string }).error).toBe('FILE_PROCESSING_FAILED');
    expect(mockDeleteFile).not.toHaveBeenCalled();
  });

  it('deletes raw objects only after setDraftFile succeeds', async () => {
    mockHeadFile.mockResolvedValueOnce({ contentLength: 100, contentType: 'application/pdf' });
    const { request, params } = makeRequest('draft-1', { uploads: oneUpload });
    await POST(request, { params });

    expect(mockDeleteFile).toHaveBeenCalledWith(RAW_KEY_1);
    const uploadOrder = mockUploadFile.mock.invocationCallOrder[0]!;
    const setDraftFileOrder = mockSetDraftFile.mock.invocationCallOrder[0]!;
    const deleteOrder = mockDeleteFile.mock.invocationCallOrder[0]!;
    expect(uploadOrder).toBeLessThan(setDraftFileOrder);
    expect(setDraftFileOrder).toBeLessThan(deleteOrder);
  });

  it('does not delete raw objects and propagates the draft error when setDraftFile fails', async () => {
    mockHeadFile.mockResolvedValueOnce({ contentLength: 100, contentType: 'application/pdf' });
    mockSetDraftFile.mockResolvedValueOnce({ ok: false, error: 'DRAFT_ALREADY_CONVERTED' });
    const { request, params } = makeRequest('draft-1', { uploads: oneUpload });
    const res = await POST(request, { params });

    expect(res.status).toBe(400);
    expect(mockDeleteFile).not.toHaveBeenCalled();
  });

  it('does not fail the response when one raw object delete fails (best-effort cleanup)', async () => {
    mockHeadFile.mockResolvedValueOnce({ contentLength: 100, contentType: 'application/pdf' });
    mockDeleteFile.mockRejectedValueOnce(new Error('R2 delete failed'));
    const { request, params } = makeRequest('draft-1', { uploads: oneUpload });
    const res = await POST(request, { params });

    expect(res.status).toBe(200);
    expect((await res.json() as { ok: boolean }).ok).toBe(true);
  });
});

describe('idempotent replay', () => {
  it('returns success without re-downloading/re-converting when the final object already exists', async () => {
    const alreadyConverted = {
      ...BASE_DRAFT,
      file_keys: [{ key: FINAL_KEY, originalName: 'passport.pdf', mimeType: 'application/pdf', sizeBytes: 12345 }],
    };
    mockGetDraftRow.mockResolvedValueOnce(alreadyConverted);
    mockHeadFile.mockResolvedValueOnce({ contentLength: 12345, contentType: 'application/pdf' }); // finalKey probe

    const { request, params } = makeRequest('draft-1', { uploads: oneUpload });
    const res = await POST(request, { params });
    const body = await res.json() as { ok: boolean; sizeBytes: number };

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.sizeBytes).toBe(12345);
    expect(mockDownloadFile).not.toHaveBeenCalled();
    expect(mockConvertToPdf).not.toHaveBeenCalled();
    expect(mockMergePdfs).not.toHaveBeenCalled();
    expect(mockSetDraftFile).not.toHaveBeenCalled();
    // The raw keys from this retry were never touched — they may already be gone.
    expect(mockDeleteFile).not.toHaveBeenCalled();
  });

  it('does not 404 on a retry whose raw objects were already deleted by the prior successful run', async () => {
    const alreadyConverted = {
      ...BASE_DRAFT,
      file_keys: [{ key: FINAL_KEY, originalName: 'passport.pdf', mimeType: 'application/pdf', sizeBytes: 999 }],
    };
    mockGetDraftRow.mockResolvedValueOnce(alreadyConverted);
    mockHeadFile.mockResolvedValueOnce({ contentLength: 999, contentType: 'application/pdf' }); // final object still there
    // headFile would 404 for the raw key if it were ever called — but the idempotency
    // check must short-circuit before that happens.

    const { request, params } = makeRequest('draft-1', { uploads: oneUpload });
    const res = await POST(request, { params });

    expect(res.status).toBe(200);
    expect(mockHeadFile).toHaveBeenCalledTimes(1); // only the final-key probe, no raw HeadObject
  });

  it('reprocesses when file_keys references a final object that no longer exists in R2', async () => {
    const staleFinal = {
      ...BASE_DRAFT,
      file_keys: [{ key: FINAL_KEY, originalName: 'passport.pdf', mimeType: 'application/pdf', sizeBytes: 999 }],
    };
    mockGetDraftRow.mockResolvedValueOnce(staleFinal);
    mockHeadFile
      .mockResolvedValueOnce(null) // final-key probe: object was manually deleted
      .mockResolvedValueOnce({ contentLength: 100, contentType: 'application/pdf' }); // raw key HeadObject

    const { request, params } = makeRequest('draft-1', { uploads: oneUpload });
    const res = await POST(request, { params });

    expect(res.status).toBe(200);
    expect(mockConvertToPdf).toHaveBeenCalled();
    expect(mockSetDraftFile).toHaveBeenCalled();
  });
});

describe('content-hash dedup before mergePdfs (2026-07-29 incident regression)', () => {
  // Reproduces the exact reported production sequence: /complete already succeeded once
  // for a single real document, pricing/calculate then failed, and a later retry's
  // uploads list ended up containing the SAME file content twice (client-side stale
  // accumulation) under a reprocessing path (e.g. the final object briefly unavailable).
  // mergePdfs() must never see both copies — physicalPageCount/characterCount must not
  // double for what is actually a one-page document.
  it('collapses two byte-identical uploads to one before merging — draft ends up with one source (sequence 1), not 2', async () => {
    mockHeadFile
      .mockResolvedValueOnce({ contentLength: 3, contentType: 'application/pdf' })
      .mockResolvedValueOnce({ contentLength: 3, contentType: 'application/pdf' });
    // Same identical bytes downloaded for both raw keys — a duplicate upload of the same file.
    mockDownloadFile.mockResolvedValueOnce(Buffer.from('AAA')).mockResolvedValueOnce(Buffer.from('AAA'));
    mockGetPhysicalPageCount.mockResolvedValueOnce(1); // only ever called once — for the single deduped part

    const uploads = [
      { key: RAW_KEY_1, originalName: 'passport.pdf', mimeType: 'application/pdf', sizeBytes: 3 },
      { key: RAW_KEY_2, originalName: 'passport.pdf', mimeType: 'application/pdf', sizeBytes: 3 },
    ];
    const { request, params } = makeRequest('draft-1', { uploads });
    const res = await POST(request, { params });

    expect(res.status).toBe(200);
    // mergePdfs must receive exactly ONE part, not two — this is what prevents the
    // page/character count from doubling downstream.
    const mergedArg = mockMergePdfs.mock.calls[0]![0] as Buffer[];
    expect(mergedArg).toHaveLength(1);
    expect(mockGetPhysicalPageCount).toHaveBeenCalledTimes(1);

    expect(mockSetDraftFile).toHaveBeenCalledWith(
      'draft-1',
      expect.objectContaining({
        sources: [expect.objectContaining({ sequence: 1, originalName: 'passport.pdf', physicalPageCount: 1 })],
      }),
      expect.anything(),
    );
    // Both raw objects (including the dropped duplicate) still get cleaned up — nothing
    // stale is left lying around in R2.
    expect(mockDeleteFile).toHaveBeenCalledWith(RAW_KEY_1);
    expect(mockDeleteFile).toHaveBeenCalledWith(RAW_KEY_2);
  });

  it('two genuinely different files are NOT deduped — sources reflects both, in sequence order', async () => {
    mockHeadFile
      .mockResolvedValueOnce({ contentLength: 3, contentType: 'application/pdf' })
      .mockResolvedValueOnce({ contentLength: 3, contentType: 'application/pdf' });
    mockDownloadFile.mockResolvedValueOnce(Buffer.from('AAA')).mockResolvedValueOnce(Buffer.from('BBB'));
    mockGetPhysicalPageCount.mockResolvedValueOnce(1).mockResolvedValueOnce(2);

    const uploads = [
      { key: RAW_KEY_1, originalName: 'front.pdf', mimeType: 'application/pdf', sizeBytes: 3 },
      { key: RAW_KEY_2, originalName: 'back.pdf', mimeType: 'application/pdf', sizeBytes: 3 },
    ];
    const { request, params } = makeRequest('draft-1', { uploads });
    const res = await POST(request, { params });

    expect(res.status).toBe(200);
    const mergedArg = mockMergePdfs.mock.calls[0]![0] as Buffer[];
    expect(mergedArg).toHaveLength(2);
    expect(mockSetDraftFile).toHaveBeenCalledWith(
      'draft-1',
      expect.objectContaining({
        sources: [
          expect.objectContaining({ sequence: 1, originalName: 'front.pdf', physicalPageCount: 1 }),
          expect.objectContaining({ sequence: 2, originalName: 'back.pdf', physicalPageCount: 2 }),
        ],
      }),
      expect.anything(),
    );
  });

  it('full incident sequence: complete succeeds (1 file) -> retry with a stale duplicate appended -> still deduped to 1 on reprocess', async () => {
    // Step 1: first successful completion, single real file.
    mockHeadFile.mockResolvedValueOnce({ contentLength: 3, contentType: 'application/pdf' });
    mockDownloadFile.mockResolvedValueOnce(Buffer.from('AAA'));
    mockGetPhysicalPageCount.mockResolvedValueOnce(1);
    const { request: req1, params: params1 } = makeRequest('draft-1', { uploads: [uploads0(RAW_KEY_1)] });
    const res1 = await POST(req1, { params: params1 });
    expect(res1.status).toBe(200);
    expect(mockSetDraftFile).toHaveBeenLastCalledWith(
      'draft-1',
      expect.objectContaining({ sources: [expect.objectContaining({ sequence: 1 })] }),
      expect.anything(),
    );

    // Step 2: pricing/calculate fails (simulated elsewhere — calculateDraftPrice, not this
    // route). The client retries; its stale `files` state now also includes the same
    // document a second time. The draft's final object momentarily fails its HeadObject
    // probe (e.g. R2 read-after-write edge case), so /complete falls through to
    // reprocessing — with the client's (stale, duplicated) uploads list.
    mockGetDraftRow.mockResolvedValueOnce({
      ...BASE_DRAFT,
      file_keys: [{
        key: FINAL_KEY, originalName: 'passport.pdf', mimeType: 'application/pdf', sizeBytes: 3,
        sources: [{ sequence: 1, originalName: 'passport.pdf', permanentKey: 'draft-uploads/draft-1/sources/001.pdf', contentSha256: 'abc', mimeType: 'application/pdf', physicalPageCount: 1 }],
      }],
    });
    mockHeadFile
      .mockResolvedValueOnce(null) // final-key probe fails -> reprocess
      .mockResolvedValueOnce({ contentLength: 3, contentType: 'application/pdf' })
      .mockResolvedValueOnce({ contentLength: 3, contentType: 'application/pdf' });
    mockDownloadFile.mockResolvedValueOnce(Buffer.from('AAA')).mockResolvedValueOnce(Buffer.from('AAA'));
    mockGetPhysicalPageCount.mockResolvedValueOnce(1);

    const retryUploads = [uploads0('draft-upload-raw/draft-1/33333333-3333-3333-3333-333333333333'), uploads0('draft-upload-raw/draft-1/44444444-4444-4444-4444-444444444444')];
    const { request: req2, params: params2 } = makeRequest('draft-1', { uploads: retryUploads });
    const res2 = await POST(req2, { params: params2 });

    expect(res2.status).toBe(200);
    // Draft still ends up with exactly ONE source upload — never doubled by the retry.
    expect(mockSetDraftFile).toHaveBeenLastCalledWith(
      'draft-1',
      expect.objectContaining({ sources: [expect.objectContaining({ sequence: 1 })] }),
      expect.anything(),
    );
    const mergedArg = mockMergePdfs.mock.calls[mockMergePdfs.mock.calls.length - 1]![0] as Buffer[];
    expect(mergedArg).toHaveLength(1);
  });
});

function uploads0(key: string) {
  return { key, originalName: 'passport.pdf', mimeType: 'application/pdf', sizeBytes: 3 };
}
