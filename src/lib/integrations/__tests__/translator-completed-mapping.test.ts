/**
 * WO-108 fix, requirement 3: TRANSLATOR_COMPLETED ("Перевод завершён") must map to a
 * DIFFERENT workflow_status depending on service level — never one shared mapping for
 * Official and Notary. This is already how the webhook route dispatches
 * (src/app/api/webhooks/jira/route.ts: notarization_through_partners ->
 * syncTranslatorDoneNotarized, everything else -> syncTranslatorDoneCertified) — this
 * file locks in that the two functions themselves write different terminal values,
 * and that the existing forward-only monotonic guard (safeUpdateWorkflowStatus,
 * WORKFLOW_RANK) still applies to both.
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
  // syncTranslatorDoneCertified calls this directly with .catch() (not via Promise.all
  // like syncTranslatorDoneNotarized does) — must return a real promise, or .catch()
  // throws on the bare jest.fn() default return value of undefined.
  notifyOperatorTranslatorDone: jest.fn(() => Promise.resolve()),
  notifyOperatorNotaryDone: jest.fn(() => Promise.resolve()),
  notifyOperatorError: jest.fn(() => Promise.resolve()),
}));

import { supabaseServer } from '../../supabase/server';
import { syncTranslatorDoneCertified, syncTranslatorDoneNotarized } from '../workflow';

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

describe('TRANSLATOR_COMPLETED mapping depends on service level', () => {
  it('Official (syncTranslatorDoneCertified) sets workflow_status=translator_approved', async () => {
    const selectChain = chain({ data: { workflow_status: 'translator_review_in_progress' }, error: null });
    const updateChain = chain({ error: null });
    const auditChain = chain({ error: null });
    mockFrom.mockReturnValueOnce(selectChain).mockReturnValueOnce(updateChain).mockReturnValueOnce(auditChain);

    const result = await syncTranslatorDoneCertified({ jobId: 'job-1', jiraIssueKey: 'WO-108' });

    expect(result.applied).toBe(true);
    expect(updateChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ workflow_status: 'translator_approved' }),
    );
  });

  it('Notary (syncTranslatorDoneNotarized) sets workflow_status=assigned_to_notary — a DIFFERENT value for the exact same real-world Jira event', async () => {
    const selectChain = chain({ data: { workflow_status: 'translator_review_in_progress' }, error: null });
    const updateChain = chain({ error: null });
    const auditChain = chain({ error: null });
    mockFrom.mockReturnValueOnce(selectChain).mockReturnValueOnce(updateChain).mockReturnValueOnce(auditChain);

    const result = await syncTranslatorDoneNotarized({
      jobId: 'job-2', jiraIssueKey: 'WO-2', sourceLang: 'ru', targetLang: 'en',
    });

    expect(result.applied).toBe(true);
    expect(updateChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ workflow_status: 'assigned_to_notary' }),
    );
  });

  it('the two functions never write the same workflow_status value for TRANSLATOR_COMPLETED — the single-mapping bug the WO-108 requirement explicitly forbids', async () => {
    const officialUpdate = chain({ error: null });
    mockFrom
      .mockReturnValueOnce(chain({ data: { workflow_status: 'translator_review_in_progress' }, error: null }))
      .mockReturnValueOnce(officialUpdate)
      .mockReturnValueOnce(chain({ error: null }));
    await syncTranslatorDoneCertified({ jobId: 'job-1', jiraIssueKey: 'WO-108' });
    const officialStatus = (officialUpdate.update as jest.Mock).mock.calls[0]![0].workflow_status;

    jest.clearAllMocks();
    const notaryUpdate = chain({ error: null });
    mockFrom
      .mockReturnValueOnce(chain({ data: { workflow_status: 'translator_review_in_progress' }, error: null }))
      .mockReturnValueOnce(notaryUpdate)
      .mockReturnValueOnce(chain({ error: null }));
    await syncTranslatorDoneNotarized({ jobId: 'job-2', jiraIssueKey: 'WO-2', sourceLang: 'ru', targetLang: 'en' });
    const notaryStatus = (notaryUpdate.update as jest.Mock).mock.calls[0]![0].workflow_status;

    expect(officialStatus).not.toBe(notaryStatus);
  });

  it('forward transition: translator_review_in_progress (rank 2) -> translator_approved (rank 3) is applied, not rejected', async () => {
    const selectChain = chain({ data: { workflow_status: 'translator_review_in_progress' }, error: null });
    const updateChain = chain({ error: null });
    const auditChain = chain({ error: null });
    mockFrom.mockReturnValueOnce(selectChain).mockReturnValueOnce(updateChain).mockReturnValueOnce(auditChain);

    const result = await syncTranslatorDoneCertified({ jobId: 'job-1', jiraIssueKey: 'WO-108' });
    expect(result.applied).toBe(true);
  });

  it('backward transition guard is NOT broken by the WO-108 fix: a job already at ready_for_delivery (rank 6) rejects a TRANSLATOR_COMPLETED retry trying to set translator_approved (rank 3)', async () => {
    const selectChain = chain({ data: { workflow_status: 'ready_for_delivery' }, error: null });
    const rejectionAuditChain = chain({ error: null });
    mockFrom.mockReturnValueOnce(selectChain).mockReturnValueOnce(rejectionAuditChain);

    const result = await syncTranslatorDoneCertified({ jobId: 'job-1', jiraIssueKey: 'WO-108' });

    expect(result.applied).toBe(false);
    // Never reaches the jobs UPDATE — only the select + backward_transition_rejected audit.
    expect(mockFrom).toHaveBeenCalledTimes(2);
  });

  it('WO-112 exact scenario, unaffected by the WO-112 fix: a Notary job already at notarized (rank 5) still rejects a TRANSLATOR_COMPLETED retry trying to set assigned_to_notary (rank 3) — the guard was correct all along, ORDER_CLOSED is the real fix, not a guard change', async () => {
    const selectChain = chain({ data: { workflow_status: 'notarized' }, error: null });
    const rejectionAuditChain = chain({ error: null });
    mockFrom.mockReturnValueOnce(selectChain).mockReturnValueOnce(rejectionAuditChain);

    const result = await syncTranslatorDoneNotarized({
      jobId: 'job-wo112', jiraIssueKey: 'WO-112', sourceLang: 'ru', targetLang: 'en',
    });

    expect(result.applied).toBe(false);
    expect(mockFrom).toHaveBeenCalledTimes(2);
    const rejectionArg = (rejectionAuditChain.insert as jest.Mock).mock.calls[0]![0];
    expect(rejectionArg.action).toBe('backward_transition_rejected');
    expect(rejectionArg.previous_status).toBe('notarized');
  });
});
