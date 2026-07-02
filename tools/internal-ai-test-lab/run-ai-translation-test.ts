#!/usr/bin/env npx tsx
/**
 * WPO Internal AI Translation Test Lab
 *
 * Runs the REAL OCR → translation → render → pricing pipeline against a local
 * document, without payment, Halyk, fiscalization, Jira, or normal customer
 * order creation. See README.md for full usage, safety rules, and limitations.
 *
 * Env is loaded from --env-file via dotenv BEFORE any pipeline module is
 * imported. Pipeline modules (worker/src/lib/*, @/lib/pricing/*) read
 * process.env at import time — some via process.exit(1) on missing vars — so
 * every pipeline import below is a dynamic `import()` performed after
 * loadEnvFile() runs. Do not convert these to static imports.
 *
 * Usage (--file accepts any supported format — .pdf, .jpg, .jpeg, .png,
 * .docx; file FORMAT and business --document-type are independent, see
 * lib/input-document.ts):
 *   npx tsx tools/internal-ai-test-lab/run-ai-translation-test.ts \
 *     --env-file tools/internal-ai-test-lab/.env.staging.local \
 *     --file ./tools/internal-ai-test-lab/input/<your-test-file> \
 *     --source-language ru --target-language en \
 *     --document-type passport --service-level official_translation
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import { parseCliArgs, CliArgError } from './lib/cli-args';
import {
  mapDocumentType,
  mapFulfillmentMethod,
  mapServiceLevel,
  mapUrgencyLevel,
  inferDeliveryZone,
  AliasMapError,
} from './lib/alias-map';
import { loadEnvFile, checkProductionSafety, buildSafetySummary, EnvGuardError } from './lib/env-guard';
import { generateRunId, buildRunPaths, ensureRunDirs } from './lib/run-paths';
import { createLogger, truncateForConsole, type Logger } from './lib/logger';
import { detectInputDocument, preparePdfForOcr, UnsupportedInputFormatError } from './lib/input-document';
import {
  buildClientPriceComponents,
  buildInternalCostRows,
  buildMarginSection,
  buildReconciliation,
  type PricingResultLike,
} from './lib/pricing-report';
import {
  buildReportData,
  renderReportHtml,
  renderReportJson,
  renderReportMarkdown,
  type OcrSummarySection,
  type PricingContextSection,
  type RenderedOutputSection,
  type RunSummarySection,
  type TranslationSummarySection,
} from './lib/report-builder';
import type { AiTranslationTestContext } from './lib/types';

const R2_INTERNAL_PREFIX = 'internal-tests/ai-translation-lab';

function fail(logger: Logger | null, message: string): never {
  if (logger) logger.error(message);
  else console.error(message);
  process.exit(1);
}

async function main(): Promise<void> {
  // ── 1. Parse args (pure, no fs/env) ────────────────────────────────────────
  let cli;
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

  // ── 2. Validate input file exists + detect its format before touching env/pipeline ──
  // File FORMAT (pdf/jpg/png/docx) is independent of business --document-type — see
  // lib/input-document.ts. Any supported format is accepted regardless of filename.
  if (!fs.existsSync(cli.file)) {
    fail(null, `[input] --file not found: ${cli.file}`);
  }
  const fileStat = fs.statSync(cli.file);
  if (!fileStat.isFile()) {
    fail(null, `[input] --file is not a regular file: ${cli.file}`);
  }
  const fileBuffer = fs.readFileSync(cli.file);
  let inputFile;
  try {
    inputFile = detectInputDocument(cli.file, fileBuffer);
  } catch (err) {
    if (err instanceof UnsupportedInputFormatError) fail(null, `[input] ${err.message}`);
    throw err;
  }

  // ── 3. Load env from --env-file BEFORE any pipeline import ─────────────────
  try {
    loadEnvFile(cli.envFile);
  } catch (err) {
    if (err instanceof EnvGuardError) fail(null, `[env] ${err.message}`);
    throw err;
  }

  // ── 4. Production safety guard ──────────────────────────────────────────────
  const safety = checkProductionSafety(process.env, cli.confirmProduction);
  if (!safety.ok) {
    console.error('[safety] Refusing to run:');
    for (const reason of safety.reasons) console.error(`  - ${reason}`);
    process.exit(1);
  }

  const maxFileMb = Number(process.env.AI_TRANSLATION_TEST_LAB_MAX_FILE_MB ?? '20');
  const maxPages = Number(process.env.AI_TRANSLATION_TEST_LAB_MAX_PAGES ?? '30');
  const fileSizeMb = fileStat.size / (1024 * 1024);
  if (fileSizeMb > maxFileMb) {
    fail(null, `[input] File is ${fileSizeMb.toFixed(1)} MB, exceeds AI_TRANSLATION_TEST_LAB_MAX_FILE_MB=${maxFileMb}`);
  }

  // ── 5. Resolve CLI aliases to canonical enums ───────────────────────────────
  let documentType: string;
  let serviceLevel: string;
  let urgency: string;
  let fulfillmentMethod: string | undefined;
  try {
    documentType = mapDocumentType(cli.documentTypeRaw);
    serviceLevel = mapServiceLevel(cli.serviceLevelRaw);
    urgency = mapUrgencyLevel(cli.urgencyRaw);
    fulfillmentMethod = mapFulfillmentMethod(cli.fulfillmentMethodRaw);
  } catch (err) {
    if (err instanceof AliasMapError) fail(null, `[args] ${err.message}`);
    throw err;
  }
  const deliveryZone = inferDeliveryZone(cli.deliveryCity);

  // ── 6. Run dirs + logger ─────────────────────────────────────────────────────
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
  logger.info(`resolved: documentType=${documentType} serviceLevel=${serviceLevel} urgency=${urgency} fulfillmentMethod=${fulfillmentMethod ?? 'n/a'} deliveryZone=${deliveryZone ?? 'n/a'}`);

  const ocrWarnings: string[] = [...inputFile.warnings];
  const translationWarnings: string[] = [];
  const renderWarnings: string[] = [];
  let pricingError: string | null = null;

  try {
    // ── 7. Snapshot source file ─────────────────────────────────────────────
    const sourceCopyPath = path.join(paths.sourceDir, `original-file${inputFile.extension}`);
    fs.copyFileSync(cli.file, sourceCopyPath);
    fs.writeFileSync(
      path.join(paths.sourceDir, 'source-metadata.json'),
      JSON.stringify(
        {
          originalPath: cli.file,
          filename: inputFile.filename,
          extension: inputFile.extension,
          mimeType: inputFile.mimeType,
          inputKind: inputFile.inputKind,
          sizeBytes: inputFile.sizeBytes,
          sha256: inputFile.sha256,
          sourceLanguage: cli.sourceLanguage,
          targetLanguage: cli.targetLanguage,
        },
        null,
        2,
      ),
    );
    logger.info(
      `source file snapshotted: ${sourceCopyPath} (${inputFile.sizeBytes} bytes, ${inputFile.mimeType}, kind=${inputFile.inputKind}, sha256=${inputFile.sha256})`,
    );

    // ── 8. Dynamic imports — AFTER dotenv load, per module design constraint ──
    logger.info('loading pipeline modules...');
    const { extractTextFromPdf } = await import('../../worker/src/lib/ocr');
    const { detectSourceLanguage } = await import('../../worker/src/lib/detect-language');
    const { computeOutputPlan } = await import('../../worker/src/lib/output-plan');
    const {
      mergeVisualElements,
      extractVisualElementsFromTranslated,
      filterPrintedVerificationStrings,
    } = await import('../../worker/src/lib/visual-elements');
    const { analyzeDocumentVisuals } = await import('../../worker/src/lib/page-vision');

    // ── 8b. Convert non-PDF input to a REAL PDF before OCR/page-vision ─────────
    // extractTextFromPdf() and analyzeDocumentVisuals() both hardcode
    // media_type/document_url as application/pdf — they must never receive
    // bytes that aren't actually a PDF. preparePdfForOcr() genuinely converts
    // JPG/PNG/DOCX via the same convertToPdf() production upload routes use;
    // it never relabels a non-PDF buffer.
    const { pdfBuffer, warnings: conversionWarnings } = await preparePdfForOcr(inputFile, fileBuffer);
    for (const w of conversionWarnings) ocrWarnings.push(w);

    // ── 9. OCR (real Mistral pipeline) ────────────────────────────────────────
    logger.info(`running OCR (Mistral) on ${inputFile.inputKind} input...`);
    const ocrResult = await extractTextFromPdf(pdfBuffer);
    const { markdown, pageCount, visualElements: ocrVisualElements, rawPages } = ocrResult;
    const extractedWordCount = markdown.trim().split(/\s+/).filter(Boolean).length;
    logger.info(`OCR done — ${pageCount} pages, ${extractedWordCount} words`);
    console.log(`[ocr] extracted text preview: ${truncateForConsole(markdown, cli.debugFullText ? Number.MAX_SAFE_INTEGER : 300)}`);

    if (pageCount > maxPages) {
      ocrWarnings.push(`Document has ${pageCount} pages, exceeds AI_TRANSLATION_TEST_LAB_MAX_PAGES=${maxPages}`);
    }
    if (extractedWordCount < 10) {
      ocrWarnings.push('OCR extracted word count is very low — check source scan quality.');
    }

    fs.writeFileSync(
      path.join(paths.ocrDir, 'ocr-result.json'),
      JSON.stringify({ pageCount, extractedWordCount, visualElements: ocrVisualElements }, null, 2),
    );
    fs.writeFileSync(path.join(paths.ocrDir, 'extracted-text.txt'), markdown, 'utf-8');
    if (cli.keepIntermediate) {
      fs.writeFileSync(path.join(paths.ocrDir, 'ocr-raw-pages.json'), JSON.stringify(rawPages, null, 2));
    }

    let resolvedSourceLang = cli.sourceLanguage;
    if (cli.sourceLanguage === 'auto') {
      logger.info('source_language=auto — running detection...');
      const detected = await detectSourceLanguage(markdown);
      if (detected) {
        logger.info(`detected source language: ${detected}`);
        resolvedSourceLang = detected;
      } else {
        ocrWarnings.push('Language auto-detection returned null.');
      }
    }

    let pageVisionElements: unknown[] = [];
    try {
      pageVisionElements = (await analyzeDocumentVisuals(rawPages, pdfBuffer, cli.targetLanguage)) as unknown[];
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      ocrWarnings.push(`page-vision analysis failed (non-fatal): ${msg}`);
    }

    const plan = computeOutputPlan(serviceLevel as 'electronic' | 'official_with_translator_signature_and_provider_stamp' | 'notarization_through_partners');

    // ── 10. Translation (real Anthropic pipeline) — skipped in dry-run-pricing-only ──
    let translatedMarkdown: string | null = null;
    let allVisualElements: unknown[] = pageVisionElements;

    if (!cli.dryRunPricingOnly) {
      const { translateDocument } = await import('../../worker/src/lib/translator');
      logger.info(`translating ${resolvedSourceLang} → ${cli.targetLanguage}... [plan: ${plan.mode}]`);
      translatedMarkdown = await translateDocument(markdown, resolvedSourceLang, cli.targetLanguage, documentType);
      logger.info(`translation done — ${translatedMarkdown.length} chars`);
      console.log(`[translation] preview: ${truncateForConsole(translatedMarkdown, cli.debugFullText ? Number.MAX_SAFE_INTEGER : 300)}`);

      fs.writeFileSync(
        path.join(paths.translationDir, 'translation-result.json'),
        JSON.stringify({ sourceLanguage: resolvedSourceLang, targetLanguage: cli.targetLanguage, documentType, outputMode: plan.mode }, null, 2),
      );
      fs.writeFileSync(path.join(paths.translationDir, 'translated-text.md'), translatedMarkdown, 'utf-8');

      if (pageVisionElements.length === 0) {
        const translatedVisualElements = extractVisualElementsFromTranslated(translatedMarkdown) as unknown[];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const merged = mergeVisualElements(ocrVisualElements as any, translatedVisualElements as any);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        allVisualElements = filterPrintedVerificationStrings(merged as any) as unknown[];
      }
    } else {
      logger.info('--dry-run-pricing-only set — skipping translation and rendering.');
    }

    // ── 11. Render PDF + DOCX (real renderer) — skipped if --skip-render or dry-run ──
    let translatedPdfPath: string | null = null;
    let translatedDocxPath: string | null = null;

    if (!cli.dryRunPricingOnly && !cli.skipRender && translatedMarkdown) {
      const { renderToHtml } = await import('../../worker/src/lib/renderer');
      const { renderToDocx } = await import('../../worker/src/lib/docx-renderer');
      const { generatePdfFromHtml, closeBrowser } = await import('../../worker/src/lib/pdf');
      const { runQaChecks } = await import('../../worker/src/lib/qa');

      const translatedAt = new Date().toISOString().split('T')[0] ?? new Date().toISOString();
      const renderMeta = {
        sourceLang: resolvedSourceLang,
        targetLang: cli.targetLanguage,
        documentType,
        translatedAt,
        filename: path.basename(cli.file),
        serviceLevel: serviceLevel as 'electronic' | 'official_with_translator_signature_and_provider_stamp' | 'notarization_through_partners',
        outputMode: plan.mode,
      };

      try {
        logger.info('generating DOCX...');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const docxBuf = await renderToDocx(translatedMarkdown, renderMeta as any, allVisualElements as any);
        translatedDocxPath = path.join(paths.renderedDir, 'translated-document.INTERNAL_TEST.docx');
        fs.writeFileSync(translatedDocxPath, docxBuf);
        logger.info(`DOCX written (${docxBuf.length} bytes) → ${translatedDocxPath}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        renderWarnings.push(`DOCX rendering failed (non-fatal): ${msg}`);
        logger.warn(`DOCX rendering failed (non-fatal): ${msg}`);
      }

      try {
        logger.info('generating HTML + PDF...');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const html = await renderToHtml(translatedMarkdown, renderMeta as any, allVisualElements as any);
        const qaReport = runQaChecks(html, plan.mode, pageCount);
        fs.writeFileSync(path.join(paths.translationDir, 'qa-report.json'), JSON.stringify(qaReport, null, 2));
        if (qaReport.warnings?.length) {
          for (const w of qaReport.warnings) translationWarnings.push(`QA: ${w}`);
        }

        const pdfBuf = await generatePdfFromHtml(html);
        translatedPdfPath = path.join(paths.renderedDir, 'translated-document.INTERNAL_TEST.pdf');
        fs.writeFileSync(translatedPdfPath, pdfBuf);
        logger.info(`PDF written (${pdfBuf.length} bytes) → ${translatedPdfPath}`);
        await closeBrowser();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        renderWarnings.push(`PDF rendering failed (non-fatal, likely missing headless Chromium in this environment): ${msg}`);
        logger.warn(`PDF rendering failed (non-fatal): ${msg}`);
      }
    } else if (cli.skipRender) {
      renderWarnings.push('--skip-render set — rendering skipped.');
    } else if (cli.dryRunPricingOnly) {
      renderWarnings.push('--dry-run-pricing-only set — rendering skipped.');
    }

    // ── 12. Pricing (real production calculator, READ-ONLY) ────────────────────
    // computeQuoteForJob() (src/lib/pricing/service.ts) only SELECTs from
    // pricing_versions and runs the pure calculator — it does not touch the
    // database. This code path deliberately never calls saveQuote(),
    // markQuotePaymentPending(), markQuotePaid(), or verifyQuotePayable(),
    // so no price_quotes / price_quote_items / cost_reservations /
    // payment_transactions rows are ever created by this tool. See
    // __tests__/no-forbidden-integrations.test.ts, which statically asserts
    // this file never references those writer functions or the
    // Halyk/Webkassa/Jira/Resend modules.
    logger.info('computing price quote (READ-ONLY — no price_quotes/cost_reservations/payment_transactions writes)...');
    let pricingResult: PricingResultLike | null = null;
    let pricingVersionCode: string | null = null;
    let languageGroup: string | null = null;

    try {
      const { computeQuoteForJob } = await import('@/lib/pricing/service');
      const { resolveLanguageGroup } = await import('@/lib/pricing/config');

      const groupInfo = resolveLanguageGroup(resolvedSourceLang, cli.targetLanguage);
      languageGroup = groupInfo.group;

      const pricingInput = {
        sourceLanguage: resolvedSourceLang,
        targetLanguage: cli.targetLanguage,
        serviceLevel,
        documentType,
        sourceWordCount: extractedWordCount,
        physicalPageCount: pageCount,
        urgencyLevel: urgency,
        ...(fulfillmentMethod ? { fulfillmentMethod } : {}),
        ...(deliveryZone ? { deliveryZone } : {}),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any;

      const quote = await computeQuoteForJob(pricingInput);
      if ('error' in quote) {
        pricingError = quote.error;
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        pricingResult = quote.result as any;
        pricingVersionCode = quote.version.code;
      }
    } catch (err) {
      pricingError = err instanceof Error ? err.message : String(err);
      logger.warn(`pricing computation failed (non-fatal — report will note this): ${pricingError}`);
    }

    let pricingContext: PricingContextSection | null = null;
    let clientPriceComponents: ReturnType<typeof buildClientPriceComponents> = [];
    let internalCosts: ReturnType<typeof buildInternalCostRows> = [];
    let margin: ReturnType<typeof buildMarginSection> | null = null;
    let reconciliation: ReturnType<typeof buildReconciliation> | null = null;

    if (pricingResult) {
      pricingContext = {
        pricingVersion: pricingVersionCode,
        languagePair: pricingResult.context.languagePair,
        languageGroup,
        documentType,
        serviceLevel,
        physicalPages: pageCount,
        sourceWordCount: extractedWordCount,
        includedWords: pricingResult.context.includedWordCount,
        includedPages: pricingResult.context.includedPageCount,
        urgency,
        fulfillmentMethod: fulfillmentMethod ?? null,
      };
      clientPriceComponents = buildClientPriceComponents(pricingResult);
      internalCosts = buildInternalCostRows(pricingResult);
      margin = buildMarginSection(pricingResult);
      reconciliation = buildReconciliation(pricingResult);

      fs.writeFileSync(path.join(paths.pricingDir, 'pricing-context.json'), JSON.stringify(pricingContext, null, 2));
      fs.writeFileSync(path.join(paths.pricingDir, 'price-items.json'), JSON.stringify(clientPriceComponents, null, 2));
      fs.writeFileSync(path.join(paths.pricingDir, 'internal-costs.json'), JSON.stringify(internalCosts, null, 2));
      fs.writeFileSync(path.join(paths.pricingDir, 'margin.json'), JSON.stringify(margin, null, 2));
      fs.writeFileSync(path.join(paths.pricingDir, 'reconciliation.json'), JSON.stringify(reconciliation, null, 2));

      logger.info(`pricing: ${pricingResult.amountKzt} KZT, margin ${margin.estimatedMarginPercent.toFixed(1)}%, reconciliation ${reconciliation.status}`);
      if (pricingResult.requiresOperatorReview) {
        translationWarnings.push(`Pricing requires operator review: ${pricingResult.reviewReasons.join('; ')}`);
      }
    }

    // ── 13. Build + write report ─────────────────────────────────────────────
    const runSummary: RunSummarySection = {
      runId,
      timestamp: new Date().toISOString(),
      environment: safety.environment,
      operatorEmail: operatorEmail ?? null,
      sourceFile: {
        name: inputFile.filename,
        sizeBytes: inputFile.sizeBytes,
        sha256: inputFile.sha256,
        mimeType: inputFile.mimeType,
        inputKind: inputFile.inputKind,
      },
      sourceLanguage: resolvedSourceLang,
      targetLanguage: cli.targetLanguage,
      documentType: { raw: cli.documentTypeRaw, canonical: documentType },
      serviceLevel: { raw: cli.serviceLevelRaw, canonical: serviceLevel },
      urgency,
      fulfillmentMethod: fulfillmentMethod ?? null,
      notaryCity: cli.notaryCity ?? null,
      deliveryCity: cli.deliveryCity ?? null,
    };

    const ocrSummary: OcrSummarySection = {
      provider: 'mistral',
      model: process.env.MISTRAL_OCR_MODEL ?? null,
      pageCount,
      extractedWordCount,
      confidence: 'not available',
      warnings: ocrWarnings,
    };

    const translationSummary: TranslationSummarySection = {
      llmProvider: 'anthropic',
      model: 'claude-sonnet-4-5-20250929',
      promptVersion: 'n/a (not versioned in translation-prompts module)',
      translationMode: plan.mode,
      visualElementsHandling: {
        count: allVisualElements.length,
        kinds: Array.from(new Set(allVisualElements.map((e) => String((e as { kind?: unknown }).kind ?? 'unknown')))),
      },
      officialMarkersStatus: plan.requiresHumanReview
        ? 'draft only — requires human translator/notary review before delivery'
        : 'electronic — no human review step in this pipeline',
      warnings: translationWarnings,
    };

    const renderedOutput: RenderedOutputSection = {
      translatedPdfPath,
      translatedDocxPath,
      warnings: renderWarnings,
    };

    const reportData = buildReportData({
      runSummary,
      ocrSummary,
      translationSummary,
      renderedOutput,
      pricingContext,
      clientPriceComponents,
      internalCosts,
      margin,
      reconciliation,
      pricingError,
    });

    fs.writeFileSync(path.join(paths.reportDir, 'report.INTERNAL_TEST.json'), renderReportJson(reportData));
    fs.writeFileSync(path.join(paths.reportDir, 'report.INTERNAL_TEST.md'), renderReportMarkdown(reportData));
    fs.writeFileSync(path.join(paths.reportDir, 'report.INTERNAL_TEST.html'), renderReportHtml(reportData));

    // ── 14. Optional R2 upload (internal-tests prefix only) ────────────────────
    if (cli.saveToR2) {
      try {
        const { uploadFile } = await import('../../worker/src/lib/r2');
        const r2Prefix = `${R2_INTERNAL_PREFIX}/${runId}`;
        const filesToUpload = walkRunDir(paths.runDir);
        for (const filePath of filesToUpload) {
          const rel = path.relative(paths.runDir, filePath);
          const key = `${r2Prefix}/${rel.split(path.sep).join('/')}`;
          const buf = fs.readFileSync(filePath);
          const contentType = guessContentType(filePath);
          await uploadFile(key, buf, contentType);
        }
        logger.info(`R2 upload complete → ${r2Prefix}/ (${filesToUpload.length} files)`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn(`R2 upload failed (non-fatal): ${msg}`);
      }
    }

    console.log('');
    console.log(`✓ Run complete: ${paths.runDir}`);
    if (pricingResult) {
      console.log(`  Price: ${pricingResult.amountKzt} KZT (${pricingVersionCode})`);
    } else {
      console.log(`  Pricing not computed: ${pricingError}`);
    }
    console.log(`  Report: ${path.join(paths.reportDir, 'report.INTERNAL_TEST.html')}`);
    console.log(`  ${reportData.watermark}`);

    process.exit(0);
  } catch (err) {
    const msg = err instanceof Error ? (err.stack ?? err.message) : String(err);
    logger.error(`fatal error: ${msg}`);
    process.exit(1);
  }
}

function walkRunDir(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkRunDir(full));
    else out.push(full);
  }
  return out;
}

function guessContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.json': return 'application/json';
    case '.md': return 'text/markdown';
    case '.html': return 'text/html; charset=utf-8';
    case '.pdf': return 'application/pdf';
    case '.docx': return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case '.txt': return 'text/plain; charset=utf-8';
    case '.log': return 'text/plain; charset=utf-8';
    default: return 'application/octet-stream';
  }
}

main().catch((err) => {
  console.error('[fatal]', err instanceof Error ? err.stack : err);
  process.exit(1);
});
