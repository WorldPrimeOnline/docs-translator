/**
 * Real end-to-end reproduction of the reported crash: 10 files + manifest.json + --dry-run.
 * Local mode (no --from-staging) so this needs zero credentials and can safely run with
 * cwd left at the repo root (tsx's @/* path resolution is cwd-dependent — see
 * staging-fail-fast-ordering.test.ts's docblock for why that matters here).
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const CLI_ENTRY = path.join(REPO_ROOT, 'tools', 'pricing-cli', 'index.ts');
const TSX_BIN = path.join(REPO_ROOT, 'node_modules', '.bin', 'tsx');

function buildTenFilesWithManifest(): { inputDir: string; outputDir: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pricing-cli-dry-run-'));
  const inputDir = path.join(root, 'run-set');
  fs.mkdirSync(inputDir);

  for (let i = 1; i <= 8; i++) fs.writeFileSync(path.join(inputDir, `doc_${i}.pdf`), `fake pdf ${i}`);
  fs.writeFileSync(path.join(inputDir, 'diploma.docx'), 'fake docx');
  fs.writeFileSync(path.join(inputDir, 'certificate.jpg'), 'fake jpg');

  fs.writeFileSync(
    path.join(inputDir, 'manifest.json'),
    JSON.stringify({
      defaults: { sourceLanguage: 'ru', targetLanguage: 'en', serviceLevel: 'official' },
      files: {
        'doc_1.pdf': { serviceLevel: 'notary', applicantType: 'individual', deliveryRequired: true, notaryUrgency: 'after_noon' },
        'diploma.docx': { targetLanguage: 'de' },
      },
    }),
  );

  return { inputDir, outputDir: path.join(root, 'pricing-results') };
}

describe('--dry-run with 10 files + manifest (real subprocess, reproduces the reported crash)', () => {
  it('completes without error, exits 0, prints no status word, and creates no output directory', () => {
    const { inputDir, outputDir } = buildTenFilesWithManifest();

    const stdout = execFileSync(TSX_BIN, [CLI_ENTRY, '--input', inputDir, '--output', outputDir, '--dry-run'], {
      cwd: REPO_ROOT,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    expect(stdout).toContain('Found 10 file(s)');
    expect(stdout).toContain('doc_1.pdf');
    expect(stdout).toContain('doc_8.pdf');
    expect(stdout).toContain('diploma.docx');
    expect(stdout).toContain('certificate.jpg');

    // doc_1.pdf's manifest override must show up as the actually-applied value.
    expect(stdout).toContain('notarization_through_partners');
    expect(stdout).toContain('after_noon');
    // diploma.docx's manifest override.
    expect(stdout).toContain('de');

    // Every field is present with a provenance label for at least one file.
    for (const field of ['sourceLanguage', 'targetLanguage', 'serviceLevel', 'applicantType', 'deliveryRequired', 'notaryUrgency', 'channel', 'partnerCommissionRate']) {
      expect(stdout).toContain(field);
    }

    // The bug this reproduces: --dry-run must never print a per-file status.
    expect(stdout).not.toMatch(/\bSUCCESS\b/);
    expect(stdout).not.toMatch(/\bFAILED\b/);
    expect(stdout).not.toMatch(/\bOPERATOR_REVIEW\b/i);
    expect(stdout).not.toContain('TypeError');
    expect(stdout).not.toContain('newModel');

    expect(fs.existsSync(outputDir)).toBe(false);
  }, 30_000);

  it('exits with code 0 (not a crash)', () => {
    const { inputDir, outputDir } = buildTenFilesWithManifest();
    let exitCode: number | null = 0;
    try {
      execFileSync(TSX_BIN, [CLI_ENTRY, '--input', inputDir, '--output', outputDir, '--dry-run'], {
        cwd: REPO_ROOT,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      exitCode = (err as { status: number | null }).status;
    }
    expect(exitCode).toBe(0);
  }, 30_000);
});
