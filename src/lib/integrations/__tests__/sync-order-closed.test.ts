/**
 * WO-112 fix: Jira status "Закрыто" (ORDER_CLOSED) is a terminal COMMAND, never
 * routed through safeUpdateWorkflowStatus's monotonic rank guard — it must mark the
 * order done from WHATEVER workflow_status it is currently at (notarized,
 * translator_approved, ...) WITHOUT changing that value. This is exactly the class
 * of event the real WO-112 incident needed: Jira Automation had nothing to send
 * except TRANSLATOR_COMPLETED (semantically wrong — "translator finished", not
 * "operator closed the order"), which the guard correctly rejected as backward once
 * workflow_status had already advanced past it.
 */
jest.mock('../../supabase/server', () => ({ supabaseServer: { from: jest.fn() } }));
jest.mock('../../jira/client', () => ({ createJiraIssue: jest.fn() }));
jest.mock('../../jira/config', () => ({ getJiraCredentials: jest.fn(() => null) }));
jest.mock('../../google-drive/client', () => ({ createOrderFolder: jest.fn(), uploadFileToDrive: jest.fn() }));
jest.mock('../../r2/client', () => ({ downloadFile: jest.fn() }));
jest.mock('../../telegram/client', () => ({
  notifyOperatorNewOrder: jest.fn(() => Promise.resolve()),
  notifyTranslatorNewAssignment: jest.fn(() => Promise.resolve()),
  notifyNotaryNewAssignment: jest.fn(() => Promise.resolve()),
  notifyOperatorTranslatorDone: jest.fn(() => Promise.resolve()),
  notifyOperatorNotaryDone: jest.fn(() => Promise.resolve()),
  notifyOperatorError: jest.fn(() => Promise.resolve()),
}));

import { supabaseServer } from '../../supabase/server';
import { syncOrderClosed } from '../workflow';

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

describe('syncOrderClosed', () => {
  it('sets jobs.status=completed and jira_closed_at, WITHOUT touching workflow_status at all — never even reads the current value', async () => {
    const updateChain = chain({ error: null });
    const auditChain = chain({ error: null });
    mockFrom.mockReturnValueOnce(updateChain).mockReturnValueOnce(auditChain);

    const result = await syncOrderClosed({ jobId: 'job-notarized', jiraIssueKey: 'WO-112' });

    expect(result.applied).toBe(true);
    const updateArg = (updateChain.update as jest.Mock).mock.calls[0]![0];
    expect(updateArg.status).toBe('completed');
    expect(typeof updateArg.jira_closed_at).toBe('string');
    expect(updateArg).not.toHaveProperty('workflow_status');

    // Exactly 2 supabase calls total: the update itself + the audit insert — no
    // select-current-workflow_status call at all, unlike every rank-guarded sync
    // function (syncDelivered/syncPickedUp/etc.), because this bypasses the guard
    // entirely by design.
    expect(mockFrom).toHaveBeenCalledTimes(2);
  });

  it('never goes through the monotonic rank guard: a job "at" the highest rank (delivered) still applies cleanly, with no backward_transition_rejected audit', async () => {
    const updateChain = chain({ error: null });
    const auditChain = chain({ error: null });
    mockFrom.mockReturnValueOnce(updateChain).mockReturnValueOnce(auditChain);

    const result = await syncOrderClosed({ jobId: 'job-1', jiraIssueKey: 'WO-1' });

    expect(result.applied).toBe(true);
    const auditArg = (auditChain.insert as jest.Mock).mock.calls[0]![0];
    expect(auditArg.action).toBe('order_closed');
    expect(auditArg.action).not.toBe('backward_transition_rejected');
  });

  it('idempotent: calling twice in a row for an already-closed job succeeds both times, re-writing the same terminal fields', async () => {
    const updateChain1 = chain({ error: null });
    const auditChain1 = chain({ error: null });
    mockFrom.mockReturnValueOnce(updateChain1).mockReturnValueOnce(auditChain1);
    const first = await syncOrderClosed({ jobId: 'job-1', jiraIssueKey: 'WO-1' });
    expect(first.applied).toBe(true);

    const updateChain2 = chain({ error: null });
    const auditChain2 = chain({ error: null });
    mockFrom.mockReturnValueOnce(updateChain2).mockReturnValueOnce(auditChain2);
    const second = await syncOrderClosed({ jobId: 'job-1', jiraIssueKey: 'WO-1' });
    expect(second.applied).toBe(true);

    expect((updateChain1.update as jest.Mock).mock.calls[0]![0].status).toBe('completed');
    expect((updateChain2.update as jest.Mock).mock.calls[0]![0].status).toBe('completed');
  });

  it('an exception during the update (e.g. network failure) surfaces as applied:false, not a thrown error out of syncOrderClosed', async () => {
    mockFrom.mockImplementationOnce(() => { throw new Error('connection lost'); });

    const result = await syncOrderClosed({ jobId: 'job-1', jiraIssueKey: 'WO-1' });
    expect(result.applied).toBe(false);
  });
});
