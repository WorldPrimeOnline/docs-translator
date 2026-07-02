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

interface FakeOrder extends Bucketable {
  documentId: string;
  outputFormat?: 'docx' | 'html' | 'pdf';
}

function orderFromState(documentId: string, state: ReturnType<typeof getCustomerOrderState>, outputFormat?: FakeOrder['outputFormat']): FakeOrder {
  return { documentId, isActive: state.isActive, isTerminal: state.isTerminal, outputFormat };
}

describe('bucketOrders — every order lands in exactly one bucket (no silent drops)', () => {
  it('an order never appears in zero or multiple buckets', () => {
    const orders: FakeOrder[] = [
      { documentId: 'a', isActive: true, isTerminal: false },
      { documentId: 'b', isActive: true, isTerminal: true },
      { documentId: 'c', isActive: false, isTerminal: true },
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
