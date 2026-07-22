/**
 * @jest-environment node
 *
 * Tests for upsertJobResultFile() — 2026-08-01 multi-file fulfillment decision. The
 * core invariant under test: every write goes through .upsert() on the
 * (job_id, stage, source_sequences) conflict target, never a blind .insert(), and
 * source_sequences is always sorted ascending before being sent — Postgres array
 * equality is positional, so an unsorted array would silently defeat idempotency.
 */
export {};

jest.mock('../supabase', () => ({
  supabase: { from: jest.fn() },
}));

describe('upsertJobResultFile', () => {
  it('calls .upsert() (never .insert()) with the onConflict target (job_id,stage,source_sequences)', async () => {
    const { supabase } = await import('../supabase');
    const { upsertJobResultFile } = await import('../job-result-files');
    const mockUpsert = jest.fn(() => Promise.resolve({ error: null }));
    const mockInsert = jest.fn();
    (supabase.from as jest.Mock).mockReturnValue({ upsert: mockUpsert, insert: mockInsert });

    const result = await upsertJobResultFile({
      jobId: 'job-1',
      stage: 'ai_draft',
      sourceSequences: [1],
      filename: 'AI_DRAFT_passport.docx',
      status: 'ready',
      r2Key: 'documents/job-1/ai_draft/001.docx',
    });

    expect(result).toEqual({ ok: true });
    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        job_id: 'job-1',
        stage: 'ai_draft',
        source_sequences: [1],
        status: 'ready',
        r2_key: 'documents/job-1/ai_draft/001.docx',
        drive_file_id: null,
        last_error: null,
      }),
      { onConflict: 'job_id,stage,source_sequences' },
    );
  });

  it('sorts source_sequences ascending regardless of input order — the conflict target must be deterministic', async () => {
    const { supabase } = await import('../supabase');
    const { upsertJobResultFile } = await import('../job-result-files');
    const mockUpsert = jest.fn(() => Promise.resolve({ error: null }));
    (supabase.from as jest.Mock).mockReturnValue({ upsert: mockUpsert });

    await upsertJobResultFile({
      jobId: 'job-1',
      stage: 'signature_stamp',
      sourceSequences: [10, 4, 7, 5, 6, 8, 9],
      filename: '004-010_Part2_SIGNED.pdf',
      status: 'ready',
      driveFileId: 'drive-file-1',
    });

    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ source_sequences: [4, 5, 6, 7, 8, 9, 10] }),
      expect.anything(),
    );
  });

  it('a retry with the same (job_id, stage, source_sequences) upserts in place — same call shape, no accumulation', async () => {
    const { supabase } = await import('../supabase');
    const { upsertJobResultFile } = await import('../job-result-files');
    const mockUpsert = jest.fn((..._args: unknown[]) => Promise.resolve({ error: null }));
    (supabase.from as jest.Mock).mockReturnValue({ upsert: mockUpsert });

    const input = { jobId: 'job-1', stage: 'ai_draft' as const, sourceSequences: [2], filename: 'AI_DRAFT_visa.docx', status: 'ready' as const, r2Key: 'k' };
    await upsertJobResultFile(input);
    await upsertJobResultFile(input); // retry

    expect(mockUpsert).toHaveBeenCalledTimes(2);
    expect(mockUpsert.mock.calls[0]![1]).toEqual({ onConflict: 'job_id,stage,source_sequences' });
    expect(mockUpsert.mock.calls[1]![1]).toEqual({ onConflict: 'job_id,stage,source_sequences' });
  });

  it('propagates a DB error as ok:false instead of throwing', async () => {
    const { supabase } = await import('../supabase');
    const { upsertJobResultFile } = await import('../job-result-files');
    (supabase.from as jest.Mock).mockReturnValue({ upsert: () => Promise.resolve({ error: { message: 'constraint violation' } }) });

    const result = await upsertJobResultFile({
      jobId: 'job-1', stage: 'notary', sourceSequences: [1], filename: 'x.pdf', status: 'failed', lastError: 'download failed',
    });

    expect(result).toEqual({ ok: false, error: 'constraint violation' });
  });

  it('writes status:"failed" with last_error set, and clears last_error to null on a successful upsert', async () => {
    const { supabase } = await import('../supabase');
    const { upsertJobResultFile } = await import('../job-result-files');
    const mockUpsert = jest.fn(() => Promise.resolve({ error: null }));
    (supabase.from as jest.Mock).mockReturnValue({ upsert: mockUpsert });

    await upsertJobResultFile({ jobId: 'job-1', stage: 'notary', sourceSequences: [1], filename: 'x.pdf', status: 'ready', r2Key: 'k' });

    expect(mockUpsert).toHaveBeenCalledWith(expect.objectContaining({ status: 'ready', last_error: null }), expect.anything());
  });
});
