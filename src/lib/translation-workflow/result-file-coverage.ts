/**
 * Pure coverage check for job_result_files.source_sequences groups — 2026-08-01
 * multi-file fulfillment decision. No DB/network calls; dependency-free like
 * customer-order-state.ts, which is the reason this lives here rather than being
 * folded into the DB-aware lookup in src/lib/jobs/result-files-status.ts.
 *
 * Canonical for the web app; worker/src/lib/result-file-mapping.ts has an identical
 * copy (kept in sync manually, same convention as output-plan.ts/visual-elements.ts —
 * see CLAUDE.md's "Modules duplicated between web and worker") since the worker
 * cannot import from src/.
 */
export function isFullyCovered(totalSources: number, sequenceGroups: number[][]): boolean {
  const covered = new Set<number>();
  for (const group of sequenceGroups) {
    for (const seq of group) {
      if (covered.has(seq)) return false; // overlap
      covered.add(seq);
    }
  }
  for (let s = 1; s <= totalSources; s++) {
    if (!covered.has(s)) return false; // gap
  }
  return true;
}
