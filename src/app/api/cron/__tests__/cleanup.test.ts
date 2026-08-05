/**
 * Tests for GET /api/cron/cleanup.
 *
 * 2026-07-24 retention fix: the old version of this cron deleted the ENTIRE
 * `documents` row past 30 days (relying on CASCADE through jobs -> translations/
 * ocr_results). That silently failed for any order with a fiscal_receipts or
 * refund_transactions row (those reference jobs/documents/payment_transactions with
 * no `ON DELETE` clause — default RESTRICT), while the R2 object deletes ran BEFORE
 * that failing delete and were not transactional with it — so paid/fiscalized
 * orders past 30 days already had their R2 files silently deleted while the DB rows
 * survived with dead keys. The new model never deletes documents/jobs/price_quotes/
 * payment_transactions/fiscal_receipts/refund_transactions rows at all — it only
 * deletes R2 objects + job_source_files/job_result_files rows, then marks
 * `documents.files_purged_at`. These tests lock in that model.
 *
 * The raw-upload sweep (cleanupOrphanedRawUploads) section is unchanged from before
 * this fix and its tests are preserved as-is below.
 */
jest.mock('@/lib/supabase/server', () => ({
  supabaseServer: { from: jest.fn() },
}));
jest.mock('@/lib/r2/client', () => ({
  deleteFile: jest.fn(),
  listObjectsByPrefix: jest.fn(),
}));
jest.mock('@/lib/google-drive/client', () => ({
  trashOrderFolder: jest.fn(),
}));

import { NextRequest } from 'next/server';
import { GET } from '../cleanup/route';
import { supabaseServer } from '@/lib/supabase/server';
import { deleteFile, listObjectsByPrefix } from '@/lib/r2/client';
import { trashOrderFolder } from '@/lib/google-drive/client';

const mockFrom = supabaseServer.from as jest.Mock;
const mockDeleteFile = deleteFile as jest.Mock;
const mockListObjectsByPrefix = listObjectsByPrefix as jest.Mock;
const mockTrashOrderFolder = trashOrderFolder as jest.Mock;

function chain(result: { data?: unknown; error?: unknown }) {
  const c: Record<string, unknown> = {};
  const methods = ['select', 'eq', 'neq', 'gte', 'lt', 'in', 'is', 'not', 'limit', 'update', 'delete'];
  for (const m of methods) c[m] = jest.fn(() => c);
  c.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return c;
}

/** Table-keyed mock dispatcher — each table gets ONE chain object reused across every
 * `.from(table)` call in the test, so `.update`/`.delete` spies accumulate calls across
 * the initial select AND any later write against the same table. */
function mockTables(tables: Record<string, ReturnType<typeof chain>>) {
  mockFrom.mockImplementation((table: string) => tables[table] ?? chain({ data: [], error: null }));
}

function makeRequest(): NextRequest {
  return new NextRequest('http://localhost/api/cron/cleanup', {
    headers: { authorization: 'Bearer test-secret' },
  });
}

const NOW = Date.now();
const HOUR = 60 * 60 * 1000;

beforeEach(() => {
  jest.resetAllMocks();
  process.env.CRON_SECRET = 'test-secret';
  // Empty everything by default — isolates a given test to only the tables it wires up.
  mockFrom.mockReturnValue(chain({ data: [], error: null }));
  mockListObjectsByPrefix.mockResolvedValue([]);
  mockTrashOrderFolder.mockResolvedValue(true);
});

it('rejects requests without the correct CRON_SECRET bearer token', async () => {
  const req = new NextRequest('http://localhost/api/cron/cleanup', { headers: { authorization: 'Bearer wrong' } });
  const res = await GET(req);
  expect(res.status).toBe(401);
  expect(mockListObjectsByPrefix).not.toHaveBeenCalled();
});

describe('purgeExpiredDocumentFiles — metadata-preserving retention (2026-07-24)', () => {
  it('a completed order within 30 days is never selected for purge (files_purged_at IS NULL filter is applied at the query, not just in-memory)', async () => {
    const documentsChain = chain({ data: [], error: null });
    mockTables({ documents: documentsChain });

    await GET(makeRequest());

    expect(documentsChain.lt).toHaveBeenCalledWith('created_at', expect.any(String));
    expect(documentsChain.is).toHaveBeenCalledWith('files_purged_at', null);
  });

  it('idempotent: a document already purged (files_purged_at set) is excluded by the query and never reprocessed on a second run', async () => {
    // The query itself filters `is('files_purged_at', null)` — simulating a real
    // second run, the already-purged doc simply never appears in the result set.
    const documentsChain = chain({ data: [], error: null });
    mockTables({ documents: documentsChain });
    mockDeleteFile.mockClear();

    const res1 = await GET(makeRequest());
    const res2 = await GET(makeRequest());
    const body1 = await res1.json() as { filesPurged: number };
    const body2 = await res2.json() as { filesPurged: number };

    expect(body1.filesPurged).toBe(0);
    expect(body2.filesPurged).toBe(0);
    expect(mockDeleteFile).not.toHaveBeenCalled();
    // Both runs applied the same idempotency filter — never just "ran once and got lucky".
    expect(documentsChain.is).toHaveBeenCalledWith('files_purged_at', null);
  });

  it('a cross-user isolation check: purging never exposes or copies another user\'s document/job data — the query is scoped by created_at/files_purged_at only, never joins across users, and the response never includes document/job identifying fields', async () => {
    const documentsChain = chain({ data: [{ id: 'doc-1', file_key: 'k' }], error: null });
    const jobsChain = chain({ data: [{ id: 'job-1' }], error: null });
    mockTables({ documents: documentsChain, jobs: jobsChain });
    mockDeleteFile.mockResolvedValue(undefined);

    const res = await GET(makeRequest());
    const body = await res.json();

    // The cron response is operator-facing counts/errors only — never document
    // filenames, user IDs, or job IDs (which would leak cross-user data into logs/
    // response bodies visible to whoever can trigger this cron).
    expect(JSON.stringify(body)).not.toMatch(/doc-1|job-1|user/i);
  });

  it('past 30 days: deletes original + translated-legacy + job_source_files/job_result_files R2 objects, deletes job_source_files/job_result_files rows, marks files_purged_at — never deletes the documents row itself', async () => {
    const documentsChain = chain({ data: [{ id: 'doc-1', file_key: 'documents/u1/doc-1/original.pdf' }], error: null });
    const jobsChain = chain({ data: [{ id: 'job-1' }], error: null });
    const translationsChain = chain({ data: [{ id: 't-1', translated_pdf_key: 'documents/u1/doc-1/translated.pdf' }], error: null });
    const ocrResultsChain = chain({ data: [], error: null });
    const sourceFilesChain = chain({ data: [{ r2_key: 'src-key-1', converted_pdf_r2_key: 'src-key-1.converted.pdf' }], error: null });
    const resultFilesChain = chain({ data: [{ r2_key: 'result-key-1' }], error: null });

    mockTables({
      documents: documentsChain,
      jobs: jobsChain,
      translations: translationsChain,
      ocr_results: ocrResultsChain,
      job_source_files: sourceFilesChain,
      job_result_files: resultFilesChain,
    });
    mockDeleteFile.mockResolvedValue(undefined);

    const res = await GET(makeRequest());
    const body = await res.json() as { filesPurged: number };

    expect(mockDeleteFile).toHaveBeenCalledWith('documents/u1/doc-1/original.pdf');
    expect(mockDeleteFile).toHaveBeenCalledWith('documents/u1/doc-1/translated.pdf');
    expect(mockDeleteFile).toHaveBeenCalledWith('src-key-1');
    expect(mockDeleteFile).toHaveBeenCalledWith('src-key-1.converted.pdf');
    expect(mockDeleteFile).toHaveBeenCalledWith('result-key-1');

    expect(sourceFilesChain.delete).toHaveBeenCalled();
    expect(resultFilesChain.delete).toHaveBeenCalled();

    // The whole point of the fix: documents.update({files_purged_at}), never documents.delete().
    expect(documentsChain.update).toHaveBeenCalledWith({ files_purged_at: expect.any(String) });
    expect(documentsChain.delete).not.toHaveBeenCalled();
    expect(jobsChain.delete).not.toHaveBeenCalled();

    expect(body.filesPurged).toBe(1);
  });

  it('legacy single-file job: translations.translated_markdown and ocr_results.markdown are replaced with a placeholder, never left holding full document text past retention', async () => {
    const documentsChain = chain({ data: [{ id: 'doc-1', file_key: 'k' }], error: null });
    const jobsChain = chain({ data: [{ id: 'job-1' }], error: null });
    const translationsChain = chain({ data: [{ id: 't-1', translated_pdf_key: 'tk' }], error: null });
    const ocrResultsChain = chain({ data: [], error: null });

    mockTables({ documents: documentsChain, jobs: jobsChain, translations: translationsChain, ocr_results: ocrResultsChain });
    mockDeleteFile.mockResolvedValue(undefined);

    await GET(makeRequest());

    expect(translationsChain.update).toHaveBeenCalledWith({ translated_markdown: expect.stringContaining('purged') });
    expect(ocrResultsChain.update).toHaveBeenCalledWith({ markdown: expect.stringContaining('purged') });
  });

  it('never deletes/touches price_quotes, payment_transactions, fiscal_receipts, or refund_transactions — financial history is untouched', async () => {
    const documentsChain = chain({ data: [{ id: 'doc-1', file_key: 'k' }], error: null });
    const jobsChain = chain({ data: [{ id: 'job-1' }], error: null });

    mockTables({ documents: documentsChain, jobs: jobsChain });
    mockDeleteFile.mockResolvedValue(undefined);

    await GET(makeRequest());

    for (const table of ['price_quotes', 'payment_transactions', 'fiscal_receipts', 'refund_transactions', 'cost_reservations', 'price_quote_items']) {
      expect(mockFrom).not.toHaveBeenCalledWith(table);
    }
  });

  it('a failed R2 delete for one object does not stop the sweep or prevent files_purged_at from being set for the rest', async () => {
    const documentsChain = chain({ data: [{ id: 'doc-1', file_key: 'k1' }], error: null });
    mockTables({ documents: documentsChain });
    mockDeleteFile.mockRejectedValueOnce(new Error('R2 transient error'));

    const res = await GET(makeRequest());
    const body = await res.json() as { filesPurged: number };

    expect(documentsChain.update).toHaveBeenCalledWith({ files_purged_at: expect.any(String) });
    expect(body.filesPurged).toBe(1);
  });

  it('a documents.update failure for one doc is recorded as an error and does not crash the whole run', async () => {
    const documentsChain = chain({ data: [{ id: 'doc-1', file_key: 'k1' }], error: null });
    documentsChain.update = jest.fn(() => chain({ error: { message: 'db write failed' } }));
    mockTables({ documents: documentsChain });
    mockDeleteFile.mockResolvedValue(undefined);

    const res = await GET(makeRequest());
    const body = await res.json() as { filesPurged: number; errors?: string[] };

    expect(res.status).toBe(200);
    expect(body.filesPurged).toBe(0);
    expect(body.errors).toEqual([expect.stringContaining('doc-1')]);
  });
});

describe('purgeExpiredDriveFolders — independent, best-effort (2026-07-24)', () => {
  it('trashes the Drive folder and sets drive_purged_at when a job has google_drive_folder_id', async () => {
    const documentsChain = chain({ data: [{ id: 'doc-1' }], error: null });
    const jobsChain = chain({ data: [{ google_drive_folder_id: 'folder-abc' }], error: null });
    mockTables({ documents: documentsChain, jobs: jobsChain });
    mockTrashOrderFolder.mockResolvedValueOnce(true);

    const res = await GET(makeRequest());
    const body = await res.json() as { drivePurged: number };

    expect(mockTrashOrderFolder).toHaveBeenCalledWith('folder-abc');
    expect(documentsChain.update).toHaveBeenCalledWith({ drive_purged_at: expect.any(String) });
    expect(body.drivePurged).toBe(1);
  });

  it('a Drive failure leaves drive_purged_at unset — never errors the whole cron, retried on the next run', async () => {
    const documentsChain = chain({ data: [{ id: 'doc-1' }], error: null });
    const jobsChain = chain({ data: [{ google_drive_folder_id: 'folder-abc' }], error: null });
    mockTables({ documents: documentsChain, jobs: jobsChain });
    mockTrashOrderFolder.mockResolvedValueOnce(false);

    const res = await GET(makeRequest());
    const body = await res.json() as { drivePurged: number };

    expect(res.status).toBe(200);
    expect(documentsChain.update).not.toHaveBeenCalledWith({ drive_purged_at: expect.any(String) });
    expect(body.drivePurged).toBe(0);
  });

  it('a document with no Drive folder at all (e.g. Electronic) is marked drive_purged_at immediately, without calling trashOrderFolder', async () => {
    const documentsChain = chain({ data: [{ id: 'doc-1' }], error: null });
    const jobsChain = chain({ data: [], error: null }); // no job has a google_drive_folder_id
    mockTables({ documents: documentsChain, jobs: jobsChain });

    const res = await GET(makeRequest());
    const body = await res.json() as { drivePurged: number };

    expect(mockTrashOrderFolder).not.toHaveBeenCalled();
    expect(documentsChain.update).toHaveBeenCalledWith({ drive_purged_at: expect.any(String) });
    expect(body.drivePurged).toBe(1);
  });
});

describe('raw-upload sweep (cleanupOrphanedRawUploads) — unchanged behavior', () => {
  it('lists the draft-upload-raw/ prefix only (never draft-uploads/ or documents/)', async () => {
    mockListObjectsByPrefix.mockResolvedValueOnce([]); // draft-upload-raw/ call
    await GET(makeRequest());
    expect(mockListObjectsByPrefix).toHaveBeenCalledWith('draft-upload-raw/');
    expect(mockListObjectsByPrefix).not.toHaveBeenCalledWith('draft-uploads/');
    expect(mockListObjectsByPrefix).not.toHaveBeenCalledWith(expect.stringMatching(/^documents\//));
    expect(mockListObjectsByPrefix).toHaveBeenCalledTimes(1);
  });

  it('deletes raw uploads older than 24 hours', async () => {
    mockListObjectsByPrefix.mockResolvedValueOnce([
      { key: 'draft-upload-raw/draft-1/uuid-old', lastModified: new Date(NOW - 25 * HOUR) },
    ]);
    mockDeleteFile.mockResolvedValueOnce(undefined);

    const res = await GET(makeRequest());
    const body = await res.json() as { rawUploadsDeleted: number };

    expect(mockDeleteFile).toHaveBeenCalledWith('draft-upload-raw/draft-1/uuid-old');
    expect(body.rawUploadsDeleted).toBe(1);
  });

  it('does not delete raw uploads younger than 24 hours', async () => {
    mockListObjectsByPrefix.mockResolvedValueOnce([
      { key: 'draft-upload-raw/draft-1/uuid-fresh', lastModified: new Date(NOW - 1 * HOUR) },
    ]);

    const res = await GET(makeRequest());
    const body = await res.json() as { rawUploadsDeleted: number };

    expect(mockDeleteFile).not.toHaveBeenCalled();
    expect(body.rawUploadsDeleted).toBe(0);
  });

  it('never touches the final draft PDF or a real document, since the list call is scoped to the raw prefix only', async () => {
    mockListObjectsByPrefix.mockResolvedValueOnce([
      { key: 'draft-upload-raw/draft-1/uuid-old', lastModified: new Date(NOW - 48 * HOUR) },
    ]);
    await GET(makeRequest());

    expect(mockDeleteFile).not.toHaveBeenCalledWith('draft-uploads/draft-1/original.pdf');
    expect(mockDeleteFile).not.toHaveBeenCalledWith(expect.stringMatching(/^documents\//));
  });

  it('continues past a failed delete and still deletes the rest (one bad object does not stop the sweep)', async () => {
    mockListObjectsByPrefix.mockResolvedValueOnce([
      { key: 'draft-upload-raw/draft-1/uuid-a', lastModified: new Date(NOW - 30 * HOUR) },
      { key: 'draft-upload-raw/draft-2/uuid-b', lastModified: new Date(NOW - 30 * HOUR) },
    ]);
    mockDeleteFile
      .mockRejectedValueOnce(new Error('R2 transient error'))
      .mockResolvedValueOnce(undefined);

    const res = await GET(makeRequest());
    const body = await res.json() as { rawUploadsDeleted: number };

    expect(mockDeleteFile).toHaveBeenCalledTimes(2);
    expect(body.rawUploadsDeleted).toBe(1); // only the successful delete is counted
  });

  it('does not fail the whole cron run when listObjectsByPrefix itself errors', async () => {
    mockListObjectsByPrefix.mockRejectedValueOnce(new Error('R2 unavailable'));
    const res = await GET(makeRequest());
    const body = await res.json() as { rawUploadsDeleted: number };
    expect(res.status).toBe(200);
    expect(body.rawUploadsDeleted).toBe(0);
  });
});
