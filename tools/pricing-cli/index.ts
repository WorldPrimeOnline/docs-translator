#!/usr/bin/env npx tsx
/**
 * WPO Pricing CLI — local, offline-by-default batch pricing calculator.
 *
 * Reads documents from a folder, runs the real document-analysis pipeline + the real
 * calculatePrice() against each one, and writes local reports. Zero side effects: never
 * creates an order/document/job/price_quote/cost_reservation row, never calls Halyk, Jira,
 * Google Drive, Telegram, or email. See README.md for the full flag/config reference.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseCliArgs, CliArgsError } from './lib/cli-args';
import { loadConfigFile, mergeParamsLayers, InvalidConfigError, SAFE_DEFAULTS } from './lib/config';
import { loadManifest } from './lib/manifest';
import { resolveFileParams } from './lib/params-resolver';
import { discoverFiles } from './lib/file-discovery';
import { runPricingForFile } from './lib/pricing-run';
import { buildRussianReport } from './lib/russian-report';
import { buildSummaryCsv, buildSummaryJson, buildSummaryMarkdown, computeTotals } from './lib/summary';
import { buildRunDir, ensureDir, generateRunTimestamp, reportBaseName } from './lib/run-paths';
import { computeExitCode } from './lib/exit-code';
import { clearCacheDir, DEFAULT_CACHE_DIR } from './lib/cache';
import { loadEnvChain, checkStagingEnvOrThrow, checkOcrEnvOrThrow, MissingStagingEnvError, MissingOcrEnvError } from './lib/env-loader';
import { traceProvenance, formatDryRunFileBlock, type NamedParamsLayer } from './lib/dry-run';
import type { FileResult, PricingParamsInput } from './lib/types';

const HELP_TEXT = `
WPO Pricing CLI — local batch pricing calculator (no side effects)

Usage:
  npm run pricing:calculate -- --input ./test-documents [options]

Required:
  --input <dir>                Folder of documents to price (.docx, .pdf, .jpg, .jpeg, .png)

Common options:
  --config <path>               pricing-test-config.json (default: ./pricing-test-config.json if present)
  --manifest <path>              manifest.json (default: <input>/manifest.json if present)
  --output <dir>                 Output folder (default: ./pricing-results)
  --no-ocr                       Never call paid OCR; scanned PDF/images -> operator_review.
                                  Without this flag, MISTRAL_API_KEY is required — checked up
                                  front; missing it exits 3 before any file is touched.
  --dry-run                      Print each file's resolved parameters + which layer set them
                                  (CLI/file manifest/manifest defaults/config/default). No
                                  analysis, no OCR, no calculatePrice(), no reports. Exits 0.
  --no-cache                     Ignore .pricing-cache/ for this run
  --clear-cache                  Delete .pricing-cache/ before running
  --from-staging                 Read-only fetch of pricing version + language rate from staging.
                                  Requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY —
                                  checked up front; missing either exits 3 before any file is touched.
  --env-file <path>               dotenv file to load (priority: process.env > --env-file >
                                  ./.env.local > tools/pricing-cli/.env.staging.local)
  --help                          Show this help and exit

Pricing parameter flags (override config/manifest for every file this run):
  --source <lang> --target <lang> --service <electronic|official|notary>
  --applicant <individual|legal_entity> --delivery --urgency <standard|same_day|before_noon|after_noon|after_18>
  --channel <direct|referral> --partner-rate <0..1> --manual-adjustment <kzt>
  --manual-adjustment-reason <text> --language-rate <kzt> --pricing-version <code>
  --manual-physical-pages <n>    Operator-supplied physical page count. Use when analysis can't
                                  get a reliable count without rendering (e.g. DOCX render
                                  failure) — takes precedence over the analyzed value.

Temporary economics overrides (in-memory only, never written to pricing_versions):
  --override-tax-rate --override-acquiring-rate --override-risk-reserve-rate
  --override-owner-reserve-rate --override-marketing-rate --override-ai-it-rate
  --override-channel-reserve-rate --override-discount-rate --override-wpo-coordination-rate
  --override-translator-payout-rate --override-partner-commission-rate --override-ocr-rate
  --override-courier-fee --override-printing-fee --override-extra-copy-fee
  --override-rounding-step-official --override-rounding-step-notary --override-mrp

Exit codes: 0 all success · 1 any failed · 2 only operator_review · 3 invalid config
`;

function printBanner(inputDir: string, outputDir: string, fromStaging: boolean, loadedEnvFiles: string[]): void {
  console.log('WPO Pricing CLI');
  console.log(`Input:  ${inputDir}`);
  console.log(`Output: ${outputDir}`);
  console.log(`Pricing version source: ${fromStaging ? 'staging (read-only fetch)' : 'local (offline)'}`);
  if (loadedEnvFiles.length > 0) console.log(`Env files loaded (priority order): ${loadedEnvFiles.join(', ')}`);
  console.log('Side effects: NONE — no orders/documents/jobs/price_quotes/cost_reservations, no Halyk, no Jira, no Drive, no Telegram/email.');
  console.log('');
}

async function main(): Promise<void> {
  let options;
  try {
    options = parseCliArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err instanceof CliArgsError ? err.message : String(err));
    process.exit(3);
  }

  if (options.help) {
    console.log(HELP_TEXT);
    process.exit(0);
  }

  if (options.clearCache) {
    clearCacheDir(DEFAULT_CACHE_DIR);
    console.log(`Cleared ${DEFAULT_CACHE_DIR}/`);
    if (!options.input) process.exit(0);
  }

  if (!options.input) {
    console.error('Error: --input <dir> is required. Run with --help for usage.');
    process.exit(3);
  }

  const inputDir = path.resolve(options.input);
  if (!fs.existsSync(inputDir) || !fs.statSync(inputDir).isDirectory()) {
    console.error(`Error: --input '${options.input}' is not a directory.`);
    process.exit(3);
  }

  // Explicit, predictable env loading BEFORE anything that could construct a Supabase client —
  // always attempted (not just --from-staging), since real OCR also needs MISTRAL_API_KEY.
  let loadedEnvFiles: string[];
  try {
    loadedEnvFiles = loadEnvChain(options.envFile, { fromStaging: options.fromStaging, ocrEnabled: !options.noOcr }).loadedFiles;
  } catch (err) {
    console.error(err instanceof InvalidConfigError ? err.message : String(err));
    process.exit(3);
  }

  // Fail-fast: check BEFORE any file search/analysis. One error message, exit 3, zero reports —
  // never a per-file FAILED report for what is really a global configuration problem.
  if (options.fromStaging) {
    try {
      checkStagingEnvOrThrow();
    } catch (err) {
      if (err instanceof MissingStagingEnvError) {
        console.error('Configuration error:');
        console.error('Missing environment variables required for --from-staging:');
        for (const name of err.missingVars) console.error(`- ${name}`);
      } else {
        console.error(err instanceof Error ? err.message : String(err));
      }
      process.exit(3);
    }
  }

  const outputDir = path.resolve(options.output);
  printBanner(inputDir, outputDir, options.fromStaging, loadedEnvFiles);

  let configLayer: PricingParamsInput;
  let manifest;
  try {
    const configPath = options.config ?? (fs.existsSync(path.resolve('pricing-test-config.json')) ? path.resolve('pricing-test-config.json') : undefined);
    configLayer = loadConfigFile(configPath);
    if (configPath) console.log(`Config: ${configPath}`);

    const manifestPath = options.manifest ?? path.join(inputDir, 'manifest.json');
    manifest = loadManifest(fs.existsSync(manifestPath) ? manifestPath : undefined);
    if (fs.existsSync(manifestPath)) console.log(`Manifest: ${manifestPath}`);
  } catch (err) {
    console.error(err instanceof InvalidConfigError ? err.message : String(err));
    process.exit(3);
  }

  const files = discoverFiles(inputDir);
  if (files.length === 0) {
    console.error(`No files found in '${inputDir}'.`);
    process.exit(3);
  }

  // --dry-run is a completely separate path: no analysis, no OCR, no calculatePrice(), no
  // buildRussianReport(), no per-file report, no status, no financial summary, and — critically
  // — no output directory is ever created. It exits here, before any of that machinery exists.
  if (options.dryRun) {
    console.log(`Found ${files.length} file(s). --dry-run: showing resolved parameters only, analyzing nothing.\n`);

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const fileManifestLayer = manifest.files[file.filename] ?? {};
      const layers: NamedParamsLayer[] = [
        { source: 'cli', values: options.paramsLayer },
        { source: 'file_manifest', values: fileManifestLayer },
        { source: 'manifest_defaults', values: manifest.defaults },
        { source: 'config', values: configLayer },
        { source: 'default', values: SAFE_DEFAULTS },
      ];
      const merged = mergeParamsLayers(SAFE_DEFAULTS, configLayer, manifest.defaults, fileManifestLayer, options.paramsLayer);

      try {
        const resolved = resolveFileParams(merged, `File '${file.filename}'`);
        const provenance = traceProvenance(layers);
        console.log(formatDryRunFileBlock(i + 1, files.length, { filename: file.filename, resolved, provenance }));
      } catch (err) {
        console.log(`[${i + 1}/${files.length}] ${file.filename}`);
        console.log(`  ERROR: ${err instanceof Error ? err.message : String(err)}`);
      }
      console.log('');
    }

    process.exit(0);
  }

  // Fail-fast: OCR needs exactly MISTRAL_API_KEY (never @/lib/env — see lib/env-loader.ts).
  // Checked once, before any file is processed, so a missing key never produces N identical
  // per-file FAILED reports — this is a global configuration problem, not a document problem.
  if (!options.noOcr) {
    try {
      checkOcrEnvOrThrow();
    } catch (err) {
      if (err instanceof MissingOcrEnvError) {
        console.error('Configuration error:');
        console.error('Missing environment variables required for OCR (pass --no-ocr to skip OCR entirely):');
        for (const name of err.missingVars) console.error(`- ${name}`);
      } else {
        console.error(err instanceof Error ? err.message : String(err));
      }
      process.exit(3);
    }
  }
  const mistralApiKey = process.env.MISTRAL_API_KEY;

  const timestamp = generateRunTimestamp();
  const runDir = buildRunDir(outputDir, timestamp);
  ensureDir(runDir);

  const results: FileResult[] = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    process.stdout.write(`[${i + 1}/${files.length}] ${file.filename} ... `);

    let result: FileResult;
    try {
      const merged = mergeParamsLayers(
        SAFE_DEFAULTS,
        configLayer,
        manifest.defaults,
        manifest.files[file.filename] ?? {},
        options.paramsLayer,
      );
      const params = resolveFileParams(merged, `File '${file.filename}'`);
      const buffer = fs.readFileSync(file.absolutePath);
      result = await runPricingForFile(file.filename, file.relativePath, buffer, file.extension, params, {
        noOcr: options.noOcr,
        noCache: options.noCache,
        cacheDir: DEFAULT_CACHE_DIR,
        mistralApiKey,
      });
    } catch (err) {
      result = {
        filename: file.filename,
        relativePath: file.relativePath,
        status: 'failed',
        reasonCode: 'invalid_config',
        reasons: [err instanceof Error ? err.message : String(err)],
        usedTemporaryOverrides: false,
      };
    }

    console.log(result.status.toUpperCase());
    results.push(result);

    const base = reportBaseName(file.filename);
    fs.writeFileSync(path.join(runDir, `${base}.report.json`), JSON.stringify(result, null, 2), 'utf-8');
    fs.writeFileSync(path.join(runDir, `${base}.report.md`), buildRussianReport(result), 'utf-8');
  }

  fs.writeFileSync(path.join(runDir, 'summary.csv'), buildSummaryCsv(results), 'utf-8');
  fs.writeFileSync(path.join(runDir, 'summary.json'), buildSummaryJson(results), 'utf-8');
  fs.writeFileSync(path.join(runDir, 'summary.md'), buildSummaryMarkdown(results), 'utf-8');

  const totals = computeTotals(results);
  console.log('');
  console.log(`Done. ${totals.success} success, ${totals.operatorReview} operator_review, ${totals.failed} failed.`);
  console.log(`Reports: ${runDir}`);

  process.exit(computeExitCode(results));
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Unexpected error:', err instanceof Error ? err.stack ?? err.message : String(err));
    process.exit(3);
  });
}
