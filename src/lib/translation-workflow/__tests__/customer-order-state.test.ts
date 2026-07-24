/**
 * Tests for customer-order-state.ts's business-state derivation (customerStatus/
 * canDownload/isActive/isTerminal) — unchanged by the 2026-07-26 progress-UI
 * architectural fix. The progress percentage/stage-timeline computation itself
 * (previously tested here) now lives in progress-flow.ts and is comprehensively
 * tested in __tests__/progress-flow.test.ts instead — this file only asserts that
 * getCustomerOrderState() wires the two together correctly (delegates to the
 * resolver, doesn't recompute anything itself).
 */
import { getCustomerOrderState, canCustomerDownload, isCustomerOrderTerminal } from '../customer-order-state';

describe('getCustomerOrderState — electronic', () => {
  it('queued (paid, not yet processing) → not downloadable, not terminal, progress starts', () => {
    const s = getCustomerOrderState({ jobStatus: 'queued', progressPercent: 0, workflowStatus: null, serviceLevel: 'electronic' });
    expect(s.customerStatus).toBe('queued');
    expect(s.canDownload).toBe(false);
    expect(s.isTerminal).toBe(false);
    expect(s.progressPercent).toBe(10);
    expect(s.showFulfillmentProgress).toBe(true);
  });

  it('ocr_in_progress → processing, not terminal, percent within the electronic processing sub-range', () => {
    const s = getCustomerOrderState({ jobStatus: 'ocr_in_progress', progressPercent: 20, workflowStatus: null, serviceLevel: 'electronic' });
    expect(s.customerStatus).toBe('ocr_in_progress');
    expect(s.isTerminal).toBe(false);
    expect(s.canDownload).toBe(false);
    expect(s.progressPercent).toBeGreaterThanOrEqual(10);
    expect(s.progressPercent).toBeLessThanOrEqual(90);
  });

  it('completed + no workflowStatus → downloadable, terminal, 100%', () => {
    const s = getCustomerOrderState({ jobStatus: 'completed', progressPercent: 100, workflowStatus: null, serviceLevel: 'electronic' });
    expect(s.customerStatus).toBe('completed');
    expect(s.canDownload).toBe(true);
    expect(s.isTerminal).toBe(true);
    expect(s.progressPercent).toBe(100);
  });

  it('failed → not downloadable, terminal, no fulfillment progress (payment_failed pre-payment bucket)', () => {
    const s = getCustomerOrderState({ jobStatus: 'failed', progressPercent: 0, workflowStatus: null, serviceLevel: 'electronic' });
    expect(s.customerStatus).toBe('failed');
    expect(s.canDownload).toBe(false);
    expect(s.isTerminal).toBe(true);
  });

  it('electronic stages: exactly 3 (paid/processing/ready), current correctly reflects translation_in_progress', () => {
    const s = getCustomerOrderState({ jobStatus: 'translation_in_progress', progressPercent: 50, workflowStatus: null, serviceLevel: 'electronic' });
    expect(s.stages.map((x) => x.key)).toEqual(['paid', 'processing', 'ready']);
    const current = s.stages.find((x) => x.current);
    expect(current?.key).toBe('processing');
  });
});

describe('getCustomerOrderState — certified (Official)', () => {
  const SL = 'official_with_translator_signature_and_provider_stamp';

  it('awaiting_translator_review → NOT downloadable, NOT terminal', () => {
    const s = getCustomerOrderState({ jobStatus: 'completed', progressPercent: 100, workflowStatus: 'awaiting_translator_review', serviceLevel: SL });
    expect(s.customerStatus).toBe('awaiting_translator_review');
    expect(s.canDownload).toBe(false);
    expect(s.isTerminal).toBe(false);
    expect(s.progressPercent).toBe(40);
  });

  it('translator_review_in_progress (Official) → NOT downloadable, NOT terminal, active', () => {
    const s = getCustomerOrderState({ jobStatus: 'completed', progressPercent: 100, workflowStatus: 'translator_review_in_progress', serviceLevel: SL });
    expect(s.customerStatus).toBe('translator_review_in_progress');
    expect(s.canDownload).toBe(false);
    expect(s.isTerminal).toBe(false);
    expect(s.isActive).toBe(true);
    expect(s.progressPercent).toBe(60);
  });

  it('translator_approved → NOT downloadable, 80% (same "signature stage" as awaiting_signature_stamp)', () => {
    const s1 = getCustomerOrderState({ jobStatus: 'completed', progressPercent: 100, workflowStatus: 'translator_approved', serviceLevel: SL });
    const s2 = getCustomerOrderState({ jobStatus: 'completed', progressPercent: 100, workflowStatus: 'awaiting_signature_stamp', serviceLevel: SL });
    expect(s1.customerStatus).toBe('translator_approved');
    expect(s1.canDownload).toBe(false);
    expect(s1.progressPercent).toBe(80);
    expect(s2.progressPercent).toBe(80);
    expect(s1.stages.findIndex((x) => x.current)).toBe(s2.stages.findIndex((x) => x.current));
  });

  it('ready_for_delivery → downloadable for certified, 100% (no early-100% forcing needed anymore — the flow table itself puts "ready" at 100)', () => {
    const s = getCustomerOrderState({ jobStatus: 'completed', progressPercent: 100, workflowStatus: 'ready_for_delivery', serviceLevel: SL });
    expect(s.customerStatus).toBe('ready_for_delivery');
    expect(s.canDownload).toBe(true);
    expect(s.progressPercent).toBe(100);
  });

  it('delivered (certified) → terminal, downloadable, 100%', () => {
    const s = getCustomerOrderState({ jobStatus: 'completed', progressPercent: 100, workflowStatus: 'delivered', serviceLevel: SL });
    expect(s.customerStatus).toBe('delivered');
    expect(s.isTerminal).toBe(true);
    expect(s.canDownload).toBe(true);
    expect(s.progressPercent).toBe(100);
  });

  it('translator_declined → not downloadable, terminal', () => {
    const s = getCustomerOrderState({ jobStatus: 'completed', progressPercent: 100, workflowStatus: 'translator_declined', serviceLevel: SL });
    expect(s.customerStatus).toBe('translator_declined');
    expect(s.canDownload).toBe(false);
    expect(s.isTerminal).toBe(true);
  });

  it('Official stages: exactly 6 (paid/processing/awaiting_translator_review/translator_review_in_progress/signature_stage/ready) — never a notary/courier marker', () => {
    const s = getCustomerOrderState({ jobStatus: 'completed', progressPercent: 100, workflowStatus: 'awaiting_translator_review', serviceLevel: SL });
    expect(s.stages.map((x) => x.key)).toEqual(['paid', 'processing', 'awaiting_translator_review', 'translator_review_in_progress', 'signature_stage', 'ready']);
    for (const forbidden of ['notarization_in_progress', 'notarized', 'out_for_delivery', 'approved_for_notary']) {
      expect(s.stages.some((x) => x.key === forbidden)).toBe(false);
    }
  });
});

describe('getCustomerOrderState — notarized delivery', () => {
  const SL = 'notarization_through_partners';

  it('OUT_FOR_DELIVERY → workflow = out_for_delivery, NOT terminal, canDownload = false, 96%', () => {
    const s = getCustomerOrderState({ jobStatus: 'completed', progressPercent: 100, workflowStatus: 'out_for_delivery', serviceLevel: SL, fulfillmentMethod: 'delivery' });
    expect(s.customerStatus).toBe('out_for_delivery');
    expect(s.isTerminal).toBe(false);
    expect(s.canDownload).toBe(false);
    expect(s.isActive).toBe(true);
    expect(s.progressPercent).toBe(96);
  });

  it('DELIVERED → workflow = delivered, terminal, canDownload = false (legacy, hasReadyResultFiles omitted), goes to history, 100%', () => {
    const s = getCustomerOrderState({ jobStatus: 'completed', progressPercent: 100, workflowStatus: 'delivered', serviceLevel: SL, fulfillmentMethod: 'delivery' });
    expect(s.customerStatus).toBe('delivered');
    expect(s.isTerminal).toBe(true);
    expect(s.canDownload).toBe(false);
    expect(s.isActive).toBe(false);
    expect(s.progressPercent).toBe(100);
  });

  it('PICKED_UP → workflow = picked_up, terminal, canDownload = false, 100%', () => {
    const s = getCustomerOrderState({ jobStatus: 'completed', progressPercent: 100, workflowStatus: 'picked_up', serviceLevel: SL, fulfillmentMethod: 'pickup' });
    expect(s.customerStatus).toBe('picked_up');
    expect(s.isTerminal).toBe(true);
    expect(s.canDownload).toBe(false);
    expect(s.isActive).toBe(false);
    expect(s.progressPercent).toBe(100);
  });

  it('assigned_to_notary → NOT downloadable, NOT terminal, 65%', () => {
    const s = getCustomerOrderState({ jobStatus: 'completed', progressPercent: 100, workflowStatus: 'assigned_to_notary', serviceLevel: SL });
    expect(s.customerStatus).toBe('assigned_to_notary');
    expect(s.canDownload).toBe(false);
    expect(s.isTerminal).toBe(false);
    expect(s.progressPercent).toBe(65);
  });

  it('translator_review_in_progress (Notary) → NOT downloadable, NOT terminal, active, unaffected by hasReadyResultFiles', () => {
    const s = getCustomerOrderState({ jobStatus: 'completed', progressPercent: 100, workflowStatus: 'translator_review_in_progress', serviceLevel: SL, hasReadyResultFiles: false });
    expect(s.customerStatus).toBe('translator_review_in_progress');
    expect(s.canDownload).toBe(false);
    expect(s.isTerminal).toBe(false);
    expect(s.isActive).toBe(true);
    expect(s.progressPercent).toBe(50);
  });

  it('notarization_in_progress → NOT downloadable, 80%', () => {
    const s = getCustomerOrderState({ jobStatus: 'completed', progressPercent: 100, workflowStatus: 'notarization_in_progress', serviceLevel: SL });
    expect(s.customerStatus).toBe('notarization_in_progress');
    expect(s.canDownload).toBe(false);
    expect(s.progressPercent).toBe(80);
  });

  it('notarized (legacy, hasReadyResultFiles omitted) → NOT downloadable, but progress reaches 90% (delivery) even before the physical/legacy download gate opens', () => {
    const s = getCustomerOrderState({ jobStatus: 'completed', progressPercent: 100, workflowStatus: 'notarized', serviceLevel: SL, fulfillmentMethod: 'delivery' });
    expect(s.customerStatus).toBe('notarized');
    expect(s.canDownload).toBe(false);
    expect(s.progressPercent).toBe(90);
  });

  it('notarized with NO fulfillment method at all (pure electronic scan, no physical component) → 100%, terminal-percent reached even though customerStatus/isTerminal business logic is unaffected by this fix', () => {
    const s = getCustomerOrderState({ jobStatus: 'completed', progressPercent: 100, workflowStatus: 'notarized', serviceLevel: SL, fulfillmentMethod: null });
    expect(s.progressPercent).toBe(100);
  });

  it('ready_for_delivery (notarized physical) → canDownload = false (legacy), 92%', () => {
    const s = getCustomerOrderState({ jobStatus: 'completed', progressPercent: 100, workflowStatus: 'ready_for_delivery', serviceLevel: SL, fulfillmentMethod: 'delivery' });
    expect(s.customerStatus).toBe('ready_for_delivery');
    expect(s.canDownload).toBe(false);
    expect(s.isTerminal).toBe(false);
    expect(s.progressPercent).toBe(92);
  });

  it('ready_for_pickup (notarized physical) → canDownload = false (legacy), 95%', () => {
    const s = getCustomerOrderState({ jobStatus: 'completed', progressPercent: 100, workflowStatus: 'ready_for_pickup', serviceLevel: SL, fulfillmentMethod: 'pickup' });
    expect(s.customerStatus).toBe('ready_for_pickup');
    expect(s.canDownload).toBe(false);
    expect(s.isTerminal).toBe(false);
    expect(s.progressPercent).toBe(95);
  });

  it('notarized delivery stages: exactly 10 steps, includes out_for_delivery/delivered', () => {
    const s = getCustomerOrderState({ jobStatus: 'completed', progressPercent: 100, workflowStatus: 'assigned_to_notary', serviceLevel: SL, fulfillmentMethod: 'delivery' });
    const keys = s.stages.map((x) => x.key);
    expect(keys).toEqual(['paid', 'processing', 'awaiting_translator_review', 'translator_review_in_progress', 'approved_for_notary', 'notarization_in_progress', 'notarized', 'ready_for_delivery', 'out_for_delivery', 'delivered']);
  });

  it('notarized pickup stages: exactly 9 steps, excludes out_for_delivery, includes picked_up', () => {
    const s = getCustomerOrderState({ jobStatus: 'completed', progressPercent: 100, workflowStatus: 'assigned_to_notary', serviceLevel: SL, fulfillmentMethod: 'pickup' });
    const keys = s.stages.map((x) => x.key);
    expect(keys).not.toContain('out_for_delivery');
    expect(keys).toContain('picked_up');
    expect(keys.length).toBe(9);
  });

  it('notary_declined → terminal, not downloadable', () => {
    const s = getCustomerOrderState({ jobStatus: 'completed', progressPercent: 100, workflowStatus: 'notary_declined', serviceLevel: SL });
    expect(s.isTerminal).toBe(true);
    expect(s.canDownload).toBe(false);
  });

  it('translator_approved maps to the same stage ("approved_for_notary") as assigned_to_notary', () => {
    const s1 = getCustomerOrderState({ jobStatus: 'completed', progressPercent: 100, workflowStatus: 'translator_approved', serviceLevel: SL, fulfillmentMethod: 'delivery' });
    const s2 = getCustomerOrderState({ jobStatus: 'completed', progressPercent: 100, workflowStatus: 'assigned_to_notary', serviceLevel: SL, fulfillmentMethod: 'delivery' });
    const cur1 = s1.stages.findIndex((x) => x.current);
    const cur2 = s2.stages.findIndex((x) => x.current);
    expect(cur1).toBe(cur2);
    expect(s1.stages[cur1]?.key).toBe('approved_for_notary');
    expect(s1.progressPercent).toBe(s2.progressPercent);
  });

  describe('notary-completed timeline transitions', () => {
    it('workflowStatus=notarized, fulfillmentMethod=delivery: "notarized" stage is current, next (out_for_delivery) not yet reached', () => {
      const s = getCustomerOrderState({ jobStatus: 'completed', progressPercent: 100, workflowStatus: 'notarized', serviceLevel: SL, fulfillmentMethod: 'delivery' });
      const notarizedStage = s.stages.find((x) => x.key === 'notarized');
      const outForDeliveryStage = s.stages.find((x) => x.key === 'out_for_delivery');
      expect(notarizedStage?.current).toBe(true);
      expect(notarizedStage?.done).toBe(false);
      expect(outForDeliveryStage?.current).toBe(false);
      expect(outForDeliveryStage?.done).toBe(false);
      expect(s.customerStatus).toBe('notarized');
      expect(s.isTerminal).toBe(false);
    });

    it('workflowStatus advances past notarized to ready_for_delivery: "notarized" flips to done, delivery stage becomes current', () => {
      const s = getCustomerOrderState({ jobStatus: 'completed', progressPercent: 100, workflowStatus: 'ready_for_delivery', serviceLevel: SL, fulfillmentMethod: 'delivery' });
      const notarizedStage = s.stages.find((x) => x.key === 'notarized');
      const readyStage = s.stages.find((x) => x.key === 'ready_for_delivery');
      expect(notarizedStage?.done).toBe(true);
      expect(notarizedStage?.current).toBe(false);
      expect(readyStage?.current).toBe(true);
      expect(s.customerStatus).toBe('ready_for_delivery');
    });

    it('workflowStatus=notarized, fulfillmentMethod=pickup: "notarized" current, ready_for_pickup stage exists distinctly, no out_for_delivery at all', () => {
      const s = getCustomerOrderState({ jobStatus: 'completed', progressPercent: 100, workflowStatus: 'notarized', serviceLevel: SL, fulfillmentMethod: 'pickup' });
      const keys = s.stages.map((x) => x.key);
      expect(keys).not.toContain('out_for_delivery');
      expect(keys).toContain('ready_for_pickup');
      const notarizedStage = s.stages.find((x) => x.key === 'notarized');
      expect(notarizedStage?.current).toBe(true);
    });

    it('pickup fulfillment reaches a terminal, appropriately-gated customer state at picked_up — no download regardless (legacy, hasReadyResultFiles omitted)', () => {
      const s = getCustomerOrderState({ jobStatus: 'completed', progressPercent: 100, workflowStatus: 'picked_up', serviceLevel: SL, fulfillmentMethod: 'pickup' });
      expect(s.customerStatus).toBe('picked_up');
      expect(s.isTerminal).toBe(true);
      expect(s.canDownload).toBe(false);
      const pickedUpStage = s.stages.find((x) => x.key === 'picked_up');
      expect(pickedUpStage?.current).toBe(true);
      expect(pickedUpStage?.done).toBe(false);
    });

    it('multi-source: workflowStatus=notarized with hasReadyResultFiles=true is downloadable immediately, independent of pickup/delivery physical progress', () => {
      const delivery = getCustomerOrderState({ jobStatus: 'completed', progressPercent: 100, workflowStatus: 'notarized', serviceLevel: SL, fulfillmentMethod: 'delivery', hasReadyResultFiles: true });
      const pickup = getCustomerOrderState({ jobStatus: 'completed', progressPercent: 100, workflowStatus: 'notarized', serviceLevel: SL, fulfillmentMethod: 'pickup', hasReadyResultFiles: true });
      expect(delivery.canDownload).toBe(true);
      expect(pickup.canDownload).toBe(true);
    });
  });
});

describe('Regression: backward transition does not affect customer state', () => {
  const SL = 'notarization_through_partners';

  it('delivered order stays delivered after late TRANSLATOR_COMPLETED (assigned_to_notary)', () => {
    const s = getCustomerOrderState({ jobStatus: 'completed', progressPercent: 100, workflowStatus: 'delivered', serviceLevel: SL, fulfillmentMethod: 'delivery' });
    expect(s.customerStatus).toBe('delivered');
    expect(s.isTerminal).toBe(true);
  });

  it('out_for_delivery is NOT terminal', () => {
    const s = getCustomerOrderState({ jobStatus: 'completed', progressPercent: 100, workflowStatus: 'out_for_delivery', serviceLevel: SL, fulfillmentMethod: 'delivery' });
    expect(s.isTerminal).toBe(false);
    expect(s.customerStatus).toBe('out_for_delivery');
  });

  it('ready_for_delivery is NOT terminal', () => {
    const s = getCustomerOrderState({ jobStatus: 'completed', progressPercent: 100, workflowStatus: 'ready_for_delivery', serviceLevel: SL, fulfillmentMethod: 'delivery' });
    expect(s.isTerminal).toBe(false);
  });

  it('notarized physical order (legacy, hasReadyResultFiles omitted) NEVER gets a download button', () => {
    const statuses = ['awaiting_translator_review', 'assigned_to_notary', 'notarization_in_progress', 'notarized', 'ready_for_delivery', 'ready_for_pickup', 'out_for_delivery', 'delivered', 'picked_up'];
    for (const ws of statuses) {
      const s = getCustomerOrderState({ jobStatus: 'completed', progressPercent: 100, workflowStatus: ws, serviceLevel: SL, fulfillmentMethod: 'delivery' });
      expect(s.canDownload).toBe(false);
    }
  });

  it('electronic completed order gets download button', () => {
    const s = getCustomerOrderState({ jobStatus: 'completed', progressPercent: 100, workflowStatus: null, serviceLevel: 'electronic' });
    expect(s.canDownload).toBe(true);
  });

  it('certified approved final digital order gets download at ready_for_delivery', () => {
    const s = getCustomerOrderState({ jobStatus: 'completed', progressPercent: 100, workflowStatus: 'ready_for_delivery', serviceLevel: 'official_with_translator_signature_and_provider_stamp' });
    expect(s.canDownload).toBe(true);
  });

  it('certified gets download at delivered', () => {
    const s = getCustomerOrderState({ jobStatus: 'completed', progressPercent: 100, workflowStatus: 'delivered', serviceLevel: 'official_with_translator_signature_and_provider_stamp' });
    expect(s.canDownload).toBe(true);
  });
});

describe('Active/history grouping', () => {
  const SL = 'notarization_through_partners';

  it('delivered notarized goes to history (isActive=false)', () => {
    const s = getCustomerOrderState({ jobStatus: 'completed', progressPercent: 100, workflowStatus: 'delivered', serviceLevel: SL, fulfillmentMethod: 'delivery' });
    expect(s.isActive).toBe(false);
    expect(s.isTerminal).toBe(true);
  });

  it('picked_up notarized goes to history (isActive=false)', () => {
    const s = getCustomerOrderState({ jobStatus: 'completed', progressPercent: 100, workflowStatus: 'picked_up', serviceLevel: SL, fulfillmentMethod: 'pickup' });
    expect(s.isActive).toBe(false);
    expect(s.isTerminal).toBe(true);
  });

  it('out_for_delivery stays in active (isActive=true)', () => {
    const s = getCustomerOrderState({ jobStatus: 'completed', progressPercent: 100, workflowStatus: 'out_for_delivery', serviceLevel: SL, fulfillmentMethod: 'delivery' });
    expect(s.isActive).toBe(true);
    expect(s.isTerminal).toBe(false);
  });

  it('ready_for_pickup stays in active', () => {
    const s = getCustomerOrderState({ jobStatus: 'completed', progressPercent: 100, workflowStatus: 'ready_for_pickup', serviceLevel: SL, fulfillmentMethod: 'pickup' });
    expect(s.isActive).toBe(true);
    expect(s.isTerminal).toBe(false);
  });

  it('electronic completed is active (stays in active section for download prominence)', () => {
    const s = getCustomerOrderState({ jobStatus: 'completed', progressPercent: 100, workflowStatus: null, serviceLevel: 'electronic' });
    expect(s.isActive).toBe(true);
    expect(s.isTerminal).toBe(true);
  });
});

describe('Unknown workflow_status does not reset to translator stage, never crashes', () => {
  it('unknown workflow_status on completed job → operator_processing (not awaiting_translator_review)', () => {
    const s = getCustomerOrderState({ jobStatus: 'completed', progressPercent: 100, workflowStatus: 'some_future_status', serviceLevel: 'notarization_through_partners' });
    expect(s.customerStatus).toBe('operator_processing');
    expect(s.customerStatus).not.toBe('awaiting_translator_review');
  });

  it('an unrecognized status combination must safely stay ACTIVE, never silently disappear, and still returns a valid percent/labelKey', () => {
    const s = getCustomerOrderState({ jobStatus: 'completed', progressPercent: 100, workflowStatus: 'some_future_status', serviceLevel: 'notarization_through_partners' });
    expect(s.isTerminal).toBe(false);
    expect(s.isActive).toBe(true);
    expect(typeof s.progressPercent).toBe('number');
    expect(typeof s.labelKey).toBe('string');
  });
});

describe('payment_pending must always be active, regardless of workflow_status — and shows no fulfillment progress at all', () => {
  it('a brand-new order (payment_pending, quote just calculated, workflow_status=null) is active, not terminal, percent=null', () => {
    const s = getCustomerOrderState({ jobStatus: 'payment_pending', progressPercent: 0, workflowStatus: null, serviceLevel: 'official_with_translator_signature_and_provider_stamp' });
    expect(s.customerStatus).toBe('payment_pending');
    expect(s.isActive).toBe(true);
    expect(s.isTerminal).toBe(false);
    expect(s.progressPercent).toBeNull();
    expect(s.showFulfillmentProgress).toBe(false);
  });

  it('payment_pending with a legacy/default workflow_status="completed" is STILL active — jobStatus is checked before any workflow_status branch', () => {
    const s = getCustomerOrderState({ jobStatus: 'payment_pending', progressPercent: 0, workflowStatus: 'completed', serviceLevel: 'notarization_through_partners' });
    expect(s.customerStatus).toBe('payment_pending');
    expect(s.isActive).toBe(true);
    expect(s.isTerminal).toBe(false);
    expect(s.progressPercent).toBeNull();
  });

  it('payment_pending with ANY workflow_status value (even a terminal-looking one like "delivered") is still active — jobStatus=payment_pending always wins', () => {
    const s = getCustomerOrderState({ jobStatus: 'payment_pending', progressPercent: 0, workflowStatus: 'delivered', serviceLevel: 'notarization_through_partners' });
    expect(s.customerStatus).toBe('payment_pending');
    expect(s.isActive).toBe(true);
    expect(s.isTerminal).toBe(false);
    expect(s.progressPercent).toBeNull();
  });

  it('quoteStatus distinguishes quote_ready / payment_pending / payment_checking sub-states, all with percent=null', () => {
    const quoteReady = getCustomerOrderState({ jobStatus: 'payment_pending', progressPercent: 0, workflowStatus: null, serviceLevel: 'electronic', quoteStatus: 'quoted' });
    const checking = getCustomerOrderState({ jobStatus: 'payment_pending', progressPercent: 0, workflowStatus: null, serviceLevel: 'electronic', quoteStatus: 'payment_pending' });
    expect(quoteReady.progressPercent).toBeNull();
    expect(checking.progressPercent).toBeNull();
    expect(quoteReady.labelKey).not.toBe(checking.labelKey);
  });
});

describe('Legacy workflow_status="completed" on non-electronic jobs', () => {
  it('notarized job with workflow_status=completed → awaiting_translator_review (not operator_processing)', () => {
    const s = getCustomerOrderState({ jobStatus: 'completed', progressPercent: 100, workflowStatus: 'completed', serviceLevel: 'notarization_through_partners' });
    expect(s.customerStatus).toBe('awaiting_translator_review');
    expect(s.canDownload).toBe(false);
    expect(s.isTerminal).toBe(false);
  });

  it('certified job with workflow_status=completed → awaiting_translator_review', () => {
    const SL = 'official_with_translator_signature_and_provider_stamp';
    const s = getCustomerOrderState({ jobStatus: 'completed', progressPercent: 100, workflowStatus: 'completed', serviceLevel: SL });
    expect(s.customerStatus).toBe('awaiting_translator_review');
    expect(s.canDownload).toBe(false);
    expect(s.isTerminal).toBe(false);
  });

  it('electronic job with workflow_status=completed → still completed (electronic shortcut)', () => {
    const s = getCustomerOrderState({ jobStatus: 'completed', progressPercent: 100, workflowStatus: 'completed', serviceLevel: 'electronic' });
    expect(s.customerStatus).toBe('completed');
    expect(s.canDownload).toBe(true);
    expect(s.isTerminal).toBe(true);
  });
});

describe('Standalone helpers', () => {
  it('isCustomerOrderTerminal: delivered is terminal', () => {
    expect(isCustomerOrderTerminal('delivered')).toBe(true);
  });
  it('isCustomerOrderTerminal: picked_up is terminal', () => {
    expect(isCustomerOrderTerminal('picked_up')).toBe(true);
  });
  it('isCustomerOrderTerminal: out_for_delivery is NOT terminal', () => {
    expect(isCustomerOrderTerminal('out_for_delivery')).toBe(false);
  });
  it('isCustomerOrderTerminal: ready_for_delivery is NOT terminal', () => {
    expect(isCustomerOrderTerminal('ready_for_delivery')).toBe(false);
  });

  it('canCustomerDownload: notarized → always false without hasReadyResultFiles', () => {
    for (const s of ['assigned_to_notary', 'notarized', 'ready_for_delivery', 'out_for_delivery', 'delivered', 'picked_up'] as const) {
      expect(canCustomerDownload(s, 'notarization_through_partners')).toBe(false);
    }
  });
  it('canCustomerDownload: certified → true at ready_for_delivery and delivered', () => {
    const SL = 'official_with_translator_signature_and_provider_stamp';
    expect(canCustomerDownload('ready_for_delivery', SL)).toBe(true);
    expect(canCustomerDownload('delivered', SL)).toBe(true);
    expect(canCustomerDownload('translator_approved', SL)).toBe(false);
  });
  it('canCustomerDownload: electronic → only at completed', () => {
    expect(canCustomerDownload('completed', 'electronic')).toBe(true);
    expect(canCustomerDownload('ready_for_delivery', 'electronic')).toBe(false);
  });
});

describe('2026-08-01 multi-file fulfillment decision — hasReadyResultFiles', () => {
  const OFFICIAL = 'official_with_translator_signature_and_provider_stamp';
  const NOTARY = 'notarization_through_partners';

  it('legacy (hasReadyResultFiles omitted): notarized stays never-downloadable at any status', () => {
    for (const ws of ['notarized', 'ready_for_delivery', 'ready_for_pickup', 'delivered', 'picked_up']) {
      const s = getCustomerOrderState({ jobStatus: 'completed', progressPercent: 100, workflowStatus: ws, serviceLevel: NOTARY });
      expect(s.canDownload).toBe(false);
    }
  });

  it('legacy (hasReadyResultFiles omitted): official keeps the exact old operator-confirmation-only gate', () => {
    const s1 = getCustomerOrderState({ jobStatus: 'completed', progressPercent: 100, workflowStatus: 'ready_for_delivery', serviceLevel: OFFICIAL });
    expect(s1.canDownload).toBe(true);
    const s2 = getCustomerOrderState({ jobStatus: 'completed', progressPercent: 100, workflowStatus: 'translator_approved', serviceLevel: OFFICIAL });
    expect(s2.canDownload).toBe(false);
  });

  it('multi-source notary: hasReadyResultFiles=true opens download even mid-delivery (not terminal, no operator ready_for_delivery status needed)', () => {
    const s = getCustomerOrderState({
      jobStatus: 'completed', progressPercent: 100, workflowStatus: 'out_for_delivery', serviceLevel: NOTARY,
      fulfillmentMethod: 'delivery', hasReadyResultFiles: true,
    });
    expect(s.canDownload).toBe(true);
    expect(s.isTerminal).toBe(false);
  });

  it('multi-source notary: hasReadyResultFiles=false keeps download closed even at notarized/ready_for_delivery', () => {
    const s = getCustomerOrderState({
      jobStatus: 'completed', progressPercent: 100, workflowStatus: 'notarized', serviceLevel: NOTARY,
      hasReadyResultFiles: false,
    });
    expect(s.canDownload).toBe(false);
  });

  it('multi-source official: hasReadyResultFiles=false blocks download even after operator marks ready_for_delivery (sync must also be complete)', () => {
    const s = getCustomerOrderState({
      jobStatus: 'completed', progressPercent: 100, workflowStatus: 'ready_for_delivery', serviceLevel: OFFICIAL,
      hasReadyResultFiles: false,
    });
    expect(s.canDownload).toBe(false);
  });

  it('multi-source official: hasReadyResultFiles=true + ready_for_delivery → downloadable (both conditions met)', () => {
    const s = getCustomerOrderState({
      jobStatus: 'completed', progressPercent: 100, workflowStatus: 'ready_for_delivery', serviceLevel: OFFICIAL,
      hasReadyResultFiles: true,
    });
    expect(s.canDownload).toBe(true);
  });

  it('multi-source official: hasReadyResultFiles=true alone (before operator confirms) does NOT bypass the human approval gate', () => {
    const s = getCustomerOrderState({
      jobStatus: 'completed', progressPercent: 100, workflowStatus: 'translator_approved', serviceLevel: OFFICIAL,
      hasReadyResultFiles: true,
    });
    expect(s.canDownload).toBe(false);
  });

  it('canCustomerDownload standalone: notary explicit hasReadyResultFiles=true/false', () => {
    expect(canCustomerDownload('notarized', NOTARY, true)).toBe(true);
    expect(canCustomerDownload('notarized', NOTARY, false)).toBe(false);
    expect(canCustomerDownload('notarized', NOTARY)).toBe(false);
  });

  it('multi-source notary: once hasReadyResultFiles=true, download stays available through every subsequent workflow_status and is IDENTICAL across pickup/delivery/unset fulfillment — never regresses once ready', () => {
    const downstreamStatuses = ['notarized', 'ready_for_delivery', 'ready_for_pickup', 'out_for_delivery', 'delivered', 'picked_up'];
    const fulfillmentMethods: Array<'pickup' | 'delivery' | null | undefined> = ['pickup', 'delivery', null, undefined];

    for (const ws of downstreamStatuses) {
      for (const fm of fulfillmentMethods) {
        const s = getCustomerOrderState({
          jobStatus: 'completed', progressPercent: 100, workflowStatus: ws, serviceLevel: NOTARY,
          fulfillmentMethod: fm, hasReadyResultFiles: true,
        });
        expect(s.canDownload).toBe(true);
      }
    }
  });

  it('canCustomerDownload standalone: official requires both operatorConfirmed and hasReadyResultFiles when explicitly passed', () => {
    expect(canCustomerDownload('ready_for_delivery', OFFICIAL, true)).toBe(true);
    expect(canCustomerDownload('ready_for_delivery', OFFICIAL, false)).toBe(false);
    expect(canCustomerDownload('ready_for_delivery', OFFICIAL)).toBe(true); // legacy omitted
  });
});

describe('getCustomerOrderState — security: download gating', () => {
  it('certified in AI processing → never downloadable', () => {
    const SL = 'official_with_translator_signature_and_provider_stamp';
    for (const wf of [null, 'awaiting_translator_review', 'awaiting_signature_stamp', 'awaiting_final_qa']) {
      const s = getCustomerOrderState({ jobStatus: 'completed', progressPercent: 100, workflowStatus: wf, serviceLevel: SL });
      expect(s.canDownload).toBe(false);
    }
  });

  it('notarized awaiting any human stage → never downloadable', () => {
    const SL = 'notarization_through_partners';
    for (const wf of ['awaiting_translator_review', 'assigned_to_notary', 'notarization_in_progress', 'notarized']) {
      const s = getCustomerOrderState({ jobStatus: 'completed', progressPercent: 100, workflowStatus: wf, serviceLevel: SL });
      expect(s.canDownload).toBe(false);
    }
  });
});

describe('getCustomerOrderState — refunded / canceled (P0 production fix)', () => {
  it('refunded → customerStatus=refunded, terminal, not downloadable', () => {
    const s = getCustomerOrderState({ jobStatus: 'refunded', progressPercent: 0, workflowStatus: null, serviceLevel: 'electronic' });
    expect(s.customerStatus).toBe('refunded');
    expect(s.isTerminal).toBe(true);
    expect(s.canDownload).toBe(false);
    expect(s.isActive).toBe(false);
  });

  it('canceled → customerStatus=canceled, terminal, not downloadable', () => {
    const s = getCustomerOrderState({ jobStatus: 'canceled', progressPercent: 0, workflowStatus: null, serviceLevel: 'electronic' });
    expect(s.customerStatus).toBe('canceled');
    expect(s.isTerminal).toBe(true);
    expect(s.canDownload).toBe(false);
    expect(s.isActive).toBe(false);
  });

  it('isCustomerOrderTerminal returns true for refunded', () => {
    expect(isCustomerOrderTerminal('refunded')).toBe(true);
  });

  it('isCustomerOrderTerminal returns true for canceled', () => {
    expect(isCustomerOrderTerminal('canceled')).toBe(true);
  });

  it('refunded on certified service level → terminal, never downloadable', () => {
    const s = getCustomerOrderState({
      jobStatus: 'refunded', progressPercent: 0, workflowStatus: null,
      serviceLevel: 'official_with_translator_signature_and_provider_stamp',
    });
    expect(s.customerStatus).toBe('refunded');
    expect(s.isTerminal).toBe(true);
    expect(s.canDownload).toBe(false);
  });

  it('refunded on notarized service level → terminal, never downloadable', () => {
    const s = getCustomerOrderState({
      jobStatus: 'refunded', progressPercent: 0, workflowStatus: null,
      serviceLevel: 'notarization_through_partners',
    });
    expect(s.customerStatus).toBe('refunded');
    expect(s.isTerminal).toBe(true);
    expect(s.canDownload).toBe(false);
  });

  it('refunded takes priority over workflowStatus (no accidental terminal bypass)', () => {
    const s = getCustomerOrderState({
      jobStatus: 'refunded', progressPercent: 0, workflowStatus: 'awaiting_translator_review',
      serviceLevel: 'official_with_translator_signature_and_provider_stamp',
    });
    expect(s.customerStatus).toBe('refunded');
  });
});
