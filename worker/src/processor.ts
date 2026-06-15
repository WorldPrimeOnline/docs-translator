import { supabase, type JobRow, type DocumentRow } from './lib/supabase';
import { downloadFile, uploadFile, getPresignedUrl } from './lib/r2';
import { extractTextFromPdf } from './lib/ocr';
import { translateDocument } from './lib/translator';
import { detectSourceLanguage } from './lib/detect-language';
import { renderToHtml } from './lib/renderer';
import { generatePdfFromHtml } from './lib/pdf';
import { renderToDocx } from './lib/docx-renderer';
import { sendTranslationReady, sendDocumentReceivedForReview } from './lib/email';
import { computeOutputPlan, type ServiceLevel } from './lib/output-plan';
import { mergeVisualElements, extractVisualElementsFromTranslated } from './lib/visual-elements';
import { runQaChecks } from './lib/qa';
import { env } from './lib/env';
import { initializeOrderIntegrations, triggerTranslatorReview } from './lib/integrations';

type JobStatus = JobRow['status'];
type OutputFormat = 'html' | 'pdf' | 'docx';

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

    // OCR quality check — abort early rather than waste translation credits
    const ocrWordCount = markdown.trim().split(/\s+/).filter(Boolean).length;
    const ocrCharCount = markdown.length;

    if (ocrWordCount < 10 || ocrCharCount < 50) {
      console.error(`${tag} OCR quality too low — ${ocrWordCount} words, ${ocrCharCount} chars`);
      await updateJob(jobId, 'failed', 0,
        'Document quality too low. Please upload a clearer scan with better lighting and resolution.');
      await supabase.from('documents').update({ status: 'failed' }).eq('id', documentId);
      return;
    }

    const nonLatinRatio = (markdown.match(/[^\x00-\x7FЀ-ӿ一-鿿]/g) ?? []).length / ocrCharCount;
    if (nonLatinRatio > 0.3) {
      console.error(`${tag} OCR junk ratio too high — ${(nonLatinRatio * 100).toFixed(1)}%`);
      await updateJob(jobId, 'failed', 0,
        'Document appears to be a low-quality scan. Please upload a higher resolution image.');
      await supabase.from('documents').update({ status: 'failed' }).eq('id', documentId);
      return;
    }

    await updateJob(jobId, 'ocr_completed', 40);

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

    const { docType, outputFormat } = parseDocumentType(doc.document_type);

    const translatedMarkdown = await translateDocument(
      markdown,
      resolvedSourceLang,
      doc.target_language,
      docType,
    );
    console.log(`${tag} translation done — ${translatedMarkdown.length} chars, format: ${outputFormat}`);

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

      // Generate DOCX draft
      const docxBuf = await renderToDocx(translatedMarkdown, renderMeta, allVisualElements);
      const draftDocxKey = `${baseKey}/translator_draft.docx`;
      await uploadFile(draftDocxKey, docxBuf, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      console.log(`${tag} DOCX draft uploaded (${docxBuf.length} bytes) → ${draftDocxKey}`);

      // Generate preview PDF (wrap in try/catch — not critical for the workflow)
      let previewPdfKey: string | undefined;
      // Hoist qaReport so it can be persisted even if PDF generation fails
      let savedQaReport: Record<string, unknown> | null = null;
      try {
        const html = await renderToHtml(translatedMarkdown, renderMeta, allVisualElements);

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

      if (existing) {
        await supabase
          .from('translations')
          .update({
            translated_pdf_key: draftDocxKey,
            translated_docx_key: draftDocxKey,
            translated_preview_pdf_key: previewPdfKey ?? null,
            qa_report: savedQaReport,
          })
          .eq('id', existing.id);
      } else {
        await supabase.from('translations').insert({
          job_id: jobId,
          translated_markdown: translatedMarkdown,
          translated_pdf_key: draftDocxKey,
          translated_docx_key: draftDocxKey,
          translated_preview_pdf_key: previewPdfKey ?? null,
          qa_report: savedQaReport,
        });
      }

      // Use 'in_review' (not 'completed') so the dashboard does not show a download button.
      // documents.status is set to 'completed' only when the operator fires READY_FOR_DELIVERY.
      await supabase.from('documents').update({ status: 'in_review' }).eq('id', documentId);
      await updateJob(jobId, 'completed', 100, undefined, { workflow_status: 'awaiting_translator_review' });

      console.log(`${tag} ✓ completed [${plan.mode}] — awaiting human review`);

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
        .update({ translated_pdf_key: translatedKey })
        .eq('id', existing.id);
    } else {
      await supabase.from('translations').insert({
        job_id: jobId,
        translated_markdown: translatedMarkdown,
        translated_pdf_key: translatedKey,
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
