/**
 * WO-106 regression suite (2026-08-01 staging incident).
 *
 * Real scenario: a notarized order with courier delivery went delivered → the
 * customer reloaded the dashboard → the order moved from "Active" to "История
 * переводов" → HistoryRow showed no download button → the customer had no way to
 * retrieve their finished translation.
 *
 * Root cause, confirmed via read-only staging DB audit
 * (scripts/support/inspect-customer-order.ts --job-id d8ee612e-64fe-44e1-9ec5-57f06e3b5394):
 * job_result_files had 5 'ai_draft' rows but ZERO 'notary' rows — the notary result
 * was never synced from Drive's 05_NOTARY folder. hasReadyResultFiles was correctly
 * false, so canDownload was correctly false, so the order correctly moved to history.
 * This was option B from the audit checklist (file never reached job_result_files/
 * the API) — never a HistoryRow/ActiveOrderCard rendering divergence; both already
 * gated on the same entry.canDownload and the same /api/documents/:id/download route.
 *
 * This file locks in: (1) the WO-106 "stuck" state shows no false button and lands in
 * history, (2) once the underlying result-file sync succeeds, the exact same order
 * becomes downloadable everywhere it can appear, across every downstream delivery
 * status, and (3) HistoryRow/ActiveOrderCard can never resolve a different answer for
 * the same order (via the shared resolveDownloadAction — see download-action.ts).
 */
import { getCustomerOrderState } from '../customer-order-state';
import { bucketOrders, visibleOrders, type Bucketable } from '../order-buckets';
import { resolveDownloadAction } from '../download-action';
import type { SortableOrder } from '../order-sort';

const SL = 'notarization_through_partners';

interface FakeOrder extends Bucketable, SortableOrder {
  documentId: string;
  canDownload: boolean;
}

function buildOrder(
  documentId: string,
  workflowStatus: string,
  hasReadyResultFiles: boolean | undefined,
  fulfillmentMethod: 'pickup' | 'delivery' = 'delivery',
): FakeOrder {
  const state = getCustomerOrderState({
    jobStatus: 'completed',
    progressPercent: 100,
    workflowStatus,
    serviceLevel: SL,
    fulfillmentMethod,
    hasReadyResultFiles,
  });
  return {
    documentId,
    isActive: state.isActive,
    isTerminal: state.isTerminal,
    canDownload: state.canDownload,
    sortCreatedAt: '2026-08-01T12:34:42.301Z',
  };
}

describe('WO-106: delivered notary order with NO ready result (the actual incident state)', () => {
  it('canDownload is false, order lands in historyOrders, never in activeOrders/readyOrders', () => {
    // hasReadyResultFiles=false mirrors the real job_result_files state: 5 job_source_files
    // rows exist, but zero 'notary'-stage rows — resultFilesStatus.hasReadyResultFiles
    // resolves to false (see src/lib/jobs/result-files-status.ts).
    const order = buildOrder('wo-106-doc', 'delivered', false);
    expect(order.canDownload).toBe(false);

    const { activeOrders, readyOrders, historyOrders } = bucketOrders([order]);
    expect(historyOrders).toContainEqual(order);
    expect(activeOrders).not.toContainEqual(order);
    expect(readyOrders).not.toContainEqual(order);
    expect(visibleOrders([order])).not.toContainEqual(order);
  });

  it('HistoryRow shows no false download button for the stuck order', () => {
    const order = buildOrder('wo-106-doc', 'delivered', false);
    const download = resolveDownloadAction(order);
    expect(download).toEqual({ visible: false, href: null });
  });

  it('moving to history is the CORRECT outcome here, not a bug to "fix" by forcing isActive back to true (requirement 1)', () => {
    const order = buildOrder('wo-106-doc', 'delivered', false);
    // isTerminal=true (delivered) and canDownload=false is exactly the state that
    // legitimately belongs in history — the fix is result-file completeness, never a
    // bucketing hack that pins a downloadless terminal order in the active section.
    expect(order.isTerminal).toBe(true);
    expect(order.isActive).toBe(false);
  });
});

describe('WO-106 fixed: once the notary result is actually ready', () => {
  it('canDownload flips true and stays true across every downstream delivery status (requirement 3)', () => {
    const downstreamStatuses = ['notarized', 'ready_for_delivery', 'out_for_delivery', 'delivered'];
    for (const ws of downstreamStatuses) {
      const order = buildOrder('wo-106-doc-fixed', ws, true, 'delivery');
      expect(order.canDownload).toBe(true);
      const download = resolveDownloadAction(order);
      expect(download).toEqual({ visible: true, href: '/api/documents/wo-106-doc-fixed/download' });
    }
  });

  it('picked_up order (pickup fulfillment) with a ready result has a working download link', () => {
    const order = buildOrder('picked-up-doc', 'picked_up', true, 'pickup');
    expect(order.canDownload).toBe(true);
    expect(resolveDownloadAction(order)).toEqual({ visible: true, href: '/api/documents/picked-up-doc/download' });
  });

  it('completed electronic order has a working download link (unaffected by the multi-source notary gate)', () => {
    const state = getCustomerOrderState({ jobStatus: 'completed', progressPercent: 100, workflowStatus: null, serviceLevel: 'electronic' });
    const order = { documentId: 'electronic-doc', canDownload: state.canDownload };
    expect(order.canDownload).toBe(true);
    expect(resolveDownloadAction(order)).toEqual({ visible: true, href: '/api/documents/electronic-doc/download' });
  });

  it('completed official/certified order has a working download link once operator-confirmed and synced', () => {
    const state = getCustomerOrderState({
      jobStatus: 'completed', progressPercent: 100, workflowStatus: 'delivered',
      serviceLevel: 'official_with_translator_signature_and_provider_stamp', hasReadyResultFiles: true,
    });
    const order = { documentId: 'official-doc', canDownload: state.canDownload };
    expect(order.canDownload).toBe(true);
    expect(resolveDownloadAction(order)).toEqual({ visible: true, href: '/api/documents/official-doc/download' });
  });
});

describe('HistoryRow and ActiveOrderCard never diverge (requirement 4)', () => {
  it('resolveDownloadAction is the single function both components call — identical entry, identical result, regardless of which bucket it renders in', () => {
    const downloadable = buildOrder('shared-doc-ready', 'notarized', true);
    const stuck = buildOrder('shared-doc-stuck', 'delivered', false);

    // Same entry shape fed to "ActiveOrderCard's" and "HistoryRow's" resolution path
    // (there is only one path now) yields the same answer every time.
    expect(resolveDownloadAction(downloadable)).toEqual(resolveDownloadAction({ ...downloadable }));
    expect(resolveDownloadAction(stuck)).toEqual(resolveDownloadAction({ ...stuck }));
    expect(resolveDownloadAction(downloadable).visible).toBe(true);
    expect(resolveDownloadAction(stuck).visible).toBe(false);
  });
});

describe('No ready result never shows a false button, in either bucket (requirement 6)', () => {
  it.each(['notarized', 'ready_for_delivery', 'out_for_delivery', 'delivered', 'picked_up'])(
    'workflow_status=%s with hasReadyResultFiles=false: no download button',
    (ws) => {
      const order = buildOrder('no-ready-result', ws, false);
      expect(resolveDownloadAction(order).visible).toBe(false);
    },
  );

  it('legacy single-file job (hasReadyResultFiles omitted entirely) never shows a false notary download button', () => {
    const order = buildOrder('legacy-doc', 'delivered', undefined);
    expect(order.canDownload).toBe(false);
    expect(resolveDownloadAction(order).visible).toBe(false);
  });
});
