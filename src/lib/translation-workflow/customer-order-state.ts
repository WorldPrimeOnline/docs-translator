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
}

export type CustomerStatus =
  | 'queued'
  | 'ocr_in_progress'
  | 'translation_in_progress'
  | 'pdf_rendering'
  | 'awaiting_translator_review'
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
  if (jobStatus === 'queued') return 0;
  if (
    jobStatus === 'ocr_in_progress' || jobStatus === 'ocr_completed' ||
    jobStatus === 'translation_in_progress' || jobStatus === 'pdf_rendering'
  ) return 1;
  if (!workflowStatus || workflowStatus === 'awaiting_translator_review') return 2;
  if (workflowStatus === 'translator_approved') return 3;
  if (workflowStatus === 'awaiting_signature_stamp') return 4;
  if (workflowStatus === 'ready_for_delivery') return 5;
  if (workflowStatus === 'delivered') return 6;
  return 2;
}

function notarizedCurrentStage(jobStatus: string, workflowStatus: string | null): number {
  if (jobStatus === 'queued') return 0;
  if (
    jobStatus === 'ocr_in_progress' || jobStatus === 'ocr_completed' ||
    jobStatus === 'translation_in_progress' || jobStatus === 'pdf_rendering'
  ) return 1;
  if (!workflowStatus || workflowStatus === 'awaiting_translator_review') return 2;
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

// ─── Status derivation ────────────────────────────────────────────────────────

function deriveCustomerStatus(
  jobStatus: string,
  workflowStatus: string | null,
  serviceLevel: string | null,
): CustomerStatus {
  if (jobStatus === 'failed') return 'failed';
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
    // Unknown workflow_status on a completed job — safe fallback, never reset to translator stage
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
 * Physical notarized orders (delivery or pickup) NEVER allow electronic download —
 * the final product is a physical notarized document.
 */
export function canCustomerDownload(
  customerStatus: CustomerStatus,
  serviceLevel: string | null,
): boolean {
  if (serviceLevel === 'notarization_through_partners') {
    return false; // physical document — no electronic download at any stage
  }
  if (serviceLevel === 'official_with_translator_signature_and_provider_stamp') {
    return customerStatus === 'ready_for_delivery' || customerStatus === 'delivered';
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
    customerStatus === 'notary_declined'
  );
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function getCustomerOrderState(input: OrderStateInput): CustomerOrderState {
  const { jobStatus, progressPercent, workflowStatus, serviceLevel, fulfillmentMethod } = input;

  const customerStatus = deriveCustomerStatus(jobStatus, workflowStatus, serviceLevel);

  const isTerminal = isCustomerOrderTerminal(customerStatus);
  const canDownload = canCustomerDownload(customerStatus, serviceLevel);

  // Active = has outstanding human/physical steps OR is electronic awaiting download.
  // Terminal orders with canDownload=true (electronic completed, certified delivered)
  // stay in the active section so the download button is prominent.
  // All other terminal orders go to history.
  const isActive = !isTerminal || canDownload;

  const resolvedServiceLevel = serviceLevel as ServiceLevel | null;

  let stages: OrderStage[];
  let effectiveProgress = progressPercent;

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
    effectiveProgress = Math.round((idx / total) * 100);
    if (isTerminal) effectiveProgress = 100;
  } else if (resolvedServiceLevel === 'official_with_translator_signature_and_provider_stamp') {
    const idx = certifiedCurrentStage(jobStatus, workflowStatus);
    const total = CERTIFIED_STAGES.length - 1;
    stages = buildStages(CERTIFIED_STAGES, idx);
    effectiveProgress = Math.round((idx / total) * 100);
    if (isTerminal || canDownload) effectiveProgress = 100;
  } else {
    const idx = electronicCurrentStage(jobStatus);
    stages = buildStages(ELECTRONIC_STAGES, idx);
    effectiveProgress = progressPercent;
    if (customerStatus === 'completed') effectiveProgress = 100;
  }

  // Never show 100% unless truly done or downloadable
  if (effectiveProgress >= 100 && !canDownload && !isTerminal) {
    effectiveProgress = 95;
  }

  return {
    customerStatus,
    progressPercent: effectiveProgress,
    canDownload,
    isActive,
    isTerminal,
    stages,
  };
}
