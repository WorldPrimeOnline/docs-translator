/**
 * Canonical, per-service-level customer progress resolver (2026-07-26 architectural
 * fix). Replaces the single universal percentage scale that used to apply the same
 * percentages to Electronic/Official/Notary regardless of how many real stages each
 * actually has — every flow below has its own stage list, its own percentages, and
 * its own marker count; nothing is shared or evenly spaced.
 *
 * Design invariants (see the fix's requirements for the full rationale):
 * - Before payment is confirmed, fulfillment progress never starts: `percent` is
 *   `null` and `showFulfillmentProgress` is `false` — only a payment-status message
 *   is shown (quote ready / awaiting payment / payment being checked / payment
 *   failed), never a translation-progress percentage or a filled stage bar.
 * - Once paid, each service level (Electronic / Official / Notary-without-courier /
 *   Notary-with-courier) uses its OWN fixed stage table. Every stage's `percent` is
 *   the position its marker is drawn at on the progress bar — markers are placed
 *   according to these percentages, never evenly spaced — and the returned
 *   top-level `percent` is what the filled portion of the bar must exactly match.
 * - The worker's own OCR/translation/PDF-render pipeline (queued/ocr_in_progress/
 *   translation_in_progress/pdf_rendering) is always collapsed into ONE customer
 *   stage ("Документ обрабатывается" / "Документ подготавливается", depending on
 *   flow) — the customer is never shown "Создание PDF" or any other raw technical
 *   label.
 * - Only Electronic's "processing" stage scales its live percent within a fixed
 *   sub-range (10-90) using the worker's raw progress_percent, matching this fix's
 *   explicit spec — every other flow's "processing" stage is a single fixed value,
 *   consistent with how every other stage in every other flow is specified.
 * - Every table's ordering matches WORKFLOW_RANK (src/lib/integrations/workflow.ts)
 *   — the DB-enforced forward-only workflow_status transition order — so percent
 *   is guaranteed to never decrease across any real observed transition.
 */

export type PaymentStatus =
  | 'quote_ready'
  | 'payment_pending'
  | 'payment_checking'
  | 'payment_failed'
  | 'paid';

export interface ProgressFlowInput {
  serviceLevel: string | null;
  fulfillmentMethod: 'pickup' | 'delivery' | null;
  paymentStatus: PaymentStatus;
  workflowStatus: string | null;
  /** The worker's own jobStatus (queued/ocr_in_progress/translation_in_progress/
   * pdf_rendering/completed/failed/...) — named `workerStatus` here, distinct from
   * `workflowStatus` (the human/Jira-driven post-processing chain), matching the
   * resolver signature this fix specifies. */
  workerStatus: string;
  /** Raw 0-100 worker progress_percent — only ever used to scale Electronic's
   * "processing" stage within its fixed sub-range (see PIPELINE_SCALE_RANGE). */
  rawProgress: number;
}

export interface ProgressFlowStage {
  id: string;
  percent: number;
  labelKey: string;
}

export interface ProgressFlowResult {
  /** null before payment is confirmed — no fulfillment percent exists yet. */
  percent: number | null;
  labelKey: string;
  /** The full stage table for this exact flow (service level + fulfillment
   * method) — empty before payment, since there is no fulfillment stage list yet. */
  stages: ProgressFlowStage[];
  currentStageId: string;
  showFulfillmentProgress: boolean;
}

/**
 * Derives the pre-payment PaymentStatus from the two already-existing fields every
 * caller has on hand — jobs.status and price_quotes.status. No new column, no new
 * payment-state machine: 'quoted' (quote exists, checkout not started) -> quote
 * ready; 'payment_pending' (the customer clicked pay — see
 * /api/payments/halyk/initiate calling markQuotePaymentPending — Halyk is now
 * processing the charge) -> payment being checked; anything else while
 * jobStatus='payment_pending' (including a missing/legacy quote row) -> the safe
 * generic "awaiting payment" default. jobStatus='failed' -> payment failed.
 */
export function derivePaymentStatus(jobStatus: string, quoteStatus: string | null | undefined): PaymentStatus {
  if (jobStatus === 'failed') return 'payment_failed';
  if (jobStatus !== 'payment_pending') return 'paid';
  if (quoteStatus === 'quoted') return 'quote_ready';
  if (quoteStatus === 'payment_pending') return 'payment_checking';
  return 'payment_pending';
}

const PRE_PAYMENT_LABEL_KEY: Record<Exclude<PaymentStatus, 'paid'>, string> = {
  quote_ready: 'progressFlow.prePayment.quoteReady',
  payment_pending: 'progressFlow.prePayment.paymentPending',
  payment_checking: 'progressFlow.prePayment.paymentChecking',
  payment_failed: 'progressFlow.prePayment.paymentFailed',
};

// jobStatus values covering the worker's own OCR/translation/PDF-render pipeline —
// identical underlying pipeline for every service level, run once per job right
// after payment, before any human workflow_status exists. Never shown to the
// customer as separate technical steps.
const PIPELINE_WORKER_STATUSES: ReadonlySet<string> = new Set([
  'queued', 'ocr_in_progress', 'ocr_completed', 'translation_in_progress', 'pdf_rendering',
]);

function isPipelineWorkerStatus(workerStatus: string): boolean {
  return PIPELINE_WORKER_STATUSES.has(workerStatus);
}

// ─── Flow 1 — Electronic ────────────────────────────────────────────────────────

const ELECTRONIC_STAGES: ProgressFlowStage[] = [
  { id: 'paid', percent: 10, labelKey: 'progressFlow.electronic.paid' },
  { id: 'processing', percent: 50, labelKey: 'progressFlow.electronic.processing' },
  { id: 'ready', percent: 100, labelKey: 'progressFlow.electronic.ready' },
];
const ELECTRONIC_PROCESSING_SCALE = [10, 90] as const;

function resolveElectronic(input: ProgressFlowInput): ProgressFlowResult {
  const { workerStatus, rawProgress } = input;

  if (workerStatus === 'completed') {
    return finalize(ELECTRONIC_STAGES, 'ready', 100);
  }
  if (isPipelineWorkerStatus(workerStatus) && workerStatus !== 'queued') {
    const clamped = Math.max(0, Math.min(100, rawProgress));
    const [low, high] = ELECTRONIC_PROCESSING_SCALE;
    const percent = Math.round(low + (clamped / 100) * (high - low));
    return finalize(ELECTRONIC_STAGES, 'processing', percent);
  }
  // workerStatus === 'queued' (or anything else unrecognized, safely) — the very
  // first moment after payment, before any worker activity has been reported yet.
  return finalize(ELECTRONIC_STAGES, 'paid', 10);
}

// ─── Flow 2 — Official (signature + stamp) ─────────────────────────────────────

const OFFICIAL_STAGES: ProgressFlowStage[] = [
  { id: 'paid', percent: 10, labelKey: 'progressFlow.official.paid' },
  { id: 'processing', percent: 25, labelKey: 'progressFlow.official.processing' },
  { id: 'awaiting_translator_review', percent: 40, labelKey: 'progressFlow.official.awaitingTranslatorReview' },
  { id: 'translator_review_in_progress', percent: 60, labelKey: 'progressFlow.official.translatorReviewInProgress' },
  { id: 'signature_stage', percent: 80, labelKey: 'progressFlow.official.signatureStage' },
  { id: 'ready', percent: 100, labelKey: 'progressFlow.official.ready' },
];

function resolveOfficial(input: ProgressFlowInput): ProgressFlowResult {
  const { workflowStatus, workerStatus } = input;

  if (workflowStatus === 'ready_for_delivery' || workflowStatus === 'delivered') {
    return finalize(OFFICIAL_STAGES, 'ready', 100);
  }
  if (workflowStatus === 'translator_approved' || workflowStatus === 'awaiting_signature_stamp') {
    return finalize(OFFICIAL_STAGES, 'signature_stage', 80);
  }
  if (workflowStatus === 'translator_review_in_progress') {
    return finalize(OFFICIAL_STAGES, 'translator_review_in_progress', 60);
  }
  // Covers awaiting_translator_review explicitly, plus the legacy
  // workflow_status==='completed' case (old worker code, treated the same way
  // customer-order-state.ts's deriveCustomerStatus already treats it).
  if (workflowStatus === 'awaiting_translator_review' || workflowStatus === 'completed' || (workerStatus === 'completed' && !workflowStatus)) {
    return finalize(OFFICIAL_STAGES, 'awaiting_translator_review', 40);
  }
  if (isPipelineWorkerStatus(workerStatus) && workerStatus !== 'queued') {
    return finalize(OFFICIAL_STAGES, 'processing', 25);
  }
  return finalize(OFFICIAL_STAGES, 'paid', 10);
}

// ─── Flow 3 — Notary without courier (no fulfillment method, or pickup) ────────

const NOTARY_NO_DELIVERY_STAGES: ProgressFlowStage[] = [
  { id: 'paid', percent: 10, labelKey: 'progressFlow.notary.paid' },
  { id: 'processing', percent: 20, labelKey: 'progressFlow.notary.processing' },
  { id: 'awaiting_translator_review', percent: 35, labelKey: 'progressFlow.notary.awaitingTranslatorReview' },
  { id: 'translator_review_in_progress', percent: 50, labelKey: 'progressFlow.notary.translatorReviewInProgress' },
  { id: 'approved_for_notary', percent: 65, labelKey: 'progressFlow.notary.approvedForNotary' },
  { id: 'notarization_in_progress', percent: 80, labelKey: 'progressFlow.notary.notarizationInProgress' },
  { id: 'notarized', percent: 100, labelKey: 'progressFlow.notary.notarizedFinal' },
];

const NOTARY_PICKUP_STAGES: ProgressFlowStage[] = [
  ...NOTARY_NO_DELIVERY_STAGES.slice(0, 6),
  { id: 'notarized', percent: 90, labelKey: 'progressFlow.notary.notarized' },
  { id: 'ready_for_pickup', percent: 95, labelKey: 'progressFlow.notary.readyForPickup' },
  { id: 'picked_up', percent: 100, labelKey: 'progressFlow.notary.pickedUp' },
];

const NOTARY_DELIVERY_STAGES: ProgressFlowStage[] = [
  ...NOTARY_NO_DELIVERY_STAGES.slice(0, 6),
  { id: 'notarized', percent: 90, labelKey: 'progressFlow.notary.notarized' },
  { id: 'ready_for_delivery', percent: 92, labelKey: 'progressFlow.notary.readyForDelivery' },
  { id: 'out_for_delivery', percent: 96, labelKey: 'progressFlow.notary.outForDelivery' },
  { id: 'delivered', percent: 100, labelKey: 'progressFlow.notary.delivered' },
];

function resolveNotary(input: ProgressFlowInput): ProgressFlowResult {
  const { workflowStatus, workerStatus, fulfillmentMethod } = input;

  if (fulfillmentMethod === 'delivery') {
    if (workflowStatus === 'delivered') return finalize(NOTARY_DELIVERY_STAGES, 'delivered', 100);
    if (workflowStatus === 'out_for_delivery') return finalize(NOTARY_DELIVERY_STAGES, 'out_for_delivery', 96);
    if (workflowStatus === 'ready_for_delivery') return finalize(NOTARY_DELIVERY_STAGES, 'ready_for_delivery', 92);
    if (workflowStatus === 'notarized') return finalize(NOTARY_DELIVERY_STAGES, 'notarized', 90);
    return resolveNotaryPrefix(NOTARY_DELIVERY_STAGES, workflowStatus, workerStatus);
  }

  if (fulfillmentMethod === 'pickup') {
    if (workflowStatus === 'picked_up') return finalize(NOTARY_PICKUP_STAGES, 'picked_up', 100);
    if (workflowStatus === 'ready_for_pickup') return finalize(NOTARY_PICKUP_STAGES, 'ready_for_pickup', 95);
    if (workflowStatus === 'notarized') return finalize(NOTARY_PICKUP_STAGES, 'notarized', 90);
    return resolveNotaryPrefix(NOTARY_PICKUP_STAGES, workflowStatus, workerStatus);
  }

  // No fulfillment method at all — a pure electronic-scan notarized order with no
  // physical component. notarized is the terminal 100% stage: the scan from
  // 05_NOTARY is downloadable immediately, never gated on delivery/pickup/Jira
  // closing (see canCustomerDownload — untouched by this fix).
  if (workflowStatus === 'notarized') return finalize(NOTARY_NO_DELIVERY_STAGES, 'notarized', 100);
  return resolveNotaryPrefix(NOTARY_NO_DELIVERY_STAGES, workflowStatus, workerStatus);
}

/** The shared prefix (paid -> processing -> translator review -> approved for
 * notary -> notarization in progress) identical across all three Notary variants —
 * only what happens AT and AFTER 'notarized' differs by fulfillment method. */
function resolveNotaryPrefix(stages: ProgressFlowStage[], workflowStatus: string | null, workerStatus: string): ProgressFlowResult {
  if (workflowStatus === 'notarization_in_progress') return finalize(stages, 'notarization_in_progress', 80);
  if (workflowStatus === 'translator_approved' || workflowStatus === 'assigned_to_notary') {
    return finalize(stages, 'approved_for_notary', 65);
  }
  if (workflowStatus === 'translator_review_in_progress') return finalize(stages, 'translator_review_in_progress', 50);
  if (workflowStatus === 'awaiting_translator_review' || workflowStatus === 'completed' || (workerStatus === 'completed' && !workflowStatus)) {
    return finalize(stages, 'awaiting_translator_review', 35);
  }
  if (isPipelineWorkerStatus(workerStatus) && workerStatus !== 'queued') {
    return finalize(stages, 'processing', 20);
  }
  return finalize(stages, 'paid', 10);
}

function finalize(stages: ProgressFlowStage[], currentStageId: string, percent: number): ProgressFlowResult {
  const stage = stages.find((s) => s.id === currentStageId);
  return {
    percent,
    labelKey: stage?.labelKey ?? stages[0]!.labelKey,
    stages,
    currentStageId,
    showFulfillmentProgress: true,
  };
}

/**
 * The single entry point — dispatches to the correct flow by serviceLevel, or
 * returns the pre-payment (no fulfillment progress at all) result when
 * paymentStatus isn't 'paid' yet. An unrecognized serviceLevel/workflowStatus never
 * throws or crashes the card — it falls back to the flow's own "paid" (10%,
 * earliest, safest) stage rather than an undefined/broken state.
 */
export function resolveCustomerProgressFlow(input: ProgressFlowInput): ProgressFlowResult {
  if (input.paymentStatus !== 'paid') {
    return {
      percent: null,
      labelKey: PRE_PAYMENT_LABEL_KEY[input.paymentStatus],
      stages: [],
      currentStageId: input.paymentStatus,
      showFulfillmentProgress: false,
    };
  }

  if (input.serviceLevel === 'official_with_translator_signature_and_provider_stamp') {
    return resolveOfficial(input);
  }
  if (input.serviceLevel === 'notarization_through_partners') {
    return resolveNotary(input);
  }
  // Electronic, and any other/unrecognized service level — the simplest, safest flow.
  return resolveElectronic(input);
}
