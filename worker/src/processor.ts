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
import { mergeVisualElements, extractVisualElementsFromTranslated, filterPrintedVerificationStrings, type VisualElement } from './lib/visual-elements';
import { analyzeDocumentVisuals } from './lib/page-vision';
import { runQaChecks } from './lib/qa';
import { env } from './lib/env';
import { initializeOrderIntegrations, triggerTranslatorReview, createFinanceReportIssue } from './lib/integrations';
import { uploadFileToDrive, isDriveConfigured } from './lib/google-drive';
import { upsertJobResultFile, type JobResultFileStage } from './lib/job-result-files';
import { sourceDriveFilename, aiDraftDriveFilename } from './lib/drive-naming';

type JobStatus = JobRow['status'];
type OutputFormat = 'html' | 'pdf' | 'docx';

interface JobSourceFileRow {
  id: string;
  job_id: string;
  sequence: number;
  original_filename: string;
  r2_key: string;
  content_sha256: string;
  mime_type: string;
  physical_page_count: number | null;
  converted_pdf_r2_key: string | null;
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
 *
 * 2026-08-01 multi-file fulfillment decision: a job with one or more job_source_files
 * rows (created by convertDraftToOrder/createCardOrder/the legacy upload-card route)
 * is processed per-source (see processMultiSourceJob) instead of once on the merged
 * bundle. A job with ZERO job_source_files rows (any job created before this feature,
 * or a dashboard-upload-card job outside this fix's scope) keeps running the exact
 * legacy single-file path (processLegacySingleFile) — byte-for-byte unchanged from
 * before this decision, so nothing about existing jobs' behavior changes.
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

    // job_source_files (migration 0063) isn't in the generated Database types yet.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: sourceRowsRaw } = await (supabase as any)
      .from('job_source_files')
      .select('*')
      .eq('job_id', jobId)
      .order('sequence', { ascending: true });
    const sourceRows = (sourceRowsRaw ?? []) as JobSourceFileRow[];

    if (sourceRows.length === 0) {
      await processLegacySingleFile(jobId, documentId, doc, jobRow, tag);
      return;
    }

    await processMultiSourceJob(jobId, documentId, doc, jobRow, sourceRows, tag);
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

/**
 * The exact pipeline that has always run for every job — unchanged by the 2026-08-01
 * multi-file fulfillment decision. Only reached for jobs with zero job_source_files
 * rows (everything created before that decision, or dashboard-upload-card jobs which
 * are explicitly out of that fix's scope).
 */
async function processLegacySingleFile(
  jobId: string,
  documentId: string,
  doc: DocumentRow,
  jobRow: JobRow | null | undefined,
  tag: string,
): Promise<void> {
  // Prefer service_level column; fall back to legacy notarized boolean for old rows
  const resolvedServiceLevel = jobRow?.service_level ?? (jobRow?.notarized ? 'notarization_through_partners' : 'electronic');
  const plan = computeOutputPlan(resolvedServiceLevel);

  const serviceLevel = resolvedServiceLevel;

  // ── 1b. Integration init (all orders) ──────────────────────────────────
  // Drive folder + source.pdf upload run for every order (electronic included).
  // Jira issue creation is restricted to certified/notarized inside initializeOrderIntegrations.
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

  try {
    integrationResult = await initializeOrderIntegrations({
      jobId,
      serviceLevel: resolvedServiceLevel as typeof serviceLevel,
      sourceLang: doc.source_language,
      targetLang: doc.target_language,
      documentType: doc.document_type,
      notaryCity: jobRow?.notary_city ?? null,
      applicantType: jobRow?.applicant_type ?? null,
      fulfillmentMethod: jobRow?.fulfillment_method ?? null,
      deliveryPhone: jobRow?.delivery_phone ?? null,
      deliveryAddress: jobRow?.delivery_address ?? null,
      paymentSource: jobRow?.payment_source ?? null,
      customerId: doc.user_id,
      sourceFileKey: doc.file_key,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      customerComment: (jobRow as any)?.customer_comment ?? null,
    });
  } catch (initErr) {
    const initMsg = initErr instanceof Error ? initErr.message : String(initErr);
    console.error(`${tag} integration init failed (non-fatal, continuing with OCR): ${initMsg}`);
  }

  // ── 2. OCR ───────────────────────────────────────────────────────────────
  await updateJob(jobId, 'ocr_in_progress', 10);
  console.log(`${tag} downloading PDF from R2…`);
  const pdfBuffer = await downloadFile(doc.file_key);

  console.log(`${tag} running OCR…`);
  const {
    markdown,
    pageCount,
    visualElements: ocrVisualElements,
    rawPages,
  } = await extractTextFromPdf(pdfBuffer);
  console.log(`${tag} OCR done — ${pageCount} pages, ${markdown.length} chars`);
  console.log(`${tag} [vis:ocr] count=${ocrVisualElements.length} kinds=${JSON.stringify(ocrVisualElements.map((e) => e.kind))}`);

  // Page-level vision analysis — primary source for visual inventory
  let pageVisionElements: VisualElement[] = [];
  try {
    pageVisionElements = await analyzeDocumentVisuals(rawPages, pdfBuffer, doc.target_language);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`${tag} page-vision analysis failed (non-fatal): ${msg}`);
  }
  console.log(`${tag} [vis:page-vision] count=${pageVisionElements.length} kinds=${JSON.stringify(pageVisionElements.map((e) => e.kind))}`);

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

  // Build visual inventory: page-vision is primary, markdown markers are fallback
  let allVisualElements: VisualElement[];

  if (pageVisionElements.length > 0) {
    // Primary path: detected directly from source page images
    allVisualElements = pageVisionElements;
    console.log(
      `${tag} [vis:renderer] count=${allVisualElements.length} source=page-vision` +
      ` kinds=${JSON.stringify(allVisualElements.map((e) => e.kind))}`,
    );
  } else {
    // Fallback: bracket markers from translated text (used when page images unavailable)
    const translatedVisualElements = extractVisualElementsFromTranslated(translatedMarkdown);
    console.log(`${tag} [vis:translated] count=${translatedVisualElements.length} kinds=${JSON.stringify(translatedVisualElements.map((e) => e.kind))}`);
    const mergedVisualElements = mergeVisualElements(ocrVisualElements, translatedVisualElements);
    allVisualElements = filterPrintedVerificationStrings(mergedVisualElements);
    console.log(
      `${tag} [vis:renderer] count=${allVisualElements.length} source=fallback-markdown` +
      ` kinds=${JSON.stringify(allVisualElements.map((e) => e.kind))}`,
    );
  }

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
        aiDraftFolderId: integrationResult.aiDraftFolderId,
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

  if (outputFormat === 'html') {
    console.log(`${tag} generating HTML…`);
    html = await renderToHtml(translatedMarkdown, renderMeta, allVisualElements);
    translatedKey = `${baseKey}/translated.html`;
    await uploadFile(translatedKey, Buffer.from(html, 'utf-8'), 'text/html; charset=utf-8');
    contentType = 'text/html';
    console.log(`${tag} HTML uploaded → ${translatedKey}`);
  } else {
    // Electronic translation client output policy: DOCX + HTML only, never
    // PDF — see docs/ai-context/40_TRANSLATION_PIPELINE.md "Electronic
    // output policy". This branch previously defaulted to a Puppeteer PDF;
    // 'docx' requests and any legacy/unrecognized outputFormat (including
    // old '|pdf'-suffixed document_type rows already in the queue) now both
    // land here as DOCX. generatePdfFromHtml() / Puppeteer is untouched —
    // it is still used for the official/notarized preview PDF in branch 4a
    // above, which is an internal reviewer artifact, not a client deliverable.
    console.log(`${tag} generating DOCX…`);
    const docxBuf = await renderToDocx(translatedMarkdown, renderMeta, allVisualElements);
    translatedKey = `${baseKey}/translated.docx`;
    await uploadFile(translatedKey, docxBuf, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    contentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    console.log(`${tag} DOCX uploaded (${docxBuf.length} bytes) → ${translatedKey}`);
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

  // ── 6b. Finance report Jira issue (non-blocking) ─────────────────────────
  const jiraKey = integrationResult.jiraIssueKey;
  if (jiraKey) {
    void (async () => {
      try {
        const { data: quoteData } = await supabase
          .from('price_quotes' as never)
          .select('id, pricing_context_json, amount_kzt')
          .eq('job_id', jobId)
          .eq('status', 'paid')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle() as { data: Record<string, unknown> | null };

        const { data: txData } = await supabase
          .from('payment_transactions' as never)
          .select('id, amount, status')
          .eq('job_id', jobId)
          .eq('status', 'paid')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle() as { data: Record<string, unknown> | null };

        await createFinanceReportIssue({
          jobId,
          mainIssueKey: jiraKey,
          pricingSnapshot: (quoteData?.pricing_context_json as Record<string, unknown>) ?? null,
          quoteId: (quoteData?.id as string) ?? null,
          serviceLevel: ((jobRow as unknown) as Record<string, unknown>)?.service_level as string ?? '',
          sourceLanguage: doc.source_language,
          targetLanguage: doc.target_language,
          documentType: doc.document_type,
          paymentTransactionId: (txData?.id as string) ?? null,
          paymentAmountKzt: (txData?.amount as number) ?? null,
          paymentStatus: (txData?.status as string) ?? null,
          fiscalStatus: null,
          fiscalReceiptId: null,
          customerComment: ((jobRow as unknown) as Record<string, unknown>)?.customer_comment as string ?? null,
        });
      } catch (finErr) {
        console.error(`${tag} createFinanceReportIssue failed (non-fatal):`, finErr instanceof Error ? finErr.message : String(finErr));
      }
    })();
  }

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
}

interface PerSourceOcrTranslateResult {
  translatedMarkdown: string;
  pageCount: number;
  allVisualElements: VisualElement[];
}

type PerSourceOcrOutcome =
  | { ok: true; value: PerSourceOcrTranslateResult }
  | { ok: false; reason: string };

/**
 * OCR + language detection + translation + visual-inventory for ONE source file — the
 * same steps 2-4 (pre-render) processLegacySingleFile runs on the merged bundle, run
 * here per job_source_files row instead. Deliberately NOT shared code with the legacy
 * function (copy-adapted, not extracted) — the legacy path must stay byte-for-byte
 * unchanged, and a shared helper would risk a subtle behavior change leaking into it.
 */
async function ocrTranslateOneSource(
  pdfBuffer: Buffer,
  sourceLang: string,
  targetLang: string,
  docType: string,
  documentId: string,
  srcTag: string,
): Promise<PerSourceOcrOutcome> {
  console.log(`${srcTag} running OCR…`);
  const { markdown, pageCount, visualElements: ocrVisualElements, rawPages } = await extractTextFromPdf(pdfBuffer);
  console.log(`${srcTag} OCR done — ${pageCount} pages, ${markdown.length} chars`);

  let pageVisionElements: VisualElement[] = [];
  try {
    pageVisionElements = await analyzeDocumentVisuals(rawPages, pdfBuffer, targetLang);
  } catch (err) {
    console.warn(`${srcTag} page-vision analysis failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
  }

  const ocrWordCount = markdown.trim().split(/\s+/).filter(Boolean).length;
  const ocrCharCount = markdown.length;
  if (ocrWordCount < 10 || ocrCharCount < 50) {
    return { ok: false, reason: 'Document quality too low. Please upload a clearer scan with better lighting and resolution.' };
  }
  const nonLatinRatio = (markdown.match(/[^\x00-\x7FЀ-ӿ一-鿿]/g) ?? []).length / ocrCharCount;
  if (nonLatinRatio > 0.3) {
    return { ok: false, reason: 'Document appears to be a low-quality scan. Please upload a higher resolution image.' };
  }

  let resolvedSourceLang = sourceLang;
  if (sourceLang === 'auto') {
    const detected = await detectSourceLanguage(markdown);
    if (detected) {
      resolvedSourceLang = detected;
      // Best-effort — documents is one row per job, so only the first source to detect
      // wins; later sources' detection still uses their own `detected` value locally.
      await supabase.from('documents').update({ detected_source_language: detected }).eq('id', documentId);
    }
  }

  console.log(`${srcTag} translating ${resolvedSourceLang} → ${targetLang}…`);
  const translatedMarkdown = await translateDocument(markdown, resolvedSourceLang, targetLang, docType);

  let allVisualElements: VisualElement[];
  if (pageVisionElements.length > 0) {
    allVisualElements = pageVisionElements;
  } else {
    const translatedVisualElements = extractVisualElementsFromTranslated(translatedMarkdown);
    const mergedVisualElements = mergeVisualElements(ocrVisualElements, translatedVisualElements);
    allVisualElements = filterPrintedVerificationStrings(mergedVisualElements);
  }

  return { ok: true, value: { translatedMarkdown, pageCount, allVisualElements } };
}

/**
 * 2026-08-01 multi-file fulfillment decision: OCR/translate/render each source
 * independently (never the merged bundle), upload per-source artifacts to Drive with
 * NNN-prefixed naming, and record job_result_files rows via the idempotent upsert
 * helper. Fails the whole job on any source's failure — no partial-success job state.
 *
 * Explicitly NOT done here (queued for follow-up, per the user's own sequencing):
 * the Drive read-back sync for translator_result/signature_stamp/notary (that Drive
 * capability doesn't exist yet), and the customer download route rewrite to serve
 * job_result_files instead of `translations`. Electronic multi-source jobs are marked
 * completed here with their final artifacts in job_result_files, but the CURRENT
 * download route still reads `translations` (empty for these jobs) — do not enable
 * multi-file upload flows for real customers until that route is rewritten.
 */
async function processMultiSourceJob(
  jobId: string,
  documentId: string,
  doc: DocumentRow,
  jobRow: JobRow | null | undefined,
  sourceRows: JobSourceFileRow[],
  tag: string,
): Promise<void> {
  const resolvedServiceLevel = jobRow?.service_level ?? (jobRow?.notarized ? 'notarization_through_partners' : 'electronic');
  const plan = computeOutputPlan(resolvedServiceLevel);
  const serviceLevel = resolvedServiceLevel;
  const { docType, outputFormat } = parseDocumentType(doc.document_type);

  console.log(`${tag} multi-source job — ${sourceRows.length} source file(s), mode=${plan.mode}`);

  let integrationResult = {
    jiraIssueKey: jobRow?.jira_issue_key ?? null,
    jiraIssueUrl: jobRow?.jira_issue_url ?? null,
    driveFolderId: jobRow?.google_drive_folder_id ?? null,
    driveUrl: jobRow?.google_drive_folder_url ?? null,
    aiDraftFolderId: null as string | null,
    sourceFolderId: null as string | null,
  };

  try {
    integrationResult = await initializeOrderIntegrations({
      jobId,
      serviceLevel: resolvedServiceLevel as ServiceLevel,
      sourceLang: doc.source_language,
      targetLang: doc.target_language,
      documentType: doc.document_type,
      notaryCity: jobRow?.notary_city ?? null,
      applicantType: jobRow?.applicant_type ?? null,
      fulfillmentMethod: jobRow?.fulfillment_method ?? null,
      deliveryPhone: jobRow?.delivery_phone ?? null,
      deliveryAddress: jobRow?.delivery_address ?? null,
      paymentSource: jobRow?.payment_source ?? null,
      customerId: doc.user_id,
      sourceFileKey: doc.file_key,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      customerComment: (jobRow as any)?.customer_comment ?? null,
      skipMergedSourceUpload: true,
    });
  } catch (initErr) {
    console.error(`${tag} integration init failed (non-fatal, continuing with OCR): ${initErr instanceof Error ? initErr.message : String(initErr)}`);
  }

  // Upload each REAL source to 01_SOURCE/NNN_<original> — replaces the single
  // hardcoded source.pdf upload that initializeOrderIntegrations skipped above.
  if (integrationResult.sourceFolderId && isDriveConfigured()) {
    for (const src of sourceRows) {
      try {
        const buf = await downloadFile(src.r2_key);
        await uploadFileToDrive(integrationResult.sourceFolderId, sourceDriveFilename(src.sequence, src.original_filename), buf, src.mime_type);
      } catch (err) {
        console.error(`${tag}[src:${src.sequence}] source Drive upload failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  await updateJob(jobId, 'ocr_in_progress', 10);

  const translatedAt = new Date().toISOString().split('T')[0] ?? new Date().toISOString();
  const baseKey = `documents/${doc.user_id}/${documentId}`;
  const isOfficialOrNotary = plan.mode === 'translator_review_draft' || plan.mode === 'notarization_package';

  let progress = 10;
  const progressStep = 60 / sourceRows.length; // spans ocr_in_progress(10) through pdf_rendering-ish(70)

  for (const src of sourceRows) {
    const srcTag = `${tag}[src:${src.sequence}]`;
    console.log(`${srcTag} processing "${src.original_filename}"`);

    const pdfKey = src.converted_pdf_r2_key ?? src.r2_key;
    const pdfBuffer = await downloadFile(pdfKey);

    const ocrResult = await ocrTranslateOneSource(pdfBuffer, doc.source_language, doc.target_language, docType, documentId, srcTag);
    if (!ocrResult.ok) {
      console.error(`${srcTag} OCR quality check failed: ${ocrResult.reason}`);
      await updateJob(jobId, 'failed', 0, ocrResult.reason);
      await supabase.from('documents').update({ status: 'failed' }).eq('id', documentId);
      return;
    }
    const { translatedMarkdown, pageCount, allVisualElements } = ocrResult.value;

    await supabase.from('ocr_results').insert({
      job_id: jobId,
      markdown: translatedMarkdown,
      page_count: pageCount,
      provider: 'mistral',
    });

    const renderMeta = {
      sourceLang: doc.source_language,
      targetLang: doc.target_language,
      documentType: docType,
      translatedAt,
      filename: src.original_filename,
      serviceLevel,
      outputMode: plan.mode,
    };

    if (isOfficialOrNotary) {
      // ── AI draft per source — NEVER the customer-facing final for Official/Notary. ──
      const docxBuf = await renderToDocx(translatedMarkdown, renderMeta, allVisualElements);
      const draftKey = `${baseKey}/sources/${String(src.sequence).padStart(3, '0')}/ai_draft.docx`;
      await uploadFile(draftKey, docxBuf, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      console.log(`${srcTag} AI draft uploaded (${docxBuf.length} bytes) → ${draftKey}`);

      if (integrationResult.aiDraftFolderId && isDriveConfigured()) {
        try {
          await uploadFileToDrive(integrationResult.aiDraftFolderId, aiDraftDriveFilename(src.sequence, src.original_filename), docxBuf, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        } catch (err) {
          console.error(`${srcTag} AI draft Drive upload failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      const upsertResult = await upsertJobResultFile({
        jobId,
        stage: 'ai_draft',
        sourceSequences: [src.sequence],
        filename: aiDraftDriveFilename(src.sequence, src.original_filename),
        status: 'ready',
        r2Key: draftKey,
      });
      if (!upsertResult.ok) {
        console.error(`${srcTag} job_result_files upsert failed (non-fatal, ai_draft still uploaded): ${upsertResult.error}`);
      }
    } else {
      // ── Electronic: the automatic render IS the final deliverable — never ai_draft. ──
      let resultKey: string;
      let stage: JobResultFileStage;
      let filename: string;
      const base = src.original_filename.replace(/\.[^./]+$/, '');

      if (outputFormat === 'html') {
        const html = await renderToHtml(translatedMarkdown, renderMeta, allVisualElements);
        resultKey = `${baseKey}/sources/${String(src.sequence).padStart(3, '0')}/translated.html`;
        await uploadFile(resultKey, Buffer.from(html, 'utf-8'), 'text/html; charset=utf-8');
        stage = 'electronic_final_html';
        filename = `${base}_translated.html`;
      } else {
        const docxBuf = await renderToDocx(translatedMarkdown, renderMeta, allVisualElements);
        resultKey = `${baseKey}/sources/${String(src.sequence).padStart(3, '0')}/translated.docx`;
        await uploadFile(resultKey, docxBuf, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        stage = 'electronic_final_docx';
        filename = `${base}_translated.docx`;
      }
      console.log(`${srcTag} electronic final uploaded → ${resultKey}`);

      const upsertResult = await upsertJobResultFile({
        jobId,
        stage,
        sourceSequences: [src.sequence],
        filename,
        status: 'ready',
        r2Key: resultKey,
      });
      if (!upsertResult.ok) {
        console.error(`${srcTag} job_result_files upsert failed (non-fatal, final file still uploaded): ${upsertResult.error}`);
      }
    }

    progress = Math.min(70, progress + progressStep);
    await updateJob(jobId, isOfficialOrNotary ? 'pdf_rendering' : 'translation_in_progress', Math.round(progress));
  }

  if (isOfficialOrNotary) {
    await updateJob(jobId, 'pdf_rendering', 90, undefined, { workflow_status: 'awaiting_translator_review' });
    await supabase.from('documents').update({ status: 'in_review' }).eq('id', documentId);
    await updateJob(jobId, 'completed', 100, undefined, { workflow_status: 'awaiting_translator_review' });
    console.log(`${tag} ✓ completed [${plan.mode}, ${sourceRows.length} source(s)] — awaiting human review`);

    // Per-source drafts are already uploaded above — this call only handles the
    // Supabase status update + Telegram notify (Jira Automation drives the rest).
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
        aiDraftFolderId: integrationResult.aiDraftFolderId,
      });
    } catch (e) {
      console.error(`${tag} triggerTranslatorReview failed (non-fatal): ${e instanceof Error ? e.message : String(e)}`);
    }

    if (env.RESEND_API_KEY) {
      try {
        const { data: authUser } = await supabase.auth.admin.getUserById(doc.user_id);
        const userEmail = authUser.user?.email;
        if (userEmail) {
          await sendDocumentReceivedForReview({ to: userEmail, filename: doc.filename });
        }
      } catch (emailErr) {
        console.error(`${tag} review email send failed (non-fatal): ${emailErr instanceof Error ? emailErr.message : String(emailErr)}`);
      }
    }
    return;
  }

  // ── Electronic: mark done. NOTE: the customer download route has not been
  // rewritten yet to serve job_result_files — do not point real customers at this
  // path until that lands. ──
  await supabase.from('documents').update({ status: 'completed' }).eq('id', documentId);
  await updateJob(jobId, 'completed', 100);
  console.log(`${tag} ✓ completed [electronic, ${sourceRows.length} source(s)]`);

  const jiraKey = integrationResult.jiraIssueKey;
  if (jiraKey) {
    void (async () => {
      try {
        const { data: quoteData } = await supabase
          .from('price_quotes' as never)
          .select('id, pricing_context_json, amount_kzt')
          .eq('job_id', jobId)
          .eq('status', 'paid')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle() as { data: Record<string, unknown> | null };

        const { data: txData } = await supabase
          .from('payment_transactions' as never)
          .select('id, amount, status')
          .eq('job_id', jobId)
          .eq('status', 'paid')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle() as { data: Record<string, unknown> | null };

        await createFinanceReportIssue({
          jobId,
          mainIssueKey: jiraKey,
          pricingSnapshot: (quoteData?.pricing_context_json as Record<string, unknown>) ?? null,
          quoteId: (quoteData?.id as string) ?? null,
          serviceLevel: ((jobRow as unknown) as Record<string, unknown>)?.service_level as string ?? '',
          sourceLanguage: doc.source_language,
          targetLanguage: doc.target_language,
          documentType: doc.document_type,
          paymentTransactionId: (txData?.id as string) ?? null,
          paymentAmountKzt: (txData?.amount as number) ?? null,
          paymentStatus: (txData?.status as string) ?? null,
          fiscalStatus: null,
          fiscalReceiptId: null,
          customerComment: ((jobRow as unknown) as Record<string, unknown>)?.customer_comment as string ?? null,
        });
      } catch (finErr) {
        console.error(`${tag} createFinanceReportIssue failed (non-fatal):`, finErr instanceof Error ? finErr.message : String(finErr));
      }
    })();
  }

  if (env.RESEND_API_KEY) {
    try {
      const { data: authUser } = await supabase.auth.admin.getUserById(doc.user_id);
      const userEmail = authUser.user?.email;
      if (userEmail) {
        // Multi-file jobs have N final artifacts, not one — link to the dashboard
        // rather than a single presigned file URL (the download route serves the
        // real files once its multi-file rewrite lands).
        const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? process.env.SITE_URL ?? 'https://wpotranslations.org';
        await sendTranslationReady({
          to: userEmail,
          filename: doc.filename,
          downloadUrl: `${siteUrl}/dashboard`,
          targetLanguage: doc.target_language,
        });
      }
    } catch (emailErr) {
      console.error(`${tag} email send failed (non-fatal): ${emailErr instanceof Error ? emailErr.message : String(emailErr)}`);
    }
  }
}
