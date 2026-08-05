/**
 * WO-112 regression suite (2026-08-05 staging incident).
 *
 * Real scenario: notarized/pickup order, workflow_status=notarized, ready result
 * file already available (job_result_files stage='notary' fully covers all
 * sources) — but with no courier/pickup-confirmation event ever coming from Jira,
 * the dashboard stayed stuck at 90% in Active forever. Staff closed the Jira issue
 * ("Закрыто"), but Jira Automation had nothing to send except TRANSLATOR_COMPLETED
 * (the wrong event), which job_audit_log shows was correctly rejected:
 *   action=backward_transition_rejected, previous_status=notarized,
 *   new_status=assigned_to_notary, reason=backward_transition
 *
 * The fix is a dedicated eventType=ORDER_CLOSED (syncOrderClosed, workflow.ts) that
 * sets jobs.jira_closed_at WITHOUT touching workflow_status, plus a new
 * customerStatus='closed' that getCustomerOrderState()/progress-flow.ts/
 * isCompletedBadge() all treat as "100%, Готово, terminal" for every service level.
 * This file locks in the customer-facing side of that fix.
 */
import { getCustomerOrderState } from '../customer-order-state';
import { bucketOrders, type Bucketable } from '../order-buckets';
import { resolveDownloadAction } from '../download-action';
import { isCompletedBadge } from '../status-badge';

const NOTARY = 'notarization_through_partners';
const OFFICIAL = 'official_with_translator_signature_and_provider_stamp';

interface FakeOrder extends Bucketable {
  documentId: string;
  canDownload: boolean;
}

describe('WO-112: notarized/pickup, stuck at notarized (90%), before ORDER_CLOSED', () => {
  it('stays active at 90%, ready file already downloadable but the order never reaches "done"', () => {
    const state = getCustomerOrderState({
      jobStatus: 'completed', progressPercent: 100, workflowStatus: 'notarized', serviceLevel: NOTARY,
      fulfillmentMethod: 'pickup', hasReadyResultFiles: true,
    });
    expect(state.progressPercent).toBe(90);
    expect(state.isTerminal).toBe(false);
    expect(state.isActive).toBe(true);
    expect(state.canDownload).toBe(true); // already worked — WO-112 was never a download bug
  });
});

describe('WO-112 fixed: after ORDER_CLOSED sets jira_closed_at', () => {
  function closedOrder(overrides: Partial<Parameters<typeof getCustomerOrderState>[0]> = {}) {
    return getCustomerOrderState({
      jobStatus: 'completed', progressPercent: 100, workflowStatus: 'notarized', serviceLevel: NOTARY,
      fulfillmentMethod: 'pickup', hasReadyResultFiles: true, isClosed: true,
      ...overrides,
    });
  }

  it('100%, "Готово", terminal', () => {
    const state = closedOrder();
    expect(state.progressPercent).toBe(100);
    expect(state.customerStatus).toBe('closed');
    expect(state.isTerminal).toBe(true);
    expect(isCompletedBadge(state.customerStatus, NOTARY)).toBe(true);
  });

  it('moves to history (isActive=false), not pinned in the active section', () => {
    const state = closedOrder();
    const order: FakeOrder = { documentId: 'wo-112-doc', isActive: state.isActive, isTerminal: state.isTerminal, canDownload: state.canDownload };
    const { historyOrders, activeOrders, readyOrders } = bucketOrders([order]);
    expect(historyOrders).toContainEqual(order);
    expect(activeOrders).not.toContainEqual(order);
    expect(readyOrders).not.toContainEqual(order);
  });

  it('the ready notary file stays downloadable — closing the order never revokes an existing download', () => {
    const state = closedOrder();
    expect(state.canDownload).toBe(true);
    const order = { documentId: 'wo-112-doc', canDownload: state.canDownload };
    expect(resolveDownloadAction(order)).toEqual({ visible: true, href: '/api/documents/wo-112-doc/download' });
  });

  it('workflow_status is preserved as "notarized" throughout — getCustomerOrderState never overwrites it, only customerStatus changes', () => {
    // workflowStatus is an INPUT here (mirrors what the DB row actually holds after
    // ORDER_CLOSED — syncOrderClosed never touches it), not something the resolver
    // could have silently changed; this test documents that the caller must keep
    // passing the real, unmodified 'notarized' value.
    const state = closedOrder({ workflowStatus: 'notarized' });
    expect(state.customerStatus).toBe('closed');
    expect(state.progressPercent).toBe(100);
  });

  it('Official translator_approved + ORDER_CLOSED: also 100%, "Готово", downloadable once ready', () => {
    const state = closedOrder({ serviceLevel: OFFICIAL, workflowStatus: 'translator_approved', fulfillmentMethod: undefined });
    expect(state.progressPercent).toBe(100);
    expect(isCompletedBadge(state.customerStatus, OFFICIAL)).toBe(true);
    expect(state.canDownload).toBe(true);
  });

  it('Electronic + ORDER_CLOSED: also 100%, "Готово", downloadable', () => {
    const state = getCustomerOrderState({
      jobStatus: 'completed', progressPercent: 100, workflowStatus: null, serviceLevel: 'electronic', isClosed: true,
    });
    expect(state.progressPercent).toBe(100);
    expect(isCompletedBadge(state.customerStatus, 'electronic')).toBe(true);
    expect(state.canDownload).toBe(true);
  });
});

describe('WO-112: repeat ORDER_CLOSED is idempotent at the customer-projection level', () => {
  it('calling getCustomerOrderState twice with isClosed=true produces an identical result', () => {
    const input = {
      jobStatus: 'completed' as const, progressPercent: 100, workflowStatus: 'notarized', serviceLevel: NOTARY,
      fulfillmentMethod: 'pickup' as const, hasReadyResultFiles: true, isClosed: true,
    };
    expect(getCustomerOrderState(input)).toEqual(getCustomerOrderState({ ...input }));
  });
});
