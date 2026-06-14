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
}

export type CustomerStatus =
  | 'queued'
  | 'ocr_in_progress'
  | 'translation_in_progress'
  | 'pdf_rendering'
  | 'awaiting_translator_review'
  | 'awaiting_signature_stamp'
  | 'awaiting_notary_review'
  | 'awaiting_final_qa'
  | 'ready_for_delivery'
  | 'translator_declined'
  | 'notary_declined'
  | 'completed'
  | 'failed';

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
  /** Whether client can download the final document */
  canDownload: boolean;
  /** Whether polling should continue */
  isActive: boolean;
  /** Whether this job belongs in history (terminal + done) */
  isTerminal: boolean;
  /** Ordered list of stages for the progress bar */
  stages: OrderStage[];
}

// ─── Stage definitions ────────────────────────────────────────────────────────

const ELECTRONIC_STAGES = [
  { key: 'uploaded',   labelKey: 'stages.uploaded' },
  { key: 'ocr',        labelKey: 'stages.ocr' },
  { key: 'translating', labelKey: 'stages.translating' },
  { key: 'rendering',  labelKey: 'stages.rendering' },
  { key: 'done',       labelKey: 'stages.done' },
];

const CERTIFIED_STAGES = [
  { key: 'uploaded',        labelKey: 'stages.uploaded' },
  { key: 'ai_processing',   labelKey: 'stages.aiProcessing' },
  { key: 'sent_translator', labelKey: 'stages.sentToTranslator' },
  { key: 'translator_review', labelKey: 'stages.translatorReview' },
  { key: 'signature_stamp', labelKey: 'stages.signatureStamp' },
  { key: 'ready',           labelKey: 'stages.readyForDelivery' },
];

const NOTARIZED_STAGES = [
  { key: 'uploaded',         labelKey: 'stages.uploaded' },
  { key: 'ai_processing',    labelKey: 'stages.aiProcessing' },
  { key: 'sent_translator',  labelKey: 'stages.sentToTranslator' },
  { key: 'translator_review', labelKey: 'stages.translatorReview' },
  { key: 'signature_stamp',  labelKey: 'stages.signatureStamp' },
  { key: 'sent_notary',      labelKey: 'stages.sentToNotary' },
  { key: 'notary_review',    labelKey: 'stages.notaryReview' },
  { key: 'ready',            labelKey: 'stages.readyForDelivery' },
];

// ─── Stage progress mapping ────────────────────────────────────────────────────

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
    jobStatus === 'ocr_in_progress' ||
    jobStatus === 'ocr_completed' ||
    jobStatus === 'translation_in_progress' ||
    jobStatus === 'pdf_rendering'
  ) return 1;
  if (!workflowStatus || workflowStatus === 'awaiting_translator_review') return 2;
  if (workflowStatus === 'awaiting_signature_stamp') return 3;
  if (workflowStatus === 'awaiting_final_qa') return 4;
  if (workflowStatus === 'ready_for_delivery') return 5;
  return 2;
}

function notarizedCurrentStage(jobStatus: string, workflowStatus: string | null): number {
  if (jobStatus === 'queued') return 0;
  if (
    jobStatus === 'ocr_in_progress' ||
    jobStatus === 'ocr_completed' ||
    jobStatus === 'translation_in_progress' ||
    jobStatus === 'pdf_rendering'
  ) return 1;
  if (!workflowStatus || workflowStatus === 'awaiting_translator_review') return 2;
  if (workflowStatus === 'awaiting_signature_stamp') return 3;
  if (workflowStatus === 'awaiting_notary_review') return 4;
  if (workflowStatus === 'awaiting_final_qa') return 5;
  if (workflowStatus === 'ready_for_delivery') return 7;
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

function deriveCustomerStatus(
  jobStatus: string,
  workflowStatus: string | null,
  serviceLevel: string | null,
): CustomerStatus {
  if (jobStatus === 'failed') return 'failed';
  if (workflowStatus === 'translator_declined') return 'translator_declined';
  if (workflowStatus === 'notary_declined') return 'notary_declined';
  if (workflowStatus === 'ready_for_delivery') return 'ready_for_delivery';

  if (jobStatus === 'completed') {
    if (!workflowStatus || serviceLevel === 'electronic') return 'completed';
    switch (workflowStatus) {
      case 'awaiting_translator_review': return 'awaiting_translator_review';
      case 'awaiting_signature_stamp':   return 'awaiting_signature_stamp';
      case 'awaiting_notary_review':     return 'awaiting_notary_review';
      case 'awaiting_final_qa':          return 'awaiting_final_qa';
      default: return 'awaiting_translator_review';
    }
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

// ─── Main export ──────────────────────────────────────────────────────────────

export function getCustomerOrderState(input: OrderStateInput): CustomerOrderState {
  const { jobStatus, progressPercent, workflowStatus, serviceLevel } = input;

  const customerStatus = deriveCustomerStatus(jobStatus, workflowStatus, serviceLevel);

  const isTerminal =
    customerStatus === 'completed' ||
    customerStatus === 'failed' ||
    customerStatus === 'ready_for_delivery' ||
    customerStatus === 'translator_declined' ||
    customerStatus === 'notary_declined';

  const canDownload =
    (customerStatus === 'completed' && serviceLevel === 'electronic') ||
    customerStatus === 'ready_for_delivery';

  // Active = not terminal (needs continued attention or polling)
  // ready_for_delivery is "active" — customer can download but it's not archived yet
  const isActive = !isTerminal || customerStatus === 'ready_for_delivery';

  const resolvedServiceLevel = serviceLevel as ServiceLevel | null;

  let stages: OrderStage[];
  let effectiveProgress = progressPercent;

  if (resolvedServiceLevel === 'notarization_through_partners') {
    const idx = notarizedCurrentStage(jobStatus, workflowStatus);
    stages = buildStages(NOTARIZED_STAGES, idx);
    // Map stage index to percent
    const total = NOTARIZED_STAGES.length - 1;
    effectiveProgress = Math.round((idx / total) * 100);
    if (customerStatus === 'ready_for_delivery') effectiveProgress = 100;
  } else if (resolvedServiceLevel === 'official_with_translator_signature_and_provider_stamp') {
    const idx = certifiedCurrentStage(jobStatus, workflowStatus);
    stages = buildStages(CERTIFIED_STAGES, idx);
    const total = CERTIFIED_STAGES.length - 1;
    effectiveProgress = Math.round((idx / total) * 100);
    if (customerStatus === 'ready_for_delivery') effectiveProgress = 100;
  } else {
    const idx = electronicCurrentStage(jobStatus);
    stages = buildStages(ELECTRONIC_STAGES, idx);
    effectiveProgress = progressPercent;
    if (customerStatus === 'completed') effectiveProgress = 100;
  }

  // Never show 100% unless truly done
  if (effectiveProgress >= 100 && !canDownload && customerStatus !== 'completed') {
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
