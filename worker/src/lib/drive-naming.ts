/**
 * Pure Drive filename conventions for multi-source jobs (2026-08-01 multi-file
 * fulfillment decision). No dependencies — deliberately separate from processor.ts
 * (which pulls in Supabase/env/OCR/etc. at import time) so these are trivially testable.
 */

/**
 * `NNN_<original_filename>` — the Drive 01_SOURCE naming convention for multi-source
 * jobs. Ordered strictly by `sequence`, never filename/createdTime.
 */
export function sourceDriveFilename(sequence: number, originalFilename: string): string {
  return `${String(sequence).padStart(3, '0')}_${originalFilename}`;
}

/** `NNN_AI_DRAFT_<base>.docx` — the Drive 02_AI_DRAFT naming convention for multi-source jobs. */
export function aiDraftDriveFilename(sequence: number, originalFilename: string): string {
  const base = originalFilename.replace(/\.[^./]+$/, '');
  return `${String(sequence).padStart(3, '0')}_AI_DRAFT_${base}.docx`;
}
