/**
 * Batch init step of the dashboard/card-payment direct-to-R2 upload flow. Same
 * gates as the legacy endpoint (Halyk enabled, auth, terms accepted, rate limit,
 * business-field validation) but returns presigned R2 PUT URLs instead of receiving
 * file bytes — no file body ever passes through this Vercel Function.
 *
 * See src/app/api/documents/upload-card/complete/route.ts for the second half.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getHalykConfig } from '@/lib/payments/halyk/config';
import { getPresignedPutUrl } from '@/lib/r2/client';
import {
  UploadFormSchema,
  getAuthUser,
  checkCardUploadRateLimit,
  buildCardRawUploadKey,
  MAX_FILE_SIZE_EACH,
  MAX_TOTAL_SIZE,
} from '@/lib/documents/upload-card-shared';
import { supabaseServer } from '@/lib/supabase/server';
import {
  resolveMimeType,
  isAllowedMimeType,
  sanitizeFilename,
} from '@/lib/order-drafts/upload-shared';
import {
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
}).and(UploadFormSchema);

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
    const parsed = InitBodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'INVALID_UPLOAD_METADATA', details: parsed.error.flatten() }, { status: 400 });
    }
    const { files, sourceLang, targetLang } = parsed.data;

    if (sourceLang === targetLang) {
      return NextResponse.json({ error: 'LANGUAGE_PAIR_MUST_DIFFER' }, { status: 422 });
    }

    // Intentional improvement over the legacy endpoint: legacy checked this limit only
    // after the full multipart body (and an R2 upload) had already been received —
    // here it runs before any presigned URL is even issued, so a rate-limited request
    // never causes an R2 PUT to happen at all. Not "unchanged legacy behavior".
    const withinLimit = await checkCardUploadRateLimit(user.id);
    if (!withinLimit) {
      return NextResponse.json({ error: 'Too many uploads. Please wait before uploading again.' }, { status: 429 });
    }

    if (files.length > MAX_UPLOAD_FILE_COUNT) {
      return NextResponse.json({ error: 'FILE_COUNT_EXCEEDED', max: MAX_UPLOAD_FILE_COUNT }, { status: 400 });
    }

    const resolvedMimes: string[] = [];
    for (const f of files) {
      const mime = resolveMimeType(f.originalName, f.mimeType);
      if (!isAllowedMimeType(mime)) {
        return NextResponse.json({ error: `Unsupported file type: ${f.originalName}` }, { status: 400 });
      }
      if (f.sizeBytes > MAX_FILE_SIZE_EACH) {
        return NextResponse.json({ error: `File "${f.originalName}" exceeds 25 MB limit` }, { status: 400 });
      }
      resolvedMimes.push(mime);
    }

    const totalSize = files.reduce((s, f) => s + f.sizeBytes, 0);
    if (totalSize > MAX_TOTAL_SIZE) {
      return NextResponse.json({ error: 'Total file size exceeds 50 MB' }, { status: 400 });
    }

    const uploadAttemptId = crypto.randomUUID();

    const uploads = await Promise.all(
      files.map(async (f, i) => {
        const mimeType = resolvedMimes[i]!;
        const key = buildCardRawUploadKey(user.id, uploadAttemptId);
        const uploadUrl = await getPresignedPutUrl(key, mimeType, UPLOAD_URL_TTL_SECONDS);
        return { key, uploadUrl, originalName: sanitizeFilename(f.originalName), mimeType, sizeBytes: f.sizeBytes };
      }),
    );

    return NextResponse.json({ uploadAttemptId, uploads, expiresInSeconds: UPLOAD_URL_TTL_SECONDS });
  } catch (err) {
    console.error('[upload-card] init failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
