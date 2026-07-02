/**
 * Pure CLI argument parsing for the Internal AI Translation Test Lab.
 * No fs/env access here — keeps this module unit-testable without a filesystem.
 */
import type { CliOptions } from './types';

export class CliArgError extends Error {}

const REQUIRED_FLAGS = [
  '--env-file',
  '--file',
  '--source-language',
  '--target-language',
  '--document-type',
  '--service-level',
] as const;

const DEFAULT_OUTPUT_DIR = 'tools/internal-ai-test-lab/runs';

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
]);

export function parseCliArgs(argv: string[]): CliOptions {
  const map = tokenize(argv);

  for (const flag of map.keys()) {
    if (!KNOWN_FLAGS.has(flag)) {
      throw new CliArgError(`Unknown flag: "${flag}". Run with --help-equivalent docs in README.md for the full option list.`);
    }
  }

  const missing = REQUIRED_FLAGS.filter((f) => readFlag(map, f) === undefined);
  if (missing.length > 0) {
    throw new CliArgError(`Missing required option(s): ${missing.join(', ')}`);
  }

  const envFile = readFlag(map, '--env-file')!;
  const file = readFlag(map, '--file')!;
  const sourceLanguage = readFlag(map, '--source-language')!;
  const targetLanguage = readFlag(map, '--target-language')!;
  const documentTypeRaw = readFlag(map, '--document-type')!;
  const serviceLevelRaw = readFlag(map, '--service-level')!;

  return {
    envFile,
    file,
    sourceLanguage: sourceLanguage.toLowerCase(),
    targetLanguage: targetLanguage.toLowerCase(),
    documentTypeRaw,
    serviceLevelRaw,
    urgencyRaw: readFlag(map, '--urgency'),
    fulfillmentMethodRaw: readFlag(map, '--fulfillment-method'),
    notaryCity: readFlag(map, '--notary-city'),
    deliveryCity: readFlag(map, '--delivery-city'),
    outputDir: readFlag(map, '--output-dir') ?? DEFAULT_OUTPUT_DIR,
    saveToR2: map.get('--save-to-r2') === true,
    dryRunPricingOnly: map.get('--dry-run-pricing-only') === true,
    skipRender: map.get('--skip-render') === true,
    keepIntermediate: map.get('--keep-intermediate') === true,
    debug: map.get('--debug') === true,
    debugFullText: map.get('--debug-full-text') === true,
    confirmProduction: map.get('--confirm-production') === true,
  };
}
