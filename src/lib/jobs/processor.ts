import { supabaseServer } from '@/lib/supabase/server';
import { downloadFile, uploadFile } from '@/lib/r2/client';
import { extractTextFromPdf } from '@/lib/ocr/mistral';
import { translateDocument } from '@/lib/translation/translator';
import { renderToPdf } from '@/lib/pdf/renderer';
import type { Tables } from '@/types';

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

    const pdfBuffer = await downloadFile(doc.file_key);
    const { markdown, pageCount } = await extractTextFromPdf(pdfBuffer);

    await updateJob(jobId, 'ocr_completed', 40);

    await supabaseServer.from('ocr_results').insert({
      job_id: jobId,
      markdown,
      page_count: pageCount,
      provider: 'mistral',
    });

    const translatedMarkdown = await translateDocument(
      markdown,
      doc.source_language,
      doc.target_language,
      doc.document_type,
    );

    await updateJob(jobId, 'pdf_rendering', 75);

    const translatedAt = new Date().toISOString().split('T')[0] ?? new Date().toISOString();
    const pdfOut = await renderToPdf(translatedMarkdown, {
      sourceLang: doc.source_language,
      targetLang: doc.target_language,
      documentType: doc.document_type,
      translatedAt,
    });

    const translatedPdfKey = `documents/${doc.user_id}/${documentId}/translated.pdf`;
    await uploadFile(translatedPdfKey, pdfOut, 'application/pdf');

    await supabaseServer.from('translations').insert({
      job_id: jobId,
      translated_markdown: translatedMarkdown,
      translated_pdf_key: translatedPdfKey,
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
