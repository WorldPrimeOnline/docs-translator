/**
 * Batch init step of the direct-to-R2 upload flow: validates ownership/metadata/limits
 * and hands back one presigned PUT URL per file, so the browser can upload straight to
 * Cloudflare R2 without the bytes ever passing through this Vercel Function (which is
 * what caused 413 FUNCTION_PAYLOAD_TOO_LARGE for files over ~4.5 MB).
 *
 * See src/app/api/order-drafts/[draftId]/upload/complete/route.ts for the second half
 * of the flow (HeadObject verification, conversion, merge, setDraftFile).
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getPresignedPutUrl } from '@/lib/r2/client';
import {
  loadOwnedDraft,
  resolveMimeType,
  isAllowedMimeType,
  sanitizeFilename,
  buildRawUploadKey,
} from '@/lib/order-drafts/upload-shared';
import {
  MAX_FILE_SIZE_EACH,
  ANONYMOUS_MAX_TOTAL_SIZE,
  AUTHENTICATED_MAX_TOTAL_SIZE,
  MAX_UPLOAD_FILE_COUNT,
  UPLOAD_URL_TTL_SECONDS,
} from '@/lib/order-drafts/upload-constants';

const InitFileSchema = z.object({
  originalName: z.string().min(1).max(255),
  mimeType: z.string().max(255).optional().default(''),
  sizeBytes: z.number().int().positive(),
});

const InitBodySchema = z.object({
  files: z.array(InitFileSchema).min(1),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ draftId: string }> },
): Promise<NextResponse> {
  try {
    const { draftId } = await params;

    const body: unknown = await request.json().catch(() => null);
    const parsed = InitBodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'INVALID_UPLOAD_METADATA', details: parsed.error.flatten() }, { status: 400 });
    }
    const { files } = parsed.data;

    const owned = await loadOwnedDraft(draftId);
    if (!owned.ok) {
      return NextResponse.json({ error: owned.error }, { status: owned.error === 'DRAFT_NOT_FOUND' ? 404 : 403 });
    }
    if (owned.draft.status === 'converted') {
      return NextResponse.json({ error: 'DRAFT_ALREADY_CONVERTED' }, { status: 409 });
    }

    if (files.length > MAX_UPLOAD_FILE_COUNT) {
      return NextResponse.json({ error: 'FILE_COUNT_EXCEEDED', max: MAX_UPLOAD_FILE_COUNT }, { status: 400 });
    }

    const resolvedMimes: string[] = [];
    for (const f of files) {
      const mime = resolveMimeType(f.originalName, f.mimeType);
      if (!isAllowedMimeType(mime)) {
        return NextResponse.json({ error: 'INVALID_UPLOAD_METADATA', file: f.originalName }, { status: 400 });
      }
      if (f.sizeBytes > MAX_FILE_SIZE_EACH) {
        return NextResponse.json({ error: 'FILE_SIZE_EXCEEDED', file: f.originalName }, { status: 400 });
      }
      resolvedMimes.push(mime);
    }

    const totalCap = owned.owner.userId ? AUTHENTICATED_MAX_TOTAL_SIZE : ANONYMOUS_MAX_TOTAL_SIZE;
    const totalSize = files.reduce((s, f) => s + f.sizeBytes, 0);
    if (totalSize > totalCap) {
      return NextResponse.json({ error: 'TOTAL_SIZE_EXCEEDED' }, { status: 400 });
    }

    const uploads = await Promise.all(
      files.map(async (f, i) => {
        const mimeType = resolvedMimes[i]!;
        const key = buildRawUploadKey(draftId);
        const uploadUrl = await getPresignedPutUrl(key, mimeType, UPLOAD_URL_TTL_SECONDS);
        return {
          key,
          uploadUrl,
          originalName: sanitizeFilename(f.originalName),
          mimeType,
          sizeBytes: f.sizeBytes,
        };
      }),
    );

    return NextResponse.json({ uploads, expiresInSeconds: UPLOAD_URL_TTL_SECONDS });
  } catch (err) {
    console.error('[order-drafts] upload/init failed:', err);
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
