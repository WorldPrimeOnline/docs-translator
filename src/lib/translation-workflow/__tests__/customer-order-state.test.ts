import { getCustomerOrderState, canCustomerDownload, isCustomerOrderTerminal } from '../customer-order-state';

describe('getCustomerOrderState — electronic', () => {
  it('queued → 0%, not downloadable, not terminal', () => {
    const s = getCustomerOrderState({ jobStatus: 'queued', progressPercent: 0, workflowStatus: null, serviceLevel: 'electronic' });
    expect(s.customerStatus).toBe('queued');
    expect(s.canDownload).toBe(false);
    expect(s.isTerminal).toBe(false);
    expect(s.progressPercent).toBe(0);
  });

  it('ocr_in_progress → processing, not terminal', () => {
    const s = getCustomerOrderState({ jobStatus: 'ocr_in_progress', progressPercent: 20, workflowStatus: null, serviceLevel: 'electronic' });
    expect(s.customerStatus).toBe('ocr_in_progress');
    expect(s.isTerminal).toBe(false);
    expect(s.canDownload).toBe(false);
  });

  it('completed + no workflowStatus → downloadable, terminal', () => {
    const s = getCustomerOrderState({ jobStatus: 'completed', progressPercent: 100, workflowStatus: null, serviceLevel: 'electronic' });
    expect(s.customerStatus).toBe('completed');
    expect(s.canDownload).toBe(true);
    expect(s.isTerminal).toBe(true);
    expect(s.progressPercent).toBe(100);
  });

  it('failed → not downloadable, terminal', () => {
    const s = getCustomerOrderState({ jobStatus: 'failed', progressPercent: 0, workflowStatus: null, serviceLevel: 'electronic' });
    expect(s.customerStatus).toBe('failed');
    expect(s.canDownload).toBe(false);
    expect(s.isTerminal).toBe(true);
  });

  it('electronic stages in correct order', () => {
    const s = getCustomerOrderState({ jobStatus: 'translation_in_progress', progressPercent: 50, workflowStatus: null, serviceLevel: 'electronic' });
    expect(s.stages.map((x) => x.key)).toEqual(['uploaded', 'ocr', 'translating', 'rendering', 'done']);
    const current = s.stages.find((x) => x.current);
    expect(current?.key).toBe('translating');
  });
});

describe('getCustomerOrderState — certified', () => {
  const SL = 'official_with_translator_signature_and_provider_stamp';

  it('awaiting_translator_review → NOT downloadable, NOT terminal', () => {
    const s = getCustomerOrderState({ jobStatus: 'completed', progressPercent: 100, workflowStatus: 'awaiting_translator_review', serviceLevel: SL });
    expect(s.customerStatus).toBe('awaiting_translator_review');
    expect(s.canDownload).toBe(false);
    expect(s.isTerminal).toBe(false);
    expect(s.progressPercent).toBeLessThan(100);
  });

  // 2026-08-04: Jira status "В работе у переводчика" → workflow_status =
  // translator_review_in_progress. Order stays active, not downloadable, same
  // "translator_review" stage bucket as awaiting_translator_review.
  it('translator_review_in_progress (Official) → NOT downloadable, NOT terminal, active', () => {
    const s = getCustomerOrderState({ jobStatus: 'completed', progressPercent: 100, workflowStatus: 'translator_review_in_progress', serviceLevel: SL });
    expect(s.customerStatus).toBe('translator_review_in_progress');
    expect(s.canDownload).toBe(false);
    expect(s.isTerminal).toBe(false);
    expect(s.isActive).toBe(true);
  });

  it('translator_review_in_progress (Official) maps to the same current stage as awaiting_translator_review', () => {
    const a = getCustomerOrderState({ jobStatus: 'completed', progressPercent: 100, workflowStatus: 'awaiting_translator_review', serviceLevel: SL });
    const b = getCustomerOrderState({ jobStatus: 'completed', progressPercent: 100, workflowStatus: 'translator_review_in_progress', serviceLevel: SL });
    const stageA = a.stages.findIndex((x) => x.current);
    const stageB = b.stages.findIndex((x) => x.current);
    expect(stageB).toBe(stageA);
  });

  it('translator_approved → NOT downloadable', () => {
    const s = getCustomerOrderState({ jobStatus: 'completed', progressPercent: 100, workflowStatus: 'translator_approved', serviceLevel: SL });
    expect(s.customerStatus).toBe('translator_approved');
    expect(s.canDownload).toBe(false);
  });

  it('awaiting_signature_stamp → NOT downloadable', () => {
    const s = getCustomerOrderState({ jobStatus: 'completed', progressPercent: 100, workflowStatus: 'awaiting_signature_stamp', serviceLevel: SL });
    expect(s.customerStatus).toBe('awaiting_signature_stamp');
    expect(s.canDownload).toBe(false);
  });

  it('ready_for_delivery → downloadable for certified', () => {
    const s = getCustomerOrderState({ jobStatus: 'completed', progressPercent: 100, workflowStatus: 'ready_for_delivery', serviceLevel: SL });
    expect(s.customerStatus).toBe('ready_for_delivery');
    expect(s.canDownload).toBe(true);
    expect(s.progressPercent).toBe(100);
  });

  it('delivered (certified) → terminal, downloadable', () => {
    const s = getCustomerOrderState({ jobStatus: 'completed', progressPercent: 100, workflowStatus: 'delivered', serviceLevel: SL });
    expect(s.customerStatus).toBe('delivered');
    expect(s.isTerminal).toBe(true);
    expect(s.canDownload).toBe(true);
  });

  it('translator_declined → not downloadable, terminal', () => {
    const s = getCustomerOrderState({ jobStatus: 'completed', progressPercent: 100, workflowStatus: 'translator_declined', serviceLevel: SL });
    expect(s.customerStatus).toBe('translator_declined');
    expect(s.canDownload).toBe(false);
    expect(s.isTerminal).toBe(true);
  });

  it('certified stages in correct order (7 stages)', () => {
    const s = getCustomerOrderState({ jobStatus: 'completed', progressPercent: 100, workflowStatus: 'awaiting_translator_review', serviceLevel: SL });
    expect(s.stages.map((x) => x.key)).toEqual([
      'uploaded', 'ai_processing', 'translator_review', 'translator_approved', 'signature_stamp', 'ready', 'delivered',
    ]);
  });
});

describe('getCustomerOrderState — notarized delivery', () => {
  const SL = 'notarization_through_partners';

  it('OUT_FOR_DELIVERY → workflow = out_for_delivery, NOT terminal, canDownload = false', () => {
    const s = getCustomerOrderState({ jobStatus: 'completed', progressPercent: 100, workflowStatus: 'out_for_delivery', serviceLevel: SL, fulfillmentMethod: 'delivery' });
    expect(s.customerStatus).toBe('out_for_delivery');
    expect(s.isTerminal).toBe(false);
    expect(s.canDownload).toBe(false);
    expect(s.isActive).toBe(true);
  });

  it('DELIVERED → workflow = delivered, terminal, canDownload = false, goes to history', () => {
    const s = getCustomerOrderState({ jobStatus: 'completed', progressPercent: 100, workflowStatus: 'delivered', serviceLevel: SL, fulfillmentMethod: 'delivery' });
    expect(s.customerStatus).toBe('delivered');
    expect(s.isTerminal).toBe(true);
    expect(s.canDownload).toBe(false);
    expect(s.isActive).toBe(false);
  });

  it('PICKED_UP → workflow = picked_up, terminal, canDownload = false', () => {
    const s = getCustomerOrderState({ jobStatus: 'completed', progressPercent: 100, workflowStatus: 'picked_up', serviceLevel: SL, fulfillmentMethod: 'pickup' });
    expect(s.customerStatus).toBe('picked_up');
    expect(s.isTerminal).toBe(true);
    expect(s.canDownload).toBe(false);
    expect(s.isActive).toBe(false);
  });

  it('assigned_to_notary → NOT downloadable, NOT terminal', () => {
    const s = getCustomerOrderState({ jobStatus: 'completed', progressPercent: 100, workflowStatus: 'assigned_to_notary', serviceLevel: SL });
    expect(s.customerStatus).toBe('assigned_to_notary');
    expect(s.canDownload).toBe(false);
    expect(s.isTerminal).toBe(false);
  });

  it('translator_review_in_progress (Notary) → NOT downloadable, NOT terminal, active, unaffected by hasReadyResultFiles', () => {
    const s = getCustomerOrderState({ jobStatus: 'completed', progressPercent: 100, workflowStatus: 'translator_review_in_progress', serviceLevel: SL, hasReadyResultFiles: false });
    expect(s.customerStatus).toBe('translator_review_in_progress');
    expect(s.canDownload).toBe(false);
    expect(s.isTerminal).toBe(false);
    expect(s.isActive).toBe(true);
  });

  it('notarization_in_progress → NOT downloadable', () => {
    const s = getCustomerOrderState({ jobStatus: 'completed', progressPercent: 100, workflowStatus: 'notarization_in_progress', serviceLevel: SL });
    expect(s.customerStatus).toBe('notarization_in_progress');
    expect(s.canDownload).toBe(false);
  });

  it('notarized → NOT downloadable (still with notary)', () => {
    const s = getCustomerOrderState({ jobStatus: 'completed', progressPercent: 100, workflowStatus: 'notarized', serviceLevel: SL });
    expect(s.customerStatus).toBe('notarized');
    expect(s.canDownload).toBe(false);
  });

  it('ready_for_delivery (notarized physical) → canDownload = false', () => {
    const s = getCustomerOrderState({ jobStatus: 'completed', progressPercent: 100, workflowStatus: 'ready_for_delivery', serviceLevel: SL, fulfillmentMethod: 'delivery' });
    expect(s.customerStatus).toBe('ready_for_delivery');
    expect(s.canDownload).toBe(false);
    expect(s.isTerminal).toBe(false);
  });

  it('ready_for_pickup (notarized physical) → canDownload = false', () => {
    const s = getCustomerOrderState({ jobStatus: 'completed', progressPercent: 100, workflowStatus: 'ready_for_pickup', serviceLevel: SL, fulfillmentMethod: 'pickup' });
    expect(s.customerStatus).toBe('ready_for_pickup');
    expect(s.canDownload).toBe(false);
    expect(s.isTerminal).toBe(false);
  });

  it('notarized delivery stages include all 9 steps', () => {
    const s = getCustomerOrderState({ jobStatus: 'completed', progressPercent: 100, workflowStatus: 'assigned_to_notary', serviceLevel: SL, fulfillmentMethod: 'delivery' });
    const keys = s.stages.map((x) => x.key);
    expect(keys).toContain('translator_approved');
    expect(keys).toContain('notarization_in_progress');
    expect(keys).toContain('notarized');
    expect(keys).toContain('out_for_delivery');
    expect(keys).toContain('delivered');
    expect(keys.length).toBe(9);
  });

  it('notarized pickup stages exclude out_for_delivery — 8 stages with picked_up', () => {
    const s = getCustomerOrderState({ jobStatus: 'completed', progressPercent: 100, workflowStatus: 'assigned_to_notary', serviceLevel: SL, fulfillmentMethod: 'pickup' });
    const keys = s.stages.map((x) => x.key);
    expect(keys).not.toContain('out_for_delivery');
    expect(keys).toContain('picked_up');
    expect(keys.length).toBe(8);
  });

  it('notary_declined → terminal, not downloadable', () => {
    const s = getCustomerOrderState({ jobStatus: 'completed', progressPercent: 100, workflowStatus: 'notary_declined', serviceLevel: SL });
    expect(s.isTerminal).toBe(true);
    expect(s.canDownload).toBe(false);
  });

  it('stage 4 label is translatorApproved not assignedToNotary', () => {
    const s = getCustomerOrderState({ jobStatus: 'completed', progressPercent: 100, workflowStatus: 'assigned_to_notary', serviceLevel: SL, fulfillmentMethod: 'delivery' });
    const stage4 = s.stages[3];
    expect(stage4?.labelKey).toBe('stages.translatorApproved');
  });

  it('translator_approved maps to same stage as assigned_to_notary (stage 4)', () => {
    const s1 = getCustomerOrderState({ jobStatus: 'completed', progressPercent: 100, workflowStatus: 'translator_approved', serviceLevel: SL, fulfillmentMethod: 'delivery' });
    const s2 = getCustomerOrderState({ jobStatus: 'completed', progressPercent: 100, workflowStatus: 'assigned_to_notary', serviceLevel: SL, fulfillmentMethod: 'delivery' });
    const cur1 = s1.stages.findIndex((x) => x.current);
    const cur2 = s2.stages.findIndex((x) => x.current);
    expect(cur1).toBe(cur2);
    expect(cur1).toBe(3);
  });

  // 2026-07-23 dashboard task, Part A/E: the progress timeline must show the 'notarized'
  // stage as complete (done) exactly once workflow_status==='notarized', and must only
  // advance to a delivery-specific stage next when fulfillmentMethod==='delivery' —
  // never for pickup, and never skipping ahead before the notary step actually finishes.
  describe('notary-completed timeline transitions (2026-07-23 dashboard task)', () => {
    it('workflowStatus=notarized, fulfillmentMethod=delivery: "notarized" stage is current, next (out_for_delivery) stage is not yet reached', () => {
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

    it('workflowStatus advances past notarized to ready_for_delivery (delivery): "notarized" stage flips to done, delivery stage becomes current', () => {
      const s = getCustomerOrderState({ jobStatus: 'completed', progressPercent: 100, workflowStatus: 'ready_for_delivery', serviceLevel: SL, fulfillmentMethod: 'delivery' });
      const notarizedStage = s.stages.find((x) => x.key === 'notarized');
      const readyStage = s.stages.find((x) => x.key === 'ready');
      expect(notarizedStage?.done).toBe(true);
      expect(notarizedStage?.current).toBe(false);
      expect(readyStage?.current).toBe(true);
      expect(s.customerStatus).toBe('ready_for_delivery');
    });

    it('workflowStatus=notarized, fulfillmentMethod=pickup ("no delivery"): "notarized" stage is current, the pickup-specific ready stage (readyForPickup label) comes next — no out_for_delivery stage exists at all', () => {
      const s = getCustomerOrderState({ jobStatus: 'completed', progressPercent: 100, workflowStatus: 'notarized', serviceLevel: SL, fulfillmentMethod: 'pickup' });
      const keys = s.stages.map((x) => x.key);
      expect(keys).not.toContain('out_for_delivery');
      const notarizedStage = s.stages.find((x) => x.key === 'notarized');
      expect(notarizedStage?.current).toBe(true);
      const readyStage = s.stages.find((x) => x.key === 'ready');
      expect(readyStage?.labelKey).toBe('stages.readyForPickup');
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
    // Simulate: DB has workflow_status = 'delivered' (correct final state)
    const s = getCustomerOrderState({ jobStatus: 'completed', progressPercent: 100, workflowStatus: 'delivered', serviceLevel: SL, fulfillmentMethod: 'delivery' });
    expect(s.customerStatus).toBe('delivered');
    expect(s.isTerminal).toBe(true);
  });

  it('delivered order stays delivered after late NOTARY_COMPLETED', () => {
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

  it('notarized physical order NEVER gets download button', () => {
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
    expect(s.isActive).toBe(true); // isTerminal=true but canDownload=true → isActive=true
    expect(s.isTerminal).toBe(true);
  });
});

describe('Unknown workflow_status does not reset to translator stage', () => {
  it('unknown workflow_status on completed job → operator_processing (not awaiting_translator_review)', () => {
    const s = getCustomerOrderState({ jobStatus: 'completed', progressPercent: 100, workflowStatus: 'some_future_status', serviceLevel: 'notarization_through_partners' });
    expect(s.customerStatus).toBe('operator_processing');
    expect(s.customerStatus).not.toBe('awaiting_translator_review');
  });

  it('2026-07-25 regression requirement: an unrecognized status combination must safely stay ACTIVE, never silently disappear', () => {
    const s = getCustomerOrderState({ jobStatus: 'completed', progressPercent: 100, workflowStatus: 'some_future_status', serviceLevel: 'notarization_through_partners' });
    expect(s.isTerminal).toBe(false);
    expect(s.isActive).toBe(true);
  });
});

describe('2026-07-25 staging regression — payment_pending must always be active, regardless of workflow_status', () => {
  it('a brand-new order (payment_pending, quote just calculated, workflow_status=null) is active, not terminal', () => {
    const s = getCustomerOrderState({ jobStatus: 'payment_pending', progressPercent: 0, workflowStatus: null, serviceLevel: 'official_with_translator_signature_and_provider_stamp' });
    expect(s.customerStatus).toBe('payment_pending');
    expect(s.isActive).toBe(true);
    expect(s.isTerminal).toBe(false);
  });

  it('payment_pending with a legacy/default workflow_status="completed" is STILL active — jobStatus is checked before any workflow_status branch', () => {
    const s = getCustomerOrderState({ jobStatus: 'payment_pending', progressPercent: 0, workflowStatus: 'completed', serviceLevel: 'notarization_through_partners' });
    expect(s.customerStatus).toBe('payment_pending');
    expect(s.isActive).toBe(true);
    expect(s.isTerminal).toBe(false);
  });

  it('payment_pending with ANY workflow_status value (even a terminal-looking one like "delivered") is still active — jobStatus=payment_pending always wins', () => {
    const s = getCustomerOrderState({ jobStatus: 'payment_pending', progressPercent: 0, workflowStatus: 'delivered', serviceLevel: 'notarization_through_partners' });
    expect(s.customerStatus).toBe('payment_pending');
    expect(s.isActive).toBe(true);
    expect(s.isTerminal).toBe(false);
  });
});

describe('Legacy workflow_status="completed" on non-electronic jobs', () => {
  it('notarized job with workflow_status=completed → awaiting_translator_review (not operator_processing)', () => {
    // Old worker code set workflow_status='completed' instead of 'awaiting_translator_review'
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

  it('canCustomerDownload: notarized → always false', () => {
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
    expect(s.isTerminal).toBe(false); // order itself isn't done until delivered — only download opened
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
      jobStatus: 'refunded',
      progressPercent: 0,
      workflowStatus: null,
      serviceLevel: 'official_with_translator_signature_and_provider_stamp',
    });
    expect(s.customerStatus).toBe('refunded');
    expect(s.isTerminal).toBe(true);
    expect(s.canDownload).toBe(false);
  });

  it('refunded on notarized service level → terminal, never downloadable', () => {
    const s = getCustomerOrderState({
      jobStatus: 'refunded',
      progressPercent: 0,
      workflowStatus: null,
      serviceLevel: 'notarization_through_partners',
    });
    expect(s.customerStatus).toBe('refunded');
    expect(s.isTerminal).toBe(true);
    expect(s.canDownload).toBe(false);
  });

  it('refunded takes priority over workflowStatus (no accidental terminal bypass)', () => {
    const s = getCustomerOrderState({
      jobStatus: 'refunded',
      progressPercent: 0,
      workflowStatus: 'awaiting_translator_review',
      serviceLevel: 'official_with_translator_signature_and_provider_stamp',
    });
    expect(s.customerStatus).toBe('refunded');
  });
});

describe('getCustomerOrderState — progress never premature 100%', () => {
  it('electronic pdf_rendering at 80% is NOT 100%', () => {
    const s = getCustomerOrderState({ jobStatus: 'pdf_rendering', progressPercent: 80, workflowStatus: null, serviceLevel: 'electronic' });
    expect(s.progressPercent).toBeLessThan(100);
  });

  it('certified awaiting translator is NOT 100%', () => {
    const s = getCustomerOrderState({ jobStatus: 'completed', progressPercent: 100, workflowStatus: 'awaiting_translator_review', serviceLevel: 'official_with_translator_signature_and_provider_stamp' });
    expect(s.progressPercent).toBeLessThan(100);
  });
});
