/**
 * 2026-07-25 fix: pure helpers behind useStatusLabel() (src/app/[locale]/dashboard/page.tsx).
 * Extracted so the "which i18n key to use" and "how to format the percent suffix"
 * decisions are independently testable, matching this codebase's convention of
 * keeping the component thin and testing logic separately.
 */

/**
 * jobStatus values covering the worker's own OCR/translation/PDF-render pipeline —
 * merged into ONE customer-facing status key ('status.preparingDocument').
 * Previously these three showed different technical labels ("Извлечение текста" /
 * "Создание PDF") with the raw worker progress_percent embedded directly —
 * "Создание PDF" specifically must never be shown to a customer per the explicit
 * requirement that closed this gap.
 */
const PIPELINE_CUSTOMER_STATUSES: ReadonlySet<string> = new Set([
  'queued', 'ocr_in_progress', 'translation_in_progress', 'pdf_rendering',
]);

export function isPipelineCustomerStatus(customerStatus: string | null): boolean {
  return customerStatus != null && PIPELINE_CUSTOMER_STATUSES.has(customerStatus);
}

/**
 * The percentage previously disappeared entirely once workflow_status took over
 * from the worker's own jobStatus pipeline (only ocr_in_progress/
 * translation_in_progress/pdf_rendering ever interpolated a {pct}). Appended here
 * for every non-terminal status instead of requiring a {pct} placeholder in all
 * ~20 status strings across all 14 locales. Not shown once terminal — a
 * "Доставлено"/"Отменено" label doesn't need a redundant "(100%)" suffix, even
 * though the underlying value getCustomerOrderState returns is still 100.
 */
export function formatStatusLabelWithProgress(label: string, isTerminal: boolean, progressPercent: number): string {
  return isTerminal ? label : `${label} (${progressPercent}%)`;
}
