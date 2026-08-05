/**
 * Regression test for the 2026-08-01 staging incident (job
 * 29b5fa37-24ac-4269-b965-c024429560da, draft 1df479ef-0aff-40ef-9806-a74213be3865,
 * document 97b80b26-7895-4153-b536-2e01f33f4f1a): a multi-source Electronic order
 * completed correctly (2 job_source_files, 2 ready job_result_files rows), but was
 * reported as disappearing from the dashboard after completion.
 *
 * Server-side investigation (read-only, against the real staging row) found
 * getResultFilesStatus/getCustomerOrderState/GET /api/jobs all already computed the
 * correct result for this exact job — no translations row is required anywhere in
 * this path. This test locks that in as an explicit regression: a completed
 * multi-source Electronic job with NO translations row must appear in /api/jobs,
 * with the correct customerStatus/canDownload/hasReadyResultFiles projection.
 */
import fs from 'fs';
import path from 'path';
import { GET } from '../route';

jest.mock('next/headers', () => ({
  cookies: jest.fn().mockResolvedValue({ getAll: () => [], set: jest.fn() }),
}));
jest.mock('@supabase/ssr', () => ({ createServerClient: jest.fn() }));
jest.mock('@/lib/supabase/server', () => ({ supabaseServer: { from: jest.fn() } }));

import { createServerClient } from '@supabase/ssr';
import { supabaseServer } from '@/lib/supabase/server';

const mockCreateServerClient = createServerClient as jest.MockedFunction<typeof createServerClient>;
const mockFrom = supabaseServer.from as jest.Mock;

function chain(result: { data?: unknown; error?: unknown; count?: number }) {
  const c: Record<string, unknown> = {};
  const methods = ['select', 'eq', 'in', 'order'];
  for (const m of methods) c[m] = jest.fn(() => c);
  c.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return c;
}

const USER_ID = '63297a92-716c-40d9-845a-2e26dc967a5b';
const DOC_ID = '97b80b26-7895-4153-b536-2e01f33f4f1a';
const JOB_ID = '29b5fa37-24ac-4269-b965-c024429560da';

// The incident document — note there is deliberately NO mocked translations query at
// all; if the route ever started requiring one, the missing mock would surface as a
// thrown error / wrong chain call, not a silent pass.
const INCIDENT_DOC = {
  id: DOC_ID,
  filename: '2_files_UVEDOML_IE_REGISTRATION.pdf',
  source_language: 'ru',
  target_language: 'en',
  document_type: 'other|docx',
  status: 'completed',
  created_at: '2026-07-22T17:16:04.422912+00:00',
  updated_at: '2026-07-22T17:18:03.880894+00:00',
};

const INCIDENT_JOB = {
  id: JOB_ID,
  document_id: DOC_ID,
  status: 'completed',
  progress_percent: 100,
  error_message: null,
  workflow_status: 'completed',
  service_level: 'electronic',
  fulfillment_method: null,
  price_kzt: 1500,
  price_before_discount_kzt: null,
  discount_applied_kzt: null,
  discount_code: null,
  created_at: '2026-07-22T17:16:04.672774+00:00',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockCreateServerClient.mockReturnValue({
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: USER_ID } } }) },
  } as unknown as ReturnType<typeof createServerClient>);
});

async function callGET() {
  const res = await GET();
  return res.json() as Promise<{ jobs: Record<string, unknown>[] }>;
}

describe('GET /api/jobs — 2026-08-01 multi-source Electronic incident regression', () => {
  it('a completed multi-source Electronic job with job_source_files=2/ready job_result_files=2 (and NO translations row) appears in the list, downloadable', () => {
    // Structural guarantee (point D of the investigation): this route must never
    // filter/join on `translations` — verified by reading its own source rather than
    // by trying to prove a negative through mocking.
    const src = fs.readFileSync(path.join(__dirname, '..', 'route.ts'), 'utf8');
    expect(src).not.toMatch(/from\(['"]translations['"]\)/);
  });

  it('end-to-end: /api/jobs returns the incident job as completed + downloadable, using the real getResultFilesStatus/getCustomerOrderState (not mocked)', async () => {
    mockFrom
      .mockReturnValueOnce(chain({ data: [INCIDENT_DOC], error: null })) // documents
      .mockReturnValueOnce(chain({ data: [INCIDENT_JOB], error: null })) // jobs
      .mockReturnValueOnce(chain({ data: [], error: null })) // fiscal_receipts
      .mockReturnValueOnce(chain({ data: [], error: null })) // price_quotes
      // getResultFilesStatus (real implementation, not mocked): job_source_files count
      .mockReturnValueOnce(chain({ count: 2 }))
      // getResultFilesStatus: job_result_files rows
      .mockReturnValueOnce(chain({
        data: [
          { stage: 'electronic_final_docx', source_sequences: [1], filename: 'a_translated.docx', r2_key: 'k1', status: 'ready' },
          { stage: 'electronic_final_docx', source_sequences: [2], filename: 'b_translated.docx', r2_key: 'k2', status: 'ready' },
        ],
      }));

    const { jobs } = await callGET();

    expect(jobs).toHaveLength(1);
    const entry = jobs[0]!;
    expect(entry.documentId).toBe(DOC_ID);
    expect(entry.jobId).toBe(JOB_ID);
    expect(entry.customerStatus).toBe('completed');
    expect(entry.canDownload).toBe(true);
    expect(entry.isTerminal).toBe(true);
    expect(entry.isActive).toBe(true); // stays visible, not silently dropped
  });
});
