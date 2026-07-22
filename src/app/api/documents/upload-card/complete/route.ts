/**
 * Completion step of the dashboard/card-payment direct-to-R2 upload flow. The
 * browser has already PUT each file straight to Cloudflare R2 using the presigned
 * URLs from src/app/api/documents/upload-card/init/route.ts; this endpoint never
 * receives file bytes over HTTP, only small JSON.
 *
 * Reuses the exact same pipeline the legacy endpoint used for everything after the
 * file lands in R2: HeadObject-verify, download, magic-byte check
 * (matchesClaimedMimeType), convertToPdf, mergePdfs, upload the merged PDF, then the
 * same document/job/pricing/quote/audit-log/referral logic (createCardOrder(), moved
 * verbatim from the legacy route's tail into src/lib/documents/upload-card-shared.ts).
 *
 * Idempotency: uploadAttemptId (client-generated, echoed from /init) is used as
 * documents.id. A retried /complete call (raw objects may already be deleted from a
 * prior successful run) is detected via findExistingCardOrder() and replays a
 * success response without re-converting or creating a duplicate document/job.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import crypto from 'crypto';
import { downloadFile, uploadFile, deleteFile, headFile } from '@/lib/r2/client';
import { matchesClaimedMimeType } from '@/lib/file-validation/signature';
import { convertToPdf, mergePdfs } from '@/lib/convert-to-pdf';
import { getPhysicalPageCount } from '@/lib/document-analysis/physical-pages';
import { getHalykConfig } from '@/lib/payments/halyk/config';
import { supabaseServer } from '@/lib/supabase/server';
import {
  UploadFormSchema,
  OptionalUtmFieldsSchema,
  getAuthUser,
  getClientIp,
  checkCardUploadRateLimit,
  findExistingCardOrder,
  isValidCardRawUploadKey,
  cardFinalUploadKey,
  cardSourceKey,
  cardConvertedPdfKey,
  createCardOrder,
  MAX_FILE_SIZE_EACH,
  MAX_TOTAL_SIZE,
  type JobSourceFileInput,
} from '@/lib/documents/upload-card-shared';
import { resolveMimeType, buildCombinedOriginalName } from '@/lib/order-drafts/upload-shared';
import { MAX_UPLOAD_FILE_COUNT } from '@/lib/order-drafts/upload-constants';
import type { ServiceLevel } from '@/lib/translation-prompts/types';

const CompleteUploadSchema = z.object({
  key: z.string().min(1).max(500),
  originalName: z.string().min(1).max(255),
  mimeType: z.string().max(255).optional().default(''),
  sizeBytes: z.number().int().positive(),
});

const CompleteBodySchema = z.object({
  uploadAttemptId: z.string().uuid(),
  uploads: z.array(CompleteUploadSchema).min(1),
}).and(UploadFormSchema).and(OptionalUtmFieldsSchema);

async function deleteRawObjects(keys: string[]): Promise<void> {
  const results = await Promise.allSettled(keys.map((k) => deleteFile(k)));
  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      console.error('[upload-card/complete] raw object delete failed (non-fatal):', keys[i], r.reason);
    }
  });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const config = getHalykConfig();
    if (!config.enabled) {
      return NextResponse.json({ error: 'Card payments are not available at this time' }, { status: 503 });
    }

    const user = await getAuthUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: userRow } = await supabaseServer
      .from('users')
      .select('terms_accepted_at')
      .eq('id', user.id)
      .maybeSingle();
    if (!userRow?.terms_accepted_at) {
      return NextResponse.json({ error: 'Terms not accepted' }, { status: 403 });
    }

    const body: unknown = await request.json().catch(() => null);
    const parsed = CompleteBodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'INVALID_UPLOAD_METADATA', details: parsed.error.flatten() }, { status: 400 });
    }
    const data = parsed.data;

    if (data.sourceLang === data.targetLang) {
      return NextResponse.json({ error: 'LANGUAGE_PAIR_MUST_DIFFER' }, { status: 422 });
    }

    // ─── Idempotency: detect a prior successful run before touching raw objects. ───
    const existing = await findExistingCardOrder(user.id, data.uploadAttemptId);
    if (existing) {
      return NextResponse.json({
        jobId: existing.jobId,
        documentId: existing.documentId,
        priceKzt: existing.priceKzt,
        priceBeforeDiscountKzt: existing.priceBeforeDiscountKzt,
        discountAppliedKzt: existing.discountAppliedKzt,
        discountCode: existing.discountCode,
        quoteId: null,
        requiresOperatorReview: false,
        currency: 'KZT',
        paymentRequired: true,
      });
    }

    // Intentional improvement over the legacy endpoint (not "unchanged legacy
    // behavior"): this runs before any R2 call (HeadObject/download/upload) below —
    // legacy only checked the rate limit after already uploading the file to R2.
    const withinLimit = await checkCardUploadRateLimit(user.id);
    if (!withinLimit) {
      return NextResponse.json({ error: 'Too many uploads. Please wait before uploading again.' }, { status: 429 });
    }

    const { uploads } = data;
    if (uploads.length > MAX_UPLOAD_FILE_COUNT) {
      return NextResponse.json({ error: 'FILE_COUNT_EXCEEDED', max: MAX_UPLOAD_FILE_COUNT }, { status: 400 });
    }

    const keys = uploads.map((u) => u.key);
    if (new Set(keys).size !== keys.length) {
      return NextResponse.json({ error: 'INVALID_UPLOAD_KEY', reason: 'duplicate_key' }, { status: 400 });
    }
    for (const key of keys) {
      if (!isValidCardRawUploadKey(key, user.id, data.uploadAttemptId)) {
        return NextResponse.json({ error: 'INVALID_UPLOAD_KEY' }, { status: 400 });
      }
    }

    // ─── HeadObject-verify every raw object against its actual, not claimed, size/type. ───
    const heads = await Promise.all(keys.map((k) => headFile(k)));
    for (let i = 0; i < heads.length; i++) {
      if (!heads[i]) {
        return NextResponse.json({ error: 'UPLOAD_OBJECT_NOT_FOUND', file: uploads[i]!.originalName }, { status: 404 });
      }
    }
    const verifiedHeads = heads as NonNullable<(typeof heads)[number]>[];

    const totalActualSize = verifiedHeads.reduce((s, h) => s + h.contentLength, 0);
    for (let i = 0; i < uploads.length; i++) {
      const actual = verifiedHeads[i]!.contentLength;
      if (actual > MAX_FILE_SIZE_EACH) {
        await deleteRawObjects(keys);
        return NextResponse.json({ error: 'FILE_SIZE_EXCEEDED', file: uploads[i]!.originalName }, { status: 400 });
      }
      if (actual !== uploads[i]!.sizeBytes) {
        await deleteRawObjects(keys);
        return NextResponse.json({ error: 'UPLOAD_SIZE_MISMATCH', file: uploads[i]!.originalName }, { status: 400 });
      }
    }
    if (totalActualSize > MAX_TOTAL_SIZE) {
      await deleteRawObjects(keys);
      return NextResponse.json({ error: 'TOTAL_SIZE_EXCEEDED' }, { status: 400 });
    }

    const resolvedMimes = uploads.map((u) => resolveMimeType(u.originalName, u.mimeType));
    for (let i = 0; i < uploads.length; i++) {
      const contentType = verifiedHeads[i]!.contentType;
      if (contentType && contentType !== resolvedMimes[i]) {
        await deleteRawObjects(keys);
        return NextResponse.json({ error: 'UPLOAD_CONTENT_TYPE_MISMATCH', file: uploads[i]!.originalName }, { status: 400 });
      }
    }

    // ─── Download + magic-byte check (existing function, unchanged). ───
    let buffers: Buffer[];
    try {
      buffers = await Promise.all(keys.map((k) => downloadFile(k)));
    } catch (err) {
      console.error('[upload-card/complete] raw download failed:', user.id, err);
      return NextResponse.json({ error: 'UPLOAD_OBJECT_NOT_FOUND' }, { status: 404 });
    }
    for (let i = 0; i < buffers.length; i++) {
      if (!matchesClaimedMimeType(buffers[i]!, resolvedMimes[i]!)) {
        await deleteRawObjects(keys);
        return NextResponse.json({ error: 'INVALID_FILE_SIGNATURE', file: uploads[i]!.originalName }, { status: 400 });
      }
    }

    // ─── Convert + merge (existing functions, unchanged). Keep raw objects on failure
    // so a retry doesn't have to re-upload the files. Also computes per-source hash +
    // physical page count here (2026-08-01 multi-file fulfillment decision) — no
    // dedup is applied in this flow (unlike order-drafts' 2026-07-29 fix), so sequence
    // is a straight 1:1 map of upload order; every upload becomes its own
    // job_source_files row, duplicates included, since this route has never
    // deduplicated and changing that now would be a pricing-affecting behavior change
    // out of scope for this fix. ───
    let pdfBuffer: Buffer;
    let sourceHashes: string[];
    let sourcePageCounts: number[];
    let sourcePdfParts: Buffer[];
    try {
      sourcePdfParts = await Promise.all(buffers.map((buf, i) => convertToPdf(buf, resolvedMimes[i]!)));
      sourceHashes = buffers.map((buf) => crypto.createHash('sha256').update(buf).digest('hex'));
      sourcePageCounts = await Promise.all(sourcePdfParts.map((part) => getPhysicalPageCount(part)));
      pdfBuffer = await mergePdfs(sourcePdfParts);
    } catch (err) {
      console.error('[upload-card/complete] conversion failed:', user.id, err);
      return NextResponse.json({ error: 'FILE_PROCESSING_FAILED' }, { status: 500 });
    }

    let sources: JobSourceFileInput[];
    try {
      sources = await Promise.all(buffers.map(async (buf, i) => {
        const sequence = i + 1;
        const srcKey = cardSourceKey(user.id, data.uploadAttemptId, sequence, resolvedMimes[i]!);
        const convertedKey = cardConvertedPdfKey(user.id, data.uploadAttemptId, sequence);
        await Promise.all([
          uploadFile(srcKey, buf, resolvedMimes[i]!),
          uploadFile(convertedKey, sourcePdfParts[i]!, 'application/pdf'),
        ]);
        return {
          sequence,
          originalName: uploads[i]!.originalName,
          r2Key: srcKey,
          contentSha256: sourceHashes[i]!,
          mimeType: resolvedMimes[i]!,
          physicalPageCount: sourcePageCounts[i]!,
          convertedPdfR2Key: convertedKey,
        } satisfies JobSourceFileInput;
      }));
    } catch (err) {
      console.error('[upload-card/complete] permanent source upload failed:', user.id, err);
      return NextResponse.json({ error: 'SOURCE_UPLOAD_FAILED' }, { status: 500 });
    }

    const finalKey = cardFinalUploadKey(user.id, data.uploadAttemptId);
    try {
      await uploadFile(finalKey, pdfBuffer, 'application/pdf');
    } catch (err) {
      console.error('[upload-card/complete] final upload failed:', user.id, err);
      return NextResponse.json({ error: 'DIRECT_UPLOAD_FAILED' }, { status: 500 });
    }

    const combinedName = buildCombinedOriginalName(uploads.map((u) => u.originalName));
    const clientIp = getClientIp(request);

    const orderResult = await createCardOrder({
      userId: user.id,
      userEmail: user.email ?? null,
      uploadAttemptId: data.uploadAttemptId,
      fileKey: finalKey,
      filename: combinedName,
      originalFileSize: totalActualSize,
      ipAddress: clientIp,
      sourceLang: data.sourceLang,
      targetLang: data.targetLang,
      documentType: data.documentType,
      serviceLevel: data.serviceLevel as ServiceLevel,
      applicantType: data.applicantType,
      notaryUrgencyLevel: data.notaryUrgencyLevel,
      deliveryZone: data.deliveryZone,
      notaryCity: data.notaryCity,
      fulfillmentMethod: data.fulfillmentMethod,
      deliveryPhone: data.deliveryPhone,
      deliveryAddress: data.deliveryAddress,
      customerComment: data.customerComment,
      refCode: data.refCode ?? null,
      utmSource: data.utmSource ?? null,
      utmMedium: data.utmMedium ?? null,
      utmCampaign: data.utmCampaign ?? null,
      utmContent: data.utmContent ?? null,
      utmTerm: data.utmTerm ?? null,
      sources,
    });

    if (!orderResult.ok) {
      return NextResponse.json({ error: orderResult.error }, { status: orderResult.status });
    }

    // Only delete raw objects once the final PDF + document/job rows are all confirmed durable.
    await deleteRawObjects(keys);

    const { value } = orderResult;
    return NextResponse.json({
      jobId: value.jobId,
      documentId: value.documentId,
      priceKzt: value.priceKzt,
      priceBeforeDiscountKzt: value.priceBeforeDiscountKzt,
      discountAppliedKzt: value.discountAppliedKzt,
      discountCode: value.discountCode,
      quoteId: value.quoteId,
      requiresOperatorReview: value.requiresOperatorReview,
      reviewReasons: value.reviewReasons,
      currency: 'KZT',
      paymentRequired: true,
    });
  } catch (err) {
    console.error('[upload-card] complete failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
