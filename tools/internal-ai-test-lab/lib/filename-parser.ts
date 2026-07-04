/**
 * Draft-manifest generator (`--generate-manifest-template`). Parses batch
 * filenames into a BEST-EFFORT starting point for a human to review and edit.
 *
 * Batch execution itself never uses this — it only ever reads the reviewed,
 * committed batch-manifest.json (see lib/manifest.ts). This module is purely
 * a convenience for drafting that file.
 */
import { isSupportedLanguageCode } from './alias-map';
import type { ManifestEntry } from './types';

export interface ParsedFilenameGuess {
  index: number | null;
  file: string;
  sourceLanguage: string | null;
  targetLanguage: string | null;
  targetLanguageGuessed: boolean;
  documentTypeGuess: string;
  documentTypeConfident: boolean;
  notes: string;
}

/**
 * Ordered most-specific-first: substring match against the remaining
 * (non-index, non-language) filename tokens joined with "_". First match
 * wins. Conservative on purpose — falls through to 'other' rather than
 * guessing wrong. Mirrors the document-type mapping hints supplied for the
 * 2026-07-03 batch-mode QA pack.
 */
const DOCUMENT_TYPE_GUESS_HINTS: ReadonlyArray<readonly [string, string]> = [
  ['identity_card', 'identity_card'],
  ['passport_biodata_visa', 'passport'],
  ['passport', 'passport'],
  ['birth_certificate', 'birth_certificate'],
  ['marriage_certificate', 'marriage_certificate'],
  ['bank_reference', 'bank_reference'],
  ['bank_statement', 'bank_statement'],
  ['employment_salary', 'employment_document'],
  ['employment', 'employment_document'],
  ['salary_certificate', 'salary_certificate'],
  ['labor_contract', 'contract'],
  ['power_of_attorney', 'power_of_attorney'],
  ['service_agreement', 'contract'],
  ['academic_transcript', 'academic_transcript'],
  ['diploma_supplement', 'diploma_supplement'],
  ['diploma_certificate', 'diploma'],
  ['diploma', 'diploma'],
  ['medical_discharge_summary', 'medical_document'],
  ['lab_results', 'medical_document'],
  ['vaccination_certificate', 'medical_document'],
  ['medical', 'medical_document'],
  ['tax_certificate', 'tax_certificate'],
  ['police_clearance', 'police_clearance'],
  ['driver_license', 'driver_license'],
  ['visa_application', 'visa_application'],
  ['migration_registration', 'migration_document'],
  ['migration', 'migration_document'],
  ['notarial_consent', 'notarial_consent'],
  ['invoice', 'invoice'],
  ['presentation', 'presentation'],
  ['old_archive', 'archival_certificate'],
  ['archive_certificate', 'archival_certificate'],
  ['contract', 'contract'],
];

/** Single-language-token filenames default target to 'ru' — except an 'ru' source, which defaults to 'en'. Always flagged for review. */
function defaultTargetFor(source: string): string {
  return source === 'ru' ? 'en' : 'ru';
}

function guessDocumentType(slug: string): { type: string; confident: boolean } {
  const lower = slug.toLowerCase();
  for (const [keyword, guess] of DOCUMENT_TYPE_GUESS_HINTS) {
    if (lower.includes(keyword)) return { type: guess, confident: true };
  }
  return { type: 'other', confident: false };
}

export function parseFilename(fileName: string): ParsedFilenameGuess {
  const base = fileName.replace(/\.[^./]+$/, '');
  const tokens = base.split('_').filter(Boolean);

  let index: number | null = null;
  let cursor = 0;
  if (tokens[0] && /^\d+$/.test(tokens[0])) {
    index = Number(tokens[0]);
    cursor = 1;
  }

  let sourceLanguage: string | null = null;
  let targetLanguage: string | null = null;
  let targetLanguageGuessed = false;
  const noteParts: string[] = [];

  const t0 = tokens[cursor];
  const t1 = tokens[cursor + 1];
  if (t0 && isSupportedLanguageCode(t0)) {
    sourceLanguage = t0.toLowerCase();
    if (t1 && isSupportedLanguageCode(t1)) {
      targetLanguage = t1.toLowerCase();
      cursor += 2;
    } else {
      targetLanguage = defaultTargetFor(sourceLanguage);
      targetLanguageGuessed = true;
      cursor += 1;
      noteParts.push(`targetLanguage guessed as "${targetLanguage}" (only one language token in filename) — please verify`);
    }
  } else {
    noteParts.push('No recognized language code found in filename — sourceLanguage/targetLanguage left blank, please fill in');
  }

  const slug = tokens.slice(cursor).join('_');
  const { type: documentTypeGuess, confident: documentTypeConfident } = guessDocumentType(slug);
  if (!documentTypeConfident) {
    noteParts.push('Please review — document type could not be confidently guessed from filename');
  }

  return {
    index,
    file: fileName,
    sourceLanguage,
    targetLanguage,
    targetLanguageGuessed,
    documentTypeGuess,
    documentTypeConfident,
    notes: noteParts.join('; '),
  };
}

/**
 * Scans an input directory (relative file names, non-recursive) and returns a
 * DRAFT manifest. Every entry is marked TEMPLATE in its notes — the caller
 * must review/edit before this is usable as a real --manifest.
 */
export function generateManifestTemplate(fileNames: string[]): ManifestEntry[] {
  return fileNames
    .slice()
    .sort((a, b) => a.localeCompare(b))
    .map((fileName) => {
      const guess = parseFilename(fileName);
      const note = ['TEMPLATE — please review before running.', guess.notes].filter(Boolean).join(' ');
      return {
        file: guess.file,
        sourceLanguage: guess.sourceLanguage ?? '',
        targetLanguage: guess.targetLanguage ?? '',
        documentType: guess.documentTypeGuess,
        serviceLevel: 'electronic_translation',
        notes: note,
      } satisfies ManifestEntry;
    });
}
