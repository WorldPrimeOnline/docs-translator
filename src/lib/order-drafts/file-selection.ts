/**
 * Pure client-side file-selection merge logic, extracted from OrderForm.tsx's
 * addFiles() (2026-08-04 multi-file order-preservation audit, WO-98) so the
 * "sequence assigned once by visible client order, before any parallel upload
 * starts" invariant is independently testable at the point files are FIRST
 * accumulated into React state — before /init, before any R2 PUT, before any
 * server-side processing.
 *
 * 2026-08-05 correction: the real WO-98 job (job_source_files.sequence 1..10 mapped
 * to original_filename "10.jpg","9.jpg",...,"1.jpg" — a perfect reversal, confirmed
 * via read-only DB audit) proved the browser's native FileList/drag-drop order is NOT
 * reliably the customer's intended numeric order — the OS file picker can hand back
 * files sorted by date-modified or another criterion having nothing to do with
 * filename. Every server-side stage (verified exhaustively in the prior fix) already
 * faithfully preserves whatever order it's given — the bug is that "whatever order"
 * was never guaranteed to be numeric-filename order in the first place. Fixed HERE,
 * at the one point closest to the source: each newly incoming batch is normalized to
 * natural numeric filename order (Intl.Collator numeric:true) before it ever touches
 * React state — never in the worker, never by re-sorting job_source_files after the
 * fact (job_source_files.sequence remains a faithful, unsorted mirror of whatever
 * order the client submitted; the client is the one and only source of truth for
 * ordering).
 *
 * A later batch is always appended AFTER the currently-selected files. Only the
 * INCOMING batch is normalized — files already in `current` (from an earlier addFiles
 * call) are never re-sorted, so a customer who deliberately reordered/removed files
 * from an earlier batch never has that undone by a later addFiles() call. The one
 * exception to "append" is the post-upload "replace, don't append" case (see
 * uploadedBatch below), which is a deliberate reset, not a reorder.
 */
const naturalFilenameCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/**
 * "IMG_1.jpg" < "IMG_2.jpg" < "IMG_10.jpg" (never "IMG_1" < "IMG_10" < "IMG_2" as plain
 * lexicographic comparison would produce). Array.prototype.sort is a stable sort (ES2019+),
 * so two files with the identical name keep their original relative (FileList) order —
 * this is never a re-shuffle, just a genuine tie with no defined winner either way.
 */
export function sortByNaturalFilename(files: File[]): File[] {
  return [...files].sort((a, b) => naturalFilenameCollator.compare(a.name, b.name));
}

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
  const sortedIncoming = sortByNaturalFilename(incoming);
  if (uploadedBatch) return sortedIncoming;
  return [...current, ...sortedIncoming];
}

/**
 * Removing one file never reorders the rest, and never needs an explicit sequence
 * renumber — sequence is never stored as a field on client state at all, only ever
 * derived from array position at /init time (see upload-card/init and
 * order-drafts/upload/init route.ts). A plain `filter()` collapsing the removed
 * index IS the renormalization to a contiguous 1..N — there is no separate step.
 */
export function removeFileAt(current: File[], index: number): File[] {
  return current.filter((_, i) => i !== index);
}
