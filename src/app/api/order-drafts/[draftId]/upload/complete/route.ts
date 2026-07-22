/**
 * Completion step of the direct-to-R2 upload flow. The browser has already PUT each
 * file straight to Cloudflare R2 using the presigned URLs from
 * src/app/api/order-drafts/[draftId]/upload/init/route.ts; this endpoint never
 * receives file bytes over HTTP, only small JSON metadata.
 *
 * From here on it reuses the exact same pipeline the legacy single-request endpoint
 * used: HeadObject-verify each raw object, download it, magic-byte check
 * (matchesClaimedMimeType), convertToPdf, mergePdfs, upload the merged PDF to the
 * existing final key, call the existing setDraftFile(), then delete the temporary
 * raw objects.
 *
 * Idempotency: because raw objects are deleted after a successful run, a naive retry
 * would 404 on the (already-deleted) raw keys. To make retries safe, the first thing
 * this handler does is check whether the draft's file_keys already point at a final
 * object that actually exists in R2 — if so, it returns success immediately without
 * touching raw objects or re-running the conversion.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import crypto from 'crypto';
import { downloadFile, uploadFile, deleteFile, headFile } from '@/lib/r2/client';
import { setDraftFile } from '@/lib/order-drafts/service';
import { matchesClaimedMimeType } from '@/lib/file-validation/signature';
import { convertToPdf, mergePdfs } from '@/lib/convert-to-pdf';
import { getPhysicalPageCount } from '@/lib/document-analysis/physical-pages';
import {
  loadOwnedDraft,
  resolveMimeType,
  buildCombinedOriginalName,
  finalUploadKey,
  isValidRawUploadKey,
} from '@/lib/order-drafts/upload-shared';
import {
  MAX_FILE_SIZE_EACH,
  ANONYMOUS_MAX_TOTAL_SIZE,
  AUTHENTICATED_MAX_TOTAL_SIZE,
  MAX_UPLOAD_FILE_COUNT,
} from '@/lib/order-drafts/upload-constants';

const CompleteFileSchema = z.object({
  key: z.string().min(1).max(500),
  originalName: z.string().min(1).max(255),
  mimeType: z.string().max(255).optional().default(''),
  sizeBytes: z.number().int().positive(),
});

const CompleteBodySchema = z.object({
  uploads: z.array(CompleteFileSchema).min(1),
});

/** Best-effort cleanup — a failed delete must never fail the (already successful) response. */
async function deleteRawObjects(keys: string[]): Promise<void> {
  const results = await Promise.allSettled(keys.map((k) => deleteFile(k)));
  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      console.error('[order-drafts] upload/complete: raw object delete failed (non-fatal):', keys[i], r.reason);
    }
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ draftId: string }> },
): Promise<NextResponse> {
  try {
    const { draftId } = await params;

    const body: unknown = await request.json().catch(() => null);
    const parsed = CompleteBodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'INVALID_UPLOAD_METADATA', details: parsed.error.flatten() }, { status: 400 });
    }
    const { uploads } = parsed.data;

    const owned = await loadOwnedDraft(draftId);
    if (!owned.ok) {
      return NextResponse.json({ error: owned.error }, { status: owned.error === 'DRAFT_NOT_FOUND' ? 404 : 403 });
    }
    const { draft, owner } = owned;
    if (draft.status === 'converted') {
      return NextResponse.json({ error: 'DRAFT_ALREADY_CONVERTED' }, { status: 409 });
    }

    // ─── Idempotency: a prior complete call may have already finished (and deleted the
    // raw objects this retry references) — detect that first and short-circuit. ───
    const finalKey = finalUploadKey(draftId);
    const existingFinal = draft.file_keys?.find((f) => f.key === finalKey);
    if (existingFinal) {
      const head = await headFile(finalKey);
      if (head) {
        return NextResponse.json({ ok: true, sizeBytes: existingFinal.sizeBytes });
      }
      // file_keys points at a final object that no longer exists in R2 (e.g. manual
      // deletion) — fall through and reprocess using the raw keys in this request.
    }

    if (uploads.length > MAX_UPLOAD_FILE_COUNT) {
      return NextResponse.json({ error: 'FILE_COUNT_EXCEEDED', max: MAX_UPLOAD_FILE_COUNT }, { status: 400 });
    }

    const keys = uploads.map((u) => u.key);
    const uniqueKeys = new Set(keys);
    if (uniqueKeys.size !== keys.length) {
      return NextResponse.json({ error: 'INVALID_UPLOAD_KEY', reason: 'duplicate_key' }, { status: 400 });
    }

    for (const key of keys) {
      if (!isValidRawUploadKey(key, draftId)) {
        // Never touch R2 for a key we don't trust — could belong to another draft or
        // be an arbitrary/attacker-supplied path.
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

    const totalCap = owner.userId ? AUTHENTICATED_MAX_TOTAL_SIZE : ANONYMOUS_MAX_TOTAL_SIZE;
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

    if (totalActualSize > totalCap) {
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
      console.error('[order-drafts] upload/complete: raw download failed:', draftId, err);
      return NextResponse.json({ error: 'UPLOAD_OBJECT_NOT_FOUND' }, { status: 404 });
    }

    for (let i = 0; i < buffers.length; i++) {
      if (!matchesClaimedMimeType(buffers[i]!, resolvedMimes[i]!)) {
        await deleteRawObjects(keys);
        return NextResponse.json({ error: 'INVALID_FILE_SIGNATURE', file: uploads[i]!.originalName }, { status: 400 });
      }
    }

    // ─── Convert + dedupe + merge. Do NOT delete raw objects on failure here — these
    // can be transient/fixable, so keep them around for a retry. ───
    //
    // 2026-07-29 incident fix: a stale/retried client submission (e.g. upload succeeded,
    // pricing failed, the customer re-added the same file before retrying) previously had
    // no server-side guard against merging genuine byte-identical duplicates into one PDF —
    // mergePdfs() faithfully merges whatever it's given, doubling the real page/character
    // count for a document that is actually one page. Deduplicate by content hash of the
    // CONVERTED PDF part (not the raw upload) so this holds regardless of original
    // mimetype/whether convertToPdf changed the bytes — before mergePdfs() ever sees the
    // list, never inside it (mergePdfs itself is untouched).
    let pdfBuffer: Buffer;
    let dedupedKeys: string[];
    let dedupedHashes: string[];
    let sourcePageCounts: number[];
    try {
      const pdfParts = await Promise.all(buffers.map((buf, i) => convertToPdf(buf, resolvedMimes[i]!)));
      const hashes = pdfParts.map((part) => crypto.createHash('sha256').update(part).digest('hex'));

      const seenHashes = new Set<string>();
      const dedupedParts: Buffer[] = [];
      dedupedKeys = [];
      dedupedHashes = [];
      const droppedKeys: string[] = [];
      for (let i = 0; i < pdfParts.length; i++) {
        const hash = hashes[i]!;
        if (seenHashes.has(hash)) {
          droppedKeys.push(keys[i]!);
          continue;
        }
        seenHashes.add(hash);
        dedupedParts.push(pdfParts[i]!);
        dedupedKeys.push(keys[i]!);
        dedupedHashes.push(hash);
      }

      sourcePageCounts = await Promise.all(dedupedParts.map((part) => getPhysicalPageCount(part)));

      // Structured log BEFORE merge/analysis — draft id, upload count, upload ids,
      // filenames, hashes, individual page counts (2026-07-29 requirement).
      console.log('[order-drafts] upload/complete: pre-merge diagnostic', {
        draftId,
        rawUploadCount: uploads.length,
        dedupedUploadCount: dedupedParts.length,
        uploadIds: keys,
        droppedDuplicateKeys: droppedKeys,
        filenames: uploads.map((u) => u.originalName),
        contentHashes: dedupedHashes,
        sourcePageCounts,
      });
      if (droppedKeys.length > 0) {
        console.warn('[order-drafts] upload/complete: dropped duplicate upload(s) before merge (retry appended stale content)', { draftId, droppedKeys });
      }

      pdfBuffer = await mergePdfs(dedupedParts);
    } catch (err) {
      console.error('[order-drafts] upload/complete: conversion failed:', draftId, err);
      return NextResponse.json({ error: 'FILE_PROCESSING_FAILED' }, { status: 500 });
    }

    try {
      await uploadFile(finalKey, pdfBuffer, 'application/pdf');
    } catch (err) {
      console.error('[order-drafts] upload/complete: final upload failed:', draftId, err);
      return NextResponse.json({ error: 'DIRECT_UPLOAD_FAILED' }, { status: 500 });
    }

    // Combined display name reflects the DEDUPED set — a dropped duplicate must never show
    // up as an extra "file" in the customer-facing name.
    const dedupedKeySet = new Set(dedupedKeys);
    const combinedName = buildCombinedOriginalName(
      uploads.filter((u) => dedupedKeySet.has(u.key)).map((u) => u.originalName),
    );
    const result = await setDraftFile(
      draftId,
      {
        key: finalKey,
        originalName: combinedName,
        mimeType: 'application/pdf',
        sizeBytes: pdfBuffer.length,
        sourceUploadCount: dedupedKeys.length,
        sourceUploadIds: dedupedKeys,
        sourceContentHashes: dedupedHashes,
      },
      owner,
    );

    if (!result.ok) {
      const status = result.error === 'DRAFT_NOT_FOUND' ? 404 : result.error === 'FORBIDDEN' ? 403 : 400;
      return NextResponse.json({ error: result.error }, { status });
    }

    // Only delete raw objects once the final PDF + DB row are both confirmed durable.
    await deleteRawObjects(keys);

    return NextResponse.json({ ok: true, sizeBytes: pdfBuffer.length });
  } catch (err) {
    console.error('[order-drafts] upload/complete failed:', err);
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
