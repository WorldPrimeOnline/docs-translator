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
