/**
 * Canonical customer-visible order state.
 *
 * Used by dashboard, download gating, and email notifications.
 * Never duplicate this logic in components — import from here.
 */

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
  /** i18n key within dashboard.stages.* */
  labelKey: string;
  done: boolean;
  current: boolean;
}

export interface CustomerOrderState {
  customerStatus: CustomerStatus;
  progressPercent: number;
  canDownload: boolean;
  isActive: boolean;
  isTerminal: boolean;
  stages: OrderStage[];
}

// ─── Stage lists ──────────────────────────────────────────────────────────────

const ELECTRONIC_STAGES = [
  { key: 'uploaded',    labelKey: 'stages.uploaded' },
  { key: 'ocr',        labelKey: 'stages.ocr' },
  { key: 'translating', labelKey: 'stages.translating' },
  { key: 'rendering',  labelKey: 'stages.rendering' },
  { key: 'done',       labelKey: 'stages.done' },
];

// Certified: 7 stages
const CERTIFIED_STAGES = [
  { key: 'uploaded',           labelKey: 'stages.uploaded' },
  { key: 'ai_processing',      labelKey: 'stages.aiProcessing' },
  { key: 'translator_review',  labelKey: 'stages.translatorReview' },
  { key: 'translator_approved', labelKey: 'stages.translatorApproved' },
  { key: 'signature_stamp',    labelKey: 'stages.signatureStamp' },
  { key: 'ready',              labelKey: 'stages.readyForDelivery' },
  { key: 'delivered',          labelKey: 'stages.delivered' },
];

// Notarized — delivery variant (9 stages)
// Stage 4 (index 3): "Перевод проверен" — covers both translator_approved and assigned_to_notary
const NOTARIZED_STAGES_DELIVERY = [
  { key: 'uploaded',                labelKey: 'stages.uploaded' },
  { key: 'ai_processing',           labelKey: 'stages.aiProcessing' },
  { key: 'translator_review',       labelKey: 'stages.translatorReview' },
  { key: 'translator_approved',     labelKey: 'stages.translatorApproved' },
  { key: 'notarization_in_progress', labelKey: 'stages.notarizationInProgress' },
  { key: 'notarized',               labelKey: 'stages.notarized' },
  { key: 'ready',                   labelKey: 'stages.readyForDelivery' },
  { key: 'out_for_delivery',        labelKey: 'stages.outForDelivery' },
  { key: 'delivered',               labelKey: 'stages.delivered' },
];

// Notarized — pickup variant (8 stages, no courier step)
const NOTARIZED_STAGES_PICKUP = [
  { key: 'uploaded',                labelKey: 'stages.uploaded' },
  { key: 'ai_processing',           labelKey: 'stages.aiProcessing' },
  { key: 'translator_review',       labelKey: 'stages.translatorReview' },
  { key: 'translator_approved',     labelKey: 'stages.translatorApproved' },
  { key: 'notarization_in_progress', labelKey: 'stages.notarizationInProgress' },
  { key: 'notarized',               labelKey: 'stages.notarized' },
  { key: 'ready',                   labelKey: 'stages.readyForPickup' },
  { key: 'picked_up',               labelKey: 'stages.pickedUp' },
];

// ─── Current-stage index helpers ─────────────────────────────────────────────

function electronicCurrentStage(jobStatus: string): number {
  switch (jobStatus) {
    case 'payment_pending': return 0;
    case 'queued': return 0;
    case 'ocr_in_progress':
    case 'ocr_completed': return 1;
    case 'translation_in_progress': return 2;
    case 'pdf_rendering': return 3;
    case 'completed': return 4;
    default: return 0;
  }
}

function certifiedCurrentStage(jobStatus: string, workflowStatus: string | null): number {
  if (jobStatus === 'payment_pending') return 0;
  if (jobStatus === 'queued') return 0;
  if (
    jobStatus === 'ocr_in_progress' || jobStatus === 'ocr_completed' ||
    jobStatus === 'translation_in_progress' || jobStatus === 'pdf_rendering'
  ) return 1;
  if (!workflowStatus || workflowStatus === 'awaiting_translator_review' || workflowStatus === 'translator_review_in_progress') return 2;
  if (workflowStatus === 'translator_approved') return 3;
  if (workflowStatus === 'awaiting_signature_stamp') return 4;
  if (workflowStatus === 'ready_for_delivery') return 5;
  if (workflowStatus === 'delivered') return 6;
  return 2;
}

function notarizedCurrentStage(jobStatus: string, workflowStatus: string | null): number {
  if (jobStatus === 'payment_pending') return 0;
  if (jobStatus === 'queued') return 0;
  if (
    jobStatus === 'ocr_in_progress' || jobStatus === 'ocr_completed' ||
    jobStatus === 'translation_in_progress' || jobStatus === 'pdf_rendering'
  ) return 1;
  if (!workflowStatus || workflowStatus === 'awaiting_translator_review' || workflowStatus === 'translator_review_in_progress') return 2;
  // translator_approved and assigned_to_notary both map to stage 4 (index 3)
  if (workflowStatus === 'translator_approved' || workflowStatus === 'assigned_to_notary') return 3;
  if (workflowStatus === 'notarization_in_progress') return 4;
  if (workflowStatus === 'notarized') return 5;
  if (workflowStatus === 'ready_for_delivery' || workflowStatus === 'ready_for_pickup') return 6;
  if (workflowStatus === 'out_for_delivery') return 7;
  if (workflowStatus === 'delivered' || workflowStatus === 'picked_up') return 8;
  return 2;
}

function buildStages(
  stageList: { key: string; labelKey: string }[],
  currentIdx: number,
): OrderStage[] {
  return stageList.map((s, i) => ({
    key: s.key,
    labelKey: s.labelKey,
    done: i < currentIdx,
    current: i === currentIdx,
  }));
}

// ─── Canonical customer-facing progress percentage (2026-07-25) ─────────────────
//
// Replaces the old per-service-level `Math.round((stageIdx / totalStages) * 100)`
// computation, which produced uneven, inconsistent percentages across service
// levels and — worse — showed the WORKER's raw internal progress_percent verbatim
// for jobStatus='ocr_in_progress'/'pdf_rendering' (e.g. "Извлечение текста (13%)",
// "Создание PDF (13%)"), then showed no percentage at all once workflow_status
// took over (awaiting_translator_review and beyond never interpolated {pct}).
//
// This table's ordering is intentionally identical to WORKFLOW_RANK
// (src/lib/integrations/workflow.ts) — the DB-enforced forward-only transition
// order for workflow_status. Since a job's real (jobStatus, workflowStatus)
// history can only move forward through that rank order (safeUpdateWorkflowStatus
// rejects backward transitions), and every value in this table is >= the value for
// every rank that can precede it, progress is guaranteed to never decrease across
// any real observed transition — without this stateless, pure function needing to
// track "the highest percent ever shown" itself. See
// __tests__/customer-order-state.test.ts's monotonicity tests, which walk the full
// realistic transition sequence for all three service levels.
const FIXED_PROGRESS_BY_STATUS: Partial<Record<CustomerStatus, number>> = {
  payment_pending: 25,
  awaiting_translator_review: 49,
  translator_review_in_progress: 50,
  translator_approved: 65,
  assigned_to_notary: 65,
  awaiting_signature_stamp: 80,
  notarization_in_progress: 80,
  notarized: 90,
  ready_for_delivery: 93,
  ready_for_pickup: 93,
  out_for_delivery: 96,
};

// jobStatus values covering the worker's own OCR/translation/PDF-render pipeline —
// the same underlying pipeline for every service level, run once per job right
// after payment, before any human workflow_status exists yet. Collapsed into ONE
// customer-facing stage ("Подготовка документа к обработке" — never "Извлечение
// текста" or "Создание PDF" individually) whose percentage scales within a fixed
// sub-range using the worker's raw 0-100 progress_percent — the ONLY place raw
// worker progress is allowed to influence the customer-facing number at all.
const PIPELINE_STATUSES: ReadonlySet<CustomerStatus> = new Set([
  'queued', 'ocr_in_progress', 'translation_in_progress', 'pdf_rendering',
]);
const PIPELINE_RANGE_LOW = 35;
const PIPELINE_RANGE_HIGH = 48;

/** The floor for any real job row that exists but doesn't match a more specific
 * rule below — covers `payment_pending` before this table's explicit 25 entry
 * would apply in a future refactor, and any genuinely unrecognized customerStatus
 * (operator_processing, etc.) — never lower than this, per "uploaded / initial
 * processing" being the very first thing a customer ever sees for a real order. */
const INITIAL_PROGRESS_FLOOR = 5;

function resolveCustomerProgress(
  customerStatus: CustomerStatus,
  rawProgressPercent: number,
  isTerminal: boolean,
): number {
  // Terminal is always 100 — delivered/picked_up/completed, but also failed/
  // canceled/refunded/declined (an order that will never progress further shows
  // a full/closed bar, never a stuck partial one).
  if (isTerminal) return 100;

  if (PIPELINE_STATUSES.has(customerStatus)) {
    const clamped = Math.max(0, Math.min(100, rawProgressPercent));
    return Math.round(PIPELINE_RANGE_LOW + (clamped / 100) * (PIPELINE_RANGE_HIGH - PIPELINE_RANGE_LOW));
  }

  return FIXED_PROGRESS_BY_STATUS[customerStatus] ?? INITIAL_PROGRESS_FLOOR;
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

// ─── Main export ──────────────────────────────────────────────────────────────

export function getCustomerOrderState(input: OrderStateInput): CustomerOrderState {
  const { jobStatus, progressPercent, workflowStatus, serviceLevel, fulfillmentMethod, hasReadyResultFiles } = input;

  const customerStatus = deriveCustomerStatus(jobStatus, workflowStatus, serviceLevel);

  const isTerminal = isCustomerOrderTerminal(customerStatus);
  const canDownload = canCustomerDownload(customerStatus, serviceLevel, hasReadyResultFiles);

  // Active = has outstanding human/physical steps OR is electronic awaiting download.
  // Terminal orders with canDownload=true (electronic completed, certified delivered)
  // stay in the active section so the download button is prominent.
  // All other terminal orders go to history.
  const isActive = !isTerminal || canDownload;

  const resolvedServiceLevel = serviceLevel as ServiceLevel | null;

  let stages: OrderStage[];

  if (resolvedServiceLevel === 'notarization_through_partners') {
    // Choose stage list based on fulfillment method.
    // Infer from workflowStatus when fulfillmentMethod not provided.
    const isPickup =
      fulfillmentMethod === 'pickup' ||
      (fulfillmentMethod == null && workflowStatus === 'ready_for_pickup');
    const stageList = isPickup ? NOTARIZED_STAGES_PICKUP : NOTARIZED_STAGES_DELIVERY;
    const total = stageList.length - 1;
    const rawIdx = notarizedCurrentStage(jobStatus, workflowStatus);
    const idx = isPickup ? Math.min(rawIdx, total) : rawIdx;
    stages = buildStages(stageList, idx);
  } else if (resolvedServiceLevel === 'official_with_translator_signature_and_provider_stamp') {
    const idx = certifiedCurrentStage(jobStatus, workflowStatus);
    stages = buildStages(CERTIFIED_STAGES, idx);
  } else {
    const idx = electronicCurrentStage(jobStatus);
    stages = buildStages(ELECTRONIC_STAGES, idx);
  }

  // 2026-07-25: canonical percentage, identical logic across all three service
  // levels — see resolveCustomerProgress's doc comment. Deliberately independent
  // of the `stages` timeline computed above (a separate UI element); this is what
  // src/app/[locale]/dashboard/page.tsx's useStatusLabel() interpolates as {pct}.
  const effectiveProgress = resolveCustomerProgress(customerStatus, progressPercent, isTerminal);

  return {
    customerStatus,
    progressPercent: effectiveProgress,
    canDownload,
    isActive,
    isTerminal,
    stages,
  };
}
