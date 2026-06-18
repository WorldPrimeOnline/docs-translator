import { supabase, type JobRow, type DocumentRow } from './lib/supabase';
import { downloadFile, uploadFile, getPresignedUrl } from './lib/r2';
import { extractTextFromPdf } from './lib/ocr';
import { translateDocument, retranslateWithCorrection } from './lib/translator';
import { extractAndProtectValues, restoreProtectedValues } from './lib/protected-values';
import { extractMarkdownTableShapes, compareMarkdownTableShapes, buildTableCorrectionPrompt } from './lib/table-shape';
import { detectSourceLanguage } from './lib/detect-language';
import { renderToHtml } from './lib/renderer';
import { generatePdfFromHtml } from './lib/pdf';
import { renderToDocx } from './lib/docx-renderer';
import { sendTranslationReady, sendDocumentReceivedForReview } from './lib/email';
import { computeOutputPlan, type ServiceLevel } from './lib/output-plan';
import { mergeVisualElements, extractVisualElementsFromTranslated } from './lib/visual-elements';
import { analyzeDocumentVisuals } from './lib/page-vision';
import { convertOcrElementsToDetected, mergeDetectedElements } from './lib/detected-visual-element';
import { serializeVisualInventory, parseAndRemoveInventoryBlock, buildFinalVisualBlock, type InventoryEntry, type ParsedInventoryEntry } from './lib/visual-inventory';
import { runQaChecks } from './lib/qa';
import { resolveDocumentType } from './lib/effective-document-type';
import { validateTranslationScript, buildScriptCorrectionPrompt } from './lib/script-validator';
import { runStructuralReview, applyStructuralCorrections } from './lib/structural-review';
import { assessOcrQuality } from './lib/ast/script-quality';
import { translateToAst } from './lib/ast/translator';
import { checkContentCoverage } from './lib/content-coverage';
import { checkSourceCompleteness } from './lib/source-completeness';
import { env } from './lib/env';
import { initializeOrderIntegrations, triggerTranslatorReview } from './lib/integrations';

type JobStatus = JobRow['status'];
type OutputFormat = 'html' | 'pdf' | 'docx';

/** Remove internal WPO HTML comment markers before passing markdown to renderers or storing. */
function stripInternalMarkers(markdown: string): string {
  return markdown.replace(/<!--\s*WPO_[A-Z_]+\s*-->/g, '').replace(/\n{3,}/g, '\n\n');
}

function parseDocumentType(raw: string): { docType: string; outputFormat: OutputFormat } {
  const [docType, fmt] = raw.split('|');
  const outputFormat: OutputFormat = (fmt === 'pdf' || fmt === 'docx') ? fmt : 'html';
  return { docType: docType ?? raw, outputFormat };
}

async function updateJob(
  jobId: string,
  status: JobStatus,
  progress: number,
  errorMessage?: string,
  extra?: Record<string, unknown>,
): Promise<void> {
  const now = new Date().toISOString();
  await supabase
    .from('jobs')
    .update({
      status,
      progress_percent: progress,
      ...(errorMessage ? { error_message: errorMessage } : {}),
      ...(status === 'completed' || status === 'failed' ? { completed_at: now } : {}),
      ...(extra ?? {}),
    })
    .eq('id', jobId);
}

/**
 * Process a single job end-to-end:
 *   OCR → Translate → Render HTML → Puppeteer PDF → Upload to R2 → Done
 *
 * The caller must have already done the atomic status claim (status → ocr_in_progress).
 */
export async function processJob(jobId: string, documentId: string): Promise<void> {
  const tag = `[job:${jobId.slice(0, 8)}]`;
  console.log(`${tag} starting — document ${documentId}`);

  try {
    // ── 1. Load document metadata ────────────────────────────────────────────
    const { data: doc, error: docErr } = await supabase
      .from('documents')
      .select('*')
      .eq('id', documentId)
      .single<DocumentRow>();

    if (docErr || !doc) throw new Error(`Document ${documentId} not found`);

    const { data: jobRow } = await supabase
      .from('jobs')
      .select('*')
      .eq('id', jobId)
      .single<JobRow>();

    // Prefer service_level column; fall back to legacy notarized boolean for old rows
    const resolvedServiceLevel = jobRow?.service_level ?? (jobRow?.notarized ? 'notarization_through_partners' : 'electronic');
    const plan = computeOutputPlan(resolvedServiceLevel);

    const serviceLevel = resolvedServiceLevel;

    // ── 1b. Integration init (certified/notarized only) ─────────────────────
    // Must run BEFORE we change status so the worker is the durable executor,
    // not a fire-and-forget Vercel request that gets killed after HTTP response.
    let integrationResult = {
      jiraIssueKey: jobRow?.jira_issue_key ?? null,
      jiraIssueUrl: jobRow?.jira_issue_url ?? null,
      driveFolderId: jobRow?.google_drive_folder_id ?? null,
      driveUrl: jobRow?.google_drive_folder_url ?? null,
      aiDraftFolderId: null as string | null,
      sourceFolderId: null as string | null,
    };

    if (serviceLevel !== 'electronic') {
      try {
        integrationResult = await initializeOrderIntegrations({
          jobId,
          serviceLevel: resolvedServiceLevel as typeof serviceLevel,
          sourceLang: doc.source_language,
          targetLang: doc.target_language,
          documentType: doc.document_type,
          notaryCity: jobRow?.notary_city ?? null,
          fulfillmentMethod: jobRow?.fulfillment_method ?? null,
          deliveryPhone: jobRow?.delivery_phone ?? null,
          deliveryAddress: jobRow?.delivery_address ?? null,
          paymentSource: jobRow?.payment_source ?? null,
          customerId: doc.user_id,
          sourceFileKey: doc.file_key,
        });
      } catch (initErr) {
        const initMsg = initErr instanceof Error ? initErr.message : String(initErr);
        console.error(`${tag} integration init failed (non-fatal, continuing with OCR): ${initMsg}`);
      }
    }

    // ── 2. OCR ───────────────────────────────────────────────────────────────
    await updateJob(jobId, 'ocr_in_progress', 10);
    console.log(`${tag} downloading PDF from R2…`);
    const pdfBuffer = await downloadFile(doc.file_key);

    console.log(`${tag} running OCR…`);
    const { markdown, pageCount, visualElements: ocrVisualElements } = await extractTextFromPdf(pdfBuffer);
    console.log(`${tag} OCR done — ${pageCount} pages, ${markdown.length} chars, ${ocrVisualElements.length} visual elements`);

    // OCR quality check — script-aware, handles CJK/Thai/Arabic/Hebrew/Devanagari
    const ocrQuality = assessOcrQuality(markdown, doc.source_language !== 'auto' ? doc.source_language : undefined);
    console.log(`${tag} OCR quality: ${ocrQuality.pass ? 'pass' : 'fail'} — ${ocrQuality.wordCountEstimate} units, ${ocrQuality.charCount} chars, ${ocrQuality.scriptProfile.name} script, junk=${(ocrQuality.junkRatio * 100).toFixed(1)}%`);

    if (!ocrQuality.pass) {
      console.error(`${tag} OCR quality too low — ${ocrQuality.failReason}`);
      await updateJob(jobId, 'failed', 0,
        'Document quality too low. Please upload a clearer scan with better lighting and resolution.');
      await supabase.from('documents').update({ status: 'failed' }).eq('id', documentId);
      return;
    }

    await updateJob(jobId, 'ocr_completed', 40);

    // ── Advisory: source-document completeness warnings ──────────────────────
    const sourceWarnings = checkSourceCompleteness(markdown, pageCount);
    if (sourceWarnings.length > 0) {
      console.warn(`${tag} source warnings: ${sourceWarnings.map(w => w.code).join(',')}`);
    }

    await supabase.from('ocr_results').insert({
      job_id: jobId,
      markdown,
      page_count: pageCount,
      provider: 'mistral',
    });

    let resolvedSourceLang = doc.source_language;
    if (doc.source_language === 'auto') {
      console.log(`${tag} source_language=auto — running detection…`);
      const detected = await detectSourceLanguage(markdown);
      if (detected) {
        console.log(`${tag} detected source language: ${detected}`);
        await supabase.from('documents').update({ detected_source_language: detected }).eq('id', documentId);
        resolvedSourceLang = detected;
      } else {
        console.warn(`${tag} language detection returned null — renderer will handle unknown source`);
      }
    }

    // ── 3. Translation ───────────────────────────────────────────────────────
    await updateJob(jobId, 'translation_in_progress', 50);
    console.log(`${tag} translating ${resolvedSourceLang} → ${doc.target_language}… [plan: ${plan.mode}]`);

    const { docType: rawDocType, outputFormat } = parseDocumentType(doc.document_type);
    // Resolve effective type for 'other'/'generic_document' via OCR heuristics
    const docType = resolveDocumentType(rawDocType, markdown);

    let translatedMarkdown: string;

    if (plan.mode === 'translator_review_draft' || plan.mode === 'notarization_package') {
      // ── 3a. Visual analysis (official path only) ─────────────────────────
      let inventoryEntries: InventoryEntry[] = [];
      let markdownForTranslation: string;
      {
        let detectedElements: import('./lib/detected-visual-element').DetectedVisualElement[] = [];
        const t0Visual = Date.now();
        try {
          const visionElements = await analyzeDocumentVisuals(pdfBuffer, pageCount);
          const ocrDetected = convertOcrElementsToDetected(ocrVisualElements);
          detectedElements = mergeDetectedElements(ocrDetected, visionElements);
          console.log(
            `${tag} [visual] vision=${visionElements.length} ocr=${ocrDetected.length} ` +
            `merged=${detectedElements.length} in ${Date.now() - t0Visual}ms`,
          );
        } catch (visionErr) {
          const visionMsg = visionErr instanceof Error ? visionErr.message : String(visionErr);
          console.warn(`${tag} PAGE_VISUAL_ANALYSIS_FAILED (non-fatal, using OCR elements): ${visionMsg}`);
          detectedElements = convertOcrElementsToDetected(ocrVisualElements);
          console.log(`${tag} [visual] fallback: ocr=${detectedElements.length} elements`);
        }

        // ── 3b. Protected values + visual inventory prepended ─────────────
        const { protectedMarkdown, values: pvList } = extractAndProtectValues(markdown);
        console.log(`${tag} [legacy-official] protected values: ${pvList.length}`);

        let inventoryBlock = '';
        if (detectedElements.length > 0) {
          const inv = serializeVisualInventory(detectedElements, doc.target_language);
          inventoryBlock = inv.inventoryBlock;
          inventoryEntries = inv.entries;
          console.log(`${tag} [visual] inventory: ${inventoryEntries.length} entries prepended`);
        }

        markdownForTranslation = inventoryBlock
          ? inventoryBlock + '\n\n' + protectedMarkdown
          : protectedMarkdown;

        const sourceShapes = extractMarkdownTableShapes(markdown);
        console.log(`${tag} [legacy-official] source tables: ${sourceShapes.length}`);

        // ── 3c. Translate ─────────────────────────────────────────────────
        const firstTranslation = await translateDocument(
          markdownForTranslation,
          resolvedSourceLang,
          doc.target_language,
          docType,
        );

        // ── 3d. Parse inventory out of translation body ───────────────────
        let parsedInventory: ParsedInventoryEntry[] = [];
        let translationBody = firstTranslation;
        if (inventoryEntries.length > 0) {
          const inv = parseAndRemoveInventoryBlock(firstTranslation, inventoryEntries);
          parsedInventory = inv.parsedEntries;
          translationBody = inv.cleanedMarkdown;
          console.log(
            `${tag} [visual] parsed inventory: ${parsedInventory.length} entries, ` +
            `missing=${inv.missingTokens.length}`,
          );
          if (inv.missingTokens.length > 0) {
            console.warn(
              `${tag} [visual] missing visual tokens (restored from source): count=${inv.missingTokens.length}`,
            );
          }
        }

        // ── 3e. Table shape check + retry ────────────────────────────────
        const translatedShapes = extractMarkdownTableShapes(translationBody);
        const shapeMismatches = compareMarkdownTableShapes(sourceShapes, translatedShapes);
        let usedTableRetry = false;

        if (shapeMismatches.length > 0) {
          console.warn(
            `${tag} [legacy-official] table structure mismatch — retrying (mismatched tables: ${shapeMismatches.length})`,
          );
          usedTableRetry = true;
          try {
            const correctionPrompt = buildTableCorrectionPrompt(shapeMismatches);
            const retried = await retranslateWithCorrection(
              markdownForTranslation,
              resolvedSourceLang,
              doc.target_language,
              docType,
              correctionPrompt,
            );
            // Re-parse inventory from retry
            if (inventoryEntries.length > 0) {
              const inv = parseAndRemoveInventoryBlock(retried, inventoryEntries);
              parsedInventory = inv.parsedEntries;
              translationBody = inv.cleanedMarkdown;
            } else {
              translationBody = retried;
            }
          } catch (retryErr) {
            const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
            console.warn(`${tag} [legacy-official] table retry failed (advisory, continuing): ${retryMsg}`);
            usedTableRetry = false;
          }
        }
        console.log(`${tag} [legacy-official] table structure retry: ${usedTableRetry}`);

        // ── 3f. Restore protected values ─────────────────────────────────
        const { restoredMarkdown, missingTokens, remainingTokens, forcedRestores } = restoreProtectedValues(
          translationBody,
          pvList,
        );
        console.log(`${tag} [legacy-official] missing placeholders: ${missingTokens.length}`);
        if (missingTokens.length > 0) {
          console.warn(`${tag} [legacy-official] missing tokens (advisory): count=${missingTokens.length}`);
        }
        if (remainingTokens.length > 0) {
          console.warn(`${tag} [legacy-official] unexpected remaining tokens: count=${remainingTokens.length}`);
        }
        if (forcedRestores.length > 0) {
          console.warn(`${tag} [legacy-official] CONFUSABLE_RECOVERY: forced restores: count=${forcedRestores.length} tokens=${forcedRestores.map(r => r.split(':')[0]).join(',')}`);
        }

        // ── 3g. Append final visual block ────────────────────────────────
        if (parsedInventory.length > 0) {
          const visualBlock = buildFinalVisualBlock(parsedInventory, doc.target_language);
          translatedMarkdown = restoredMarkdown.trimEnd() + '\n\n' + visualBlock;
          console.log(`${tag} [visual] final visual block appended: ${parsedInventory.length} elements`);
        } else {
          translatedMarkdown = restoredMarkdown;
        }

        // ── 3h. Content coverage check (pre-render) ──────────────────────
        const coverageResult = checkContentCoverage({
          sourceMarkdown: markdown,
          translatedMarkdown,
          sourceShapes,
          protectedValueCount: pvList.length,
          inventoryEntryCount: inventoryEntries.length,
        });
        if (coverageResult.warnings.length > 0) {
          console.warn(`${tag} coverage warnings: ${coverageResult.warnings.join('|')}`);
        }
        if (!coverageResult.passed) {
          console.warn(`${tag} coverage errors: ${coverageResult.errors.join('|')}`);
        }
        if (coverageResult.retryNeeded && !usedTableRetry) {
          console.warn(`${tag} [coverage] retry indicated by coverage check (table/heading issue)`);
          // One targeted retry — only if we haven't already retried for table shape
          try {
            const retried = await retranslateWithCorrection(
              markdownForTranslation,
              resolvedSourceLang,
              doc.target_language,
              docType,
              `Coverage check failed: ${coverageResult.errors.slice(0, 2).join('; ')}. ` +
              `Ensure ALL headings and tables from the source are present in the translation.`,
            );
            // Re-parse inventory and rebuild
            let retryBody = retried;
            let retryInventory = parsedInventory;
            if (inventoryEntries.length > 0) {
              const inv = parseAndRemoveInventoryBlock(retried, inventoryEntries);
              retryInventory = inv.parsedEntries;
              retryBody = inv.cleanedMarkdown;
            }
            const { restoredMarkdown: retryRestored } = restoreProtectedValues(retryBody, pvList);
            let retryFinal = retryRestored;
            if (retryInventory.length > 0) {
              retryFinal = retryRestored.trimEnd() + '\n\n' + buildFinalVisualBlock(retryInventory, doc.target_language);
            }
            const retryCheck = checkContentCoverage({
              sourceMarkdown: markdown,
              translatedMarkdown: retryFinal,
              sourceShapes,
              protectedValueCount: pvList.length,
              inventoryEntryCount: inventoryEntries.length,
            });
            if (retryCheck.errors.length <= coverageResult.errors.length) {
              translatedMarkdown = retryFinal;
              console.log(`${tag} [coverage] retry applied: errors ${coverageResult.errors.length} → ${retryCheck.errors.length}`);
            } else {
              console.warn(`${tag} [coverage] retry did not improve coverage, keeping original`);
            }
          } catch (cvErr) {
            console.warn(`${tag} [coverage] retry failed (advisory, continuing): ${cvErr instanceof Error ? cvErr.message : String(cvErr)}`);
          }
        } else if (coverageResult.fallbackNeeded) {
          console.warn(`${tag} [coverage] fallback needed but not retrying — using available content with warning`);
        }
      }
    } else {
      // Electronic path: unchanged
      translatedMarkdown = await translateDocument(
        markdown,
        resolvedSourceLang,
        doc.target_language,
        docType,
      );
    }

    console.log(`${tag} translation done — ${translatedMarkdown.length} chars, format: ${outputFormat}`);

    // ── Unexpected-script validation (advisory, one targeted retry) ───────────
    if (plan.mode === 'translator_review_draft' || plan.mode === 'notarization_package') {
      const scriptIssues = validateTranslationScript(
        translatedMarkdown,
        doc.target_language,
      );
      if (scriptIssues.length > 0) {
        console.warn(`${tag} [script-validator] unexpected script: count=${scriptIssues.length} fragments=${scriptIssues.slice(0, 5).map(i => i.text).join(',')}`);
        try {
          const correctionInstructions = buildScriptCorrectionPrompt(scriptIssues, doc.target_language);
          const corrected = await retranslateWithCorrection(
            translatedMarkdown,
            resolvedSourceLang ?? 'auto',
            doc.target_language,
            docType,
            correctionInstructions,
          );
          const remaining = validateTranslationScript(corrected, doc.target_language);
          if (remaining.length < scriptIssues.length) {
            translatedMarkdown = corrected;
            console.log(`${tag} [script-validator] correction applied: issues ${scriptIssues.length} → ${remaining.length}`);
          } else {
            console.warn(`${tag} [script-validator] correction did not reduce issues (advisory), keeping original`);
          }
        } catch (err) {
          console.warn(`${tag} [script-validator] correction failed (advisory):`, err instanceof Error ? err.message : err);
        }
      }
    }

    // Generate structured AST in background (non-blocking — failure does not abort the job)
    let translatedAst: unknown = null;
    try {
      const astResult = await translateToAst({
        ocrMarkdown: markdown,
        sourceLanguage: resolvedSourceLang ?? 'auto',
        targetLanguage: doc.target_language,
        documentType: docType,
        pageCount,
      });
      translatedAst = astResult.ast;
      if (astResult.lexiconWarning) console.warn(`${tag} AST lexicon warning: ${astResult.lexiconWarning}`);
      console.log(`${tag} AST generated — ${astResult.ast.blocks.length} blocks, profile: ${astResult.ast.renderingProfile}`);
    } catch (astErr) {
      const astMsg = astErr instanceof Error ? astErr.message : String(astErr);
      // Compact: Zod errors are enormous — log only a one-liner
      console.warn(`${tag} AST generation failed (non-fatal): ${astMsg.split('\n')[0]?.slice(0, 120) ?? astMsg.slice(0, 120)}`);
    }

    // ── 4. Render output in requested format ─────────────────────────────────
    await updateJob(jobId, 'pdf_rendering', 70);

    const translatedAt = new Date().toISOString().split('T')[0] ?? new Date().toISOString();
    const renderMeta = {
      sourceLang: resolvedSourceLang,
      targetLang: doc.target_language,
      documentType: docType,
      translatedAt,
      filename: doc.filename,
      serviceLevel,
      outputMode: plan.mode,
    };

    const baseKey = `documents/${doc.user_id}/${documentId}`;

    // Merge visual elements from OCR + translated markdown
    const translatedVisualElements = extractVisualElementsFromTranslated(translatedMarkdown);
    const allVisualElements = mergeVisualElements(ocrVisualElements, translatedVisualElements);

    // ── 4a. Official / review mode (certified + notarization both produce translator draft) ──
    if (plan.mode === 'translator_review_draft' || plan.mode === 'notarization_package') {
      console.log(`${tag} [official mode] generating translator draft DOCX + preview PDF…`);

      // Strip internal WPO markers (<!-- WPO_VISUAL_BLOCK_START --> etc.) before rendering.
      // The sentinel is used for dedup detection only — it must not appear in rendered output.
      let markdownForRender = stripInternalMarkers(translatedMarkdown);

      // ── Structural translation review (untranslated/transliterated fragment detection) ──
      // Catches phonetic-Latin transcriptions of source-language words that pass script-level
      // detection (e.g. "COXPAHEH" in an English heading = transliterated "СОХРАНЕН").
      try {
        const structuralCorrections = await runStructuralReview(
          markdownForRender,
          doc.target_language,
          resolvedSourceLang ?? 'auto',
        );
        if (structuralCorrections.length > 0) {
          console.log(`${tag} [structural-review] applying ${structuralCorrections.length} correction(s): ${structuralCorrections.map(c => `"${c.original}"→"${c.corrected}"`).join(', ')}`);
          markdownForRender = applyStructuralCorrections(markdownForRender, structuralCorrections);
        } else {
          console.log(`${tag} [structural-review] no corrections needed`);
        }
      } catch (reviewErr) {
        console.warn(`${tag} [structural-review] failed (advisory, continuing):`, reviewErr instanceof Error ? reviewErr.message : reviewErr);
      }

      // Visual block already baked into markdownForRender — pass empty array to renderers
      // so ensureVisualElementsBlock finds the heading and skips adding another block.
      const docxBuf = await renderToDocx(markdownForRender, renderMeta, []);
      const draftDocxKey = `${baseKey}/translator_draft.docx`;
      await uploadFile(draftDocxKey, docxBuf, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      console.log(`${tag} DOCX draft uploaded (${docxBuf.length} bytes) → ${draftDocxKey}`);

      // Generate preview PDF (wrap in try/catch — not critical for the workflow)
      let previewPdfKey: string | undefined;
      // Hoist qaReport so it can be persisted even if PDF generation fails
      let savedQaReport: Record<string, unknown> | null = null;
      try {
        const html = await renderToHtml(markdownForRender, renderMeta, []);

        // Run QA checks
        const qaReport = runQaChecks(html, plan.mode, pageCount);
        savedQaReport = qaReport as unknown as Record<string, unknown>;
        console.log(`${tag} QA report:`, JSON.stringify(qaReport));
        if (qaReport.warnings.length > 0) {
          console.warn(`${tag} QA warnings:`, qaReport.warnings);
        }

        const pdfBuf = await generatePdfFromHtml(html);
        previewPdfKey = `${baseKey}/preview.pdf`;
        await uploadFile(previewPdfKey, pdfBuf, 'application/pdf');
        console.log(`${tag} preview PDF uploaded (${pdfBuf.length} bytes) → ${previewPdfKey}`);
      } catch (previewErr) {
        const msg = previewErr instanceof Error ? previewErr.message : String(previewErr);
        console.error(`${tag} preview PDF generation failed (non-fatal): ${msg}`);
      }

      // Upsert translation record with DOCX key as primary artifact + preview PDF key + qa_report
      // NOTE: translated_docx_key, translated_preview_pdf_key, qa_report columns require
      // supabase/migrations/add_official_workflow_fields.sql to be applied in Supabase first.
      await updateJob(jobId, 'pdf_rendering', 90, undefined, { workflow_status: 'awaiting_translator_review' });

      const { data: existing } = await supabase
        .from('translations')
        .select('id')
        .eq('job_id', jobId)
        .maybeSingle();

      // Merge source warnings into QA report so translators can see them
      const mergedQaReport = savedQaReport
        ? { ...savedQaReport, sourceWarnings: sourceWarnings.map(w => ({ code: w.code, message: w.message })) }
        : (sourceWarnings.length > 0 ? { sourceWarnings: sourceWarnings.map(w => ({ code: w.code, message: w.message })) } : null);

      if (existing) {
        await supabase
          .from('translations')
          .update({
            // translated_pdf_key holds a real PDF only — preview PDF or null
            translated_pdf_key: previewPdfKey ?? null,
            translated_docx_key: draftDocxKey,
            translated_preview_pdf_key: previewPdfKey ?? null,
            qa_report: mergedQaReport,
            ...(translatedAst ? { translated_ast: translatedAst } : {}),
          })
          .eq('id', existing.id);
      } else {
        await supabase.from('translations').insert({
          job_id: jobId,
          translated_markdown: markdownForRender,
          translated_pdf_key: previewPdfKey ?? null,
          translated_docx_key: draftDocxKey,
          translated_preview_pdf_key: previewPdfKey ?? null,
          qa_report: mergedQaReport,
          ...(translatedAst ? { translated_ast: translatedAst } : {}),
        });
      }

      // Use 'in_review' (not 'completed') so the dashboard does not show a download button.
      // documents.status is set to 'completed' only when the operator fires READY_FOR_DELIVERY.
      await supabase.from('documents').update({ status: 'in_review' }).eq('id', documentId);
      await updateJob(jobId, 'completed', 100, undefined, { workflow_status: 'awaiting_translator_review' });

      console.log(
        `${tag} ✓ completed [${plan.mode}] ` +
        `docx=${docxBuf.length}B ` +
        `warnings=${sourceWarnings.length > 0 ? sourceWarnings.map(w => w.code).join(',') : 'none'}`,
      );

      // Upload AI draft to Drive 02_AI_DRAFT and notify translator.
      // Jira Automation handles assignment/transitions on the Jira side.
      try {
        await triggerTranslatorReview({
          jobId,
          jiraIssueKey: integrationResult.jiraIssueKey,
          serviceLevel: resolvedServiceLevel as ServiceLevel,
          sourceLang: doc.source_language,
          targetLang: doc.target_language,
          documentType: docType,
          driveUrl: integrationResult.driveUrl,
          driveFolderId: integrationResult.driveFolderId,
          draftFileKey: draftDocxKey,
          draftFileName: 'ai_draft.docx',
          previewFileKey: previewPdfKey ?? null,
        });
      } catch (e) {
        const m = e instanceof Error ? e.message : String(e);
        console.error(`${tag} triggerTranslatorReview failed (non-fatal): ${m}`);
      }

      // Send review email (no download URL for the draft)
      if (env.RESEND_API_KEY) {
        try {
          const { data: authUser } = await supabase.auth.admin.getUserById(doc.user_id);
          const userEmail = authUser.user?.email;
          if (userEmail) {
            await sendDocumentReceivedForReview({ to: userEmail, filename: doc.filename });
            console.log(`${tag} review email sent to ${userEmail}`);
          }
        } catch (emailErr) {
          const msg = emailErr instanceof Error ? emailErr.message : String(emailErr);
          console.error(`${tag} review email send failed (non-fatal): ${msg}`);
        }
      }

      return;
    }

    // ── 4b. Normal mode (translation_only) ───────────────────────────────────
    let translatedKey: string;
    let contentType: string;
    let html: string | undefined;

    if (outputFormat === 'docx') {
      console.log(`${tag} generating DOCX…`);
      const docxBuf = await renderToDocx(translatedMarkdown, renderMeta, allVisualElements);
      translatedKey = `${baseKey}/translated.docx`;
      await uploadFile(translatedKey, docxBuf, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      contentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      console.log(`${tag} DOCX uploaded (${docxBuf.length} bytes) → ${translatedKey}`);
    } else if (outputFormat === 'html') {
      console.log(`${tag} generating HTML…`);
      html = await renderToHtml(translatedMarkdown, renderMeta, allVisualElements);
      translatedKey = `${baseKey}/translated.html`;
      await uploadFile(translatedKey, Buffer.from(html, 'utf-8'), 'text/html; charset=utf-8');
      contentType = 'text/html';
      console.log(`${tag} HTML uploaded → ${translatedKey}`);
    } else {
      // pdf (default) — HTML → Puppeteer → PDF
      html = await renderToHtml(translatedMarkdown, renderMeta, allVisualElements);

      // Run QA checks for normal mode
      const qaReport = runQaChecks(html, plan.mode, pageCount);
      if (!qaReport.ok) {
        console.warn(`${tag} QA checks failed (non-fatal for translation_only):`, qaReport.errors);
      }
      if (qaReport.warnings.length > 0) {
        console.warn(`${tag} QA warnings:`, qaReport.warnings);
      }

      try {
        console.log(`${tag} generating PDF via Puppeteer…`);
        const pdfBuf = await generatePdfFromHtml(html);
        translatedKey = `${baseKey}/translated.pdf`;
        await uploadFile(translatedKey, pdfBuf, 'application/pdf');
        contentType = 'application/pdf';
        console.log(`${tag} PDF uploaded (${pdfBuf.length} bytes) → ${translatedKey}`);
      } catch (pdfErr) {
        const msg = pdfErr instanceof Error ? pdfErr.message : String(pdfErr);
        console.error(`${tag} PDF generation failed (${msg}), falling back to HTML`);
        translatedKey = `${baseKey}/translated.html`;
        await uploadFile(translatedKey, Buffer.from(html, 'utf-8'), 'text/html; charset=utf-8');
        contentType = 'text/html';
      }
    }

    // ── 5. Persist translation record ────────────────────────────────────────
    await updateJob(jobId, 'pdf_rendering', 90);

    const { data: existing } = await supabase
      .from('translations')
      .select('id')
      .eq('job_id', jobId)
      .maybeSingle();

    if (existing) {
      await supabase
        .from('translations')
        .update({
          translated_pdf_key: translatedKey,
          ...(translatedAst ? { translated_ast: translatedAst } : {}),
        })
        .eq('id', existing.id);
    } else {
      await supabase.from('translations').insert({
        job_id: jobId,
        translated_markdown: translatedMarkdown,
        translated_pdf_key: translatedKey,
        ...(translatedAst ? { translated_ast: translatedAst } : {}),
      });
    }

    // ── 6. Mark done ─────────────────────────────────────────────────────────
    await supabase
      .from('documents')
      .update({ status: 'completed' })
      .eq('id', documentId);

    await updateJob(jobId, 'completed', 100);

    console.log(`${tag} ✓ completed (${contentType})`);

    // ── 7. Send email notification ───────────────────────────────────────────
    if (env.RESEND_API_KEY) {
      try {
        const { data: authUser } = await supabase.auth.admin.getUserById(doc.user_id);
        const userEmail = authUser.user?.email;

        if (userEmail) {
          const downloadUrl = await getPresignedUrl(translatedKey, 7 * 24 * 3600);
          await sendTranslationReady({
            to: userEmail,
            filename: doc.filename,
            downloadUrl,
            targetLanguage: doc.target_language,
          });
          console.log(`${tag} email sent to ${userEmail}`);
        } else {
          console.warn(`${tag} no email found for user ${doc.user_id}, skipping email`);
        }
      } catch (emailErr) {
        const msg = emailErr instanceof Error ? emailErr.message : String(emailErr);
        console.error(`${tag} email send failed (non-fatal): ${msg}`);
      }
    } else {
      console.log(`${tag} RESEND_API_KEY not set — skipping email notification`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`${tag} ✗ failed:`, message);
    await updateJob(jobId, 'failed', 0, message);
    await supabase
      .from('documents')
      .update({ status: 'failed' })
      .eq('id', documentId);
  }
}
