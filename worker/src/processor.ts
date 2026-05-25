import { supabase, type JobRow, type DocumentRow } from './lib/supabase';
import { downloadFile, uploadFile, getPresignedUrl } from './lib/r2';
import { extractTextFromPdf } from './lib/ocr';
import { translateDocument } from './lib/translator';
import { renderToHtml } from './lib/renderer';
import { generatePdfFromHtml } from './lib/pdf';
import { sendTranslationReady } from './lib/email';
import { env } from './lib/env';

type JobStatus = JobRow['status'];

async function updateJob(
  jobId: string,
  status: JobStatus,
  progress: number,
  errorMessage?: string,
): Promise<void> {
  const now = new Date().toISOString();
  await supabase
    .from('jobs')
    .update({
      status,
      progress_percent: progress,
      ...(errorMessage ? { error_message: errorMessage } : {}),
      ...(status === 'completed' || status === 'failed' ? { completed_at: now } : {}),
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

    // ── 2. OCR ───────────────────────────────────────────────────────────────
    await updateJob(jobId, 'ocr_in_progress', 10);
    console.log(`${tag} downloading PDF from R2…`);
    const pdfBuffer = await downloadFile(doc.file_key);

    console.log(`${tag} running OCR…`);
    const { markdown, pageCount } = await extractTextFromPdf(pdfBuffer);
    console.log(`${tag} OCR done — ${pageCount} pages, ${markdown.length} chars`);

    await updateJob(jobId, 'ocr_completed', 40);

    await supabase.from('ocr_results').insert({
      job_id: jobId,
      markdown,
      page_count: pageCount,
      provider: 'mistral',
    });

    // ── 3. Translation ───────────────────────────────────────────────────────
    await updateJob(jobId, 'translation_in_progress', 50);
    console.log(`${tag} translating ${doc.source_language} → ${doc.target_language}…`);

    const translatedMarkdown = await translateDocument(
      markdown,
      doc.source_language,
      doc.target_language,
      doc.document_type,
    );
    console.log(`${tag} translation done — ${translatedMarkdown.length} chars`);

    // ── 4. Render HTML template ──────────────────────────────────────────────
    await updateJob(jobId, 'pdf_rendering', 70);

    const translatedAt = new Date().toISOString().split('T')[0] ?? new Date().toISOString();
    const html = await renderToHtml(translatedMarkdown, {
      sourceLang: doc.source_language,
      targetLang: doc.target_language,
      documentType: doc.document_type,
      translatedAt,
      filename: doc.filename,
    });

    // ── 5. Generate PDF via Puppeteer ────────────────────────────────────────
    const baseKey = `documents/${doc.user_id}/${documentId}`;
    let translatedKey: string;
    let contentType: string;

    try {
      console.log(`${tag} generating PDF via Puppeteer…`);
      const pdfBuf = await generatePdfFromHtml(html);
      translatedKey = `${baseKey}/translated.pdf`;
      await uploadFile(translatedKey, pdfBuf, 'application/pdf');
      contentType = 'application/pdf';
      console.log(`${tag} PDF uploaded (${pdfBuf.length} bytes) → ${translatedKey}`);
    } catch (pdfErr) {
      // Fallback: save HTML if Puppeteer fails
      const msg = pdfErr instanceof Error ? pdfErr.message : String(pdfErr);
      console.error(`${tag} PDF generation failed (${msg}), falling back to HTML`);
      translatedKey = `${baseKey}/translated.html`;
      await uploadFile(translatedKey, Buffer.from(html, 'utf-8'), 'text/html; charset=utf-8');
      contentType = 'text/html';
    }

    // ── 6. Persist translation record ────────────────────────────────────────
    await updateJob(jobId, 'pdf_rendering', 90);

    // Upsert: if a record already exists (from Vercel's processJob race) update it
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

    // ── 7. Mark done ─────────────────────────────────────────────────────────
    await supabase
      .from('documents')
      .update({ status: 'completed' })
      .eq('id', documentId);

    await updateJob(jobId, 'completed', 100);

    console.log(`${tag} ✓ completed (${contentType})`);

    // ── 8. Send email notification ───────────────────────────────────────────
    if (env.RESEND_API_KEY) {
      try {
        // Get user email from Supabase Auth
        const { data: authUser } = await supabase.auth.admin.getUserById(doc.user_id);
        const userEmail = authUser.user?.email;

        if (userEmail) {
          // Presigned download URL valid for 7 days
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
