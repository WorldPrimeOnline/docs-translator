/**
 * Dashboard order-visibility regression tests (2026-07-02 bug report):
 * "worker completes an electronic DOCX job successfully, but the order
 * disappears from the dashboard instead of moving to completed/downloadable."
 *
 * getCustomerOrderState() (see customer-order-state.test.ts) is proven to
 * classify a completed electronic job correctly regardless of file format —
 * it has no concept of document_type/output_format at all. This file locks
 * in the SECOND half of the pipeline: that bucketOrders() (extracted from
 * the dashboard's own filter logic) never drops an order that
 * getCustomerOrderState() marked active/downloadable.
 */
import { getCustomerOrderState } from '../customer-order-state';
import { bucketOrders, visibleOrders, type Bucketable } from '../order-buckets';
import type { SortableOrder } from '../order-sort';

// Default createdAt for fixtures that don't care about ordering — a fixed value
// so equal-timestamp tie-breaking (by documentId) never affects unrelated tests.
const DEFAULT_CREATED_AT = '2026-01-01T00:00:00.000Z';

interface FakeOrder extends Bucketable, SortableOrder {
  outputFormat?: 'docx' | 'html' | 'pdf';
}

function orderFromState(
  documentId: string,
  state: ReturnType<typeof getCustomerOrderState>,
  outputFormat?: FakeOrder['outputFormat'],
  sortCreatedAt: string = DEFAULT_CREATED_AT,
): FakeOrder {
  return { documentId, isActive: state.isActive, isTerminal: state.isTerminal, outputFormat, sortCreatedAt };
}

describe('bucketOrders — every order lands in exactly one bucket (no silent drops)', () => {
  it('an order never appears in zero or multiple buckets', () => {
    const orders: FakeOrder[] = [
      { documentId: 'a', isActive: true, isTerminal: false, sortCreatedAt: DEFAULT_CREATED_AT },
      { documentId: 'b', isActive: true, isTerminal: true, sortCreatedAt: DEFAULT_CREATED_AT },
      { documentId: 'c', isActive: false, isTerminal: true, sortCreatedAt: DEFAULT_CREATED_AT },
    ];
    const { activeOrders, readyOrders, historyOrders } = bucketOrders(orders);
    const totalBucketed = activeOrders.length + readyOrders.length + historyOrders.length;
    expect(totalBucketed).toBe(orders.length);
  });
});

describe('1. queued/in-progress electronic order is visible', () => {
  it('queued electronic job lands in activeOrders', () => {
    const state = getCustomerOrderState({ jobStatus: 'queued', progressPercent: 0, workflowStatus: null, serviceLevel: 'electronic' });
    const order = orderFromState('doc-1', state);
    const { activeOrders, readyOrders, historyOrders } = bucketOrders([order]);
    expect(activeOrders).toContainEqual(order);
    expect(readyOrders).not.toContainEqual(order);
    expect(historyOrders).not.toContainEqual(order);
    expect(visibleOrders([order])).toContainEqual(order);
  });

  it('translation_in_progress electronic job lands in activeOrders', () => {
    const state = getCustomerOrderState({ jobStatus: 'translation_in_progress', progressPercent: 50, workflowStatus: null, serviceLevel: 'electronic' });
    const order = orderFromState('doc-2', state);
    const { activeOrders } = bucketOrders([order]);
    expect(activeOrders).toContainEqual(order);
  });
});

describe('2. completed electronic DOCX order is visible', () => {
  it('completed electronic job (docx output) lands in readyOrders, not dropped', () => {
    // Real job/document IDs from the 2026-07-02 bug report:
    // job_id 19179437-a761-44c7-b777-fe5192a84737, service_level=electronic,
    // jobs.status=completed, workflow_status=completed (DB default — see
    // migration 0011), document_type='other|docx'.
    const state = getCustomerOrderState({ jobStatus: 'completed', progressPercent: 100, workflowStatus: 'completed', serviceLevel: 'electronic' });
    const order = orderFromState('a903c6fc-5006-4672-b81b-17a161645fe5', state, 'docx');
    const { readyOrders } = bucketOrders([order]);
    expect(readyOrders).toContainEqual(order);
    expect(state.canDownload).toBe(true);
    expect(visibleOrders([order])).toContainEqual(order);
  });
});

describe('3. completed electronic HTML order is visible if generated', () => {
  it('completed electronic job (html output) lands in readyOrders', () => {
    const state = getCustomerOrderState({ jobStatus: 'completed', progressPercent: 100, workflowStatus: null, serviceLevel: 'electronic' });
    const order = orderFromState('doc-3', state, 'html');
    const { readyOrders } = bucketOrders([order]);
    expect(readyOrders).toContainEqual(order);
    expect(state.canDownload).toBe(true);
  });
});

describe('4. completed electronic order does not require PDF', () => {
  it('OrderStateInput (the only input to visibility/download logic) has no document-format field at all', () => {
    // Structural guarantee, not just a value check: getCustomerOrderState's
    // input type only carries jobStatus/progressPercent/workflowStatus/
    // serviceLevel/fulfillmentMethod. There is no outputFormat/documentType/
    // fileExtension field for it to branch on — PDF-vs-DOCX-vs-HTML is
    // structurally impossible to gate on here.
    const state = getCustomerOrderState({ jobStatus: 'completed', progressPercent: 100, workflowStatus: null, serviceLevel: 'electronic' });
    expect(state.canDownload).toBe(true);
    expect(Object.keys(state)).not.toContain('outputFormat');
    expect(Object.keys(state)).not.toContain('documentType');
  });

  it('canDownload is identical for docx and html outputs on an otherwise-identical completed electronic job', () => {
    const base = { jobStatus: 'completed' as const, progressPercent: 100, workflowStatus: null, serviceLevel: 'electronic' };
    const docxState = getCustomerOrderState(base);
    const htmlState = getCustomerOrderState(base);
    expect(docxState).toEqual(htmlState);
  });
});

describe('5. completed electronic order does not disappear after worker completion', () => {
  it('the same documentId transitions from activeOrders to readyOrders on completion — never removed', () => {
    const documentId = 'a903c6fc-5006-4672-b81b-17a161645fe5';

    // Before: worker still processing (matches the bug report's "OCR completed,
    // translation completed, DOCX generated" — i.e. mid-pipeline, not yet 'completed').
    const processingState = getCustomerOrderState({ jobStatus: 'pdf_rendering', progressPercent: 90, workflowStatus: null, serviceLevel: 'electronic' });
    const before = orderFromState(documentId, processingState);
    const bucketsBefore = bucketOrders([before]);
    expect(bucketsBefore.activeOrders.map((o) => o.documentId)).toContain(documentId);

    // After: worker marks the job completed (matches "DOCX uploaded to R2, job completed").
    const completedState = getCustomerOrderState({ jobStatus: 'completed', progressPercent: 100, workflowStatus: 'completed', serviceLevel: 'electronic' });
    const after = orderFromState(documentId, completedState);
    const bucketsAfter = bucketOrders([after]);

    // Must have moved to readyOrders, not vanished from all three buckets.
    expect(bucketsAfter.readyOrders.map((o) => o.documentId)).toContain(documentId);
    expect(bucketsAfter.activeOrders.map((o) => o.documentId)).not.toContain(documentId);
    expect(bucketsAfter.historyOrders.map((o) => o.documentId)).not.toContain(documentId);
    expect(visibleOrders([after]).map((o) => o.documentId)).toContain(documentId);
  });

  it('a full order list keeps the completed order visible alongside other in-progress orders', () => {
    const completed = orderFromState(
      'a903c6fc-5006-4672-b81b-17a161645fe5',
      getCustomerOrderState({ jobStatus: 'completed', progressPercent: 100, workflowStatus: 'completed', serviceLevel: 'electronic' }),
      'docx',
    );
    const stillProcessing = orderFromState(
      'other-doc',
      getCustomerOrderState({ jobStatus: 'ocr_in_progress', progressPercent: 20, workflowStatus: null, serviceLevel: 'electronic' }),
    );
    const visible = visibleOrders([completed, stillProcessing]);
    expect(visible.map((o) => o.documentId).sort()).toEqual(['a903c6fc-5006-4672-b81b-17a161645fe5', 'other-doc'].sort());
  });
});

describe('6. visibleOrders — created_at DESC ordering (2026-08-03 dashboard-ordering incident)', () => {
  it('an old payment_pending order never outranks a newer completed order', () => {
    const oldPending = orderFromState(
      'doc-old-pending',
      getCustomerOrderState({ jobStatus: 'queued', progressPercent: 0, workflowStatus: null, serviceLevel: 'electronic' }),
      undefined,
      '2026-07-01T00:00:00.000Z',
    );
    const newCompleted = orderFromState(
      'doc-new-completed',
      getCustomerOrderState({ jobStatus: 'completed', progressPercent: 100, workflowStatus: 'completed', serviceLevel: 'electronic' }),
      'docx',
      '2026-08-03T00:00:00.000Z',
    );

    // Old pending listed FIRST in the input — bucket-concatenation would have put
    // it first in the output too (activeOrders before readyOrders). Must not.
    const visible = visibleOrders([oldPending, newCompleted]);
    expect(visible.map((o) => o.documentId)).toEqual(['doc-new-completed', 'doc-old-pending']);
  });

  it('a new job appearing after a full reload lands first, regardless of its position in the input array', () => {
    const old1 = orderFromState('old-1', getCustomerOrderState({ jobStatus: 'completed', progressPercent: 100, workflowStatus: 'completed', serviceLevel: 'electronic' }), undefined, '2026-06-01T00:00:00.000Z');
    const old2 = orderFromState('old-2', getCustomerOrderState({ jobStatus: 'payment_pending', progressPercent: 0, workflowStatus: null, serviceLevel: 'electronic' }), undefined, '2026-06-15T00:00:00.000Z');
    const brandNew = orderFromState('brand-new', getCustomerOrderState({ jobStatus: 'queued', progressPercent: 0, workflowStatus: null, serviceLevel: 'electronic' }), undefined, '2026-08-03T00:00:00.000Z');

    expect(visibleOrders([old1, old2, brandNew]).map((o) => o.documentId)[0]).toBe('brand-new');
    // Order of the input array must not matter — even inserted first, it still sorts to position 0.
    expect(visibleOrders([brandNew, old1, old2]).map((o) => o.documentId)[0]).toBe('brand-new');
  });

  it('processing -> completed keeps the same position (created_at is untouched by a status transition)', () => {
    const documentId = 'doc-transition';
    const createdAt = '2026-07-15T00:00:00.000Z';
    const other = orderFromState('doc-other-newer', getCustomerOrderState({ jobStatus: 'queued', progressPercent: 0, workflowStatus: null, serviceLevel: 'electronic' }), undefined, '2026-08-01T00:00:00.000Z');

    const processing = orderFromState(documentId, getCustomerOrderState({ jobStatus: 'translation_in_progress', progressPercent: 50, workflowStatus: null, serviceLevel: 'electronic' }), undefined, createdAt);
    const beforeOrder = visibleOrders([other, processing]).map((o) => o.documentId);
    expect(beforeOrder).toEqual(['doc-other-newer', documentId]);

    // Same documentId/createdAt, now completed — position relative to `other` must be identical.
    const completed = orderFromState(documentId, getCustomerOrderState({ jobStatus: 'completed', progressPercent: 100, workflowStatus: 'completed', serviceLevel: 'electronic' }), undefined, createdAt);
    const afterOrder = visibleOrders([other, completed]).map((o) => o.documentId);
    expect(afterOrder).toEqual(['doc-other-newer', documentId]);
  });

  it('a scrambled/out-of-order input (as a poll response might arrive) is still rendered sorted by created_at DESC', () => {
    const a = orderFromState('a', getCustomerOrderState({ jobStatus: 'completed', progressPercent: 100, workflowStatus: 'completed', serviceLevel: 'electronic' }), undefined, '2026-08-01T00:00:00.000Z');
    const b = orderFromState('b', getCustomerOrderState({ jobStatus: 'queued', progressPercent: 0, workflowStatus: null, serviceLevel: 'electronic' }), undefined, '2026-08-03T00:00:00.000Z');
    const c = orderFromState('c', getCustomerOrderState({ jobStatus: 'payment_pending', progressPercent: 0, workflowStatus: null, serviceLevel: 'electronic' }), undefined, '2026-08-02T00:00:00.000Z');

    expect(visibleOrders([a, b, c]).map((o) => o.documentId)).toEqual(['b', 'c', 'a']);
    expect(visibleOrders([c, a, b]).map((o) => o.documentId)).toEqual(['b', 'c', 'a']);
  });

  it('a completed order never disappears and never moves below older orders', () => {
    const older = orderFromState('older', getCustomerOrderState({ jobStatus: 'payment_pending', progressPercent: 0, workflowStatus: null, serviceLevel: 'electronic' }), undefined, '2026-01-01T00:00:00.000Z');
    const completed = orderFromState('newer-completed', getCustomerOrderState({ jobStatus: 'completed', progressPercent: 100, workflowStatus: 'completed', serviceLevel: 'electronic' }), 'docx', '2026-08-03T00:00:00.000Z');

    const visible = visibleOrders([older, completed]);
    expect(visible.map((o) => o.documentId)).toContain('newer-completed');
    expect(visible.map((o) => o.documentId).indexOf('newer-completed')).toBeLessThan(visible.map((o) => o.documentId).indexOf('older'));
  });
});

describe('7. closed/terminal-non-downloadable orders land in historyOrders only (2026-07-23 dashboard task)', () => {
  // A closed order (canceled/refunded/declined) must always be reachable in historyOrders,
  // never silently dropped, and must never leak into activeOrders (the section rendered as
  // "in progress") or readyOrders (which implies a download button is shown).
  const closedCases: Array<{
    name: string;
    input: Parameters<typeof getCustomerOrderState>[0];
  }> = [
    { name: 'canceled electronic order', input: { jobStatus: 'canceled', progressPercent: 0, workflowStatus: null, serviceLevel: 'electronic' } },
    { name: 'refunded electronic order', input: { jobStatus: 'refunded', progressPercent: 0, workflowStatus: null, serviceLevel: 'electronic' } },
    { name: 'failed electronic order', input: { jobStatus: 'failed', progressPercent: 0, workflowStatus: null, serviceLevel: 'electronic' } },
    { name: 'translator-declined certified order', input: { jobStatus: 'completed', progressPercent: 100, workflowStatus: 'translator_declined', serviceLevel: 'official_with_translator_signature_and_provider_stamp' } },
    { name: 'notary-declined notarized order', input: { jobStatus: 'completed', progressPercent: 100, workflowStatus: 'notary_declined', serviceLevel: 'notarization_through_partners' } },
    { name: 'delivered notarized order (no result-file sync passed — legacy single-file behavior)', input: { jobStatus: 'completed', progressPercent: 100, workflowStatus: 'delivered', serviceLevel: 'notarization_through_partners' } },
  ];

  for (const { name, input } of closedCases) {
    it(`${name}: appears in historyOrders, never in activeOrders or readyOrders`, () => {
      const state = getCustomerOrderState(input);
      expect(state.isTerminal).toBe(true);
      const order = orderFromState(`closed-${name}`, state);
      const { activeOrders, readyOrders, historyOrders } = bucketOrders([order]);
      expect(historyOrders).toContainEqual(order);
      expect(activeOrders).not.toContainEqual(order);
      expect(readyOrders).not.toContainEqual(order);
      // Also never present in the rendered "active" section.
      expect(visibleOrders([order])).not.toContainEqual(order);
    });
  }

  it('a mixed list of active, ready, and closed orders keeps each in exactly its own bucket — no cross-leakage', () => {
    const active = orderFromState(
      'still-active',
      getCustomerOrderState({ jobStatus: 'translation_in_progress', progressPercent: 40, workflowStatus: null, serviceLevel: 'electronic' }),
    );
    const ready = orderFromState(
      'ready-to-download',
      getCustomerOrderState({ jobStatus: 'completed', progressPercent: 100, workflowStatus: 'completed', serviceLevel: 'electronic' }),
    );
    const closed = orderFromState(
      'closed-canceled',
      getCustomerOrderState({ jobStatus: 'canceled', progressPercent: 0, workflowStatus: null, serviceLevel: 'electronic' }),
    );

    const { activeOrders, readyOrders, historyOrders } = bucketOrders([active, ready, closed]);
    expect(activeOrders.map((o) => o.documentId)).toEqual(['still-active']);
    expect(readyOrders.map((o) => o.documentId)).toEqual(['ready-to-download']);
    expect(historyOrders.map((o) => o.documentId)).toEqual(['closed-canceled']);

    // The rendered "active" section (activeOrders + readyOrders) must never include the closed order.
    const rendered = visibleOrders([active, ready, closed]).map((o) => o.documentId);
    expect(rendered).not.toContain('closed-canceled');
    expect(rendered.sort()).toEqual(['ready-to-download', 'still-active'].sort());
  });
});
