/**
 * One file, start to finish: analyze -> resolve pricing version -> build PricingInput ->
 * calculatePrice() (the REAL production calculator, never reimplemented) -> classify into
 * success / operator_review / failed (README §Error handling).
 *
 * Zero side effects: no orders/documents/jobs/price_quotes/cost_reservations row is ever
 * created; no Halyk/Jira/Drive/Telegram/email call; no pricing_versions write.
 */
import { calculatePrice } from '@/lib/pricing/calculator';
import type { PricingInput } from '@/lib/pricing/types';
import { analyzeLocalFile, SUPPORTED_EXTENSIONS } from './analyze-file';
import { buildNowOverride, splitUrgency } from './alias-map';
import { resolvePricingVersion } from './version-source';
import { hasAnyOverride } from './version-overrides';
import type { AnalysisSummary, FileResult, ResolvedFileParams } from './types';
import type { DocumentAnalysisResult } from '@/lib/document-analysis/analyze';
import { TRANSLATION_PAGE_CHAR_DIVISOR, MIN_TRANSLATION_PAGES } from '@/lib/pricing/config';

export interface RunPricingOptions {
  noOcr: boolean;
  noCache: boolean;
  cacheDir: string;
  /** Forwarded to analyzeLocalFile() -> extractTextFromPdf(); never read from @/lib/env. */
  mistralApiKey?: string;
}

function summarizeAnalysis(analysis: DocumentAnalysisResult, fromCache: boolean, manualPhysicalPageCountOverride?: number): AnalysisSummary {
  return {
    method: analysis.method,
    physicalPageCount: manualPhysicalPageCountOverride ?? analysis.physicalPageCount,
    charactersWithSpaces: analysis.characterCount,
    translationPages: Math.max(MIN_TRANSLATION_PAGES, analysis.characterCount / TRANSLATION_PAGE_CHAR_DIVISOR),
    fromCache,
  };
}

export async function runPricingForFile(
  filename: string,
  relativePath: string,
  buffer: Buffer,
  extension: string,
  params: ResolvedFileParams,
  opts: RunPricingOptions,
): Promise<FileResult> {
  const usedTemporaryOverridesBeforeVersion = hasAnyOverride(params.versionOverrides);

  const analysisOutcome = await analyzeLocalFile(buffer, extension, {
    noOcr: opts.noOcr,
    noCache: opts.noCache,
    cacheDir: opts.cacheDir,
    mistralApiKey: opts.mistralApiKey,
  });

  if (analysisOutcome.kind === 'unsupported_type') {
    return {
      filename,
      relativePath,
      status: 'failed',
      reasonCode: 'unsupported_type',
      reasons: [`Unsupported file extension '${extension}'. Supported: ${SUPPORTED_EXTENSIONS.join(', ')}.`],
      usedTemporaryOverrides: usedTemporaryOverridesBeforeVersion,
      appliedParams: params,
    };
  }

  if (analysisOutcome.kind === 'preflight_failed') {
    const reasonCode = analysisOutcome.status === 'encrypted' ? 'encrypted_pdf' : 'corrupted_pdf';
    return {
      filename,
      relativePath,
      status: 'failed',
      reasonCode,
      reasons: [`PDF is ${analysisOutcome.status} and could not be opened for analysis.`],
      usedTemporaryOverrides: usedTemporaryOverridesBeforeVersion,
      appliedParams: params,
    };
  }

  if (analysisOutcome.kind === 'skipped_ocr') {
    return {
      filename,
      relativePath,
      status: 'operator_review',
      reasons: [analysisOutcome.reason],
      usedTemporaryOverrides: usedTemporaryOverridesBeforeVersion,
      appliedParams: params,
    };
  }

  const analysis = analysisOutcome.result;
  const analysisSummary = summarizeAnalysis(analysis, analysisOutcome.fromCache, params.manualPhysicalPageCountOverride);
  const ocrFailed = analysis.reviewReasons.some((r) => r.startsWith('OCR failed:'));

  if (ocrFailed) {
    // Report the real OCR failure only — analyze.ts also pushes a generic "No text could be
    // extracted" reason whenever characterCount ends up 0 (which it always does after an OCR
    // exception), but that's misleading here: extraction was never attempted, it errored before
    // producing any text at all. Requirement: an OCR/config failure must never masquerade as a
    // per-document "no text" finding.
    return {
      filename,
      relativePath,
      status: 'failed',
      reasonCode: 'ocr_failed',
      reasons: analysis.reviewReasons.filter((r) => r.startsWith('OCR failed:')),
      usedTemporaryOverrides: usedTemporaryOverridesBeforeVersion,
      appliedParams: params,
      analysis: analysisSummary,
    };
  }

  if (analysis.characterCount === 0) {
    return {
      filename,
      relativePath,
      status: 'operator_review',
      reasonCode: 'no_text',
      reasons: analysis.reviewReasons,
      usedTemporaryOverrides: usedTemporaryOverridesBeforeVersion,
      appliedParams: params,
      analysis: analysisSummary,
    };
  }

  let resolvedVersion;
  try {
    resolvedVersion = await resolvePricingVersion(params);
  } catch (err) {
    return {
      filename,
      relativePath,
      status: 'failed',
      reasonCode: 'invalid_config',
      reasons: [err instanceof Error ? err.message : String(err)],
      usedTemporaryOverrides: usedTemporaryOverridesBeforeVersion,
      appliedParams: params,
      analysis: analysisSummary,
    };
  }

  const { notaryUrgencyLevel, notaryUrgencyWindowOverride } = splitUrgency(params.urgency);

  const input: PricingInput = {
    sourceLanguage: params.sourceLanguage,
    targetLanguage: params.targetLanguage,
    serviceLevel: params.serviceLevel,
    sourceCharacterCountWithSpaces: analysis.characterCount,
    // manualPhysicalPageCountOverride takes precedence over analysis — the operator override path
    // for DOCX (and any other method) when analysis couldn't get a reliable count without rendering.
    physicalPageCount: params.manualPhysicalPageCountOverride ?? analysis.physicalPageCount,
    applicantType: params.applicantType,
    fulfillmentMethod: params.fulfillmentMethod,
    deliveryRequired: params.deliveryRequired,
    notaryUrgencyLevel,
    extraPaperCopies: params.extraPaperCopies,
    salesChannel: params.salesChannel,
    partnerCommissionRateOverride: params.partnerCommissionRateOverride,
    manualAdjustmentKzt: params.manualAdjustmentKzt,
    manualAdjustmentReason: params.manualAdjustmentReason,
    languageRate: resolvedVersion.languageRate,
    nowOverride: buildNowOverride(notaryUrgencyWindowOverride),
  };

  let result;
  try {
    result = calculatePrice(input, resolvedVersion.version);
  } catch (err) {
    return {
      filename,
      relativePath,
      status: 'failed',
      reasonCode: 'invalid_config',
      reasons: [err instanceof Error ? err.message : String(err)],
      usedTemporaryOverrides: resolvedVersion.usedTemporaryOverrides,
      appliedParams: params,
      analysis: analysisSummary,
    };
  }

  if (result.requiresOperatorReview) {
    const noRateReason = result.reviewReasons.some((r) => /language rate/i.test(r));
    return {
      filename,
      relativePath,
      status: 'operator_review',
      reasonCode: noRateReason ? 'no_language_rate' : undefined,
      reasons: result.reviewReasons,
      usedTemporaryOverrides: resolvedVersion.usedTemporaryOverrides,
      appliedParams: params,
      analysis: analysisSummary,
      pricingResult: result,
    };
  }

  const reconciliationOk = result.newModel ? Math.abs(result.newModel.reconciliationDifferenceKzt) < 0.01 : true;
  if (!reconciliationOk) {
    return {
      filename,
      relativePath,
      status: 'failed',
      reasonCode: 'reconciliation_mismatch',
      reasons: [`Reconciliation difference: ${result.newModel!.reconciliationDifferenceKzt} KZT (expected ~0).`],
      usedTemporaryOverrides: resolvedVersion.usedTemporaryOverrides,
      appliedParams: params,
      analysis: analysisSummary,
      pricingResult: result,
      reconciliationOk: false,
    };
  }

  return {
    filename,
    relativePath,
    status: 'success',
    reasons: [],
    usedTemporaryOverrides: resolvedVersion.usedTemporaryOverrides,
    appliedParams: params,
    analysis: analysisSummary,
    pricingResult: result,
    reconciliationOk: true,
  };
}
