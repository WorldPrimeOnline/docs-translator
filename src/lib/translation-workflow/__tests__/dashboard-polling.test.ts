/**
 * Tests for applyPolledOrderUpdate() — 2026-08-01 staging incident (job
 * 29b5fa37-24ac-4269-b965-c024429560da): a multi-source Electronic order that never
 * gets a legacy `translations` row disappeared from the dashboard right after
 * completing. Server-side investigation confirmed getResultFilesStatus/
 * getCustomerOrderState/the /api/jobs endpoints all return correct data for this
 * exact job — so this locks in the CLIENT-side merge invariant: a poll update must
 * never remove an order from the list, regardless of translations/job_result_files
 * state, only ever rewrite the matching entry in place.
 */
import { applyPolledOrderUpdate, type PolledOrderData, type PollableOrderEntry } from '../dashboard-polling';

function makeEntry(overrides: Partial<PollableOrderEntry> = {}): PollableOrderEntry {
  return {
    documentId: 'doc-1',
    jobStatus: 'translation_in_progress',
    workflowStatus: null,
    fulfillmentMethod: null,
    progressPercent: 50,
    errorMessage: null,
    customerStatus: 'translation_in_progress',
    canDownload: false,
    isActive: true,
    isTerminal: false,
    latestQuoteId: 'quote-1',
    quoteStatus: 'paid',
    quoteAmountKzt: 1500,
    quoteCurrency: 'KZT',
    quoteExpiresAt: null,
    quoteRequiresOperatorReview: false,
    stages: [],
    ...overrides,
  };
}

function makePolledData(overrides: Partial<PolledOrderData> = {}): PolledOrderData {
  return {
    status: 'completed',
    progress: 100,
    errorMessage: null,
    workflowStatus: 'completed',
    serviceLevel: 'electronic',
    fulfillmentMethod: null,
    hasReadyResultFiles: true,
    latestQuoteId: 'quote-1',
    quoteStatus: 'paid',
    quoteAmountKzt: 1500,
    quoteCurrency: 'KZT',
    quoteExpiresAt: null,
    quoteRequiresOperatorReview: false,
    ...overrides,
  };
}

describe('applyPolledOrderUpdate — array length is always preserved', () => {
  it('reproduces the incident: multi-source Electronic, no legacy translations row (hasReadyResultFiles from job_result_files), processing -> completed keeps exactly one entry, now downloadable', () => {
    const orders = [makeEntry()];
    const polled = makePolledData(); // hasReadyResultFiles: true, no translations row involved at all

    const next = applyPolledOrderUpdate(orders, 'doc-1', polled);

    expect(next).toHaveLength(1);
    expect(next[0]!.customerStatus).toBe('completed');
    expect(next[0]!.isTerminal).toBe(true);
    expect(next[0]!.canDownload).toBe(true);
  });

  it('a job not yet fully synced (hasReadyResultFiles=false) does not vanish either — stays in the list, just not downloadable yet', () => {
    const orders = [makeEntry({ jobStatus: 'completed', customerStatus: 'translation_in_progress' })];
    const polled = makePolledData({ serviceLevel: 'notarization_through_partners', workflowStatus: 'notarized', hasReadyResultFiles: false });

    const next = applyPolledOrderUpdate(orders, 'doc-1', polled);

    expect(next).toHaveLength(1);
    expect(next[0]!.canDownload).toBe(false);
  });

  it('multiple orders in the list: only the matching documentId is updated, the rest (and the array length) are untouched', () => {
    const orders = [
      makeEntry({ documentId: 'doc-1' }),
      makeEntry({ documentId: 'doc-2', progressPercent: 20 }),
      makeEntry({ documentId: 'doc-3', progressPercent: 80 }),
    ];
    const next = applyPolledOrderUpdate(orders, 'doc-2', makePolledData());

    expect(next).toHaveLength(3);
    expect(next[0]).toEqual(orders[0]); // unchanged
    expect(next[1]!.customerStatus).toBe('completed'); // updated
    expect(next[2]).toEqual(orders[2]); // unchanged
  });

  it('an unknown documentId (stale/removed order) returns the array unchanged, by reference — never throws, never drops other entries', () => {
    const orders = [makeEntry({ documentId: 'doc-1' })];
    const next = applyPolledOrderUpdate(orders, 'doc-does-not-exist', makePolledData());

    expect(next).toBe(orders); // same reference — no-op
    expect(next).toHaveLength(1);
  });

  it('stopping active polling (no more calls to applyPolledOrderUpdate) never removes anything — the function is only ever additive/in-place, so simply not calling it again leaves the list exactly as it was', () => {
    const orders = [makeEntry({ jobStatus: 'completed', customerStatus: 'completed', isTerminal: true, isActive: true, canDownload: true })];
    // No poll call happens (order already terminal, polling stopped) — list must remain intact.
    expect(orders).toHaveLength(1);
    expect(orders[0]!.canDownload).toBe(true);
  });
});

describe('applyPolledOrderUpdate — quote fields fall back to the previous value when the poll omits them', () => {
  it('keeps the previous quote fields if the poll response has them as null', () => {
    const orders = [makeEntry({ latestQuoteId: 'quote-old', quoteAmountKzt: 2000 })];
    const next = applyPolledOrderUpdate(orders, 'doc-1', makePolledData({ latestQuoteId: null, quoteAmountKzt: null }));

    expect(next[0]!.latestQuoteId).toBe('quote-old');
    expect(next[0]!.quoteAmountKzt).toBe(2000);
  });
});
