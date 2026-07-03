import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import {
  loadManifest,
  ManifestError,
  validateManifestShape,
  validateManifestFiles,
  validateManifest,
  selectManifestEntries,
  formatValidationSummary,
} from '../lib/manifest';
import type { ManifestEntry } from '../lib/types';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wpo-manifest-test-'));
}

const VALID_ENTRY: ManifestEntry = {
  file: '01_ru_kk_identity_card_complex.pdf',
  sourceLanguage: 'ru',
  targetLanguage: 'kk',
  documentType: 'identity_card',
  serviceLevel: 'electronic_translation',
  notes: 'Complex ID card layout',
};

describe('loadManifest', () => {
  it('fails clearly if the manifest file does not exist', () => {
    expect(() => loadManifest('/nonexistent/batch-manifest.json')).toThrow(ManifestError);
    expect(() => loadManifest('/nonexistent/batch-manifest.json')).toThrow(/not found/);
  });

  it('fails clearly on invalid JSON', () => {
    const dir = tmpDir();
    const manifestPath = path.join(dir, 'batch-manifest.json');
    fs.writeFileSync(manifestPath, '{ not valid json');
    expect(() => loadManifest(manifestPath)).toThrow(ManifestError);
    expect(() => loadManifest(manifestPath)).toThrow(/not valid JSON/);
  });

  it('fails clearly if the manifest is not a JSON array', () => {
    const dir = tmpDir();
    const manifestPath = path.join(dir, 'batch-manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify({ file: 'x.pdf' }));
    expect(() => loadManifest(manifestPath)).toThrow(/must be a JSON array/);
  });

  it('loads a valid manifest array', () => {
    const dir = tmpDir();
    const manifestPath = path.join(dir, 'batch-manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify([VALID_ENTRY]));
    const entries = loadManifest(manifestPath);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.file).toBe(VALID_ENTRY.file);
  });
});

describe('validateManifestShape — required fields', () => {
  it('passes for a fully valid entry', () => {
    const issues = validateManifestShape([VALID_ENTRY]);
    expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('fails if required fields are missing', () => {
    const bad = { file: '02.pdf' } as ManifestEntry;
    const issues = validateManifestShape([bad]);
    const errors = issues.filter((i) => i.severity === 'error');
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]!.message).toContain('sourceLanguage');
    expect(errors[0]!.message).toContain('targetLanguage');
    expect(errors[0]!.message).toContain('documentType');
    expect(errors[0]!.message).toContain('serviceLevel');
  });

  it('flags empty-string required fields as missing too', () => {
    const bad: ManifestEntry = { ...VALID_ENTRY, sourceLanguage: '   ' };
    const issues = validateManifestShape([bad]);
    expect(issues.some((i) => i.severity === 'error' && i.message.includes('sourceLanguage'))).toBe(true);
  });

  it('fails on empty manifest', () => {
    const issues = validateManifestShape([]);
    expect(issues.some((i) => i.severity === 'error')).toBe(true);
  });
});

describe('validateManifestShape — duplicate file entries', () => {
  it('fails if the same file appears twice', () => {
    const issues = validateManifestShape([VALID_ENTRY, { ...VALID_ENTRY }]);
    const errors = issues.filter((i) => i.severity === 'error');
    expect(errors.some((e) => e.message.includes('Duplicate'))).toBe(true);
  });

  it('does not flag distinct files as duplicates', () => {
    const other: ManifestEntry = { ...VALID_ENTRY, file: '02_en_th_passport_biodata_visa.pdf' };
    const issues = validateManifestShape([VALID_ENTRY, other]);
    expect(issues.some((i) => i.message.includes('Duplicate'))).toBe(false);
  });
});

describe('validateManifestShape — alias-map validation reuses existing config', () => {
  it('fails on an unknown documentType', () => {
    const bad: ManifestEntry = { ...VALID_ENTRY, documentType: 'totally_made_up_type' };
    const issues = validateManifestShape([bad]);
    expect(issues.some((i) => i.severity === 'error' && i.message.includes('document-type'))).toBe(true);
  });

  it('fails on an unknown serviceLevel', () => {
    const bad: ManifestEntry = { ...VALID_ENTRY, serviceLevel: 'made_up_service_level' };
    const issues = validateManifestShape([bad]);
    expect(issues.some((i) => i.severity === 'error' && i.message.includes('service-level'))).toBe(true);
  });

  it('warns (not errors) when documentType resolves through a lossy "other" fallback alias', () => {
    const entry: ManifestEntry = { ...VALID_ENTRY, documentType: 'birth_certificate' };
    const issues = validateManifestShape([entry]);
    expect(issues.some((i) => i.severity === 'error')).toBe(false);
    expect(issues.some((i) => i.severity === 'warning' && i.message.includes('birth_certificate'))).toBe(true);
  });

  it('warns on a source/target language code outside the supported list', () => {
    const entry: ManifestEntry = { ...VALID_ENTRY, targetLanguage: 'xx' };
    const issues = validateManifestShape([entry]);
    expect(issues.some((i) => i.severity === 'warning' && i.message.includes('targetLanguage'))).toBe(true);
  });

  it('accepts sourceLanguage "auto" without a warning', () => {
    const entry: ManifestEntry = { ...VALID_ENTRY, sourceLanguage: 'auto' };
    const issues = validateManifestShape([entry]);
    expect(issues.some((i) => i.message.includes('sourceLanguage'))).toBe(false);
  });

  it('fails on an unknown urgency alias', () => {
    const bad: ManifestEntry = { ...VALID_ENTRY, urgency: 'yesterday' };
    const issues = validateManifestShape([bad]);
    expect(issues.some((i) => i.severity === 'error' && i.message.includes('urgency'))).toBe(true);
  });

  it('fails on an unknown fulfillmentMethod alias', () => {
    const bad: ManifestEntry = { ...VALID_ENTRY, fulfillmentMethod: 'teleport' };
    const issues = validateManifestShape([bad]);
    expect(issues.some((i) => i.severity === 'error' && i.message.includes('fulfillment-method'))).toBe(true);
  });
});

describe('validateManifestFiles — missing input dir / missing referenced file', () => {
  it('fails clearly if input-dir does not exist', () => {
    const issues = validateManifestFiles([VALID_ENTRY], '/nonexistent/input/batch');
    expect(issues.some((i) => i.message.includes('--input-dir not found'))).toBe(true);
  });

  it('fails clearly if input-dir is not a directory', () => {
    const dir = tmpDir();
    const notADir = path.join(dir, 'file.txt');
    fs.writeFileSync(notADir, 'x');
    const issues = validateManifestFiles([VALID_ENTRY], notADir);
    expect(issues.some((i) => i.message.includes('is not a directory'))).toBe(true);
  });

  it('fails clearly if the manifest references a missing file', () => {
    const dir = tmpDir();
    const issues = validateManifestFiles([VALID_ENTRY], dir);
    expect(issues.some((i) => i.file === VALID_ENTRY.file && i.message.includes('does not exist'))).toBe(true);
  });

  it('passes when every referenced file exists', () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, VALID_ENTRY.file), 'dummy content');
    const issues = validateManifestFiles([VALID_ENTRY], dir);
    expect(issues).toEqual([]);
  });
});

describe('validateManifest — end-to-end + summary', () => {
  it('ok=true for a fully valid manifest with existing files', () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, VALID_ENTRY.file), 'dummy');
    const result = validateManifest([VALID_ENTRY], dir);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('ok=false when any error is present, even with zero warnings', () => {
    const dir = tmpDir();
    const result = validateManifest([VALID_ENTRY], dir); // file missing on disk
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('formatValidationSummary prints a clear summary before running', () => {
    const dir = tmpDir();
    const result = validateManifest([VALID_ENTRY], dir);
    const summary = formatValidationSummary(result, 1);
    expect(summary).toContain('Manifest validation');
    expect(summary).toContain('Entries: 1');
    expect(summary).toContain('Errors:');
    expect(summary).toContain('Warnings:');
  });
});

describe('selectManifestEntries — --only / --limit', () => {
  const entries: ManifestEntry[] = [
    { ...VALID_ENTRY, file: 'a.pdf' },
    { ...VALID_ENTRY, file: 'b.pdf' },
    { ...VALID_ENTRY, file: 'c.pdf' },
  ];

  it('with no options, returns all entries', () => {
    expect(selectManifestEntries(entries, {})).toHaveLength(3);
  });

  it('--only by file name selects just that entry', () => {
    const selected = selectManifestEntries(entries, { only: 'b.pdf' });
    expect(selected.map((e) => e.file)).toEqual(['b.pdf']);
  });

  it('--only by 1-based position selects that entry', () => {
    const selected = selectManifestEntries(entries, { only: '2' });
    expect(selected.map((e) => e.file)).toEqual(['b.pdf']);
  });

  it('--only accepts a comma-separated mix of names and positions', () => {
    const selected = selectManifestEntries(entries, { only: 'a.pdf,3' });
    expect(selected.map((e) => e.file).sort()).toEqual(['a.pdf', 'c.pdf']);
  });

  it('--limit caps the result after --only filtering', () => {
    const selected = selectManifestEntries(entries, { limit: 2 });
    expect(selected).toHaveLength(2);
    expect(selected.map((e) => e.file)).toEqual(['a.pdf', 'b.pdf']);
  });
});
