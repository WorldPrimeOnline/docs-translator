/**
 * Tests for POST/DELETE /api/internal/pricing-lab/analyze-file.
 * Confirms: no jobs/payment/Jira/Drive/fiscal side effects, files land under pricing-lab/,
 * a failed analysis deletes its own upload immediately, and the opportunistic TTL sweep runs
 * on every request without blocking it.
 */
import * as fs from 'fs';
export {};

const uploadedFiles: Array<{ key: string; contentType: string }> = [];
const deletedKeys: string[] = [];
let listedObjects: Array<{ key: string; lastModified: Date | null; size: number }> = [];

jest.mock('@/lib/r2/client', () => ({
  uploadFile: jest.fn(async (key: string, _buf: Buffer, contentType: string) => { uploadedFiles.push({ key, contentType }); }),
  deleteFile: jest.fn(async (key: string) => { deletedKeys.push(key); }),
  listObjectsByPrefix: jest.fn(async () => listedObjects),
}));

jest.mock('@/lib/internal/require-pricing-lab-access', () => ({
  requirePricingLabAccess: jest.fn(async () => ({ ok: true, userId: 'operator-1', userEmail: 'ops@wpo.test' })),
}));

const mockAnalyze = jest.fn();
jest.mock('@/lib/document-analysis/analyze', () => ({
  analyzeDocumentForPricing: (...args: unknown[]) => mockAnalyze(...args),
}));

function makeUploadRequest(filename: string, mimeType: string): Request {
  const formData = new FormData();
  const file = new File([Buffer.from('fake-content')], filename, { type: mimeType });
  formData.append('file', file);
  return new Request('http://localhost/api/internal/pricing-lab/analyze-file', { method: 'POST', body: formData });
}

beforeEach(() => {
  uploadedFiles.length = 0;
  deletedKeys.length = 0;
  listedObjects = [];
  jest.resetModules();
  mockAnalyze.mockResolvedValue({
    method: 'docx_text', rawText: 'text', normalizedText: 'text', characterCount: 4, physicalPageCount: 1,
    qualitySignals: { method: 'docx_text', rawCharacterCount: 4, emptyOrNearEmpty: false, charsPerPhysicalPage: 4, possiblyHandwrittenOrIllegible: false },
    requiresOperatorReview: false, reviewReasons: [],
  });
});

describe('POST /api/internal/pricing-lab/analyze-file', () => {
  it('uploads under the pricing-lab/{userId}/ prefix, never documents/ or draft-uploads/', async () => {
    const { POST } = await import('../route');
    await POST(makeUploadRequest('test.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'));
    expect(uploadedFiles).toHaveLength(1);
    expect(uploadedFiles[0]!.key).toMatch(/^pricing-lab\/operator-1\//);
  });

  it('returns the real analysis result (method/characterCount/etc.), never a fabricated confidence field', async () => {
    const { POST } = await import('../route');
    const res = await POST(makeUploadRequest('test.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'));
    const data = await res.json();
    expect(data.method).toBe('docx_text');
    expect(data.characterCount).toBe(4);
    expect(data).not.toHaveProperty('confidence');
    expect(data).not.toHaveProperty('ocrConfidence');
  });

  it('deletes the upload immediately if analysis throws', async () => {
    mockAnalyze.mockRejectedValue(new Error('boom'));
    const { POST } = await import('../route');
    const res = await POST(makeUploadRequest('bad.pdf', 'application/pdf'));
    expect(res.status).toBe(500);
    expect(deletedKeys).toHaveLength(1);
    expect(deletedKeys[0]).toBe(uploadedFiles[0]!.key);
  });

  it('rejects unsupported file types', async () => {
    const { POST } = await import('../route');
    const res = await POST(makeUploadRequest('virus.exe', 'application/x-msdownload'));
    expect(res.status).toBe(400);
    expect(uploadedFiles).toHaveLength(0);
  });

  it('runs the opportunistic TTL sweep on every call, deleting stale pricing-lab files (awaited, not fire-and-forget)', async () => {
    listedObjects = [{ key: 'pricing-lab/operator-1/stale.pdf', lastModified: new Date(Date.now() - 2 * 60 * 60 * 1000), size: 10 }];
    const { POST } = await import('../route');
    await POST(makeUploadRequest('test.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'));
    expect(deletedKeys).toContain('pricing-lab/operator-1/stale.pdf');
  });

  it('never IMPORTS jobs/payment/Jira/Drive/fiscal modules (static source check on import statements only, not doc comments)', () => {
    const src = fs.readFileSync(require.resolve('../route.ts'), 'utf8');
    const importLines = src.split('\n').filter((l) => l.trim().startsWith('import '));
    for (const forbidden of ['jira', 'google-drive', 'halyk', 'fiscal', 'payments/', "'@/lib/pricing/service'", 'supabase/server']) {
      expect(importLines.some((l) => l.toLowerCase().includes(forbidden.toLowerCase()))).toBe(false);
    }
  });
});

describe('DELETE /api/internal/pricing-lab/analyze-file', () => {
  it('deletes only a fileKey scoped to the requesting operator', async () => {
    const { DELETE } = await import('../route');
    const req = new Request('http://localhost/api/internal/pricing-lab/analyze-file?fileKey=pricing-lab/operator-1/x.pdf', { method: 'DELETE' });
    const res = await DELETE(req);
    expect(res.status).toBe(200);
    expect(deletedKeys).toContain('pricing-lab/operator-1/x.pdf');
  });

  it('refuses to delete a fileKey belonging to a different operator/prefix', async () => {
    const { DELETE } = await import('../route');
    const req = new Request('http://localhost/api/internal/pricing-lab/analyze-file?fileKey=documents/someone-else/real-order.pdf', { method: 'DELETE' });
    const res = await DELETE(req);
    expect(res.status).toBe(400);
    expect(deletedKeys).toHaveLength(0);
  });
});
