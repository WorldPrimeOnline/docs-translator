/**
 * The real OCR -> translation -> render -> pricing -> report pipeline for ONE
 * document, extracted from run-ai-translation-test.ts so single-file mode and
 * batch mode share the exact same code path (no duplicated pipeline logic to
 * drift out of sync). Never calls process.exit() — always returns a result;
 * the caller (single-file main() or the batch runner) decides what to do
 * with a failure.
 *
 * Env must already be loaded (loadEnvFile) and the production safety check
 * already passed BEFORE calling this — those are once-per-process concerns,
 * not once-per-document. See run-ai-translation-test.ts and lib/batch-runner.ts.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  mapDocumentType,
  mapFulfillmentMethod,
  mapServiceLevel,
  mapUrgencyLevel,
  inferDeliveryZone,
  AliasMapError,
} from './alias-map';
import { truncateForConsole, type Logger } from './logger';
import { detectInputDocument, preparePdfForOcr, UnsupportedInputFormatError } from './input-document';
import {
  buildClientPriceComponents,
  buildInternalCostRows,
  buildMarginSection,
  buildReconciliation,
  type PricingResultLike,
} from './pricing-report';
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
} from './report-builder';
import type { Environment, RunPaths } from './types';

const R2_INTERNAL_PREFIX = 'internal-tests/ai-translation-lab';

export interface ProcessDocumentInput {
  file: string;
  sourceLanguage: string;
  targetLanguage: string;
  documentTypeRaw: string;
  serviceLevelRaw: string;
  urgencyRaw?: string;
  fulfillmentMethodRaw?: string;
  notaryCity?: string;
  deliveryCity?: string;
  dryRunPricingOnly: boolean;
  skipRender: boolean;
  keepIntermediate: boolean;
  saveToR2: boolean;
  debugFullText: boolean;
  maxFileMb: number;
  maxPages: number;
  environment: Environment;
  operatorEmail?: string;
  paths: RunPaths;
  logger: Logger;
}

export interface ProcessDocumentResult {
  status: 'completed' | 'failed';
  errorCode: string | null;
  errorMessage: string | null;
  pageCount: number | null;
  extractedWordCount: number | null;
  warnings: string[];
  pricingAmountKzt: number | null;
  pricingVersion: string | null;
  reconciliationStatus: string | null;
  translatedDocxPath: string | null;
  translatedHtmlPath: string | null;
  /** Internal diagnostic artifact only — never the client-facing electronic output. */
  translatedPdfPath: string | null;
  reportJsonPath: string | null;
  reportMdPath: string | null;
  reportHtmlPath: string | null;
  durationSeconds: number;
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

function failResult(errorCode: string, errorMessage: string, startedAt: number, warnings: string[]): ProcessDocumentResult {
  return {
    status: 'failed',
    errorCode,
    errorMessage,
    pageCount: null,
    extractedWordCount: null,
    warnings,
    pricingAmountKzt: null,
    pricingVersion: null,
    reconciliationStatus: null,
    translatedDocxPath: null,
    translatedHtmlPath: null,
    translatedPdfPath: null,
    reportJsonPath: null,
    reportMdPath: null,
    reportHtmlPath: null,
    durationSeconds: (Date.now() - startedAt) / 1000,
  };
}

export async function processDocument(input: ProcessDocumentInput): Promise<ProcessDocumentResult> {
  const startedAt = Date.now();
  const { logger, paths } = input;
  const ocrWarnings: string[] = [];
  const translationWarnings: string[] = [];
  const renderWarnings: string[] = [];
  let pricingError: string | null = null;

  // ── Validate input file exists + detect its format ────────────────────────
  if (!fs.existsSync(input.file)) {
    return failResult('INPUT_NOT_FOUND', `File not found: ${input.file}`, startedAt, []);
  }
  const fileStat = fs.statSync(input.file);
  if (!fileStat.isFile()) {
    return failResult('INPUT_NOT_A_FILE', `Not a regular file: ${input.file}`, startedAt, []);
  }
  const fileBuffer = fs.readFileSync(input.file);
  let inputFile;
  try {
    inputFile = detectInputDocument(input.file, fileBuffer);
  } catch (err) {
    if (err instanceof UnsupportedInputFormatError) {
      return failResult('UNSUPPORTED_FORMAT', err.message, startedAt, []);
    }
    throw err;
  }
  ocrWarnings.push(...inputFile.warnings);

  const fileSizeMb = fileStat.size / (1024 * 1024);
  if (fileSizeMb > input.maxFileMb) {
    return failResult(
      'FILE_TOO_LARGE',
      `File is ${fileSizeMb.toFixed(1)} MB, exceeds AI_TRANSLATION_TEST_LAB_MAX_FILE_MB=${input.maxFileMb}`,
      startedAt,
      [],
    );
  }

  // ── Resolve CLI aliases to canonical enums ─────────────────────────────────
  let documentType: string;
  let serviceLevel: string;
  let urgency: string;
  let fulfillmentMethod: string | undefined;
  try {
    documentType = mapDocumentType(input.documentTypeRaw);
    serviceLevel = mapServiceLevel(input.serviceLevelRaw);
    urgency = mapUrgencyLevel(input.urgencyRaw);
    fulfillmentMethod = mapFulfillmentMethod(input.fulfillmentMethodRaw);
  } catch (err) {
    if (err instanceof AliasMapError) return failResult('ALIAS_MAP_ERROR', err.message, startedAt, []);
    throw err;
  }
  const deliveryZone = inferDeliveryZone(input.deliveryCity);

  logger.info(
    `resolved: documentType=${documentType} serviceLevel=${serviceLevel} urgency=${urgency} fulfillmentMethod=${fulfillmentMethod ?? 'n/a'} deliveryZone=${deliveryZone ?? 'n/a'}`,
  );

  try {
    // ── Snapshot source file ─────────────────────────────────────────────────
    const sourceCopyPath = path.join(paths.sourceDir, `original-file${inputFile.extension}`);
    fs.copyFileSync(input.file, sourceCopyPath);
    fs.writeFileSync(
      path.join(paths.sourceDir, 'source-metadata.json'),
      JSON.stringify(
        {
          originalPath: input.file,
          filename: inputFile.filename,
          extension: inputFile.extension,
          mimeType: inputFile.mimeType,
          inputKind: inputFile.inputKind,
          sizeBytes: inputFile.sizeBytes,
          sha256: inputFile.sha256,
          sourceLanguage: input.sourceLanguage,
          targetLanguage: input.targetLanguage,
        },
        null,
        2,
      ),
    );
    logger.info(
      `source file snapshotted: ${sourceCopyPath} (${inputFile.sizeBytes} bytes, ${inputFile.mimeType}, kind=${inputFile.inputKind}, sha256=${inputFile.sha256})`,
    );

    // ── Dynamic imports — env must already be loaded by the caller ─────────────
    logger.info('loading pipeline modules...');
    const { extractTextFromPdf } = await import('../../../worker/src/lib/ocr');
    const { detectSourceLanguage } = await import('../../../worker/src/lib/detect-language');
    const { computeOutputPlan } = await import('../../../worker/src/lib/output-plan');
    const {
      mergeVisualElements,
      extractVisualElementsFromTranslated,
      filterPrintedVerificationStrings,
    } = await import('../../../worker/src/lib/visual-elements');
    const { analyzeDocumentVisuals } = await import('../../../worker/src/lib/page-vision');

    // ── Convert non-PDF input to a REAL PDF before OCR/page-vision ─────────────
    const { pdfBuffer, warnings: conversionWarnings } = await preparePdfForOcr(inputFile, fileBuffer);
    ocrWarnings.push(...conversionWarnings);

    // ── OCR (real Mistral pipeline) ──────────────────────────────────────────
    logger.info(`running OCR (Mistral) on ${inputFile.inputKind} input...`);
    const ocrResult = await extractTextFromPdf(pdfBuffer);
    const { markdown, pageCount, visualElements: ocrVisualElements, rawPages } = ocrResult;
    const extractedWordCount = markdown.trim().split(/\s+/).filter(Boolean).length;
    logger.info(`OCR done — ${pageCount} pages, ${extractedWordCount} words`);
    console.log(`[ocr] extracted text preview: ${truncateForConsole(markdown, input.debugFullText ? Number.MAX_SAFE_INTEGER : 300)}`);

    if (pageCount > input.maxPages) {
      ocrWarnings.push(`Document has ${pageCount} pages, exceeds AI_TRANSLATION_TEST_LAB_MAX_PAGES=${input.maxPages}`);
    }
    if (extractedWordCount < 10) {
      ocrWarnings.push('OCR extracted word count is very low — check source scan quality.');
    }

    fs.writeFileSync(
      path.join(paths.ocrDir, 'ocr-result.json'),
      JSON.stringify({ pageCount, extractedWordCount, visualElements: ocrVisualElements }, null, 2),
    );
    fs.writeFileSync(path.join(paths.ocrDir, 'extracted-text.txt'), markdown, 'utf-8');
    if (input.keepIntermediate) {
      fs.writeFileSync(path.join(paths.ocrDir, 'ocr-raw-pages.json'), JSON.stringify(rawPages, null, 2));
    }

    let resolvedSourceLang = input.sourceLanguage;
    if (input.sourceLanguage === 'auto') {
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
      pageVisionElements = (await analyzeDocumentVisuals(rawPages, pdfBuffer, input.targetLanguage)) as unknown[];
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      ocrWarnings.push(`page-vision analysis failed (non-fatal): ${msg}`);
    }

    const plan = computeOutputPlan(serviceLevel as 'electronic' | 'official_with_translator_signature_and_provider_stamp' | 'notarization_through_partners');

    // ── Translation (real Anthropic pipeline) — skipped in dry-run-pricing-only ──
    let translatedMarkdown: string | null = null;
    let allVisualElements: unknown[] = pageVisionElements;

    if (!input.dryRunPricingOnly) {
      const { translateDocument } = await import('../../../worker/src/lib/translator');
      logger.info(`translating ${resolvedSourceLang} → ${input.targetLanguage}... [plan: ${plan.mode}]`);
      translatedMarkdown = await translateDocument(markdown, resolvedSourceLang, input.targetLanguage, documentType);
      logger.info(`translation done — ${translatedMarkdown.length} chars`);
      console.log(`[translation] preview: ${truncateForConsole(translatedMarkdown, input.debugFullText ? Number.MAX_SAFE_INTEGER : 300)}`);

      fs.writeFileSync(
        path.join(paths.translationDir, 'translation-result.json'),
        JSON.stringify({ sourceLanguage: resolvedSourceLang, targetLanguage: input.targetLanguage, documentType, outputMode: plan.mode }, null, 2),
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

    // ── Render DOCX + HTML (client-facing formats) + diagnostic PDF ─────────────
    let translatedPdfPath: string | null = null;
    let translatedDocxPath: string | null = null;
    let translatedHtmlPath: string | null = null;

    if (!input.dryRunPricingOnly && !input.skipRender && translatedMarkdown) {
      const { renderToHtml } = await import('../../../worker/src/lib/renderer');
      const { renderToDocx } = await import('../../../worker/src/lib/docx-renderer');
      const { generatePdfFromHtml, closeBrowser } = await import('../../../worker/src/lib/pdf');
      const { runQaChecks } = await import('../../../worker/src/lib/qa');

      const translatedAt = new Date().toISOString().split('T')[0] ?? new Date().toISOString();
      const renderMeta = {
        sourceLang: resolvedSourceLang,
        targetLang: input.targetLanguage,
        documentType,
        translatedAt,
        filename: path.basename(input.file),
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

      let html: string | null = null;
      try {
        logger.info('generating HTML...');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        html = await renderToHtml(translatedMarkdown, renderMeta as any, allVisualElements as any);
        translatedHtmlPath = path.join(paths.renderedDir, 'translated-document.INTERNAL_TEST.html');
        fs.writeFileSync(translatedHtmlPath, html, 'utf-8');
        logger.info(`HTML written (${html.length} chars) → ${translatedHtmlPath}`);

        const qaReport = runQaChecks(html, plan.mode, pageCount);
        fs.writeFileSync(path.join(paths.translationDir, 'qa-report.json'), JSON.stringify(qaReport, null, 2));
        if (qaReport.warnings?.length) {
          for (const w of qaReport.warnings) translationWarnings.push(`QA: ${w}`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        renderWarnings.push(`HTML rendering failed (non-fatal): ${msg}`);
        logger.warn(`HTML rendering failed (non-fatal): ${msg}`);
      }

      // Diagnostic PDF only — electronic client delivery is DOCX+HTML, never PDF.
      // See docs/ai-context/40_TRANSLATION_PIPELINE.md "Electronic output policy".
      if (html) {
        try {
          logger.info('generating internal diagnostic PDF...');
          const pdfBuf = await generatePdfFromHtml(html);
          translatedPdfPath = path.join(paths.renderedDir, 'translated-document.INTERNAL_DIAGNOSTIC_ONLY.pdf');
          fs.writeFileSync(translatedPdfPath, pdfBuf);
          logger.info(`Diagnostic PDF written (${pdfBuf.length} bytes) → ${translatedPdfPath}`);
          await closeBrowser();
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          renderWarnings.push(`Diagnostic PDF rendering failed (non-fatal, likely missing headless Chromium in this environment): ${msg}`);
          logger.warn(`Diagnostic PDF rendering failed (non-fatal): ${msg}`);
        }
      }
    } else if (input.skipRender) {
      renderWarnings.push('--skip-render set — rendering skipped.');
    } else if (input.dryRunPricingOnly) {
      renderWarnings.push('--dry-run-pricing-only set — rendering skipped.');
    }

    // ── Pricing (real production calculator, READ-ONLY) ────────────────────────
    logger.info('computing price quote (READ-ONLY — no price_quotes/cost_reservations/payment_transactions writes)...');
    let pricingResult: PricingResultLike | null = null;
    let pricingVersionCode: string | null = null;
    let languageGroup: string | null = null;

    try {
      const { computeQuoteForJob } = await import('@/lib/pricing/service');
      const { resolveLanguageGroup } = await import('@/lib/pricing/config');

      const groupInfo = resolveLanguageGroup(resolvedSourceLang, input.targetLanguage);
      languageGroup = groupInfo.group;

      const pricingInput = {
        sourceLanguage: resolvedSourceLang,
        targetLanguage: input.targetLanguage,
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

    // ── Build + write report ─────────────────────────────────────────────────
    const runSummary: RunSummarySection = {
      runId: paths.runId,
      timestamp: new Date().toISOString(),
      environment: input.environment,
      operatorEmail: input.operatorEmail ?? null,
      sourceFile: {
        name: inputFile.filename,
        sizeBytes: inputFile.sizeBytes,
        sha256: inputFile.sha256,
        mimeType: inputFile.mimeType,
        inputKind: inputFile.inputKind,
      },
      sourceLanguage: resolvedSourceLang,
      targetLanguage: input.targetLanguage,
      documentType: { raw: input.documentTypeRaw, canonical: documentType },
      serviceLevel: { raw: input.serviceLevelRaw, canonical: serviceLevel },
      urgency,
      fulfillmentMethod: fulfillmentMethod ?? null,
      notaryCity: input.notaryCity ?? null,
      deliveryCity: input.deliveryCity ?? null,
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
      translatedHtmlPath,
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

    const reportJsonPath = path.join(paths.reportDir, 'report.INTERNAL_TEST.json');
    const reportMdPath = path.join(paths.reportDir, 'report.INTERNAL_TEST.md');
    const reportHtmlPath = path.join(paths.reportDir, 'report.INTERNAL_TEST.html');
    fs.writeFileSync(reportJsonPath, renderReportJson(reportData));
    fs.writeFileSync(reportMdPath, renderReportMarkdown(reportData));
    fs.writeFileSync(reportHtmlPath, renderReportHtml(reportData));

    // ── Optional R2 upload (internal-tests prefix only) ─────────────────────────
    if (input.saveToR2) {
      try {
        const { uploadFile } = await import('../../../worker/src/lib/r2');
        const r2Prefix = `${R2_INTERNAL_PREFIX}/${paths.runId}`;
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

    const allWarnings = [...ocrWarnings, ...translationWarnings, ...renderWarnings];

    return {
      status: 'completed',
      errorCode: null,
      errorMessage: null,
      pageCount,
      extractedWordCount,
      warnings: allWarnings,
      pricingAmountKzt: pricingResult?.amountKzt ?? null,
      pricingVersion: pricingVersionCode,
      reconciliationStatus: reconciliation?.status ?? null,
      translatedDocxPath,
      translatedHtmlPath,
      translatedPdfPath,
      reportJsonPath,
      reportMdPath,
      reportHtmlPath,
      durationSeconds: (Date.now() - startedAt) / 1000,
    };
  } catch (err) {
    const msg = err instanceof Error ? (err.stack ?? err.message) : String(err);
    logger.error(`fatal error: ${msg}`);
    return failResult('PIPELINE_ERROR', err instanceof Error ? err.message : String(err), startedAt, [
      ...ocrWarnings,
      ...translationWarnings,
      ...renderWarnings,
    ]);
  }
}
