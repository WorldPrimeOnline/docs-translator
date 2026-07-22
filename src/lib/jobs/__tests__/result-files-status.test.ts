/**
 * Tests for getResultFilesStatus() — 2026-08-01 multi-file fulfillment decision.
 * Verifies the exact source→stage mapping (electronic/official/notary) and that
 * "ready" requires FULL, non-overlapping coverage of job_source_files.sequence,
 * never a partial set.
 */
jest.mock('@/lib/supabase/server', () => ({
  supabaseServer: { from: jest.fn() },
}));

import { supabaseServer } from '@/lib/supabase/server';
import { getResultFilesStatus } from '../result-files-status';

const mockFrom = supabaseServer.from as jest.Mock;

function chain(result: { data?: unknown; count?: number }) {
  const c: Record<string, unknown> = {};
  const methods = ['select', 'eq', 'in'];
  for (const m of methods) c[m] = jest.fn(() => c);
  c.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return c;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('getResultFilesStatus', () => {
  it('legacy job (no job_source_files rows): isMultiSource=false, hasReadyResultFiles=false', async () => {
    mockFrom.mockReturnValueOnce(chain({ count: 0 })); // job_source_files count
    const result = await getResultFilesStatus('job-1', 'electronic');
    expect(result).toEqual({ isMultiSource: false, hasReadyResultFiles: false, readyFiles: [] });
  });

  it('multi-source Official: fully covered signature_stamp rows → ready, sorted by min sequence', async () => {
    mockFrom
      .mockReturnValueOnce(chain({ count: 2 })) // job_source_files count
      .mockReturnValueOnce(chain({
        data: [
          { stage: 'signature_stamp', source_sequences: [2], filename: '002_SIGNED.pdf', r2_key: 'k2' },
          { stage: 'signature_stamp', source_sequences: [1], filename: '001_SIGNED.pdf', r2_key: 'k1' },
        ],
      }));

    const result = await getResultFilesStatus('job-1', 'official_with_translator_signature_and_provider_stamp');
    expect(result.isMultiSource).toBe(true);
    expect(result.hasReadyResultFiles).toBe(true);
    expect(result.readyFiles.map((f) => f.filename)).toEqual(['001_SIGNED.pdf', '002_SIGNED.pdf']);
  });

  it('multi-source Notary: incomplete coverage (gap) → not ready', async () => {
    mockFrom
      .mockReturnValueOnce(chain({ count: 3 }))
      .mockReturnValueOnce(chain({
        data: [
          { stage: 'notary', source_sequences: [1], filename: '001_NOTARY.pdf', r2_key: 'k1' },
          // sequence 2 missing
          { stage: 'notary', source_sequences: [3], filename: '003_NOTARY.pdf', r2_key: 'k3' },
        ],
      }));

    const result = await getResultFilesStatus('job-1', 'notarization_through_partners');
    expect(result).toEqual({ isMultiSource: true, hasReadyResultFiles: false, readyFiles: [] });
  });

  it('multi-source Electronic: matches whichever of electronic_final_pdf/docx/html has rows', async () => {
    mockFrom
      .mockReturnValueOnce(chain({ count: 1 }))
      .mockReturnValueOnce(chain({
        data: [{ stage: 'electronic_final_docx', source_sequences: [1], filename: 'a_translated.docx', r2_key: 'k1' }],
      }));

    const result = await getResultFilesStatus('job-1', 'electronic');
    expect(result.hasReadyResultFiles).toBe(true);
    expect(result.readyFiles).toEqual([{ sequenceMin: 1, sourceSequences: [1], filename: 'a_translated.docx', r2Key: 'k1' }]);
  });

  it('a row with a null r2_key is never treated as ready, even if the sequence coverage looks complete', async () => {
    mockFrom
      .mockReturnValueOnce(chain({ count: 2 }))
      .mockReturnValueOnce(chain({
        data: [
          { stage: 'notary', source_sequences: [1], filename: '001_NOTARY.pdf', r2_key: 'k1' },
          { stage: 'notary', source_sequences: [2], filename: '002_NOTARY.pdf', r2_key: null }, // not yet re-hosted
        ],
      }));

    const result = await getResultFilesStatus('job-1', 'notarization_through_partners');
    expect(result.hasReadyResultFiles).toBe(false);
    expect(result.readyFiles).toEqual([]);
  });

  it('no rows at all for the relevant stage → not ready', async () => {
    mockFrom
      .mockReturnValueOnce(chain({ count: 1 }))
      .mockReturnValueOnce(chain({ data: [] }));

    const result = await getResultFilesStatus('job-1', 'notarization_through_partners');
    expect(result).toEqual({ isMultiSource: true, hasReadyResultFiles: false, readyFiles: [] });
  });
});
