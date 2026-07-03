#!/usr/bin/env npx tsx
/**
 * WPO Internal AI Translation Test Lab
 *
 * Runs the REAL OCR → translation → render → pricing pipeline against local
 * document(s), without payment, Halyk, fiscalization, Jira, or normal
 * customer order creation. See README.md for full usage, safety rules, and
 * limitations.
 *
 * Three modes (auto-detected from flags — see lib/cli-args.ts):
 *
 * 1. Single-file mode (--file ...) — unchanged from the original tool:
 *   npx tsx tools/internal-ai-test-lab/run-ai-translation-test.ts \
 *     --env-file tools/internal-ai-test-lab/.env.staging.local \
 *     --file ./tools/internal-ai-test-lab/input/<your-test-file> \
 *     --source-language ru --target-language en \
 *     --document-type passport --service-level official_translation
 *
 * 2. Batch mode (--input-dir + --manifest) — runs every manifest entry
 *    sequentially (or --concurrency 2), writing one item folder + a
 *    batch-summary.{json,csv,html} per run. See lib/batch-runner.ts.
 *   npx tsx tools/internal-ai-test-lab/run-ai-translation-test.ts \
 *     --env-file tools/internal-ai-test-lab/.env.staging.local \
 *     --input-dir ./tools/internal-ai-test-lab/input/batch \
 *     --manifest ./tools/internal-ai-test-lab/input/batch-manifest.json \
 *     --output-dir tools/internal-ai-test-lab/runs \
 *     --continue-on-error
 *
 * 3. --generate-manifest-template — drafts a batch-manifest.json from
 *    filenames in --input-dir for a human to review (lib/filename-parser.ts):
 *   npx tsx tools/internal-ai-test-lab/run-ai-translation-test.ts \
 *     --input-dir ./tools/internal-ai-test-lab/input/batch \
 *     --generate-manifest-template \
 *     --output-manifest ./tools/internal-ai-test-lab/input/batch-manifest.template.json
 *
 * Env is loaded from --env-file via dotenv BEFORE any pipeline module is
 * imported (single-file and batch modes only — template mode needs no env).
 * Pipeline modules (worker/src/lib/*, @/lib/pricing/*) read process.env at
 * import time — some via process.exit(1) on missing vars — so every pipeline
 * import happens inside lib/process-document.ts via dynamic `import()`,
 * performed after loadEnvFile() runs. Do not convert these to static imports.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import { parseCliArgs, CliArgError } from './lib/cli-args';
import { loadEnvFile, checkProductionSafety, buildSafetySummary, buildBatchSafetySummary, EnvGuardError } from './lib/env-guard';
import { generateRunId, buildRunPaths, ensureRunDirs, generateBatchId, buildBatchPaths, ensureBatchDirs } from './lib/run-paths';
import { createLogger, type Logger } from './lib/logger';
import { detectInputDocument, UnsupportedInputFormatError } from './lib/input-document';
import { processDocument } from './lib/process-document';
import { loadManifest, validateManifest, selectManifestEntries, formatValidationSummary, ManifestError } from './lib/manifest';
import { generateManifestTemplate } from './lib/filename-parser';
import { renderSummaryJson, renderSummaryCsv, renderSummaryHtml } from './lib/batch-summary';
import { runBatch } from './lib/batch-runner';
import { INTERNAL_TEST_WATERMARK } from './lib/report-builder';
import type { AiTranslationTestContext, CliOptions } from './lib/types';

function fail(logger: Logger | null, message: string): never {
  if (logger) logger.error(message);
  else console.error(message);
  process.exit(1);
}

// ── Mode 3: --generate-manifest-template ──────────────────────────────────────

function runGenerateManifestTemplate(cli: CliOptions): never {
  const inputDir = cli.inputDir!;
  if (!fs.existsSync(inputDir) || !fs.statSync(inputDir).isDirectory()) {
    fail(null, `[batch] --input-dir not found or not a directory: ${inputDir}`);
  }
  const fileNames = fs
    .readdirSync(inputDir, { withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => e.name)
    .filter((n) => !n.startsWith('.'));
  if (fileNames.length === 0) {
    fail(null, `[batch] --input-dir ${inputDir} has no files to generate a template from.`);
  }

  const entries = generateManifestTemplate(fileNames);
  const outputManifest = cli.outputManifest!;
  fs.mkdirSync(path.dirname(outputManifest), { recursive: true });
  fs.writeFileSync(outputManifest, JSON.stringify(entries, null, 2) + '\n', 'utf-8');

  console.log(`✓ Draft manifest template written: ${outputManifest} (${entries.length} entries)`);
  console.log('This is a TEMPLATE — batch execution never guesses. Review every entry');
  console.log('(sourceLanguage/targetLanguage/documentType/serviceLevel) before using it with --manifest.');
  process.exit(0);
}

// ── Mode 1: single-file (unchanged contract) ──────────────────────────────────

async function runSingleFileMode(cli: CliOptions): Promise<never> {
  const file = cli.file!;

  // Validate input file exists + detect its format BEFORE touching env/pipeline —
  // same ordering as the original tool, so a bad --file fails fast regardless
  // of whether --env-file is also valid.
  if (!fs.existsSync(file)) fail(null, `[input] --file not found: ${file}`);
  const fileStat = fs.statSync(file);
  if (!fileStat.isFile()) fail(null, `[input] --file is not a regular file: ${file}`);
  const fileBuffer = fs.readFileSync(file);
  try {
    detectInputDocument(file, fileBuffer);
  } catch (err) {
    if (err instanceof UnsupportedInputFormatError) fail(null, `[input] ${err.message}`);
    throw err;
  }

  try {
    loadEnvFile(cli.envFile!);
  } catch (err) {
    if (err instanceof EnvGuardError) fail(null, `[env] ${err.message}`);
    throw err;
  }

  const safety = checkProductionSafety(process.env, cli.confirmProduction);
  if (!safety.ok) {
    console.error('[safety] Refusing to run:');
    for (const reason of safety.reasons) console.error(`  - ${reason}`);
    process.exit(1);
  }

  const maxFileMb = Number(process.env.AI_TRANSLATION_TEST_LAB_MAX_FILE_MB ?? '20');
  const maxPages = Number(process.env.AI_TRANSLATION_TEST_LAB_MAX_PAGES ?? '30');

  const runId = generateRunId();
  const paths = buildRunPaths(cli.outputDir, runId);
  ensureRunDirs(paths);
  const logger = createLogger(paths.logFile);

  const operatorEmail = process.env.AI_TRANSLATION_TEST_LAB_OPERATOR_EMAIL;
  const context: AiTranslationTestContext = {
    runId,
    isInternalTest: true,
    environment: safety.environment,
    createPayment: false,
    createJira: false,
    createFiscalReceipt: false,
    sendEmail: false,
    saveToR2: cli.saveToR2,
    outputDir: cli.outputDir,
    operatorEmail,
  };

  console.log(buildSafetySummary({ environment: safety.environment, runId, outputDir: cli.outputDir, saveToR2: cli.saveToR2 }));
  logger.info(`context: ${JSON.stringify(context)}`);

  const result = await processDocument({
    file,
    sourceLanguage: cli.sourceLanguage!,
    targetLanguage: cli.targetLanguage!,
    documentTypeRaw: cli.documentTypeRaw!,
    serviceLevelRaw: cli.serviceLevelRaw!,
    urgencyRaw: cli.urgencyRaw,
    fulfillmentMethodRaw: cli.fulfillmentMethodRaw,
    notaryCity: cli.notaryCity,
    deliveryCity: cli.deliveryCity,
    dryRunPricingOnly: cli.dryRunPricingOnly,
    skipRender: cli.skipRender,
    keepIntermediate: cli.keepIntermediate,
    saveToR2: cli.saveToR2,
    debugFullText: cli.debugFullText,
    maxFileMb,
    maxPages,
    environment: safety.environment,
    operatorEmail,
    paths,
    logger,
  });

  if (result.status === 'failed') {
    fail(logger, `[${result.errorCode}] ${result.errorMessage}`);
  }

  console.log('');
  console.log(`✓ Run complete: ${paths.runDir}`);
  if (result.pricingAmountKzt !== null) {
    console.log(`  Price: ${result.pricingAmountKzt} KZT (${result.pricingVersion})`);
  } else {
    console.log('  Pricing not computed');
  }
  console.log(`  Report: ${result.reportHtmlPath}`);
  console.log(`  ${INTERNAL_TEST_WATERMARK}`);
  process.exit(0);
}

// ── Mode 2: batch ──────────────────────────────────────────────────────────────

async function runBatchMode(cli: CliOptions): Promise<never> {
  const inputDir = cli.inputDir!;
  const manifestPath = cli.manifest!;

  let entries;
  try {
    entries = loadManifest(manifestPath);
  } catch (err) {
    if (err instanceof ManifestError) fail(null, `[manifest] ${err.message}`);
    throw err;
  }

  const validation = validateManifest(entries, inputDir);
  console.log(formatValidationSummary(validation, entries.length));
  if (!validation.ok) {
    process.exit(1);
  }

  const selected = selectManifestEntries(entries, { only: cli.only, limit: cli.limit });
  if (selected.length === 0) {
    fail(null, '[batch] No manifest entries selected to run — check --only/--limit.');
  }

  try {
    loadEnvFile(cli.envFile!);
  } catch (err) {
    if (err instanceof EnvGuardError) fail(null, `[env] ${err.message}`);
    throw err;
  }

  const safety = checkProductionSafety(process.env, cli.confirmProduction);
  if (!safety.ok) {
    console.error('[safety] Refusing to run:');
    for (const reason of safety.reasons) console.error(`  - ${reason}`);
    process.exit(1);
  }

  const maxFileMb = Number(process.env.AI_TRANSLATION_TEST_LAB_MAX_FILE_MB ?? '20');
  const maxPages = Number(process.env.AI_TRANSLATION_TEST_LAB_MAX_PAGES ?? '30');
  const operatorEmail = process.env.AI_TRANSLATION_TEST_LAB_OPERATOR_EMAIL;

  const batchId = generateBatchId();
  const batchPaths = buildBatchPaths(cli.outputDir, batchId);
  ensureBatchDirs(batchPaths);
  const batchLogger = createLogger(batchPaths.logFile);

  console.log(
    buildBatchSafetySummary({
      environment: safety.environment,
      batchId,
      outputDir: cli.outputDir,
      fileCount: selected.length,
      concurrency: cli.concurrency,
    }),
  );
  batchLogger.info(
    `batch starting: ${selected.length} files, concurrency=${cli.concurrency}, continueOnError=${cli.continueOnError}, skipExisting=${cli.skipExisting}`,
  );

  const { rows, stoppedEarly } = await runBatch({
    entries: selected,
    inputDir,
    itemsDir: batchPaths.itemsDir,
    environment: safety.environment,
    operatorEmail,
    maxFileMb,
    maxPages,
    dryRunPricingOnly: cli.dryRunPricingOnly,
    skipRender: cli.skipRender,
    keepIntermediate: cli.keepIntermediate,
    saveToR2: cli.saveToR2,
    debugFullText: cli.debugFullText,
    continueOnError: cli.continueOnError,
    skipExisting: cli.skipExisting,
    concurrency: cli.concurrency,
    batchLogger,
  });

  fs.writeFileSync(batchPaths.summaryJsonPath, renderSummaryJson(rows));
  fs.writeFileSync(batchPaths.summaryCsvPath, renderSummaryCsv(rows));

  const completed = rows.filter((r) => r.status === 'completed').length;
  const failed = rows.filter((r) => r.status === 'failed').length;
  const skipped = rows.filter((r) => r.status === 'skipped').length;

  fs.writeFileSync(
    batchPaths.summaryHtmlPath,
    renderSummaryHtml(rows, {
      batchId,
      environment: safety.environment,
      generatedAt: new Date().toISOString(),
      totalFiles: rows.length,
      completed,
      failed,
      skipped,
    }),
  );

  console.log('');
  console.log(`✓ Batch complete: ${batchPaths.batchDir}`);
  console.log(`  Completed: ${completed} · Failed: ${failed} · Skipped: ${skipped} (of ${rows.length})`);
  if (stoppedEarly) console.log('  Stopped early — --stop-on-error was set and an item failed.');
  console.log(`  Summary: ${batchPaths.summaryHtmlPath}`);
  console.log(`  ${INTERNAL_TEST_WATERMARK}`);

  process.exit(failed > 0 ? 1 : 0);
}

// ── Entry point ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  let cli: CliOptions;
  try {
    cli = parseCliArgs(process.argv.slice(2));
  } catch (err) {
    if (err instanceof CliArgError) {
      console.error(`[args] ${err.message}`);
      console.error('See tools/internal-ai-test-lab/README.md for usage.');
      process.exit(1);
    }
    throw err;
  }

  if (cli.mode === 'generate-manifest-template') {
    runGenerateManifestTemplate(cli);
    return;
  }
  if (cli.mode === 'batch') {
    await runBatchMode(cli);
    return;
  }
  await runSingleFileMode(cli);
}

main().catch((err) => {
  console.error('[fatal]', err instanceof Error ? err.stack : err);
  process.exit(1);
});
