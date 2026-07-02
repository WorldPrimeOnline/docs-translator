import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { generateRunId, buildRunPaths, ensureRunDirs } from '../lib/run-paths';

describe('generateRunId', () => {
  it('produces a timestamp_suffix shaped id', () => {
    const id = generateRunId(new Date('2026-07-02T18:46:00.000Z'));
    expect(id).toMatch(/^\d{8}T\d{6}Z_[0-9a-f]{8}$/);
  });

  it('produces different ids on repeated calls', () => {
    const a = generateRunId();
    const b = generateRunId();
    expect(a).not.toBe(b);
  });
});

describe('buildRunPaths', () => {
  it('computes all expected subdirectories under outputDir/runId', () => {
    const paths = buildRunPaths('tools/internal-ai-test-lab/runs', 'abc123');
    expect(paths.runId).toBe('abc123');
    expect(paths.runDir).toBe(path.join('tools/internal-ai-test-lab/runs', 'abc123'));
    expect(paths.sourceDir).toBe(path.join(paths.runDir, 'source'));
    expect(paths.ocrDir).toBe(path.join(paths.runDir, 'ocr'));
    expect(paths.translationDir).toBe(path.join(paths.runDir, 'translation'));
    expect(paths.renderedDir).toBe(path.join(paths.runDir, 'rendered'));
    expect(paths.pricingDir).toBe(path.join(paths.runDir, 'pricing'));
    expect(paths.reportDir).toBe(path.join(paths.runDir, 'report'));
    expect(paths.logFile).toBe(path.join(paths.runDir, 'run.log'));
  });
});

describe('ensureRunDirs', () => {
  it('creates the run directory tree on disk', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wpo-ai-test-lab-'));
    try {
      const paths = buildRunPaths(tmpRoot, 'run1');
      ensureRunDirs(paths);
      for (const dir of [paths.runDir, paths.sourceDir, paths.ocrDir, paths.translationDir, paths.renderedDir, paths.pricingDir, paths.reportDir]) {
        expect(fs.existsSync(dir)).toBe(true);
        expect(fs.statSync(dir).isDirectory()).toBe(true);
      }
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});
