/**
 * Tests for syncDelivered()'s 2026-08-01 multi-file fulfillment addition: a
 * multi-source (job_source_files rows exist) notarized order only completes its
 * document once physical delivery is confirmed ("не завершать заказ до доставки") —
 * digital access itself already opened earlier via job_result_files being ready
 * (see customer-order-state.ts's hasReadyResultFiles). Legacy single-file jobs must
 * be completely unaffected — this is additive, scoped behavior only.
 */
jest.mock('../../supabase/server', () => ({ supabaseServer: { from: jest.fn() } }));
jest.mock('../../jira/client', () => ({ createJiraIssue: jest.fn() }));
jest.mock('../../jira/config', () => ({ getJiraCredentials: jest.fn(() => null) }));
jest.mock('../../google-drive/client', () => ({ createOrderFolder: jest.fn(), uploadFileToDrive: jest.fn() }));
jest.mock('../../r2/client', () => ({ downloadFile: jest.fn() }));
jest.mock('../../telegram/client', () => ({
  notifyOperatorNewOrder: jest.fn(),
  notifyTranslatorNewAssignment: jest.fn(),
  notifyNotaryNewAssignment: jest.fn(),
  notifyOperatorTranslatorDone: jest.fn(),
  notifyOperatorNotaryDone: jest.fn(),
  notifyOperatorError: jest.fn(),
}));

import { supabaseServer } from '../../supabase/server';
import { syncDelivered } from '../workflow';

const mockFrom = supabaseServer.from as jest.Mock;

function chain(result: { data?: unknown; error?: unknown; count?: number }) {
  const c: Record<string, unknown> = {};
  const methods = ['select', 'eq', 'update', 'insert'];
  for (const m of methods) c[m] = jest.fn(() => c);
  c.single = jest.fn(() => Promise.resolve(result));
  c.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return c;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('syncDelivered — multi-source notarized document completion', () => {
  it('multi-source notarized job: DELIVERED marks the document completed', async () => {
    const workflowUpdateChain = chain({ data: { workflow_status: 'out_for_delivery' }, error: null });
    const sourceCountChain = chain({ count: 2 });
    const jobLookupChain = chain({ data: { document_id: 'doc-1', service_level: 'notarization_through_partners' }, error: null });
    const docUpdateChain = chain({ error: null });
    const auditChain = chain({ error: null });

    mockFrom
      .mockReturnValueOnce(workflowUpdateChain) // safeUpdateWorkflowStatus: select current workflow_status
      .mockReturnValueOnce(workflowUpdateChain) // safeUpdateWorkflowStatus: update
      .mockReturnValueOnce(sourceCountChain)    // job_source_files count
      .mockReturnValueOnce(jobLookupChain)      // jobs: document_id + service_level
      .mockReturnValueOnce(docUpdateChain)      // documents: status update
      .mockReturnValueOnce(auditChain);         // job_audit_log insert

    const result = await syncDelivered({ jobId: 'job-1', jiraIssueKey: 'WO-1' });

    expect(result.applied).toBe(true);
    expect(docUpdateChain.update).toHaveBeenCalledWith({ status: 'completed' });
  });

  it('legacy notarized job (no job_source_files): documents.status is left untouched', async () => {
    const workflowUpdateChain = chain({ data: { workflow_status: 'out_for_delivery' }, error: null });
    const sourceCountChain = chain({ count: 0 });

    mockFrom
      .mockReturnValueOnce(workflowUpdateChain)
      .mockReturnValueOnce(workflowUpdateChain)
      .mockReturnValueOnce(sourceCountChain) // job_source_files count = 0 → early return, no further queries
      .mockReturnValueOnce(chain({ error: null })); // job_audit_log insert

    const result = await syncDelivered({ jobId: 'job-1', jiraIssueKey: 'WO-1' });

    expect(result.applied).toBe(true);
    // Only 4 .from() calls total: workflow select, workflow update, source count, audit —
    // no jobs/documents lookup for a legacy job.
    expect(mockFrom).toHaveBeenCalledTimes(4);
  });

  it('multi-source job that is NOT notarized (e.g. official/certified with delivery): documents.status untouched here (already released earlier by syncOrderReady)', async () => {
    const workflowUpdateChain = chain({ data: { workflow_status: 'out_for_delivery' }, error: null });
    const sourceCountChain = chain({ count: 2 });
    const jobLookupChain = chain({ data: { document_id: 'doc-1', service_level: 'official_with_translator_signature_and_provider_stamp' }, error: null });

    mockFrom
      .mockReturnValueOnce(workflowUpdateChain)
      .mockReturnValueOnce(workflowUpdateChain)
      .mockReturnValueOnce(sourceCountChain)
      .mockReturnValueOnce(jobLookupChain) // service_level check fails → early return
      .mockReturnValueOnce(chain({ error: null })); // audit

    const result = await syncDelivered({ jobId: 'job-1', jiraIssueKey: 'WO-1' });
    expect(result.applied).toBe(true);
    // 5 calls: workflow select/update, source count, jobs lookup, audit — no documents update.
    expect(mockFrom).toHaveBeenCalledTimes(5);
  });

  it('a completion-side-effect failure does not fail the DELIVERED sync itself (non-fatal)', async () => {
    const workflowUpdateChain = chain({ data: { workflow_status: 'out_for_delivery' }, error: null });

    mockFrom
      .mockReturnValueOnce(workflowUpdateChain)
      .mockReturnValueOnce(workflowUpdateChain)
      .mockImplementationOnce(() => { throw new Error('DB unavailable'); }) // job_source_files count throws
      .mockReturnValueOnce(chain({ error: null })); // audit still runs

    const result = await syncDelivered({ jobId: 'job-1', jiraIssueKey: 'WO-1' });
    expect(result.applied).toBe(true);
  });
});
