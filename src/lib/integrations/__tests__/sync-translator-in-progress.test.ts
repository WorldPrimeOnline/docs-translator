/**
 * Tests for syncTranslatorInProgress() — Jira status "В работе у переводчика"
 * (2026-08-04). Sets jobs.workflow_status = 'translator_review_in_progress', forward
 * -only (WORKFLOW_RANK: awaiting_translator_review=1 < translator_review_in_progress=2
 * < translator_approved=3), via the same safeUpdateWorkflowStatus() guard every other
 * Jira reverse-sync function already uses.
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
import { syncTranslatorInProgress } from '../workflow';

const mockFrom = supabaseServer.from as jest.Mock;

function chain(result: { data?: unknown; error?: unknown }) {
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

describe('syncTranslatorInProgress', () => {
  it('applies the transition from awaiting_translator_review (rank 1) -> translator_review_in_progress (rank 2)', async () => {
    const selectChain = chain({ data: { workflow_status: 'awaiting_translator_review' }, error: null });
    const updateChain = chain({ error: null });
    const auditChain = chain({ error: null });
    mockFrom
      .mockReturnValueOnce(selectChain) // safeUpdateWorkflowStatus: select current workflow_status
      .mockReturnValueOnce(updateChain) // safeUpdateWorkflowStatus: update jobs
      .mockReturnValueOnce(auditChain); // syncTranslatorInProgress: audit insert

    const result = await syncTranslatorInProgress({ jobId: 'job-1', jiraIssueKey: 'WO-1' });

    expect(result.applied).toBe(true);
    expect(updateChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ workflow_status: 'translator_review_in_progress', jira_sync_status: 'translator_review_in_progress' }),
    );
  });

  it('applies from a null workflow_status (job just left AI processing)', async () => {
    const selectChain = chain({ data: { workflow_status: null }, error: null });
    const updateChain = chain({ error: null });
    const auditChain = chain({ error: null });
    mockFrom.mockReturnValueOnce(selectChain).mockReturnValueOnce(updateChain).mockReturnValueOnce(auditChain);

    const result = await syncTranslatorInProgress({ jobId: 'job-1', jiraIssueKey: 'WO-1' });
    expect(result.applied).toBe(true);
  });

  it('rejects a backward transition — job already at translator_approved (rank 3)', async () => {
    const selectChain = chain({ data: { workflow_status: 'translator_approved' }, error: null });
    const rejectionAuditChain = chain({ error: null });
    mockFrom
      .mockReturnValueOnce(selectChain)         // safeUpdateWorkflowStatus: select current workflow_status
      .mockReturnValueOnce(rejectionAuditChain); // safeUpdateWorkflowStatus: backward_transition_rejected audit

    const result = await syncTranslatorInProgress({ jobId: 'job-1', jiraIssueKey: 'WO-1' });

    expect(result.applied).toBe(false);
    // Never reaches the jobs UPDATE — only 2 supabaseServer.from() calls total.
    expect(mockFrom).toHaveBeenCalledTimes(2);
  });

  it('a repeat delivery at the SAME status (translator_review_in_progress -> translator_review_in_progress) is a harmless idempotent no-op re-write, not rejected', async () => {
    const selectChain = chain({ data: { workflow_status: 'translator_review_in_progress' }, error: null });
    const updateChain = chain({ error: null });
    const auditChain = chain({ error: null });
    mockFrom.mockReturnValueOnce(selectChain).mockReturnValueOnce(updateChain).mockReturnValueOnce(auditChain);

    const result = await syncTranslatorInProgress({ jobId: 'job-1', jiraIssueKey: 'WO-1' });
    expect(result.applied).toBe(true);
  });
});
