import { supabase, type JobRow, type DocumentRow } from './lib/supabase';
import { downloadFile, uploadFile, getPresignedUrl } from './lib/r2';
import { extractTextFromPdf } from './lib/ocr';
import { translateDocument } from './lib/translator';
import { renderToHtml } from './lib/renderer';
import { generatePdfFromHtml } from './lib/pdf';
import { renderToDocx } from './lib/docx-renderer';
import { sendTranslationReady } from './lib/email';
import { env } from './lib/env';

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

    // serviceLevel will be derived from jobs.notarized / jobs.bureau_stamp once those columns are added to the schema.
    const serviceLevel = 'electronic' as const;

    // ── 2. OCR ───────────────────────────────────────────────────────────────
    await updateJob(jobId, 'ocr_in_progress', 10);
    console.log(`${tag} downloading PDF from R2…`);
    const pdfBuffer = await downloadFile(doc.file_key);

    console.log(`${tag} running OCR…`);
    const { markdown, pageCount } = await extractTextFromPdf(pdfBuffer);
    console.log(`${tag} OCR done — ${pageCount} pages, ${markdown.length} chars`);

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

    // ── 3. Translation ───────────────────────────────────────────────────────
    await updateJob(jobId, 'translation_in_progress', 50);
    console.log(`${tag} translating ${doc.source_language} → ${doc.target_language}…`);

    const { docType, outputFormat } = parseDocumentType(doc.document_type);

    const translatedMarkdown = await translateDocument(
      markdown,
      doc.source_language,
      doc.target_language,
      docType,
    );
    console.log(`${tag} translation done — ${translatedMarkdown.length} chars, format: ${outputFormat}`);

    // ── 4. Render output in requested format ─────────────────────────────────
    await updateJob(jobId, 'pdf_rendering', 70);

    const translatedAt = new Date().toISOString().split('T')[0] ?? new Date().toISOString();
    const renderMeta = {
      sourceLang: doc.source_language,
      targetLang: doc.target_language,
      documentType: docType,
      translatedAt,
      filename: doc.filename,
      serviceLevel,
    };

    const baseKey = `documents/${doc.user_id}/${documentId}`;
    let translatedKey: string;
    let contentType: string;

    if (outputFormat === 'docx') {
      console.log(`${tag} generating DOCX…`);
      const docxBuf = await renderToDocx(translatedMarkdown, renderMeta);
      translatedKey = `${baseKey}/translated.docx`;
      await uploadFile(translatedKey, docxBuf, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      contentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      console.log(`${tag} DOCX uploaded (${docxBuf.length} bytes) → ${translatedKey}`);
    } else if (outputFormat === 'html') {
      console.log(`${tag} generating HTML…`);
      const html = await renderToHtml(translatedMarkdown, renderMeta);
      translatedKey = `${baseKey}/translated.html`;
      await uploadFile(translatedKey, Buffer.from(html, 'utf-8'), 'text/html; charset=utf-8');
      contentType = 'text/html';
      console.log(`${tag} HTML uploaded → ${translatedKey}`);
    } else {
      // pdf (default) — HTML → Puppeteer → PDF
      const html = await renderToHtml(translatedMarkdown, renderMeta);
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
