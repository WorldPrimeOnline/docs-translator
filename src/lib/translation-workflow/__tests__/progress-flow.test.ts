/**
 * 2026-07-26 architectural fix: per-service-level customer progress resolver.
 * Replaces the single universal scale that applied identical percentages to
 * Electronic/Official/Notary regardless of how many real stages each has.
 */
import { resolveCustomerProgressFlow, derivePaymentStatus, type ProgressFlowInput } from '../progress-flow';

function baseInput(overrides: Partial<ProgressFlowInput> = {}): ProgressFlowInput {
  return {
    serviceLevel: 'electronic',
    fulfillmentMethod: null,
    paymentStatus: 'paid',
    workflowStatus: null,
    workerStatus: 'queued',
    rawProgress: 0,
    ...overrides,
  };
}

describe('derivePaymentStatus', () => {
  it('quoted (checkout not started) -> quote_ready', () => {
    expect(derivePaymentStatus('payment_pending', 'quoted')).toBe('quote_ready');
  });
  it('quote payment_pending (customer clicked pay, Halyk processing) -> payment_checking', () => {
    expect(derivePaymentStatus('payment_pending', 'payment_pending')).toBe('payment_checking');
  });
  it('any other/missing quote status while job is payment_pending -> the safe generic payment_pending default', () => {
    expect(derivePaymentStatus('payment_pending', 'requires_operator_review')).toBe('payment_pending');
    expect(derivePaymentStatus('payment_pending', null)).toBe('payment_pending');
    expect(derivePaymentStatus('payment_pending', undefined)).toBe('payment_pending');
  });
  it('job failed -> payment_failed', () => {
    expect(derivePaymentStatus('failed', null)).toBe('payment_failed');
  });
  it('any non-payment_pending, non-failed jobStatus -> paid (fulfillment progress begins)', () => {
    for (const js of ['queued', 'ocr_in_progress', 'translation_in_progress', 'pdf_rendering', 'completed']) {
      expect(derivePaymentStatus(js, 'paid')).toBe('paid');
    }
  });
});

describe('resolveCustomerProgressFlow — pre-payment (Rule 1)', () => {
  it.each(['quote_ready', 'payment_pending', 'payment_checking', 'payment_failed'] as const)(
    'paymentStatus=%s: percent is null, showFulfillmentProgress is false, no stages at all',
    (paymentStatus) => {
      const result = resolveCustomerProgressFlow(baseInput({ paymentStatus }));
      expect(result.percent).toBeNull();
      expect(result.showFulfillmentProgress).toBe(false);
      expect(result.stages).toEqual([]);
    },
  );

  it('each pre-payment status gets its own distinct labelKey', () => {
    const keys = (['quote_ready', 'payment_pending', 'payment_checking', 'payment_failed'] as const)
      .map((paymentStatus) => resolveCustomerProgressFlow(baseInput({ paymentStatus })).labelKey);
    expect(new Set(keys).size).toBe(4);
  });
});

describe('FLOW 1 — Electronic', () => {
  it('paid (queued, nothing started yet) -> 10%', () => {
    const r = resolveCustomerProgressFlow(baseInput({ workerStatus: 'queued' }));
    expect(r.percent).toBe(10);
    expect(r.currentStageId).toBe('paid');
  });

  it('processing (worker pipeline running) -> scales within 10-90 by raw progress, label stays "processing"', () => {
    const low = resolveCustomerProgressFlow(baseInput({ workerStatus: 'ocr_in_progress', rawProgress: 0 }));
    const mid = resolveCustomerProgressFlow(baseInput({ workerStatus: 'translation_in_progress', rawProgress: 50 }));
    const high = resolveCustomerProgressFlow(baseInput({ workerStatus: 'pdf_rendering', rawProgress: 100 }));
    expect(low.percent).toBeGreaterThanOrEqual(10);
    expect(low.percent).toBeLessThan(mid.percent!);
    expect(mid.percent).toBeLessThan(high.percent!);
    expect(high.percent).toBeLessThanOrEqual(90);
    expect(low.currentStageId).toBe('processing');
    expect(mid.currentStageId).toBe('processing');
    expect(high.currentStageId).toBe('processing');
  });

  it('ready/completed -> 100%', () => {
    const r = resolveCustomerProgressFlow(baseInput({ workerStatus: 'completed' }));
    expect(r.percent).toBe(100);
    expect(r.currentStageId).toBe('ready');
  });

  it('the stage table contains exactly 3 stages — no translator/notary/courier markers at all', () => {
    const r = resolveCustomerProgressFlow(baseInput({ workerStatus: 'completed' }));
    expect(r.stages.map((s) => s.id)).toEqual(['paid', 'processing', 'ready']);
    for (const id of ['translator_review_in_progress', 'notarization_in_progress', 'out_for_delivery', 'notarized']) {
      expect(r.stages.some((s) => s.id === id)).toBe(false);
    }
  });

  it('never shows "Создание PDF" — pdf_rendering maps to the same merged "processing" label as ocr_in_progress', () => {
    const ocr = resolveCustomerProgressFlow(baseInput({ workerStatus: 'ocr_in_progress' }));
    const pdf = resolveCustomerProgressFlow(baseInput({ workerStatus: 'pdf_rendering' }));
    expect(ocr.labelKey).toBe(pdf.labelKey);
    expect(ocr.labelKey).toBe('progressFlow.electronic.processing');
  });
});

describe('FLOW 2 — Official (signature + stamp)', () => {
  const SL = 'official_with_translator_signature_and_provider_stamp';

  it('paid -> 10%', () => {
    expect(resolveCustomerProgressFlow(baseInput({ serviceLevel: SL, workerStatus: 'queued' })).percent).toBe(10);
  });
  it('processing -> 25%', () => {
    expect(resolveCustomerProgressFlow(baseInput({ serviceLevel: SL, workerStatus: 'ocr_in_progress' })).percent).toBe(25);
  });
  it('awaiting_translator_review -> 40%', () => {
    const r = resolveCustomerProgressFlow(baseInput({ serviceLevel: SL, workerStatus: 'completed', workflowStatus: 'awaiting_translator_review' }));
    expect(r.percent).toBe(40);
  });
  it('translator_review_in_progress -> 60%', () => {
    const r = resolveCustomerProgressFlow(baseInput({ serviceLevel: SL, workerStatus: 'completed', workflowStatus: 'translator_review_in_progress' }));
    expect(r.percent).toBe(60);
  });
  it('translator_approved / awaiting_signature_stamp -> 80% (same "signature stage")', () => {
    const a = resolveCustomerProgressFlow(baseInput({ serviceLevel: SL, workerStatus: 'completed', workflowStatus: 'translator_approved' }));
    const b = resolveCustomerProgressFlow(baseInput({ serviceLevel: SL, workerStatus: 'completed', workflowStatus: 'awaiting_signature_stamp' }));
    expect(a.percent).toBe(80);
    expect(b.percent).toBe(80);
    expect(a.currentStageId).toBe(b.currentStageId);
  });
  it('ready_for_delivery / delivered -> 100%', () => {
    const a = resolveCustomerProgressFlow(baseInput({ serviceLevel: SL, workerStatus: 'completed', workflowStatus: 'ready_for_delivery' }));
    const b = resolveCustomerProgressFlow(baseInput({ serviceLevel: SL, workerStatus: 'completed', workflowStatus: 'delivered' }));
    expect(a.percent).toBe(100);
    expect(b.percent).toBe(100);
  });

  it('the stage table has exactly 6 stages — no notary/courier markers at all', () => {
    const r = resolveCustomerProgressFlow(baseInput({ serviceLevel: SL, workerStatus: 'completed', workflowStatus: 'delivered' }));
    expect(r.stages.map((s) => s.id)).toEqual(['paid', 'processing', 'awaiting_translator_review', 'translator_review_in_progress', 'signature_stage', 'ready']);
    for (const id of ['notarization_in_progress', 'notarized', 'out_for_delivery', 'approved_for_notary']) {
      expect(r.stages.some((s) => s.id === id)).toBe(false);
    }
  });

  it('delivery is never added automatically without a real fulfillmentMethod — the stage table is identical regardless of fulfillmentMethod input', () => {
    const withDelivery = resolveCustomerProgressFlow(baseInput({ serviceLevel: SL, fulfillmentMethod: 'delivery', workerStatus: 'completed', workflowStatus: 'ready_for_delivery' }));
    const withoutFulfillment = resolveCustomerProgressFlow(baseInput({ serviceLevel: SL, fulfillmentMethod: null, workerStatus: 'completed', workflowStatus: 'ready_for_delivery' }));
    expect(withDelivery.stages).toEqual(withoutFulfillment.stages);
  });
});

describe('FLOW 3 — Notary without courier (no fulfillment method)', () => {
  const SL = 'notarization_through_partners';

  it('paid -> 10%, processing -> 20%', () => {
    expect(resolveCustomerProgressFlow(baseInput({ serviceLevel: SL, workerStatus: 'queued' })).percent).toBe(10);
    expect(resolveCustomerProgressFlow(baseInput({ serviceLevel: SL, workerStatus: 'ocr_in_progress' })).percent).toBe(20);
  });
  it('awaiting_translator_review -> 35%, translator_review_in_progress -> 50%', () => {
    expect(resolveCustomerProgressFlow(baseInput({ serviceLevel: SL, workerStatus: 'completed', workflowStatus: 'awaiting_translator_review' })).percent).toBe(35);
    expect(resolveCustomerProgressFlow(baseInput({ serviceLevel: SL, workerStatus: 'completed', workflowStatus: 'translator_review_in_progress' })).percent).toBe(50);
  });
  it('translator_approved / assigned_to_notary -> 65%', () => {
    const a = resolveCustomerProgressFlow(baseInput({ serviceLevel: SL, workerStatus: 'completed', workflowStatus: 'translator_approved' }));
    const b = resolveCustomerProgressFlow(baseInput({ serviceLevel: SL, workerStatus: 'completed', workflowStatus: 'assigned_to_notary' }));
    expect(a.percent).toBe(65);
    expect(b.percent).toBe(65);
  });
  it('notarization_in_progress -> 80%', () => {
    expect(resolveCustomerProgressFlow(baseInput({ serviceLevel: SL, workerStatus: 'completed', workflowStatus: 'notarization_in_progress' })).percent).toBe(80);
  });
  it('notarized -> 100% (no fulfillment method: electronic scan is the whole deliverable)', () => {
    const r = resolveCustomerProgressFlow(baseInput({ serviceLevel: SL, workerStatus: 'completed', workflowStatus: 'notarized' }));
    expect(r.percent).toBe(100);
    expect(r.currentStageId).toBe('notarized');
  });

  it('the stage table has exactly 7 stages, terminal at notarized — no pickup/courier markers', () => {
    const r = resolveCustomerProgressFlow(baseInput({ serviceLevel: SL, workerStatus: 'completed', workflowStatus: 'notarized' }));
    expect(r.stages.map((s) => s.id)).toEqual(['paid', 'processing', 'awaiting_translator_review', 'translator_review_in_progress', 'approved_for_notary', 'notarization_in_progress', 'notarized']);
  });
});

describe('FLOW 3b — Notary with pickup', () => {
  const SL = 'notarization_through_partners';

  it('notarized -> 90%, ready_for_pickup -> 95%, picked_up -> 100%', () => {
    const notarized = resolveCustomerProgressFlow(baseInput({ serviceLevel: SL, fulfillmentMethod: 'pickup', workerStatus: 'completed', workflowStatus: 'notarized' }));
    const ready = resolveCustomerProgressFlow(baseInput({ serviceLevel: SL, fulfillmentMethod: 'pickup', workerStatus: 'completed', workflowStatus: 'ready_for_pickup' }));
    const pickedUp = resolveCustomerProgressFlow(baseInput({ serviceLevel: SL, fulfillmentMethod: 'pickup', workerStatus: 'completed', workflowStatus: 'picked_up' }));
    expect(notarized.percent).toBe(90);
    expect(ready.percent).toBe(95);
    expect(pickedUp.percent).toBe(100);
  });

  it('9 stages total, includes ready_for_pickup/picked_up, no courier markers', () => {
    const r = resolveCustomerProgressFlow(baseInput({ serviceLevel: SL, fulfillmentMethod: 'pickup', workerStatus: 'completed', workflowStatus: 'picked_up' }));
    expect(r.stages.map((s) => s.id)).toEqual(['paid', 'processing', 'awaiting_translator_review', 'translator_review_in_progress', 'approved_for_notary', 'notarization_in_progress', 'notarized', 'ready_for_pickup', 'picked_up']);
    expect(r.stages.some((s) => s.id === 'out_for_delivery' || s.id === 'delivered')).toBe(false);
  });
});

describe('FLOW 4 — Notary with courier', () => {
  const SL = 'notarization_through_partners';

  it('notarized -> 90%, out_for_delivery -> 96%, delivered -> 100%', () => {
    const notarized = resolveCustomerProgressFlow(baseInput({ serviceLevel: SL, fulfillmentMethod: 'delivery', workerStatus: 'completed', workflowStatus: 'notarized' }));
    const outForDelivery = resolveCustomerProgressFlow(baseInput({ serviceLevel: SL, fulfillmentMethod: 'delivery', workerStatus: 'completed', workflowStatus: 'out_for_delivery' }));
    const delivered = resolveCustomerProgressFlow(baseInput({ serviceLevel: SL, fulfillmentMethod: 'delivery', workerStatus: 'completed', workflowStatus: 'delivered' }));
    expect(notarized.percent).toBe(90);
    expect(outForDelivery.percent).toBe(96);
    expect(delivered.percent).toBe(100);
  });

  it('ready_for_delivery -> 92%', () => {
    const r = resolveCustomerProgressFlow(baseInput({ serviceLevel: SL, fulfillmentMethod: 'delivery', workerStatus: 'completed', workflowStatus: 'ready_for_delivery' }));
    expect(r.percent).toBe(92);
  });

  it('the scan is available at notarized (90%) already, independent of everything that comes after — canCustomerDownload is untouched by this fix and already grants download purely from hasReadyResultFiles', () => {
    // This resolver only controls the displayed percent/label — it asserts nothing
    // about download gating (a separate, untouched function), but locks in that
    // 'notarized' itself is reachable at 90%, not deferred until delivered.
    const r = resolveCustomerProgressFlow(baseInput({ serviceLevel: SL, fulfillmentMethod: 'delivery', workerStatus: 'completed', workflowStatus: 'notarized' }));
    expect(r.currentStageId).toBe('notarized');
    expect(r.percent).toBe(90);
  });

  it('10 stages total', () => {
    const r = resolveCustomerProgressFlow(baseInput({ serviceLevel: SL, fulfillmentMethod: 'delivery', workerStatus: 'completed', workflowStatus: 'delivered' }));
    expect(r.stages.map((s) => s.id)).toEqual(['paid', 'processing', 'awaiting_translator_review', 'translator_review_in_progress', 'approved_for_notary', 'notarization_in_progress', 'notarized', 'ready_for_delivery', 'out_for_delivery', 'delivered']);
  });
});

describe('General invariants', () => {
  it('monotonicity: the full realistic sequence for each flow is strictly increasing', () => {
    const officialSeq: Array<[string | null, string]> = [
      [null, 'queued'], [null, 'ocr_in_progress'], ['awaiting_translator_review', 'completed'],
      ['translator_review_in_progress', 'completed'], ['translator_approved', 'completed'],
      ['ready_for_delivery', 'completed'],
    ];
    const percentages = officialSeq.map(([ws, js]) =>
      resolveCustomerProgressFlow(baseInput({ serviceLevel: 'official_with_translator_signature_and_provider_stamp', workflowStatus: ws, workerStatus: js })).percent!,
    );
    for (let i = 1; i < percentages.length; i++) expect(percentages[i]).toBeGreaterThan(percentages[i - 1]!);

    const notaryDeliverySeq: Array<[string | null, string]> = [
      [null, 'queued'], [null, 'ocr_in_progress'], ['awaiting_translator_review', 'completed'],
      ['translator_review_in_progress', 'completed'], ['assigned_to_notary', 'completed'],
      ['notarization_in_progress', 'completed'], ['notarized', 'completed'],
      ['ready_for_delivery', 'completed'], ['out_for_delivery', 'completed'], ['delivered', 'completed'],
    ];
    const notaryPercentages = notaryDeliverySeq.map(([ws, js]) =>
      resolveCustomerProgressFlow(baseInput({ serviceLevel: 'notarization_through_partners', fulfillmentMethod: 'delivery', workflowStatus: ws, workerStatus: js })).percent!,
    );
    for (let i = 1; i < notaryPercentages.length; i++) expect(notaryPercentages[i]).toBeGreaterThan(notaryPercentages[i - 1]!);
  });

  it('payment_pending shows no percent at all, for every service level', () => {
    for (const sl of ['electronic', 'official_with_translator_signature_and_provider_stamp', 'notarization_through_partners']) {
      const r = resolveCustomerProgressFlow(baseInput({ serviceLevel: sl, paymentStatus: 'payment_pending' }));
      expect(r.percent).toBeNull();
      expect(r.showFulfillmentProgress).toBe(false);
    }
  });

  it('an unrecognized workflowStatus never crashes the resolver and never returns an undefined labelKey/percent', () => {
    const r = resolveCustomerProgressFlow(baseInput({
      serviceLevel: 'notarization_through_partners', fulfillmentMethod: 'delivery',
      workerStatus: 'completed', workflowStatus: 'some_future_status_2099',
    }));
    expect(typeof r.percent).toBe('number');
    expect(typeof r.labelKey).toBe('string');
    expect(r.labelKey.length).toBeGreaterThan(0);
  });

  it('an unrecognized serviceLevel falls back to the simplest (Electronic) flow rather than crashing', () => {
    const r = resolveCustomerProgressFlow(baseInput({ serviceLevel: 'some_future_service_level', workerStatus: 'completed' }));
    expect(r.percent).toBe(100);
    expect(r.stages.map((s) => s.id)).toEqual(['paid', 'processing', 'ready']);
  });

  it('every stage marker percent in every flow exactly matches what a filled bar at that stage would show — no stage claims a percent the top-level result would disagree with', () => {
    const cases: ProgressFlowInput[] = [
      baseInput({ workerStatus: 'completed' }),
      baseInput({ serviceLevel: 'official_with_translator_signature_and_provider_stamp', workerStatus: 'completed', workflowStatus: 'translator_approved' }),
      baseInput({ serviceLevel: 'notarization_through_partners', fulfillmentMethod: 'delivery', workerStatus: 'completed', workflowStatus: 'out_for_delivery' }),
    ];
    for (const input of cases) {
      const result = resolveCustomerProgressFlow(input);
      const currentStage = result.stages.find((s) => s.id === result.currentStageId);
      expect(currentStage?.percent).toBe(result.percent);
    }
  });

  it('no flow ever produces 49% — the old architecture\'s awkward "one point below translator_review_in_progress" value created only to preserve a technical ordering, replaced by real per-flow values (40% Official / 35% Notary for awaiting_translator_review)', () => {
    const officialAwaiting = resolveCustomerProgressFlow(baseInput({ serviceLevel: 'official_with_translator_signature_and_provider_stamp', workerStatus: 'completed', workflowStatus: 'awaiting_translator_review' }));
    const notaryAwaiting = resolveCustomerProgressFlow(baseInput({ serviceLevel: 'notarization_through_partners', workerStatus: 'completed', workflowStatus: 'awaiting_translator_review' }));
    expect(officialAwaiting.percent).not.toBe(49);
    expect(officialAwaiting.percent).toBe(40);
    expect(notaryAwaiting.percent).not.toBe(49);
    expect(notaryAwaiting.percent).toBe(35);

    // Exhaustive sweep: no stage marker in any flow's table is 49.
    const allStages = [
      ...resolveCustomerProgressFlow(baseInput({ workerStatus: 'completed' })).stages,
      ...resolveCustomerProgressFlow(baseInput({ serviceLevel: 'official_with_translator_signature_and_provider_stamp', workerStatus: 'completed', workflowStatus: 'delivered' })).stages,
      ...resolveCustomerProgressFlow(baseInput({ serviceLevel: 'notarization_through_partners', fulfillmentMethod: 'delivery', workerStatus: 'completed', workflowStatus: 'delivered' })).stages,
      ...resolveCustomerProgressFlow(baseInput({ serviceLevel: 'notarization_through_partners', fulfillmentMethod: 'pickup', workerStatus: 'completed', workflowStatus: 'picked_up' })).stages,
      ...resolveCustomerProgressFlow(baseInput({ serviceLevel: 'notarization_through_partners', workerStatus: 'completed', workflowStatus: 'notarized' })).stages,
    ];
    expect(allStages.some((s) => s.percent === 49)).toBe(false);
  });
});
