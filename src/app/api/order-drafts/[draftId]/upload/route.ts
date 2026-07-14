/**
 * LEGACY single-request draft upload endpoint — kept only for backward compatibility
 * with already-cached old frontend bundles that still POST multipart/form-data here
 * directly. This is the endpoint that hits Vercel's ~4.5 MB function payload limit
 * (413 FUNCTION_PAYLOAD_TOO_LARGE) for any file over a few MB, which is exactly why
 * the direct-to-R2 flow (init/route.ts + complete/route.ts, in this same directory)
 * was introduced.
 *
 * The current frontend (src/components/order/OrderForm.tsx) no longer calls this
 * endpoint — it uses init -> presigned PUT -> complete instead. Do not add an
 * automatic fallback to this endpoint for large files: it would just reproduce the
 * 413. Safe to delete this file entirely after one stable release cycle once no
 * cached old bundle can still be pointing at it.
 *
 * Internals below now reuse the same shared constants/MIME/ownership/key helpers as
 * init/complete, so the three endpoints cannot drift on limits or validation rules —
 * only the transport (multipart body vs presigned R2 PUT) differs.
 */
import { NextRequest, NextResponse } from 'next/server';
import { setDraftFile } from '@/lib/order-drafts/service';
import { uploadFile } from '@/lib/r2/client';
import { convertToPdf, mergePdfs } from '@/lib/convert-to-pdf';
import { matchesClaimedMimeType } from '@/lib/file-validation/signature';
import {
  loadOwnedDraft,
  resolveMimeType,
  isAllowedMimeType,
  buildCombinedOriginalName,
  finalUploadKey,
} from '@/lib/order-drafts/upload-shared';
import {
  MAX_FILE_SIZE_EACH,
  ANONYMOUS_MAX_TOTAL_SIZE,
  AUTHENTICATED_MAX_TOTAL_SIZE,
} from '@/lib/order-drafts/upload-constants';

export async function POST(request: NextRequest, { params }: { params: Promise<{ draftId: string }> }): Promise<NextResponse> {
  try {
    const { draftId } = await params;

    const owned = await loadOwnedDraft(draftId);
    if (!owned.ok) {
      return NextResponse.json({ error: owned.error }, { status: owned.error === 'DRAFT_NOT_FOUND' ? 404 : 403 });
    }
    const { draft, owner } = owned;
    if (draft.status === 'converted') return NextResponse.json({ error: 'DRAFT_ALREADY_CONVERTED' }, { status: 409 });

    const formData = await request.formData();
    const rawFiles = formData.getAll('file').filter((f): f is File => f instanceof File);
    if (rawFiles.length === 0) {
      return NextResponse.json({ error: 'At least one file is required' }, { status: 400 });
    }

    const totalCap = owner.userId ? AUTHENTICATED_MAX_TOTAL_SIZE : ANONYMOUS_MAX_TOTAL_SIZE;

    const mimes: string[] = [];
    for (const f of rawFiles) {
      const mime = resolveMimeType(f.name, f.type);
      if (!isAllowedMimeType(mime)) {
        return NextResponse.json({ error: `Unsupported file type: ${f.name}` }, { status: 400 });
      }
      if (f.size > MAX_FILE_SIZE_EACH) {
        return NextResponse.json({ error: `File "${f.name}" exceeds the size limit` }, { status: 400 });
      }
      mimes.push(mime);
    }

    const totalSize = rawFiles.reduce((s, f) => s + f.size, 0);
    if (totalSize > totalCap) {
      return NextResponse.json({ error: 'TOTAL_SIZE_EXCEEDED' }, { status: 400 });
    }

    const buffers = await Promise.all(rawFiles.map((f) => f.arrayBuffer().then((b) => Buffer.from(b))));
    for (let i = 0; i < rawFiles.length; i++) {
      if (!matchesClaimedMimeType(buffers[i]!, mimes[i]!)) {
        return NextResponse.json({ error: 'INVALID_FILE_SIGNATURE', file: rawFiles[i]!.name }, { status: 400 });
      }
    }

    const pdfParts = await Promise.all(
      rawFiles.map((f, i) => convertToPdf(buffers[i]!, mimes[i]!)),
    );
    const pdfBuffer = await mergePdfs(pdfParts);

    const originalName = buildCombinedOriginalName(rawFiles.map((f) => f.name));
    const r2Key = finalUploadKey(draftId);

    await uploadFile(r2Key, pdfBuffer, 'application/pdf');

    const result = await setDraftFile(
      draftId,
      { key: r2Key, originalName, mimeType: 'application/pdf', sizeBytes: pdfBuffer.length },
      owner,
    );

    if (!result.ok) {
      const status = result.error === 'DRAFT_NOT_FOUND' ? 404 : result.error === 'FORBIDDEN' ? 403 : 400;
      return NextResponse.json({ error: result.error }, { status });
    }

    return NextResponse.json({ ok: true, sizeBytes: pdfBuffer.length });
  } catch (err) {
    console.error('[order-drafts] upload failed:', err);
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
