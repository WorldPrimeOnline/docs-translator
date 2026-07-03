/**
 * batch-manifest.json loading and validation for batch mode.
 *
 * Batch execution relies ONLY on the manifest — never on filename guessing
 * (that's lib/filename-parser.ts, used only to draft a template a human must
 * review). See README.md for the manifest format.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import type { ManifestEntry } from './types';
import {
  mapDocumentType,
  mapServiceLevel,
  mapUrgencyLevel,
  mapFulfillmentMethod,
  isSupportedLanguageCode,
  AliasMapError,
  DOCUMENT_TYPE_FALLBACK_ALIASES,
} from './alias-map';

export class ManifestError extends Error {}

const REQUIRED_FIELDS = ['file', 'sourceLanguage', 'targetLanguage', 'documentType', 'serviceLevel'] as const;

export interface ManifestIssue {
  /** undefined for manifest-wide issues (e.g. "not an array"). */
  file?: string;
  message: string;
  /** Warnings do not block the batch run; errors do. */
  severity: 'error' | 'warning';
}

export interface ManifestValidationResult {
  ok: boolean;
  issues: ManifestIssue[];
  errors: ManifestIssue[];
  warnings: ManifestIssue[];
}

/** Fails if the manifest file does not exist or is not valid JSON array of objects. */
export function loadManifest(manifestPath: string): ManifestEntry[] {
  if (!fs.existsSync(manifestPath)) {
    throw new ManifestError(`--manifest not found: ${manifestPath}`);
  }
  let raw: string;
  try {
    raw = fs.readFileSync(manifestPath, 'utf-8');
  } catch (err) {
    throw new ManifestError(`Failed to read --manifest ${manifestPath}: ${err instanceof Error ? err.message : String(err)}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new ManifestError(`--manifest ${manifestPath} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!Array.isArray(parsed)) {
    throw new ManifestError(`--manifest ${manifestPath} must be a JSON array of entries.`);
  }
  return parsed as ManifestEntry[];
}

/** Pure — required fields, duplicates, and alias-map validity. No filesystem access. */
export function validateManifestShape(entries: ManifestEntry[]): ManifestIssue[] {
  const issues: ManifestIssue[] = [];

  if (entries.length === 0) {
    issues.push({ message: 'Manifest is empty — nothing to run.', severity: 'error' });
    return issues;
  }

  const seenFiles = new Map<string, number>();

  entries.forEach((entry, idx) => {
    const label = entry?.file ?? `entry #${idx + 1}`;

    if (entry === null || typeof entry !== 'object') {
      issues.push({ file: label, message: `Entry #${idx + 1} is not an object.`, severity: 'error' });
      return;
    }

    const missing = REQUIRED_FIELDS.filter((f) => !entry[f] || typeof entry[f] !== 'string' || entry[f].trim() === '');
    if (missing.length > 0) {
      issues.push({ file: label, message: `Missing required field(s): ${missing.join(', ')}`, severity: 'error' });
    }

    if (entry.file) {
      const count = (seenFiles.get(entry.file) ?? 0) + 1;
      seenFiles.set(entry.file, count);
    }

    if (entry.sourceLanguage && entry.sourceLanguage !== 'auto' && !isSupportedLanguageCode(entry.sourceLanguage)) {
      issues.push({
        file: label,
        message: `sourceLanguage "${entry.sourceLanguage}" is not in the supported language list (src/i18n/locales.ts). If this is intentional, verify manually.`,
        severity: 'warning',
      });
    }
    if (entry.targetLanguage && !isSupportedLanguageCode(entry.targetLanguage)) {
      issues.push({
        file: label,
        message: `targetLanguage "${entry.targetLanguage}" is not in the supported language list (src/i18n/locales.ts). If this is intentional, verify manually.`,
        severity: 'warning',
      });
    }

    if (entry.documentType) {
      try {
        const canonical = mapDocumentType(entry.documentType);
        if (canonical === 'other' && DOCUMENT_TYPE_FALLBACK_ALIASES.has(entry.documentType.trim().toLowerCase())) {
          issues.push({
            file: label,
            message: `documentType "${entry.documentType}" has no dedicated canonical type — mapped to "other". Pricing/prompting will treat it generically.`,
            severity: 'warning',
          });
        }
      } catch (err) {
        issues.push({
          file: label,
          message: err instanceof AliasMapError ? err.message : String(err),
          severity: 'error',
        });
      }
    }

    if (entry.serviceLevel) {
      try {
        mapServiceLevel(entry.serviceLevel);
      } catch (err) {
        issues.push({
          file: label,
          message: err instanceof AliasMapError ? err.message : String(err),
          severity: 'error',
        });
      }
    }

    if (entry.urgency) {
      try {
        mapUrgencyLevel(entry.urgency);
      } catch (err) {
        issues.push({ file: label, message: err instanceof AliasMapError ? err.message : String(err), severity: 'error' });
      }
    }

    if (entry.fulfillmentMethod) {
      try {
        mapFulfillmentMethod(entry.fulfillmentMethod);
      } catch (err) {
        issues.push({ file: label, message: err instanceof AliasMapError ? err.message : String(err), severity: 'error' });
      }
    }
  });

  for (const [file, count] of seenFiles) {
    if (count > 1) {
      issues.push({ file, message: `Duplicate manifest entry — "${file}" appears ${count} times.`, severity: 'error' });
    }
  }

  return issues;
}

/** Filesystem-dependent — checks every referenced file exists under inputDir. */
export function validateManifestFiles(entries: ManifestEntry[], inputDir: string): ManifestIssue[] {
  const issues: ManifestIssue[] = [];
  if (!fs.existsSync(inputDir)) {
    issues.push({ message: `--input-dir not found: ${inputDir}`, severity: 'error' });
    return issues;
  }
  if (!fs.statSync(inputDir).isDirectory()) {
    issues.push({ message: `--input-dir is not a directory: ${inputDir}`, severity: 'error' });
    return issues;
  }
  for (const entry of entries) {
    if (!entry.file) continue;
    const full = path.join(inputDir, entry.file);
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
      issues.push({ file: entry.file, message: `Manifest references a file that does not exist: ${full}`, severity: 'error' });
    }
  }
  return issues;
}

export function validateManifest(entries: ManifestEntry[], inputDir: string): ManifestValidationResult {
  const issues = [...validateManifestShape(entries), ...validateManifestFiles(entries, inputDir)];
  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');
  return { ok: errors.length === 0, issues, errors, warnings };
}

export interface SelectManifestEntriesOptions {
  /** Comma-separated file names or 1-based positions in the manifest array. */
  only?: string;
  limit?: number;
}

/** Applies --only then --limit, in that order. Pure — no filesystem access. */
export function selectManifestEntries(entries: ManifestEntry[], opts: SelectManifestEntriesOptions): ManifestEntry[] {
  let selected = entries;

  if (opts.only) {
    const tokens = opts.only.split(',').map((t) => t.trim()).filter(Boolean);
    const byFileName = new Set(tokens.filter((t) => !/^\d+$/.test(t)));
    const byPosition = new Set(tokens.filter((t) => /^\d+$/.test(t)).map(Number));
    selected = entries.filter((entry, idx) => byFileName.has(entry.file) || byPosition.has(idx + 1));
  }

  if (opts.limit !== undefined) {
    selected = selected.slice(0, opts.limit);
  }

  return selected;
}

/** Human-readable validation summary printed before a batch run starts. */
export function formatValidationSummary(result: ManifestValidationResult, entryCount: number): string {
  const lines: string[] = [];
  lines.push('=== Manifest validation ===');
  lines.push(`Entries: ${entryCount}`);
  lines.push(`Errors: ${result.errors.length}`);
  lines.push(`Warnings: ${result.warnings.length}`);
  if (result.errors.length > 0) {
    lines.push('');
    lines.push('Errors (must fix before running):');
    for (const e of result.errors) lines.push(`  - [${e.file ?? 'manifest'}] ${e.message}`);
  }
  if (result.warnings.length > 0) {
    lines.push('');
    lines.push('Warnings (review, but will not block the run):');
    for (const w of result.warnings) lines.push(`  - [${w.file ?? 'manifest'}] ${w.message}`);
  }
  lines.push(result.ok ? '\n✓ Manifest is valid.' : '\n✗ Manifest is invalid — fix errors above before running.');
  return lines.join('\n');
}
