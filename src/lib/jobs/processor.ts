import { supabaseServer } from '@/lib/supabase/server';
import { downloadFile, uploadFile } from '@/lib/r2/client';
import { extractTextFromPdf } from '@/lib/ocr/mistral';
import { translateDocument } from '@/lib/translation/translator';
import { detectSourceLanguage } from '@/lib/translation/detect-language';
import { renderToPdf, renderToPdfBuffer } from '@/lib/pdf/renderer';
import { renderToDocx } from '@/lib/pdf/docx-renderer';
import type { Tables } from '@/types';

type OutputFormat = 'html' | 'pdf' | 'docx';

function parseDocumentType(raw: string): { docType: string; outputFormat: OutputFormat } {
  const [docType, fmt] = raw.split('|');
  const outputFormat: OutputFormat = (fmt === 'pdf' || fmt === 'docx') ? fmt : 'html';
  return { docType: docType ?? raw, outputFormat };
}

type JobStatus = Tables<'jobs'>['status'];

async function updateJob(
  jobId: string,
  status: JobStatus,
  progress: number,
  errorMessage?: string,
): Promise<void> {
  await supabaseServer
    .from('jobs')
    .update({
      status,
      progress_percent: progress,
      ...(errorMessage ? { error_message: errorMessage } : {}),
      ...(status === 'completed' || status === 'failed' ? { completed_at: new Date().toISOString() } : {}),
      ...(status === 'ocr_in_progress' ? { started_at: new Date().toISOString() } : {}),
    })
    .eq('id', jobId);
}

export async function processJob(jobId: string, documentId: string): Promise<void> {
  try {
    await updateJob(jobId, 'ocr_in_progress', 10);

    const { data: doc } = await supabaseServer
      .from('documents')
      .select('*')
      .eq('id', documentId)
      .single();

    if (!doc) throw new Error(`Document ${documentId} not found`);

    const { data: jobRow } = await supabaseServer
      .from('jobs')
      .select('*')
      .eq('id', jobId)
      .single();
    const serviceLevel =
      jobRow?.notarized === true
        ? 'official_with_translator_signature_and_provider_stamp' as const
        : 'electronic' as const;

    const pdfBuffer = await downloadFile(doc.file_key);
    const { markdown, pageCount } = await extractTextFromPdf(pdfBuffer);

    const ocrWordCount = markdown.trim().split(/\s+/).filter(Boolean).length;
    const ocrCharCount = markdown.length;

    if (ocrWordCount < 10 || ocrCharCount < 50) {
      await updateJob(jobId, 'failed', 0,
        'Document quality too low. Please upload a clearer scan with better lighting and resolution.');
      await supabaseServer.from('documents').update({ status: 'failed' }).eq('id', documentId);
      return;
    }

    const nonLatinRatio = (markdown.match(/[^\x00-\x7FЀ-ӿ一-鿿]/g) ?? []).length / ocrCharCount;
    if (nonLatinRatio > 0.3) {
      await updateJob(jobId, 'failed', 0,
        'Document appears to be a low-quality scan. Please upload a higher resolution image.');
      await supabaseServer.from('documents').update({ status: 'failed' }).eq('id', documentId);
      return;
    }

    await updateJob(jobId, 'ocr_completed', 40);

    await supabaseServer.from('ocr_results').insert({
      job_id: jobId,
      markdown,
      page_count: pageCount,
      provider: 'mistral',
    });

    let resolvedSourceLang = doc.source_language;
    if (doc.source_language === 'auto') {
      const detected = await detectSourceLanguage(markdown);
      if (detected) {
        await supabaseServer.from('documents').update({ detected_source_language: detected }).eq('id', documentId);
        resolvedSourceLang = detected;
      }
    }

    const { docType, outputFormat } = parseDocumentType(doc.document_type);

    const translatedMarkdown = await translateDocument(
      markdown,
      resolvedSourceLang,
      doc.target_language,
      docType,
    );

    await updateJob(jobId, 'pdf_rendering', 75);

    const translatedAt = new Date().toISOString().split('T')[0] ?? new Date().toISOString();
    const renderMeta = {
      sourceLang: resolvedSourceLang,
      targetLang: doc.target_language,
      documentType: docType,
      translatedAt,
      serviceLevel,
    };

    let fileBuffer: Buffer;
    let fileKey: string;
    let contentType: string;

    if (outputFormat === 'pdf') {
      fileBuffer = await renderToPdfBuffer(translatedMarkdown, renderMeta);
      fileKey = `documents/${doc.user_id}/${documentId}/translated.pdf`;
      contentType = 'application/pdf';
    } else if (outputFormat === 'docx') {
      fileBuffer = await renderToDocx(translatedMarkdown, renderMeta);
      fileKey = `documents/${doc.user_id}/${documentId}/translated.docx`;
      contentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    } else {
      fileBuffer = await renderToPdf(translatedMarkdown, renderMeta);
      fileKey = `documents/${doc.user_id}/${documentId}/translated.html`;
      contentType = 'text/html; charset=utf-8';
    }

    await uploadFile(fileKey, fileBuffer, contentType);

    await supabaseServer.from('translations').insert({
      job_id: jobId,
      translated_markdown: translatedMarkdown,
      translated_pdf_key: fileKey,
    });

    await supabaseServer
      .from('documents')
      .update({ status: 'completed' })
      .eq('id', documentId);

    await updateJob(jobId, 'completed', 100);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await updateJob(jobId, 'failed', 0, message);
    await supabaseServer
      .from('documents')
      .update({ status: 'failed' })
      .eq('id', documentId);
  }
}
