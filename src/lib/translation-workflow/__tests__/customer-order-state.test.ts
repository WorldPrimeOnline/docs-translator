import { getCustomerOrderState } from '../customer-order-state';

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

  it('ready_for_delivery → downloadable', () => {
    const s = getCustomerOrderState({ jobStatus: 'completed', progressPercent: 100, workflowStatus: 'ready_for_delivery', serviceLevel: SL });
    expect(s.customerStatus).toBe('ready_for_delivery');
    expect(s.canDownload).toBe(true);
    expect(s.progressPercent).toBe(100);
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

  it('delivered → terminal, downloadable', () => {
    const s = getCustomerOrderState({ jobStatus: 'completed', progressPercent: 100, workflowStatus: 'delivered', serviceLevel: SL });
    expect(s.customerStatus).toBe('delivered');
    expect(s.isTerminal).toBe(true);
    expect(s.canDownload).toBe(true);
  });
});

describe('getCustomerOrderState — notarized', () => {
  const SL = 'notarization_through_partners';

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

  it('ready_for_delivery → downloadable', () => {
    const s = getCustomerOrderState({ jobStatus: 'completed', progressPercent: 100, workflowStatus: 'ready_for_delivery', serviceLevel: SL, fulfillmentMethod: 'delivery' });
    expect(s.canDownload).toBe(true);
    expect(s.progressPercent).toBe(100);
  });

  it('ready_for_pickup → downloadable', () => {
    const s = getCustomerOrderState({ jobStatus: 'completed', progressPercent: 100, workflowStatus: 'ready_for_pickup', serviceLevel: SL, fulfillmentMethod: 'pickup' });
    expect(s.canDownload).toBe(true);
  });

  it('out_for_delivery → downloadable, NOT terminal', () => {
    const s = getCustomerOrderState({ jobStatus: 'completed', progressPercent: 100, workflowStatus: 'out_for_delivery', serviceLevel: SL, fulfillmentMethod: 'delivery' });
    expect(s.canDownload).toBe(true);
    expect(s.isTerminal).toBe(false);
  });

  it('notarized stages (delivery) include notary steps — 9 stages', () => {
    const s = getCustomerOrderState({ jobStatus: 'completed', progressPercent: 100, workflowStatus: 'assigned_to_notary', serviceLevel: SL, fulfillmentMethod: 'delivery' });
    const keys = s.stages.map((x) => x.key);
    expect(keys).toContain('assigned_to_notary');
    expect(keys).toContain('notarization_in_progress');
    expect(keys).toContain('notarized');
    expect(keys).toContain('out_for_delivery');
    expect(keys.length).toBe(9);
  });

  it('notarized stages (pickup) exclude out_for_delivery — 8 stages', () => {
    const s = getCustomerOrderState({ jobStatus: 'completed', progressPercent: 100, workflowStatus: 'assigned_to_notary', serviceLevel: SL, fulfillmentMethod: 'pickup' });
    const keys = s.stages.map((x) => x.key);
    expect(keys).not.toContain('out_for_delivery');
    expect(keys.length).toBe(8);
  });

  it('notary_declined → terminal, not downloadable', () => {
    const s = getCustomerOrderState({ jobStatus: 'completed', progressPercent: 100, workflowStatus: 'notary_declined', serviceLevel: SL });
    expect(s.isTerminal).toBe(true);
    expect(s.canDownload).toBe(false);
  });

  it('delivered → terminal', () => {
    const s = getCustomerOrderState({ jobStatus: 'completed', progressPercent: 100, workflowStatus: 'delivered', serviceLevel: SL });
    expect(s.isTerminal).toBe(true);
    expect(s.customerStatus).toBe('delivered');
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
