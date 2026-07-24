/**
 * Canonical customer-visible order state.
 *
 * Used by dashboard, download gating, and email notifications.
 * Never duplicate this logic in components — import from here.
 *
 * 2026-07-26: the progress percentage/stage-timeline computation was moved out of
 * this file entirely into progress-flow.ts's resolveCustomerProgressFlow() — a
 * dedicated, per-service-level resolver (Electronic/Official/Notary-without-
 * courier/Notary-with-courier each have their own stage list, percentages, and
 * marker count; nothing is shared or evenly spaced). This file's own
 * responsibility stays exactly what it always was: customerStatus/canDownload/
 * isActive/isTerminal — the business-state derivation, untouched by that fix.
 */
import { resolveCustomerProgressFlow, derivePaymentStatus, type ProgressFlowStage } from './progress-flow';

export type ServiceLevel =
  | 'electronic'
  | 'official_with_translator_signature_and_provider_stamp'
  | 'notarization_through_partners';

export interface OrderStateInput {
  jobStatus: string;
  progressPercent: number;
  workflowStatus: string | null;
  serviceLevel: string | null;
  fulfillmentMethod?: 'pickup' | 'delivery' | null;
  /**
   * 2026-08-01 multi-file fulfillment decision — whether job_result_files has a
   * complete, non-overlapping 'ready' set for this job's relevant stage
   * (signature_stamp for Official, notary for Notarized; Electronic doesn't use this
   * input at all). ONLY meaningful for multi-source jobs (job_source_files rows
   * exist) — the caller computes this via a DB query and passes it in; this function
   * stays dependency-free. Omit entirely for legacy single-file jobs to get the
   * exact pre-2026-08-01 behavior (see canCustomerDownload).
   */
  hasReadyResultFiles?: boolean;
  /**
   * 2026-07-26 progress-UI fix — price_quotes.status ('quoted' | 'payment_pending' |
   * 'paid' | ...) for this job's latest quote. Only used to distinguish the
   * pre-payment sub-states (quote ready / awaiting payment / payment being
   * checked) — see progress-flow.ts's derivePaymentStatus(). Omit for a legacy
   * caller with no quote row on hand; falls back to the safe generic
   * "awaiting payment" state whenever jobStatus is still 'payment_pending'.
   */
  quoteStatus?: string | null;
}

export type CustomerStatus =
  | 'payment_pending'
  | 'queued'
  | 'ocr_in_progress'
  | 'translation_in_progress'
  | 'pdf_rendering'
  | 'awaiting_translator_review'
  | 'translator_review_in_progress'
  | 'translator_approved'
  | 'awaiting_signature_stamp'
  | 'assigned_to_notary'
  | 'notarization_in_progress'
  | 'notarized'
  | 'ready_for_delivery'
  | 'ready_for_pickup'
  | 'out_for_delivery'
  | 'delivered'
  | 'picked_up'
  | 'translator_declined'
  | 'notary_declined'
  | 'completed'
  | 'failed'
  | 'refunded'
  | 'canceled'
  | 'operator_processing';

export interface OrderStage {
  key: string;
  /** i18n key — see progress-flow.ts's per-flow stage tables (dashboard.progressFlow.*). */
  labelKey: string;
  /** Where this stage's marker is positioned on the progress bar (0-100) — markers
   * are placed according to this percent, never evenly spaced. */
  percent: number;
  done: boolean;
  current: boolean;
}

export interface CustomerOrderState {
  customerStatus: CustomerStatus;
  /** null before payment is confirmed — no fulfillment percent exists yet (Rule 1). */
  progressPercent: number | null;
  labelKey: string;
  canDownload: boolean;
  isActive: boolean;
  isTerminal: boolean;
  stages: OrderStage[];
  /** false before payment (and for the pre-payment pseudo-stages) — the dashboard
   * must not render a fulfillment progress bar/timeline at all while this is false. */
  showFulfillmentProgress: boolean;
}

// ─── Status derivation ────────────────────────────────────────────────────────

function deriveCustomerStatus(
  jobStatus: string,
  workflowStatus: string | null,
  serviceLevel: string | null,
): CustomerStatus {
  if (jobStatus === 'payment_pending') return 'payment_pending';
  if (jobStatus === 'failed') return 'failed';
  if (jobStatus === 'refunded') return 'refunded';
  if (jobStatus === 'canceled') return 'canceled';
  if (workflowStatus === 'translator_declined') return 'translator_declined';
  if (workflowStatus === 'notary_declined') return 'notary_declined';

  // Terminal delivery statuses — checked before anything else
  if (workflowStatus === 'delivered') return 'delivered';
  if (workflowStatus === 'picked_up') return 'picked_up';

  // Active physical-delivery statuses
  if (workflowStatus === 'out_for_delivery') return 'out_for_delivery';
  if (workflowStatus === 'ready_for_delivery') return 'ready_for_delivery';
  if (workflowStatus === 'ready_for_pickup') return 'ready_for_pickup';

  // Notary workflow statuses
  if (workflowStatus === 'notarized') return 'notarized';
  if (workflowStatus === 'notarization_in_progress') return 'notarization_in_progress';
  if (workflowStatus === 'assigned_to_notary') return 'assigned_to_notary';

  // Translator statuses
  if (workflowStatus === 'translator_approved') return 'translator_approved';
  if (workflowStatus === 'awaiting_signature_stamp') return 'awaiting_signature_stamp';

  if (jobStatus === 'completed') {
    if (!workflowStatus || serviceLevel === 'electronic') return 'completed';
    if (workflowStatus === 'awaiting_translator_review') return 'awaiting_translator_review';
    // 2026-08-04: Jira status "В работе у переводчика" — translator has started actively
    // reviewing (distinct from merely being assigned/awaiting review). Same gating as
    // awaiting_translator_review — order stays active, not downloadable, Drive read-back
    // does not run, 03_TRANSLATOR_RESULT is not published yet.
    if (workflowStatus === 'translator_review_in_progress') return 'translator_review_in_progress';
    // Legacy: pre-workflow-update jobs had workflow_status='completed' set by the worker
    // instead of 'awaiting_translator_review'. Treat as awaiting review for certified/notarized.
    if (workflowStatus === 'completed') return 'awaiting_translator_review';
    console.warn('[customer-order-state] unknown workflow_status on completed job:', workflowStatus);
    return 'operator_processing';
  }

  switch (jobStatus) {
    case 'queued': return 'queued';
    case 'ocr_in_progress':
    case 'ocr_completed': return 'ocr_in_progress';
    case 'translation_in_progress': return 'translation_in_progress';
    case 'pdf_rendering': return 'pdf_rendering';
    default: return 'queued';
  }
}

// ─── Download gating (service-level-aware) ───────────────────────────────────

/**
 * Whether the customer can download the translated file.
 *
 * Legacy (single-file, `hasReadyResultFiles` omitted): behavior is EXACTLY what it
 * was before the 2026-08-01 multi-file fulfillment decision — physical notarized
 * orders never allow electronic download; certified/official allows it once the
 * operator confirms ready_for_delivery/delivered; electronic only once completed.
 *
 * Multi-source (`hasReadyResultFiles` explicitly passed, computed by the caller from
 * job_result_files coverage — see src/lib/translation-workflow/result-file-coverage.ts):
 * - Notarized: digital download opens once the notary result is FULLY synced from
 *   Drive (job_result_files stage='notary'), regardless of pickup/delivery fulfillment
 *   or physical delivery status — a deliberate change from "never downloadable".
 * - Official: still requires the existing operator confirmation (ready_for_delivery/
 *   delivered) AND a fully-synced signature_stamp result — the sync is an additional
 *   necessary condition, never a bypass of the human approval step.
 * - Electronic: unaffected either way (gate is purely customerStatus === 'completed').
 */
export function canCustomerDownload(
  customerStatus: CustomerStatus,
  serviceLevel: string | null,
  hasReadyResultFiles?: boolean,
): boolean {
  if (serviceLevel === 'notarization_through_partners') {
    return hasReadyResultFiles === true;
  }
  if (serviceLevel === 'official_with_translator_signature_and_provider_stamp') {
    const operatorConfirmed = customerStatus === 'ready_for_delivery' || customerStatus === 'delivered';
    if (hasReadyResultFiles === undefined) return operatorConfirmed;
    return operatorConfirmed && hasReadyResultFiles;
  }
  // Electronic
  return customerStatus === 'completed';
}

// ─── Terminal status check ────────────────────────────────────────────────────

export function isCustomerOrderTerminal(customerStatus: CustomerStatus): boolean {
  return (
    customerStatus === 'completed' ||
    customerStatus === 'failed' ||
    customerStatus === 'delivered' ||
    customerStatus === 'picked_up' ||
    customerStatus === 'translator_declined' ||
    customerStatus === 'notary_declined' ||
    customerStatus === 'refunded' ||
    customerStatus === 'canceled'
  );
}

// ─── Stage mapping (ProgressFlowStage[] -> OrderStage[]) ─────────────────────────

/** Adds the `done`/`current` booleans a stage-dot-track UI needs, derived from each
 * stage's own percent relative to the currently active one — never assumed from
 * array position (2026-07-26: array order and percent order are the same for every
 * table today, but deriving from percent is the correct invariant to hold, not
 * "index < currentIndex"). */
function toOrderStages(stages: ProgressFlowStage[], currentStageId: string, currentPercent: number | null): OrderStage[] {
  return stages.map((s) => ({
    key: s.id,
    labelKey: s.labelKey,
    percent: s.percent,
    current: s.id === currentStageId,
    done: currentPercent != null && s.percent < currentPercent,
  }));
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function getCustomerOrderState(input: OrderStateInput): CustomerOrderState {
  const { jobStatus, progressPercent, workflowStatus, serviceLevel, fulfillmentMethod, hasReadyResultFiles, quoteStatus } = input;

  const customerStatus = deriveCustomerStatus(jobStatus, workflowStatus, serviceLevel);

  const isTerminal = isCustomerOrderTerminal(customerStatus);
  const canDownload = canCustomerDownload(customerStatus, serviceLevel, hasReadyResultFiles);

  // Active = has outstanding human/physical steps OR is electronic awaiting download.
  // Terminal orders with canDownload=true (electronic completed, certified delivered)
  // stay in the active section so the download button is prominent.
  // All other terminal orders go to history.
  const isActive = !isTerminal || canDownload;

  const paymentStatus = derivePaymentStatus(jobStatus, quoteStatus);
  const flow = resolveCustomerProgressFlow({
    serviceLevel,
    fulfillmentMethod: fulfillmentMethod ?? null,
    paymentStatus,
    workflowStatus,
    workerStatus: jobStatus,
    rawProgress: progressPercent,
  });

  return {
    customerStatus,
    progressPercent: flow.percent,
    labelKey: flow.labelKey,
    canDownload,
    isActive,
    isTerminal,
    stages: toOrderStages(flow.stages, flow.currentStageId, flow.percent),
    showFulfillmentProgress: flow.showFulfillmentProgress,
  };
}
