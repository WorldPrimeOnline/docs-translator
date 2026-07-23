/**
 * Pure client-side file-selection merge logic, extracted from OrderForm.tsx's
 * addFiles() (2026-08-04 multi-file order-preservation audit, WO-98) so the
 * "sequence assigned once by visible client order, before any parallel upload
 * starts" invariant is independently testable at the point files are FIRST
 * accumulated into React state — before /init, before any R2 PUT, before any
 * server-side processing.
 *
 * A later batch is always appended AFTER the currently-selected files, and the
 * relative order within each batch (as delivered by the browser's FileList) is
 * preserved — never re-sorted by name/size/type. The one exception is the
 * post-upload "replace, don't append" case (see uploadedBatch below), which is a
 * deliberate reset, not a reorder.
 */
export function mergeFileSelection(
  current: File[],
  incoming: File[],
  /**
   * True only when `current` was already fully uploaded once (upload/complete
   * succeeded) but the overall submit hasn't finished (e.g. pricing failed
   * afterward). Retrying by adding a file must REPLACE that stale-but-uploaded
   * selection, never append to it — appending previously caused a one-page
   * document to silently become a two-page merged PDF (see the 2026-07-29
   * dedup-before-merge incident).
   */
  uploadedBatch: boolean,
): File[] {
  if (uploadedBatch) return incoming;
  return [...current, ...incoming];
}

/** Removing one file must never reorder the rest. */
export function removeFileAt(current: File[], index: number): File[] {
  return current.filter((_, i) => i !== index);
}
