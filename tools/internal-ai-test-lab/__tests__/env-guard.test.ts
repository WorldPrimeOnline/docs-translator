import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadEnvFile, checkProductionSafety, resolveEnvironment, buildSafetySummary, buildBatchSafetySummary, EnvGuardError } from '../lib/env-guard';

const TOOL_ROOT = path.resolve(__dirname, '..');

describe('resolveEnvironment', () => {
  it('detects production via APP_ENV', () => {
    expect(resolveEnvironment({ APP_ENV: 'production' })).toBe('production');
  });

  it('detects production via NEXT_PUBLIC_APP_ENV', () => {
    expect(resolveEnvironment({ NEXT_PUBLIC_APP_ENV: 'production' })).toBe('production');
  });

  it('detects staging', () => {
    expect(resolveEnvironment({ APP_ENV: 'staging' })).toBe('staging');
  });

  it('defaults to local', () => {
    expect(resolveEnvironment({})).toBe('local');
  });
});

describe('checkProductionSafety', () => {
  it('requires AI_TRANSLATION_TEST_LAB_ENABLED in every environment', () => {
    const result = checkProductionSafety({}, false);
    expect(result.ok).toBe(false);
    expect(result.reasons.join(' ')).toMatch(/AI_TRANSLATION_TEST_LAB_ENABLED/);
  });

  it('allows a fully-configured staging run', () => {
    const result = checkProductionSafety({ AI_TRANSLATION_TEST_LAB_ENABLED: 'true', APP_ENV: 'staging' }, false);
    expect(result.ok).toBe(true);
    expect(result.environment).toBe('staging');
  });

  it('refuses production without AI_TRANSLATION_TEST_LAB_ALLOW_PRODUCTION=true', () => {
    const result = checkProductionSafety(
      { AI_TRANSLATION_TEST_LAB_ENABLED: 'true', APP_ENV: 'production' },
      true,
    );
    expect(result.ok).toBe(false);
    expect(result.reasons.join(' ')).toMatch(/AI_TRANSLATION_TEST_LAB_ALLOW_PRODUCTION/);
  });

  it('refuses production without --confirm-production', () => {
    const result = checkProductionSafety(
      {
        AI_TRANSLATION_TEST_LAB_ENABLED: 'true',
        AI_TRANSLATION_TEST_LAB_ALLOW_PRODUCTION: 'true',
        APP_ENV: 'production',
      },
      false,
    );
    expect(result.ok).toBe(false);
    expect(result.reasons.join(' ')).toMatch(/--confirm-production/);
  });

  it('refuses production if ALLOW_STAGING_PAYMENT_OVERRIDE=true, even with everything else correct', () => {
    const result = checkProductionSafety(
      {
        AI_TRANSLATION_TEST_LAB_ENABLED: 'true',
        AI_TRANSLATION_TEST_LAB_ALLOW_PRODUCTION: 'true',
        ALLOW_STAGING_PAYMENT_OVERRIDE: 'true',
        APP_ENV: 'production',
      },
      true,
    );
    expect(result.ok).toBe(false);
    expect(result.reasons.join(' ')).toMatch(/ALLOW_STAGING_PAYMENT_OVERRIDE/);
  });

  it('allows a fully-configured, fully-confirmed production run', () => {
    const result = checkProductionSafety(
      {
        AI_TRANSLATION_TEST_LAB_ENABLED: 'true',
        AI_TRANSLATION_TEST_LAB_ALLOW_PRODUCTION: 'true',
        APP_ENV: 'production',
      },
      true,
    );
    expect(result.ok).toBe(true);
    expect(result.environment).toBe('production');
  });

  it('does not require production-only vars for staging even if ALLOW_STAGING_PAYMENT_OVERRIDE is set', () => {
    const result = checkProductionSafety(
      { AI_TRANSLATION_TEST_LAB_ENABLED: 'true', ALLOW_STAGING_PAYMENT_OVERRIDE: 'true', APP_ENV: 'staging' },
      false,
    );
    expect(result.ok).toBe(true);
  });
});

describe('buildSafetySummary', () => {
  it('renders the required fixed-format summary', () => {
    const summary = buildSafetySummary({
      environment: 'production',
      runId: 'run123',
      outputDir: 'tools/internal-ai-test-lab/runs',
      saveToR2: false,
    });
    expect(summary).toContain('WPO AI Translation Test Lab');
    expect(summary).toContain('Environment: production');
    expect(summary).toContain('Payment bypass: disabled');
    expect(summary).toContain('Halyk: disabled');
    expect(summary).toContain('Jira: disabled');
    expect(summary).toContain('Fiscalization: disabled');
    expect(summary).toContain('Normal order creation: disabled');
    expect(summary).toContain('Output dir: tools/internal-ai-test-lab/runs/run123');
    expect(summary).toContain('R2 save: false');
  });
});

describe('buildBatchSafetySummary', () => {
  it('renders the required batch-mode startup banner', () => {
    const summary = buildBatchSafetySummary({
      environment: 'production',
      batchId: 'batch_20260703T120000Z_ab12cd34',
      outputDir: 'tools/internal-ai-test-lab/runs',
      fileCount: 28,
      concurrency: 1,
    });
    expect(summary).toContain('WPO AI Translation Test Lab — Batch Mode');
    expect(summary).toContain('Environment: production');
    expect(summary).toContain('Files to process: 28');
    expect(summary).toContain('Concurrency: 1');
    expect(summary).toContain('Payment: disabled');
    expect(summary).toContain('Halyk: disabled');
    expect(summary).toContain('Jira: disabled');
    expect(summary).toContain('Fiscalization: disabled');
    expect(summary).toContain('Normal customer workflow: disabled');
  });

  it('includes a real-API-credit cost warning', () => {
    const summary = buildBatchSafetySummary({
      environment: 'staging',
      batchId: 'batch_x',
      outputDir: 'runs',
      fileCount: 2,
      concurrency: 1,
    });
    expect(summary).toMatch(/real OCR\/LLM API credits/);
  });
});

describe('production guard applies identically to batch mode (checkProductionSafety is mode-agnostic)', () => {
  it('run-ai-translation-test.ts calls checkProductionSafety() in both runSingleFileMode and runBatchMode', () => {
    const src = fs.readFileSync(path.join(TOOL_ROOT, 'run-ai-translation-test.ts'), 'utf-8');
    const singleFn = src.slice(src.indexOf('async function runSingleFileMode'), src.indexOf('async function runBatchMode'));
    const batchFn = src.slice(src.indexOf('async function runBatchMode'), src.indexOf('async function main'));
    expect(singleFn).toContain('checkProductionSafety(process.env, cli.confirmProduction)');
    expect(batchFn).toContain('checkProductionSafety(process.env, cli.confirmProduction)');
    // Both modes refuse to proceed the same way — no batch-only bypass.
    expect(singleFn).toMatch(/if \(!safety\.ok\) \{/);
    expect(batchFn).toMatch(/if \(!safety\.ok\) \{/);
  });
});

describe('loadEnvFile', () => {
  it('throws EnvGuardError when the file does not exist', () => {
    expect(() => loadEnvFile('/nonexistent/path/does-not-exist.local')).toThrow(EnvGuardError);
  });

  it('loads variables from the given file into process.env', () => {
    const tmpFile = path.join(os.tmpdir(), `wpo-ai-test-lab-env-${Date.now()}.local`);
    fs.writeFileSync(tmpFile, 'WPO_TEST_LAB_UNIT_TEST_VAR=hello123\n');
    try {
      loadEnvFile(tmpFile);
      expect(process.env.WPO_TEST_LAB_UNIT_TEST_VAR).toBe('hello123');
    } finally {
      fs.unlinkSync(tmpFile);
      delete process.env.WPO_TEST_LAB_UNIT_TEST_VAR;
    }
  });
});
