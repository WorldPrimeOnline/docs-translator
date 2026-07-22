/**
 * @jest-environment node
 *
 * Tests for syncResultFilesFromDrive() — the Drive → R2 read-back reconciler for
 * signature_stamp/notary results (2026-08-01 multi-file fulfillment decision).
 *
 * Covers the user's explicit point 5 concern: UNIQUE(job_id, stage, source_sequences)
 * must never let two different files silently coexist covering an overlapping/stale
 * range — a folder reconciliation must remove a superseded row, not just add new ones.
 * Also covers: invalid mapping never touches existing (last-known-good) rows, and a
 * download/upload failure marks that one group 'failed' without abandoning others'
 * success.
 */
export {};

jest.mock('../supabase', () => ({ supabase: { from: jest.fn() } }));
jest.mock('../google-drive', () => ({
  listFilesInFolder: jest.fn(),
  downloadFileFromDrive: jest.fn(),
}));
jest.mock('../r2', () => ({ uploadFile: jest.fn() }));
jest.mock('../job-result-files', () => ({
  upsertJobResultFile: jest.fn(),
  getResultFilesForStage: jest.fn(),
  deleteJobResultFilesByIds: jest.fn(),
}));

function supabaseChain(result: { data?: unknown; error?: unknown; count?: number }) {
  const c: Record<string, unknown> = {};
  const methods = ['select', 'eq', 'in'];
  for (const m of methods) c[m] = jest.fn(() => c);
  c.single = jest.fn(() => Promise.resolve(result));
  c.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return c;
}

describe('syncResultFilesFromDrive', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  async function setup() {
    const { supabase } = await import('../supabase');
    const { listFilesInFolder, downloadFileFromDrive } = await import('../google-drive');
    const { uploadFile } = await import('../r2');
    const { upsertJobResultFile, getResultFilesForStage, deleteJobResultFilesByIds } = await import('../job-result-files');
    return {
      mockFrom: supabase.from as jest.Mock,
      mockList: listFilesInFolder as jest.Mock,
      mockDownload: downloadFileFromDrive as jest.Mock,
      mockUpload: uploadFile as jest.Mock,
      mockUpsert: upsertJobResultFile as jest.Mock,
      mockGetForStage: getResultFilesForStage as jest.Mock,
      mockDeleteByIds: deleteJobResultFilesByIds as jest.Mock,
    };
  }

  function mockJobLookups(mockFrom: jest.Mock, totalSources: number) {
    mockFrom
      .mockReturnValueOnce(supabaseChain({ count: totalSources, error: null })) // job_source_files count
      .mockReturnValueOnce(supabaseChain({ data: { document_id: 'doc-1' }, error: null })) // jobs
      .mockReturnValueOnce(supabaseChain({ data: { user_id: 'user-1' }, error: null })); // documents
  }

  it('refuses to sync a job with zero job_source_files rows (not a multi-source job)', async () => {
    const { mockFrom, mockList } = await setup();
    mockFrom.mockReturnValueOnce(supabaseChain({ count: 0, error: null }));

    const { syncResultFilesFromDrive } = await import('../result-file-sync');
    const result = await syncResultFilesFromDrive({ jobId: 'job-1', stage: 'signature_stamp', driveFolderId: 'folder-1' });

    expect(result).toEqual({ ok: false, reason: expect.stringContaining('no job_source_files rows') });
    expect(mockList).not.toHaveBeenCalled();
  });

  it('2 sources -> 2 individual files: downloads, uploads to R2, upserts both as ready', async () => {
    const { mockFrom, mockList, mockDownload, mockUpload, mockUpsert, mockGetForStage } = await setup();
    mockJobLookups(mockFrom, 2);
    mockList.mockResolvedValueOnce([
      { id: 'drive-1', name: '001_TRANSLATOR_RESULT.pdf' },
      { id: 'drive-2', name: '002_TRANSLATOR_RESULT.pdf' },
    ]);
    mockGetForStage.mockResolvedValueOnce([]); // nothing synced yet
    mockDownload.mockResolvedValue(Buffer.from('pdf-bytes'));
    mockUpsert.mockResolvedValue({ ok: true });

    const { syncResultFilesFromDrive } = await import('../result-file-sync');
    const result = await syncResultFilesFromDrive({ jobId: 'job-1', stage: 'signature_stamp', driveFolderId: 'folder-1' });

    expect(result).toEqual({ ok: true, groupsSynced: 2, fullyCovered: true });
    expect(mockUpload).toHaveBeenCalledTimes(2);
    expect(mockUpsert).toHaveBeenCalledWith(expect.objectContaining({ jobId: 'job-1', stage: 'signature_stamp', sourceSequences: [1], status: 'ready', driveFileId: 'drive-1' }));
    expect(mockUpsert).toHaveBeenCalledWith(expect.objectContaining({ jobId: 'job-1', stage: 'signature_stamp', sourceSequences: [2], status: 'ready', driveFileId: 'drive-2' }));
  });

  it('point 5: staff replaces one grouped file [1-10] with two smaller files [1-5]+[6-10] — the stale [1..10] row is deleted, never left overlapping the new rows', async () => {
    const { mockFrom, mockList, mockDownload, mockUpload, mockUpsert, mockGetForStage, mockDeleteByIds } = await setup();
    mockJobLookups(mockFrom, 10);
    mockList.mockResolvedValueOnce([
      { id: 'drive-new-a', name: '001-005_Part1.pdf' },
      { id: 'drive-new-b', name: '006-010_Part2.pdf' },
    ]);
    // Existing stale row from a prior sync covering the whole range as one file.
    mockGetForStage.mockResolvedValueOnce([
      { id: 'row-stale', source_sequences: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], status: 'ready', drive_file_id: 'drive-old' },
    ]);
    mockDownload.mockResolvedValue(Buffer.from('pdf-bytes'));
    mockUpsert.mockResolvedValue({ ok: true });
    mockDeleteByIds.mockResolvedValue({ ok: true });

    const { syncResultFilesFromDrive } = await import('../result-file-sync');
    const result = await syncResultFilesFromDrive({ jobId: 'job-1', stage: 'signature_stamp', driveFolderId: 'folder-1' });

    expect(result).toEqual({ ok: true, groupsSynced: 2, fullyCovered: true });
    // The stale whole-range row must be deleted — it is no longer represented by any
    // current Drive file, and would otherwise sit alongside the two new rows claiming
    // to cover the same sequences twice.
    expect(mockDeleteByIds).toHaveBeenCalledWith(['row-stale']);
    expect(mockUpsert).toHaveBeenCalledWith(expect.objectContaining({ sourceSequences: [1, 2, 3, 4, 5] }));
    expect(mockUpsert).toHaveBeenCalledWith(expect.objectContaining({ sourceSequences: [6, 7, 8, 9, 10] }));
  });

  it('skips re-download/re-upload when a group is already synced with the same drive_file_id (idempotent retry)', async () => {
    const { mockFrom, mockList, mockDownload, mockUpload, mockUpsert, mockGetForStage } = await setup();
    mockJobLookups(mockFrom, 1);
    mockList.mockResolvedValueOnce([{ id: 'drive-1', name: '001_TRANSLATOR_RESULT.pdf' }]);
    mockGetForStage.mockResolvedValueOnce([
      { id: 'row-1', source_sequences: [1], status: 'ready', drive_file_id: 'drive-1' },
    ]);

    const { syncResultFilesFromDrive } = await import('../result-file-sync');
    const result = await syncResultFilesFromDrive({ jobId: 'job-1', stage: 'signature_stamp', driveFolderId: 'folder-1' });

    expect(result).toEqual({ ok: true, groupsSynced: 1, fullyCovered: true });
    expect(mockDownload).not.toHaveBeenCalled();
    expect(mockUpload).not.toHaveBeenCalled();
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('invalid mapping (gap) refuses to sync and never touches existing rows', async () => {
    const { mockFrom, mockList, mockDeleteByIds, mockUpsert, mockGetForStage } = await setup();
    mockJobLookups(mockFrom, 3);
    mockList.mockResolvedValueOnce([
      { id: 'drive-1', name: '001_TRANSLATOR_RESULT.pdf' },
      { id: 'drive-2', name: '003_TRANSLATOR_RESULT.pdf' },
      // sequence 2 missing — a gap
    ]);

    const { syncResultFilesFromDrive } = await import('../result-file-sync');
    const result = await syncResultFilesFromDrive({ jobId: 'job-1', stage: 'notary', driveFolderId: 'folder-1' });

    expect(result.ok).toBe(false);
    expect(mockGetForStage).not.toHaveBeenCalled();
    expect(mockDeleteByIds).not.toHaveBeenCalled();
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('an empty Drive folder refuses to sync (no files uploaded yet — Jira status arrived first)', async () => {
    const { mockFrom, mockList, mockUpsert } = await setup();
    mockJobLookups(mockFrom, 2);
    mockList.mockResolvedValueOnce([]);

    const { syncResultFilesFromDrive } = await import('../result-file-sync');
    const result = await syncResultFilesFromDrive({ jobId: 'job-1', stage: 'notary', driveFolderId: 'folder-1' });

    expect(result).toEqual({ ok: false, reason: expect.stringContaining('no files found') });
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('a download failure for one group marks it failed with last_error, without crashing the whole sync', async () => {
    const { mockFrom, mockList, mockDownload, mockUpsert, mockGetForStage } = await setup();
    mockJobLookups(mockFrom, 1);
    mockList.mockResolvedValueOnce([{ id: 'drive-1', name: '001_NOTARY.pdf' }]);
    mockGetForStage.mockResolvedValueOnce([]);
    mockDownload.mockRejectedValueOnce(new Error('Drive download timeout'));
    mockUpsert.mockResolvedValue({ ok: true });

    const { syncResultFilesFromDrive } = await import('../result-file-sync');
    const result = await syncResultFilesFromDrive({ jobId: 'job-1', stage: 'notary', driveFolderId: 'folder-1' });

    expect(result).toEqual({ ok: false, reason: expect.stringContaining('Drive download timeout') });
    expect(mockUpsert).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed', lastError: expect.stringContaining('Drive download timeout') }));
  });
});
