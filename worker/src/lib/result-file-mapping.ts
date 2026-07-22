/**
 * Pure validation for mapping Drive-synced result files (translator_result,
 * signature_stamp, notary) back onto job_source_files.sequence — 2026-08-01 multi-file
 * fulfillment decision. No Drive/R2/DB calls here; the (not-yet-built) Drive read-back
 * sync calls this on the filenames it finds in a folder before writing/upserting any
 * job_result_files row, and must refuse to publish anything to the customer if
 * validation fails — see job_result_files.status: only 'ready' rows are ever served.
 *
 * Filename convention (from the user's exact examples):
 *   "001_TRANSLATOR_RESULT.pdf"        -> covers source sequence 1
 *   "001-010_Contract_TRANSLATOR_RESULT.pdf" -> covers source sequences 1..10
 *   "001-003_Part1.pdf" + "004-010_Part2.pdf" -> two groups, no overlap
 * An unprefixed filename (no leading NNN or NNN-MMM) is only valid when the job has
 * exactly one source file — otherwise WPO staff must always disambiguate explicitly.
 */

const PREFIX_RE = /^(\d{3})(?:-(\d{3}))?_/;

/**
 * Parses the leading `NNN_` or `NNN-MMM_` prefix from a Drive filename. Returns the
 * inclusive [start, end] sequence range it claims, or `null` if no prefix is present.
 * Never derives a range from anything other than this explicit numeric prefix (never
 * filename string order, never Drive createdTime).
 */
export function parseSequenceRangeFromFilename(filename: string): { start: number; end: number } | null {
  const match = PREFIX_RE.exec(filename);
  if (!match) return null;
  const start = parseInt(match[1]!, 10);
  const end = match[2] ? parseInt(match[2], 10) : start;
  return { start, end };
}

export interface ResultFileCandidate {
  filename: string;
}

export interface ResolvedResultFileGroup {
  filename: string;
  sourceSequences: number[];
}

export type MappingValidationResult =
  | { ok: true; groups: ResolvedResultFileGroup[] }
  | { ok: false; errors: string[] };

/**
 * Validates a full set of candidate result filenames against the job's real source
 * count. Every rule here is a hard block on publication — a caller must never create
 * or upsert job_result_files rows as `status: 'ready'` from a failed validation; the
 * whole batch is rejected together so a customer never gets a partial/inconsistent set.
 */
export function validateResultFileMapping(
  totalSources: number,
  candidates: ResultFileCandidate[],
): MappingValidationResult {
  const errors: string[] = [];
  const groups: ResolvedResultFileGroup[] = [];
  const claimedBy = new Map<number, string[]>();

  for (const candidate of candidates) {
    const range = parseSequenceRangeFromFilename(candidate.filename);

    let sequences: number[];
    if (range === null) {
      if (totalSources !== 1) {
        errors.push(`"${candidate.filename}": no NNN/NNN-MMM sequence prefix, but this job has ${totalSources} source files (an unprefixed filename is only allowed when there is exactly one source file)`);
        continue;
      }
      sequences = [1];
    } else {
      if (range.start < 1 || range.end < range.start) {
        errors.push(`"${candidate.filename}": invalid sequence range ${range.start}-${range.end}`);
        continue;
      }
      if (range.end > totalSources) {
        errors.push(`"${candidate.filename}": sequence range ${range.start}-${range.end} exceeds this job's ${totalSources} source file(s)`);
        continue;
      }
      sequences = [];
      for (let s = range.start; s <= range.end; s++) sequences.push(s);
    }

    groups.push({ filename: candidate.filename, sourceSequences: sequences });
    for (const seq of sequences) {
      const claimants = claimedBy.get(seq) ?? [];
      claimants.push(candidate.filename);
      claimedBy.set(seq, claimants);
    }
  }

  for (const [seq, filenames] of claimedBy) {
    if (filenames.length > 1) {
      errors.push(`source sequence ${seq} is covered by multiple files: ${filenames.join(', ')}`);
    }
  }

  const missing: number[] = [];
  for (let s = 1; s <= totalSources; s++) {
    if (!claimedBy.has(s)) missing.push(s);
  }
  if (missing.length > 0) {
    errors.push(`no result file covers source sequence(s): ${missing.join(', ')}`);
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, groups };
}

/**
 * Coverage-only check over already-resolved sequence groups (e.g. stored
 * job_result_files.source_sequences rows) — no filename parsing. Used to decide
 * whether a stage's CURRENTLY STORED 'ready' rows fully cover 1..totalSources before
 * treating that stage as deliverable to the customer. A web-app-side copy of this
 * exact check lives in src/lib/translation-workflow/result-file-coverage.ts (that
 * file is canonical for the customer-projection read path per
 * customer-order-state.ts's own "never duplicate" rule) — this worker copy is used
 * by the reconciler to decide whether a job still needs another sync attempt.
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
