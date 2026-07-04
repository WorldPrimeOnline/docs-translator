/**
 * Pure CLI argument parsing for the Internal AI Translation Test Lab.
 * No fs/env access here — keeps this module unit-testable without a filesystem.
 *
 * Three modes, detected from which flags are present (see detectMode()):
 *   1. single (default)            — existing --file ... behavior, unchanged.
 *   2. batch                       — --input-dir + --manifest.
 *   3. generate-manifest-template  — --generate-manifest-template.
 */
import type { CliMode, CliOptions } from './types';

export class CliArgError extends Error {}

const SINGLE_REQUIRED_FLAGS = [
  '--env-file',
  '--file',
  '--source-language',
  '--target-language',
  '--document-type',
  '--service-level',
] as const;

const BATCH_REQUIRED_FLAGS = ['--env-file', '--input-dir', '--manifest'] as const;

const TEMPLATE_REQUIRED_FLAGS = ['--input-dir', '--output-manifest'] as const;

const DEFAULT_OUTPUT_DIR = 'tools/internal-ai-test-lab/runs';
const MAX_CONCURRENCY = 2;

function readFlag(map: Map<string, string | boolean>, name: string): string | undefined {
  const v = map.get(name);
  return typeof v === 'string' ? v : undefined;
}

/**
 * Tokenizes argv into a flag map. Boolean flags (no following value, or followed by
 * another flag) are stored as `true`. Unknown flags are rejected to catch typos early —
 * an internal test tool with production access should fail loudly on malformed input.
 */
function tokenize(argv: string[]): Map<string, string | boolean> {
  const map = new Map<string, string | boolean>();
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (!tok || !tok.startsWith('--')) {
      throw new CliArgError(`Unexpected positional argument: "${tok}". All options must be passed as --flag value.`);
    }
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      map.set(tok, next);
      i++;
    } else {
      map.set(tok, true);
    }
  }
  return map;
}

const KNOWN_FLAGS = new Set([
  '--env-file',
  '--file',
  '--source-language',
  '--target-language',
  '--document-type',
  '--service-level',
  '--urgency',
  '--fulfillment-method',
  '--notary-city',
  '--delivery-city',
  '--output-dir',
  '--save-to-r2',
  '--dry-run-pricing-only',
  '--skip-render',
  '--keep-intermediate',
  '--debug',
  '--debug-full-text',
  '--confirm-production',
  // batch mode
  '--input-dir',
  '--manifest',
  '--continue-on-error',
  '--stop-on-error',
  '--limit',
  '--only',
  '--skip-existing',
  '--concurrency',
  // template mode
  '--generate-manifest-template',
  '--output-manifest',
]);

function detectMode(map: Map<string, string | boolean>): CliMode {
  if (map.get('--generate-manifest-template') === true) return 'generate-manifest-template';
  if (readFlag(map, '--input-dir') !== undefined || readFlag(map, '--manifest') !== undefined) return 'batch';
  return 'single';
}

function parsePositiveInt(raw: string, flagName: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new CliArgError(`${flagName} must be a positive integer, got "${raw}".`);
  }
  return n;
}

export function parseCliArgs(argv: string[]): CliOptions {
  const map = tokenize(argv);

  for (const flag of map.keys()) {
    if (!KNOWN_FLAGS.has(flag)) {
      throw new CliArgError(`Unknown flag: "${flag}". Run with --help-equivalent docs in README.md for the full option list.`);
    }
  }

  const mode = detectMode(map);

  const requiredFlags =
    mode === 'single' ? SINGLE_REQUIRED_FLAGS : mode === 'batch' ? BATCH_REQUIRED_FLAGS : TEMPLATE_REQUIRED_FLAGS;
  const missing = requiredFlags.filter((f) => readFlag(map, f) === undefined);
  if (missing.length > 0) {
    throw new CliArgError(`Missing required option(s) for ${mode} mode: ${missing.join(', ')}`);
  }

  const outputDir = readFlag(map, '--output-dir') ?? DEFAULT_OUTPUT_DIR;
  const stopOnError = map.get('--stop-on-error') === true;
  const continueOnErrorFlag = map.get('--continue-on-error') === true;
  if (stopOnError && continueOnErrorFlag) {
    throw new CliArgError('--continue-on-error and --stop-on-error are mutually exclusive.');
  }

  let concurrency = 1;
  const concurrencyRaw = readFlag(map, '--concurrency');
  if (concurrencyRaw !== undefined) {
    concurrency = parsePositiveInt(concurrencyRaw, '--concurrency');
    if (concurrency > MAX_CONCURRENCY) {
      throw new CliArgError(
        `--concurrency ${concurrency} exceeds the maximum of ${MAX_CONCURRENCY}. Running more documents in parallel ` +
          'multiplies real-time OCR/LLM API cost and materially raises the risk of hitting Mistral/Anthropic rate ' +
          'limits mid-batch. Keep --concurrency at 1 (default, sequential) or 2.',
      );
    }
  }

  let limit: number | undefined;
  const limitRaw = readFlag(map, '--limit');
  if (limitRaw !== undefined) {
    limit = parsePositiveInt(limitRaw, '--limit');
  }

  const base = {
    mode,
    envFile: readFlag(map, '--env-file'),
    outputDir,
    saveToR2: map.get('--save-to-r2') === true,
    dryRunPricingOnly: map.get('--dry-run-pricing-only') === true,
    skipRender: map.get('--skip-render') === true,
    keepIntermediate: map.get('--keep-intermediate') === true,
    debug: map.get('--debug') === true,
    debugFullText: map.get('--debug-full-text') === true,
    confirmProduction: map.get('--confirm-production') === true,
    // batch defaults — continueOnError is the batch-QA default; an explicit
    // --stop-on-error flips it off. --continue-on-error is accepted for
    // explicitness in commands but is a no-op relative to the default.
    continueOnError: !stopOnError,
    stopOnError,
    limit,
    only: readFlag(map, '--only'),
    skipExisting: map.get('--skip-existing') === true,
    concurrency,
    outputManifest: readFlag(map, '--output-manifest'),
  };

  if (mode === 'single') {
    const sourceLanguage = readFlag(map, '--source-language')!;
    const targetLanguage = readFlag(map, '--target-language')!;
    return {
      ...base,
      file: readFlag(map, '--file')!,
      sourceLanguage: sourceLanguage.toLowerCase(),
      targetLanguage: targetLanguage.toLowerCase(),
      documentTypeRaw: readFlag(map, '--document-type')!,
      serviceLevelRaw: readFlag(map, '--service-level')!,
      urgencyRaw: readFlag(map, '--urgency'),
      fulfillmentMethodRaw: readFlag(map, '--fulfillment-method'),
      notaryCity: readFlag(map, '--notary-city'),
      deliveryCity: readFlag(map, '--delivery-city'),
    };
  }

  if (mode === 'batch') {
    return {
      ...base,
      inputDir: readFlag(map, '--input-dir')!,
      manifest: readFlag(map, '--manifest')!,
    };
  }

  // generate-manifest-template
  return {
    ...base,
    inputDir: readFlag(map, '--input-dir')!,
  };
}
