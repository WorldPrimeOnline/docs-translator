/**
 * Cheap physical page count via pdf-lib — no OCR needed. Same API already used elsewhere in
 * this codebase (mergePdfs() in src/lib/convert-to-pdf.ts).
 */
import { PDFDocument } from 'pdf-lib';

export async function getPhysicalPageCount(pdfBuffer: Buffer): Promise<number> {
  try {
    const doc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
    return Math.max(1, doc.getPageCount());
  } catch {
    return 1;
  }
}

/**
 * Sums the physicalPageCount of each DEDUPLICATED source — 2026-08-02 incident fix
 * (job 29b5fa37-24ac-4269-b965-c024429560da: 2 uploaded sources with real page
 * counts [2,1] priced as if physicalPageCount=1, since Electronic never runs full
 * document analysis on the merged bundle and previously just hardcoded 1).
 *
 * Per-source counts ARE already available at upload time (getPhysicalPageCount()
 * runs on each deduplicated source before merging — see upload/complete routes),
 * so this is the reliable source of truth to fall back on when no merged-document
 * analysis was run. Returns undefined ("unreliable — fall back safely") if there
 * are no sources at all, or if ANY source is missing a count — never guesses a
 * partial sum, never treats a missing count as 0 pages.
 *
 * Multiple uploaded files can be photographs of pages of ONE document — this sums
 * REAL PAGES across sources, never the number of FILES, and must never be used to
 * multiply a per-file minimum/rate.
 */
export function aggregateReliablePhysicalPageCount(
  sources: Array<{ physicalPageCount: number | null }> | undefined | null,
): number | undefined {
  if (!sources || sources.length === 0) return undefined;
  let total = 0;
  for (const source of sources) {
    if (source.physicalPageCount == null) return undefined;
    total += source.physicalPageCount;
  }
  return total;
}
