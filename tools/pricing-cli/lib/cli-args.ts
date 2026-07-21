/**
 * process.argv -> CliOptions. No external arg-parsing dependency — the flag surface is small
 * and fixed (see README §CLI flags). Supports both `--flag value` and `--flag=value`.
 */
import type { PricingParamsInput } from './types';
import { VERSION_OVERRIDE_FLAGS, type VersionOverrides } from './version-overrides';

export interface CliOptions {
  input?: string;
  config?: string;
  output: string;
  manifest?: string;
  noOcr: boolean;
  dryRun: boolean;
  noCache: boolean;
  clearCache: boolean;
  fromStaging: boolean;
  envFile?: string;
  help: boolean;
  paramsLayer: PricingParamsInput;
}

export class CliArgsError extends Error {}

const BOOLEAN_FLAGS = new Set([
  'delivery', 'no-ocr', 'dry-run', 'no-cache', 'clear-cache', 'from-staging', 'help',
]);

const FLAG_TO_OVERRIDE_KEY = new Map<string, keyof VersionOverrides>(
  (Object.entries(VERSION_OVERRIDE_FLAGS) as Array<[keyof VersionOverrides, string]>).map(([key, flag]) => [flag, key]),
);

function toRecord(argv: string[]): Map<string, string | true> {
  const out = new Map<string, string | true>();
  let i = 0;
  while (i < argv.length) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      throw new CliArgsError(`Unexpected argument '${token}' (flags must start with --)`);
    }
    const withoutDashes = token.slice(2);
    const eqIndex = withoutDashes.indexOf('=');
    if (eqIndex !== -1) {
      out.set(withoutDashes.slice(0, eqIndex), withoutDashes.slice(eqIndex + 1));
      i += 1;
      continue;
    }
    const name = withoutDashes;
    if (BOOLEAN_FLAGS.has(name)) {
      out.set(name, true);
      i += 1;
      continue;
    }
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      throw new CliArgsError(`Flag --${name} requires a value`);
    }
    out.set(name, next);
    i += 2;
  }
  return out;
}

function num(value: string | true | undefined, flag: string): number | undefined {
  if (value === undefined) return undefined;
  if (value === true) throw new CliArgsError(`--${flag} requires a numeric value`);
  const n = Number(value);
  if (Number.isNaN(n)) throw new CliArgsError(`--${flag} must be a number, got '${value}'`);
  return n;
}

function str(value: string | true | undefined, flag: string): string | undefined {
  if (value === undefined) return undefined;
  if (value === true) throw new CliArgsError(`--${flag} requires a value`);
  return value;
}

export function parseCliArgs(argv: string[]): CliOptions {
  const flags = toRecord(argv);

  const versionOverrides: VersionOverrides = {};
  for (const [flagName, overrideKey] of FLAG_TO_OVERRIDE_KEY) {
    const n = num(flags.get(flagName), flagName);
    if (n !== undefined) versionOverrides[overrideKey] = n;
  }

  const paramsLayer: PricingParamsInput = {
    sourceLanguage: str(flags.get('source'), 'source'),
    targetLanguage: str(flags.get('target'), 'target'),
    serviceLevel: str(flags.get('service'), 'service'),
    applicantType: str(flags.get('applicant'), 'applicant') as PricingParamsInput['applicantType'],
    notaryUrgency: str(flags.get('urgency'), 'urgency'),
    channel: str(flags.get('channel'), 'channel') as PricingParamsInput['channel'],
    partnerCommissionRate: num(flags.get('partner-rate'), 'partner-rate'),
    manualAdjustmentKzt: num(flags.get('manual-adjustment'), 'manual-adjustment'),
    manualAdjustmentReason: str(flags.get('manual-adjustment-reason'), 'manual-adjustment-reason'),
    languageRateOverrideKzt: num(flags.get('language-rate'), 'language-rate'),
    manualPhysicalPageCountOverride: num(flags.get('manual-physical-pages'), 'manual-physical-pages'),
    pricingVersionCode: str(flags.get('pricing-version'), 'pricing-version'),
    deliveryRequired: flags.has('delivery') ? true : undefined,
    fulfillmentMethod: flags.has('delivery') ? 'delivery' : undefined,
    versionOverrides: Object.keys(versionOverrides).length > 0 ? versionOverrides : undefined,
  };
  // Strip undefined keys so this layer merges cleanly on top of lower-priority layers.
  for (const key of Object.keys(paramsLayer) as Array<keyof PricingParamsInput>) {
    if (paramsLayer[key] === undefined) delete paramsLayer[key];
  }

  const fromStaging = flags.has('from-staging');

  return {
    input: str(flags.get('input'), 'input'),
    config: str(flags.get('config'), 'config'),
    output: str(flags.get('output'), 'output') ?? './pricing-results',
    manifest: str(flags.get('manifest'), 'manifest'),
    noOcr: flags.has('no-ocr'),
    dryRun: flags.has('dry-run'),
    noCache: flags.has('no-cache'),
    clearCache: flags.has('clear-cache'),
    fromStaging,
    envFile: str(flags.get('env-file'), 'env-file'),
    help: flags.has('help'),
    paramsLayer: fromStaging ? { ...paramsLayer, pricingVersionSource: 'staging' } : paramsLayer,
  };
}
