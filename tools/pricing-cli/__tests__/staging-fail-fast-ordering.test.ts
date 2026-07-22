/**
 * Structural test proving --from-staging's env check runs BEFORE file discovery/analysis and
 * exits 3 without ever creating an output directory — via source-position assertions, the same
 * technique worker/src/__tests__/index.startup.test.ts already uses in this codebase for
 * exactly this kind of ordering guarantee.
 *
 * A real subprocess spawn was tried and rejected: this repo always has a real ./.env.local at
 * the repo root (needed for `npm run dev`), which would satisfy the check and make the missing-
 * env scenario untestable without either temporarily moving the developer's real credentials
 * file (destructive) or changing the subprocess's cwd (which breaks tsx's tsconfig-paths
 * resolution for @/* — a separate, unrelated cwd-dependency). The behavioral guarantee itself
 * (checkStagingEnvOrThrow's exact throw/message) is unit-tested in env-loader.test.ts.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const INDEX_SRC = fs.readFileSync(path.join(__dirname, '..', 'index.ts'), 'utf-8');

function pos(needle: string): number {
  const i = INDEX_SRC.indexOf(needle);
  expect(i).toBeGreaterThan(-1); // sanity: the needle must actually exist in the source
  return i;
}

describe('index.ts — --from-staging fail-fast ordering', () => {
  it('checks staging env before loading config/manifest or discovering files', () => {
    const checkPos = pos('checkStagingEnvOrThrow()');
    const configPos = pos('loadConfigFile(configPath)');
    const manifestPos = pos('loadManifest(');
    const discoverPos = pos('discoverFiles(inputDir)');

    expect(checkPos).toBeLessThan(configPos);
    expect(checkPos).toBeLessThan(manifestPos);
    expect(checkPos).toBeLessThan(discoverPos);
  });

  it('checks staging env before any output/report directory is created', () => {
    const checkPos = pos('checkStagingEnvOrThrow()');
    const ensureDirPos = pos('ensureDir(runDir)');
    expect(checkPos).toBeLessThan(ensureDirPos);
  });

  it('the missing-env catch block prints only names (via err.missingVars) and exits 3', () => {
    const catchBlockStart = INDEX_SRC.indexOf('if (err instanceof MissingStagingEnvError)');
    const catchBlockEnd = INDEX_SRC.indexOf('process.exit(3)', catchBlockStart);
    const block = INDEX_SRC.slice(catchBlockStart, catchBlockEnd + 'process.exit(3)'.length);

    expect(block).toContain('Configuration error:');
    expect(block).toContain('Missing environment variables required for --from-staging:');
    expect(block).toContain('err.missingVars');
    expect(block).toContain('process.exit(3)');
    // Never interpolates process.env directly in this block (names only, from the error object).
    expect(block).not.toMatch(/process\.env\[/);
  });

  it('env loading itself happens before the staging env check (loadEnvChain before checkStagingEnvOrThrow)', () => {
    expect(pos('loadEnvChain(')).toBeLessThan(pos('checkStagingEnvOrThrow()'));
  });
});

describe('index.ts — OCR (MISTRAL_API_KEY) fail-fast ordering', () => {
  it('checks OCR env before the per-file loop and before the output/run directory is created', () => {
    const checkPos = pos('checkOcrEnvOrThrow()');
    const runDirPos = pos('const runDir = buildRunDir(');
    const ensureDirPos = pos('ensureDir(runDir)');
    const loopPos = INDEX_SRC.indexOf('for (let i = 0; i < files.length; i++)', runDirPos - 500);

    expect(checkPos).toBeLessThan(runDirPos);
    expect(checkPos).toBeLessThan(ensureDirPos);
    expect(checkPos).toBeLessThan(loopPos);
  });

  it('checks OCR env AFTER the --dry-run branch has already exited (dry-run never needs it)', () => {
    const dryRunBranchPos = pos("if (options.dryRun) {");
    const checkPos = pos('checkOcrEnvOrThrow()');
    expect(dryRunBranchPos).toBeLessThan(checkPos);
  });

  it('is skipped entirely when --no-ocr is set (guarded by `if (!options.noOcr)`)', () => {
    const guardPos = INDEX_SRC.indexOf('if (!options.noOcr) {');
    const checkPos = pos('checkOcrEnvOrThrow()');
    expect(guardPos).toBeGreaterThan(-1);
    expect(guardPos).toBeLessThan(checkPos);
  });

  it('the missing-OCR-env catch block prints only the var name and exits 3 — no per-file reports created here', () => {
    const catchStart = INDEX_SRC.indexOf('if (err instanceof MissingOcrEnvError)');
    const catchEnd = INDEX_SRC.indexOf('process.exit(3)', catchStart);
    const block = INDEX_SRC.slice(catchStart, catchEnd + 'process.exit(3)'.length);

    expect(block).toContain('Configuration error:');
    expect(block).toContain('Missing environment variables required for OCR');
    expect(block).toContain('err.missingVars');
    expect(block).toContain('process.exit(3)');
    expect(block).not.toContain('.report.json');
    expect(block).not.toContain('.report.md');
    expect(block).not.toMatch(/process\.env\[/);
  });

  it('MISTRAL_API_KEY is read directly from process.env, never through @/lib/env', () => {
    expect(INDEX_SRC).not.toMatch(/from ['"]@\/lib\/env['"]/);
    expect(INDEX_SRC).toContain('process.env.MISTRAL_API_KEY');
  });
});
