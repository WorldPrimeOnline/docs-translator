/**
 * Pricing Lab — file-mode analysis ("Рассчитать по документу").
 *
 * POST: uploads the file to R2 under the pricing-lab/ prefix (kept separate from real
 * customer document storage — never mixed with the 30-day customer retention convention),
 * runs the SAME analyzeDocumentForPricing() the real document_analysis pipeline will use,
 * and returns the result. The file is NOT deleted immediately — the operator can re-run
 * analysis or adjust overrides without re-uploading — but it is deletable on demand (DELETE
 * below) and swept by the cleanup cron after 1 hour regardless (see
 * src/app/api/cron/cleanup/route.ts).
 *
 * No jobs/documents/payment_transactions/orders row is ever created. No worker/Jira/Drive/
 * fiscal-receipt/translation process is triggered.
 */
import { NextResponse } from 'next/server';
import { requirePricingLabAccess } from '@/lib/internal/require-pricing-lab-access';
import { uploadFile, deleteFile, listObjectsByPrefix } from '@/lib/r2/client';
import { analyzeDocumentForPricing } from '@/lib/document-analysis/analyze';

const PRICING_LAB_RETENTION_HOURS = 1;

/**
 * Opportunistic best-effort sweep, run on every upload — NOT the sole enforcement mechanism
 * (the daily cleanup cron in src/app/api/cron/cleanup/route.ts is the guaranteed backstop).
 * Since this route is called far more often than once a day, this makes the "maximum 1 hour"
 * retention a practical reality rather than depending solely on the once-daily cron. Never
 * blocks or fails the actual upload/analysis if the sweep itself errors.
 */
async function sweepStalePricingLabFiles(): Promise<void> {
  try {
    const cutoffMs = Date.now() - PRICING_LAB_RETENTION_HOURS * 60 * 60 * 1000;
    const objects = await listObjectsByPrefix('pricing-lab/');
    const stale = objects.filter((o) => o.lastModified !== null && o.lastModified.getTime() < cutoffMs);
    await Promise.all(stale.map((o) => deleteFile(o.key).catch(() => undefined)));
  } catch {
    // Best-effort only — never let a sweep failure affect the actual request.
  }
}

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg',
  'image/png',
]);

const MAX_FILE_SIZE = 25 * 1024 * 1024; // matches MAX_FILE_SIZE_EACH convention (upload-card-shared.ts)

export async function POST(request: Request): Promise<NextResponse> {
  const access = await requirePricingLabAccess();
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  // Awaited, not fire-and-forget — a Vercel serverless function can be frozen/killed right
  // after the response is sent, so an un-awaited promise here risks never completing (the
  // same class of bug fixed for markQuotePaid/attachReferralToOrder elsewhere in this repo).
  // Best-effort regardless — errors inside the sweep are swallowed, never surfaced here.
  await sweepStalePricingLabFiles();

  const formData = await request.formData();
  const file = formData.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 });
  }
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: `File too large (max ${MAX_FILE_SIZE / (1024 * 1024)} MB)` }, { status: 400 });
  }
  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    return NextResponse.json({ error: `Unsupported file type: ${file.type}` }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const ext = file.name.split('.').pop()?.replace(/[^a-zA-Z0-9]/g, '') || 'bin';
  const fileKey = `pricing-lab/${access.userId}/${crypto.randomUUID()}.${ext}`;

  await uploadFile(fileKey, buffer, file.type);

  try {
    const analysis = await analyzeDocumentForPricing(buffer, file.type);
    return NextResponse.json({
      fileKey,
      filename: file.name, // never returned as a public URL — key only, for the delete button
      method: analysis.method,
      rawCharacterCount: analysis.qualitySignals.rawCharacterCount,
      characterCount: analysis.characterCount,
      normalizedTextPreview: analysis.normalizedText.slice(0, 2000),
      physicalPageCount: analysis.physicalPageCount,
      qualitySignals: analysis.qualitySignals,
      requiresOperatorReview: analysis.requiresOperatorReview,
      reviewReasons: analysis.reviewReasons,
    });
  } catch (err) {
    // Analysis failed unexpectedly — clean up immediately rather than leaving an orphan
    // around for the hourly TTL to eventually catch.
    await deleteFile(fileKey).catch(() => undefined);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function DELETE(request: Request): Promise<NextResponse> {
  const access = await requirePricingLabAccess();
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  const url = new URL(request.url);
  const fileKey = url.searchParams.get('fileKey');
  if (!fileKey || !fileKey.startsWith(`pricing-lab/${access.userId}/`)) {
    return NextResponse.json({ error: 'Invalid or missing fileKey' }, { status: 400 });
  }

  await deleteFile(fileKey);
  return NextResponse.json({ ok: true });
}
