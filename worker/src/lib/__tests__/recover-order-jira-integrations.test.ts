/**
 * @jest-environment node
 *
 * Tests for the generic order recovery logic
 * (worker/src/lib/jira-order-recovery.ts, driven by scripts/prod/2026-07-15_
 * recover-order-jira-integrations.ts). Generalized from the WO-77-specific
 * recover-wo77-recovery.test.ts after the same tool was needed for WO-78 —
 * no order-specific values are hardcoded in the tests either.
 *
 * Pure dependency-injection tests: runRecovery() takes a `deps` object of
 * fakes, so these never touch worker/src/lib/env.ts, real Supabase, or real
 * Jira — no jest module mocks needed.
 */
import { runRecovery, resolveJobId, type RecoveryDeps, type JiraFieldRead, type BackfillOutcome } from '../jira-order-recovery';
import type { JiraSearchOutcome } from '../jira/search';

const APPLICATION_ID = '34c19be3-f501-4c24-894f-e46d22c229d9';

interface FakeState {
  jobId: string;
  jiraIssueKey: string | null;
  serviceLevel: string;
  paymentSource: string | null;
  paid: boolean;
  referralPartnerId: string | null;
  partnerApplicationId: string | null;
  jiraCustomField10121: string | null;
  jobsPriceJiraIssueKey: string | null;
  jiraSearchResult: JiraSearchOutcome;
  createPriceBreakdownIssueResult: string | null;
  priceBreakdownEnabled: boolean;
  /** jira_issue_key -> job id, used only for the --issue-key lookup path */
  issueKeyToJobId: Record<string, string>;
}

function baseState(overrides: Partial<FakeState> = {}): FakeState {
  return {
    jobId: 'job-78',
    jiraIssueKey: 'WO-78',
    serviceLevel: 'notarization_through_partners',
    paymentSource: 'card_payment',
    paid: true,
    referralPartnerId: 'partner-1',
    partnerApplicationId: APPLICATION_ID,
    jiraCustomField10121: null,
    jobsPriceJiraIssueKey: null,
    jiraSearchResult: { ok: true, issues: [], endpoint: '/search/jql', httpStatus: 200 },
    createPriceBreakdownIssueResult: 'WO-100',
    priceBreakdownEnabled: true,
    issueKeyToJobId: { 'WO-78': 'job-78' },
    ...overrides,
  };
}

interface Calls {
  jiraGetCalls: string[];
  backfillCalls: Array<{ issueKey: string; patch: unknown }>;
  createPriceBreakdownCalls: unknown[];
  searchCalls: number;
  jobUpdates: Record<string, unknown>[];
  auditInserts: Record<string, unknown>[];
}

function makeDeps(state: FakeState): { deps: RecoveryDeps; calls: Calls } {
  const calls: Calls = {
    jiraGetCalls: [],
    backfillCalls: [],
    createPriceBreakdownCalls: [],
    searchCalls: 0,
    jobUpdates: [],
    auditInserts: [],
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db: any = {
    from(table: string) {
      return {
        select() {
          return {
            eq(col: string, val: string) {
              return {
                in: () => ({
                  maybeSingle: async () => (table === 'payment_transactions'
                    ? { data: state.paid ? { status: 'paid' } : null, error: null }
                    : { data: null, error: null }),
                }),
                maybeSingle: async () => {
                  if (table === 'jobs' && col === 'jira_issue_key') {
                    const jobId = state.issueKeyToJobId[val];
                    return { data: jobId ? { id: jobId } : null, error: null };
                  }
                  if (table === 'jobs') {
                    return {
                      data: {
                        id: state.jobId,
                        jira_issue_key: state.jiraIssueKey,
                        service_level: state.serviceLevel,
                        payment_source: state.paymentSource,
                        document_id: 'doc-1',
                        price_jira_issue_key: state.jobsPriceJiraIssueKey,
                      },
                      error: null,
                    };
                  }
                  if (table === 'partner_referrals') {
                    return { data: state.referralPartnerId ? { partner_id: state.referralPartnerId } : null, error: null };
                  }
                  if (table === 'partners') {
                    return { data: state.partnerApplicationId ? { application_id: state.partnerApplicationId } : null, error: null };
                  }
                  if (table === 'documents') {
                    return { data: { source_language: 'ru', target_language: 'en', document_type: 'passport_id|docx' }, error: null };
                  }
                  return { data: null, error: null };
                },
              };
            },
          };
        },
        update(payload: Record<string, unknown>) {
          calls.jobUpdates.push(payload);
          return { eq: async () => ({ data: null, error: null }) };
        },
        insert: async (payload: Record<string, unknown>) => {
          calls.auditInserts.push(payload);
          return { data: null, error: null };
        },
      };
    },
  };

  const deps: RecoveryDeps = {
    db,
    jiraGet: async (issueKey: string): Promise<JiraFieldRead> => {
      calls.jiraGetCalls.push(issueKey);
      return { ok: true, status: 200, fields: { customfield_10121: state.jiraCustomField10121 } };
    },
    jiraFetchThrowing: () => { throw new Error('not used directly in tests'); },
    getPartnerApplicationId: async () => state.partnerApplicationId,
    backfillJiraOrderFields: async (issueKey: string, patch: { partnerApplicationId?: string | null }): Promise<BackfillOutcome> => {
      calls.backfillCalls.push({ issueKey, patch });
      if (patch.partnerApplicationId) {
        state.jiraCustomField10121 = patch.partnerApplicationId;
        return { ok: true, updatedFields: ['partnerApplicationId'], skippedFields: [] };
      }
      return { ok: true, updatedFields: [], skippedFields: ['partnerApplicationId (no value)'] };
    },
    searchJiraIssuesByJql: async () => {
      calls.searchCalls += 1;
      return state.jiraSearchResult;
    },
    createPriceBreakdownIssue: async () => {
      calls.createPriceBreakdownCalls.push('called');
      return state.createPriceBreakdownIssueResult;
    },
    getPriceBreakdownConfig: () => ({ enabled: state.priceBreakdownEnabled, projectKey: 'WO', labels: ['wpo-price-breakdown'] }),
    buildPriceBreakdownSummary: (mainIssueKey: string) => `Price Breakdown for ${mainIssueKey}`,
  };

  return { deps, calls };
}

describe('resolveJobId', () => {
  it('resolves a job id from --issue-key', async () => {
    const state = baseState();
    const { deps } = makeDeps(state);
    const result = await resolveJobId({ issueKey: 'WO-78' }, deps.db);
    expect(result).toEqual({ ok: true, jobId: 'job-78' });
  });

  it('passes --job-id straight through', async () => {
    const state = baseState();
    const { deps } = makeDeps(state);
    const result = await resolveJobId({ jobId: 'job-78' }, deps.db);
    expect(result).toEqual({ ok: true, jobId: 'job-78' });
  });

  it('rejects an unknown issue key', async () => {
    const state = baseState();
    const { deps } = makeDeps(state);
    const result = await resolveJobId({ issueKey: 'WO-999' }, deps.db);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/no job found/);
  });

  it('rejects when both --issue-key and --job-id are given', async () => {
    const state = baseState();
    const { deps } = makeDeps(state);
    const result = await resolveJobId({ issueKey: 'WO-78', jobId: 'job-78' }, deps.db);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/not both/);
  });

  it('rejects when neither is given', async () => {
    const state = baseState();
    const { deps } = makeDeps(state);
    const result = await resolveJobId({}, deps.db);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/must provide/);
  });
});

describe('runRecovery — generic, any order', () => {
  it('resolves via --issue-key end-to-end (WO-78, both empty) and recovers both', async () => {
    const state = baseState({
      jiraIssueKey: 'WO-78',
      jiraCustomField10121: null,
      jobsPriceJiraIssueKey: null,
      jiraSearchResult: { ok: true, issues: [], endpoint: '/search/jql', httpStatus: 200 },
      createPriceBreakdownIssueResult: 'WO-100',
    });
    const { deps } = makeDeps(state);

    const result = await runRecovery({ issueKey: 'WO-78' }, true, deps);

    expect(result.jobId).toBe('job-78');
    expect(result.jiraIssueKey).toBe('WO-78');
    expect(result.hardStop).toBeNull();
    expect(result.partnerId.action).toBe('RECOVERED');
    expect(result.partnerId.after).toBe(APPLICATION_ID);
    expect(result.priceBreakdown.action).toBe('CREATED');
    expect(result.priceBreakdown.after).toBe('WO-100');
  });

  it('already-recovered order → full NO_OP, zero writes', async () => {
    const state = baseState({ jiraCustomField10121: APPLICATION_ID, jobsPriceJiraIssueKey: 'WO-90' });
    const { deps, calls } = makeDeps(state);

    const result = await runRecovery({ jobId: 'job-78' }, true, deps);

    expect(result.partnerId.action).toBe('NO_OP');
    expect(result.priceBreakdown.action).toBe('NO_OP');
    expect(calls.jobUpdates.length).toBe(0);
    expect(calls.auditInserts.length).toBe(0);
  });

  it('order with no referral → hard-stop on Partner ID, Price Breakdown still evaluated independently', async () => {
    const state = baseState({ referralPartnerId: null, jobsPriceJiraIssueKey: 'WO-90' });
    const { deps } = makeDeps(state);

    const result = await runRecovery({ jobId: 'job-78' }, true, deps);

    expect(result.partnerId.action).toBe('FAILED');
    expect(result.partnerId.detail).toMatch(/no partner_referrals row/);
    expect(result.priceBreakdown.action).toBe('NO_OP'); // independent of Partner ID's hard-stop
  });

  it('electronic order → job-level hard-stop, neither check attempted', async () => {
    const state = baseState({ serviceLevel: 'electronic' });
    const { deps } = makeDeps(state);

    const result = await runRecovery({ jobId: 'job-78' }, true, deps);

    expect(result.hardStop).toMatch(/electronic/);
    expect(result.partnerId.action).toBe('FAILED');
    expect(result.priceBreakdown.action).toBe('FAILED');
  });

  it('Jira search failure → Price Breakdown hard-stops, never creates', async () => {
    const state = baseState({
      jiraCustomField10121: APPLICATION_ID,
      jobsPriceJiraIssueKey: null,
      jiraSearchResult: { ok: false, error: 'Jira search failed: 500', endpoint: '/search/jql', httpStatus: 500 },
    });
    const { deps, calls } = makeDeps(state);

    const result = await runRecovery({ jobId: 'job-78' }, true, deps);

    expect(result.priceBreakdown.action).toBe('FAILED');
    expect(result.priceBreakdown.detail).toMatch(/hard-stop/);
    expect(calls.createPriceBreakdownCalls.length).toBe(0);
  });

  it('unknown issue key → hard-stop before any table other than jobs is touched', async () => {
    const state = baseState();
    const { deps } = makeDeps(state);

    const result = await runRecovery({ issueKey: 'WO-DOES-NOT-EXIST' }, true, deps);

    expect(result.hardStop).toMatch(/no job found/);
    expect(result.jobId).toBeNull();
    expect(result.partnerId.action).toBe('FAILED');
    expect(result.priceBreakdown.action).toBe('FAILED');
  });

  it('both --issue-key and --job-id given → validation error, hard-stop', async () => {
    const state = baseState();
    const { deps } = makeDeps(state);

    const result = await runRecovery({ issueKey: 'WO-78', jobId: 'job-78' }, true, deps);

    expect(result.hardStop).toMatch(/not both/);
  });

  it('application_id not on file for the referring partner → hard-stop, no write', async () => {
    const state = baseState({ partnerApplicationId: null, jiraCustomField10121: null });
    const { deps, calls } = makeDeps(state);

    const result = await runRecovery({ jobId: 'job-78' }, true, deps);

    expect(result.partnerId.action).toBe('FAILED');
    expect(result.partnerId.detail).toMatch(/application_id is not on file/);
    expect(calls.backfillCalls.length).toBe(0);
  });

  it('dry run performs no writes even when both would be recoverable', async () => {
    const state = baseState({
      jiraCustomField10121: null,
      jobsPriceJiraIssueKey: null,
      jiraSearchResult: { ok: true, issues: [], endpoint: '/search/jql', httpStatus: 200 },
    });
    const { deps, calls } = makeDeps(state);

    const result = await runRecovery({ jobId: 'job-78' }, false, deps);

    expect(result.partnerId.detail).toMatch(/dry-run/);
    expect(result.priceBreakdown.detail).toMatch(/dry-run/);
    expect(calls.jobUpdates.length).toBe(0);
    expect(calls.auditInserts.length).toBe(0);
    expect(calls.backfillCalls.length).toBe(0);
  });

  it('rerun after a successful recovery → NO_OP on both, idempotent', async () => {
    const state = baseState({
      jiraCustomField10121: null,
      jobsPriceJiraIssueKey: null,
      jiraSearchResult: { ok: true, issues: [], endpoint: '/search/jql', httpStatus: 200 },
      createPriceBreakdownIssueResult: 'WO-100',
    });
    const { deps } = makeDeps(state);

    const first = await runRecovery({ jobId: 'job-78' }, true, deps);
    expect(first.partnerId.action).toBe('RECOVERED');
    expect(first.priceBreakdown.action).toBe('CREATED');

    const state2 = baseState({ jiraCustomField10121: APPLICATION_ID, jobsPriceJiraIssueKey: 'WO-100' });
    const { deps: deps2, calls: calls2 } = makeDeps(state2);

    const second = await runRecovery({ jobId: 'job-78' }, true, deps2);

    expect(second.partnerId.action).toBe('NO_OP');
    expect(second.priceBreakdown.action).toBe('NO_OP');
    expect(calls2.jobUpdates.length).toBe(0);
    expect(calls2.auditInserts.length).toBe(0);
  });
});
