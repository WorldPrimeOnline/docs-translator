/**
 * Card-payment upload route.
 * Creates document + job in payment_pending state without consuming subscription quota.
 * Computes a dynamic price quote via the pricing engine.
 * Returns job ID, quote ID, and price so the frontend can initiate Halyk ePay payment.
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { uploadFile } from '@/lib/r2/client';
import { convertToPdf, mergePdfs } from '@/lib/convert-to-pdf';
import { deriveBackcompatBooleans } from '@/lib/translation-workflow/output-plan';
import { getHalykConfig } from '@/lib/payments/halyk/config';
import { computeQuoteForJob, saveQuote } from '@/lib/pricing/service';
import { DOCUMENT_TYPE_COEFFICIENT } from '@/lib/pricing/config';
import { classifyPricingReviewReasons } from '@/lib/pricing/review-classification';
import { reportInternalPricingFailure } from '@/lib/pricing/internal-failure';
import { resolveDocumentAnalysisForPricing } from '@/lib/document-analysis/service';
import { attachReferralToOrder } from '@/lib/referral/server';
import { calculatePartnerDiscount } from '@/lib/partners/discount';
import {
  MAX_FILE_SIZE_EACH,
  MAX_TOTAL_SIZE,
  UploadFormSchema,
  getClientIp,
  getAuthUser,
} from '@/lib/documents/upload-card-shared';
import type { ServiceLevel } from '@/lib/translation-prompts/types';

// Moved to src/lib/documents/upload-card-shared.ts (not duplicated) so the direct-to-R2
// init/complete endpoints in this same directory share the exact same values/schema/
// auth helper — Next.js's route-export type contract only allows HTTP-method exports
// (GET/POST/etc.) from a route.ts file, so these can't be exported from here directly.

const ALLOWED_MIME_TYPES: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
};

function detectMimeType(file: File): string {
  if (file.type && ALLOWED_MIME_TYPES[file.type]) return file.type;
  const ext = file.name.toLowerCase().split('.').pop() ?? '';
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'png') return 'image/png';
  if (ext === 'docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  return file.type;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    return await handlePost(request);
  } catch (err) {
    console.error('[upload-card] unhandled error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

async function handlePost(request: NextRequest): Promise<NextResponse> {
  const config = getHalykConfig();
  if (!config.enabled) {
    return NextResponse.json(
      { error: 'Card payments are not available at this time' },
      { status: 503 },
    );
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

  const formData = await request.formData();
  const rawFiles = formData.getAll('file').filter((f): f is File => f instanceof File);

  if (rawFiles.length === 0) {
    return NextResponse.json({ error: 'At least one file is required' }, { status: 400 });
  }

  for (const f of rawFiles) {
    const mime = detectMimeType(f);
    if (!ALLOWED_MIME_TYPES[mime]) {
      return NextResponse.json({ error: `Unsupported file type: ${f.name}` }, { status: 400 });
    }
    if (f.size > MAX_FILE_SIZE_EACH) {
      return NextResponse.json({ error: `File "${f.name}" exceeds 25 MB limit` }, { status: 400 });
    }
  }

  const totalSize = rawFiles.reduce((s, f) => s + f.size, 0);
  if (totalSize > MAX_TOTAL_SIZE) {
    return NextResponse.json({ error: 'Total file size exceeds 50 MB' }, { status: 400 });
  }

  const parsed = UploadFormSchema.safeParse({
    sourceLang: formData.get('sourceLang'),
    targetLang: formData.get('targetLang'),
    documentType: formData.get('documentType'),
    serviceLevel: formData.get('serviceLevel') ?? 'electronic',
    applicantType: formData.get('applicantType') ?? undefined,
    notaryUrgencyLevel: formData.get('notaryUrgencyLevel') ?? 'standard',
    deliveryZone: formData.get('deliveryZone') ?? undefined,
    notaryCity: formData.get('notaryCity') ?? undefined,
    fulfillmentMethod: formData.get('fulfillmentMethod') ?? undefined,
    deliveryPhone: formData.get('deliveryPhone') ?? undefined,
    deliveryAddress: formData.get('deliveryAddress') ?? undefined,
    customerComment: (formData.get('customerComment') as string | null) ?? undefined,
  });

  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 });
  }

  // Warn if deprecated system-analysis fields are sent by old client (ignored)
  if (formData.get('scanQuality') || formData.get('layoutComplexity') || formData.get('urgencyLevel')) {
    console.warn('[upload-card] deprecated pricing fields received from client, ignoring', {
      fields: ['scanQuality', 'layoutComplexity', 'urgencyLevel', 'visualMarksComplexity', 'extraPaperCopies'].filter((f) => formData.get(f)),
    });
  }

  const {
    sourceLang, targetLang, documentType, serviceLevel,
    applicantType, notaryUrgencyLevel, deliveryZone,
    notaryCity, fulfillmentMethod, deliveryPhone, deliveryAddress, customerComment,
  } = parsed.data;

  const correlationId = crypto.randomUUID();

  // Reject same source/target language pair
  if (sourceLang === targetLang) {
    return NextResponse.json(
      { error: 'LANGUAGE_PAIR_MUST_DIFFER', correlationId },
      { status: 422 },
    );
  }

  const { notarized } = deriveBackcompatBooleans(serviceLevel as ServiceLevel);

  // Strip output-format suffix from documentType for pricing engine.
  // documents.document_type stores "presentation|pdf" (compound, per CLAUDE.md),
  // but pricingInput.documentType must be just "presentation".
  const pricingDocumentType = documentType.includes('|') ? documentType.split('|')[0]! : documentType;

  // Convert and merge files
  console.log('[upload-card] step: converting files', rawFiles.length, 'file(s)');
  const pdfParts = await Promise.all(
    rawFiles.map(async (f) => {
      const mime = detectMimeType(f);
      const buf = Buffer.from(await f.arrayBuffer());
      return convertToPdf(buf, mime);
    }),
  );
  const pdfBuffer = await mergePdfs(pdfParts);
  console.log('[upload-card] step: pdf ready', pdfBuffer.length, 'bytes');

  const firstName = rawFiles[0]!.name.replace(/[^a-zA-Z0-9._\- ]/g, '_').slice(0, 200);
  const safeFilename = rawFiles.length === 1 ? firstName : `${rawFiles.length}_files_${firstName}`;

  const docId = crypto.randomUUID();
  const fileKey = `documents/${user.id}/${docId}/original.pdf`;
  const clientIp = getClientIp(request);

  console.log('[upload-card] step: uploading to R2', fileKey);
  await uploadFile(fileKey, pdfBuffer, 'application/pdf');
  console.log('[upload-card] step: R2 upload done');

  // Rate limit: same 10 uploads/hour per user
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count: recentCount } = await supabaseServer
    .from('documents')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .gte('created_at', oneHourAgo);

  if (recentCount !== null && recentCount >= 10) {
    return NextResponse.json({ error: 'Too many uploads. Please wait before uploading again.' }, { status: 429 });
  }

  await supabaseServer
    .from('users')
    .upsert({ id: user.id, email: user.email ?? '' }, { onConflict: 'id', ignoreDuplicates: true });

  const { data: doc, error: docError } = await supabaseServer
    .from('documents')
    .insert({
      id: docId,
      user_id: user.id,
      filename: safeFilename,
      original_file_size: totalSize,
      file_key: fileKey,
      source_language: sourceLang,
      target_language: targetLang,
      document_type: documentType,
      status: 'processing',
      ip_address: clientIp,
    })
    .select()
    .single();

  if (docError || !doc) {
    console.error('[upload-card] document insert failed', {
      correlationId,
      code: docError?.code,
      message: docError?.message,
      details: docError?.details,
      hint: docError?.hint,
    });
    return NextResponse.json({ error: 'Failed to create document record' }, { status: 500 });
  }

  // Real document analysis (2026-07-22) is required for Official/Notary — see
  // src/lib/documents/upload-card-shared.ts's createCardOrder for the canonical version of
  // this same wiring (this legacy route keeps its own copy since it can't import a shared
  // helper defined in a route.ts file). Electronic keeps its exact prior behavior untouched.
  let analysisId: string | undefined;
  let physicalPageCountForPricing: number | undefined = 1;
  let sourceCharacterCountWithSpaces: number | undefined;

  if (serviceLevel !== 'electronic') {
    // pdfBuffer (built above via convertToPdf+mergePdfs) is already the exact file that was
    // uploaded to R2 — reuse it directly rather than downloading it back.
    const analysisOutcome = await resolveDocumentAnalysisForPricing(
      doc.id,
      'application/pdf',
      () => Promise.resolve(pdfBuffer),
    );

    if (analysisOutcome.kind === 'in_progress') {
      return NextResponse.json({ error: 'ANALYSIS_IN_PROGRESS' }, { status: 409 });
    }
    if (analysisOutcome.kind === 'failed') {
      console.error('[upload-card] document analysis failed:', analysisOutcome.reason, { correlationId });
      await supabaseServer.from('documents').update({ status: 'failed' }).eq('id', docId);
      const failure = reportInternalPricingFailure('DOCUMENT_ANALYSIS_PIPELINE_FAILED', { correlationId, documentId: docId, reason: analysisOutcome.reason });
      return NextResponse.json({ error: failure.error }, { status: failure.status });
    }
    if (analysisOutcome.kind === 'requires_operator_review') {
      // Genuinely corrupted/unreadable file — a distinct, honest, customer-actionable code
      // (never "operator review" — WPO has no such process), not folded into the generic
      // internal-failure bucket above. See upload-card-shared.ts's createCardOrder for the
      // matching comment.
      return NextResponse.json({ error: 'INVALID_DOCUMENT' }, { status: 422 });
    }

    analysisId = analysisOutcome.row.id;
    physicalPageCountForPricing = analysisOutcome.row.physicalPageCount ?? undefined;
    sourceCharacterCountWithSpaces = analysisOutcome.row.sourceCharacterCountWithSpaces ?? undefined;
  }

  // Dynamic pricing: compute quote from pricing engine
  const pricingInput = {
    documentId: doc.id,
    analysisId,
    userId: user.id,
    sourceLanguage: sourceLang,
    targetLanguage: targetLang,
    serviceLevel: serviceLevel as ServiceLevel,
    documentType: pricingDocumentType,
    physicalPageCount: physicalPageCountForPricing,
    sourceCharacterCountWithSpaces,
    // System-derived defaults — not from customer input
    urgencyLevel: 'standard' as const,
    scanQuality: 'normal' as const,
    layoutComplexity: 'standard' as const,
    visualMarksComplexity: 'normal' as const,
    extraPaperCopies: 0,
    applicantType,
    notaryUrgencyLevel: notaryUrgencyLevel as 'standard' | 'same_day',
    deliveryZone: deliveryZone as 'almaty_standard' | 'remote_area' | 'other_city' | 'urgent_delivery' | undefined,
    fulfillmentMethod: fulfillmentMethod as 'pickup' | 'delivery' | undefined,
    deliveryRequired: fulfillmentMethod === 'delivery',
    salesChannel: 'direct' as const,
  };

  const quoteResult = await computeQuoteForJob(pricingInput);

  if ('error' in quoteResult) {
    // PRICING_NOT_CONFIGURED / SERVICE_LEVEL_PRICING_DISABLED / PRICING_VERSION_MISMATCH are all
    // internal config problems — never surfaced to the customer by name (2026-07-28), only the
    // real reason logged to Sentry for ops to fix. See upload-card-shared.ts's createCardOrder.
    console.error('[upload-card] pricing not available:', quoteResult.error, { correlationId });
    await supabaseServer.from('documents').update({ status: 'failed' }).eq('id', docId);
    const failure = reportInternalPricingFailure(quoteResult.error, { correlationId, documentId: docId, serviceLevel });
    return NextResponse.json({ error: failure.error }, { status: failure.status });
  }

  const { version } = quoteResult;
  let { result: pricingResult } = quoteResult;

  // 2026-07-22/23/28: same fix as upload-card-shared.ts's createCardOrder — WPO has no manual
  // operator pricing process, so requiresOperatorReview=true is a terminal failure here, never
  // "success with a note", and never surfaced to the customer by classification name. No job is
  // created for any of these.
  if (pricingResult.requiresOperatorReview) {
    const classification = classifyPricingReviewReasons(pricingResult.reviewReasons);
    console.error('[upload-card] pricing requires operator review — refusing to create a job', { correlationId, classification, reviewReasons: pricingResult.reviewReasons });
    await supabaseServer.from('documents').update({ status: 'failed' }).eq('id', docId);
    const failure = reportInternalPricingFailure(classification, { correlationId, documentId: docId, reviewReasons: pricingResult.reviewReasons });
    return NextResponse.json({ error: failure.error }, { status: failure.status });
  }

  const basePreDiscountKzt = Math.round(pricingResult.amountKzt);

  // Apply partner client discount server-side (re-validate; never trust client value)
  let discountKzt = 0;
  const refCodeForDiscount = (formData.get('refCode') as string | null)?.trim().toUpperCase() || null;
  if (refCodeForDiscount) {
    const { data: discountPartner } = await supabaseServer
      .from('partners')
      .select('client_discount_enabled, client_discount_type, client_discount_value, client_discount_min_order_amount, client_discount_max_amount, is_active')
      .eq('referral_code', refCodeForDiscount)
      .maybeSingle();

    discountKzt = calculatePartnerDiscount(basePreDiscountKzt, discountPartner);
  }

  const finalPriceKzt = basePreDiscountKzt - discountKzt;

  // Patch pricingResult so the saved quote amount equals what the customer actually pays.
  // Without this, price_quotes.amount_kzt stays at the pre-discount base and Halyk
  // would charge the original price instead of the discounted one.
  if (discountKzt > 0) {
    pricingResult = { ...pricingResult, amountKzt: finalPriceKzt };
  }

  // Create job with dynamic price
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const jobInsertPayload: any = {
    document_id: doc.id,
    status: 'payment_pending',
    progress_percent: 0,
    priority: 0,
    payment_source: 'card_payment',
    notarized,
    service_level: serviceLevel,
    notary_city: notaryCity ?? null,
    applicant_type: notarized ? applicantType : null,
    fulfillment_method: fulfillmentMethod ?? null,
    delivery_phone: deliveryPhone ?? null,
    delivery_address: deliveryAddress ?? null,
    price_kzt: finalPriceKzt,
    price_before_discount_kzt: discountKzt > 0 ? basePreDiscountKzt : null,
    discount_applied_kzt: discountKzt > 0 ? discountKzt : null,
    discount_code: discountKzt > 0 ? refCodeForDiscount : null,
    customer_comment: customerComment ?? null,
  };
  const { data: job, error: jobError } = await supabaseServer
    .from('jobs')
    .insert(jobInsertPayload)
    .select()
    .single();

  if (jobError || !job) {
    console.error('[upload-card] job insert failed', {
      correlationId,
      code: jobError?.code,
      message: jobError?.message,
      details: jobError?.details,
      hint: jobError?.hint,
    });
    await supabaseServer.from('documents').update({ status: 'failed' }).eq('id', docId);
    return NextResponse.json({ error: 'Failed to create job' }, { status: 500 });
  }

  // Save quote with job_id now that job exists.
  // For same-day notary orders, use the cutoff-aware expiry from the pricing result.
  const notaryCutoffExpiry = pricingResult.context.notaryCutoff?.quoteExpiresAt;
  const cutoffExpiresAt = notaryCutoffExpiry && notaryCutoffExpiry.length > 0 ? notaryCutoffExpiry : undefined;
  const savedQuote = await saveQuote({ ...pricingInput, jobId: job.id }, pricingResult, version, 24, cutoffExpiresAt);

  if ('error' in savedQuote) {
    // 2026-07-23 (precise wording): a job in a payable status (payment_pending) must never exist
    // without a saved quote — see upload-card-shared.ts's createCardOrder for the full
    // rationale. The job row is NOT deleted — it's transitioned OUT of payment_pending to
    // status='failed' (kept as an audit record), never left payable with no quote.
    console.error('[upload-card] failed to save quote — job moved to failed:', savedQuote.error, { correlationId });
    await supabaseServer.from('jobs').update({ status: 'failed', error_message: 'Quote save failed' }).eq('id', job.id);
    await supabaseServer.from('documents').update({ status: 'failed' }).eq('id', docId);
    return NextResponse.json({ error: 'QUOTE_SAVE_FAILED' }, { status: 500 });
  }
  const quoteId = savedQuote.quoteId;

  await supabaseServer.from('job_audit_log').insert({
    job_id: job.id,
    actor: user.id,
    source: 'upload-card',
    action: 'job_created',
    new_status: 'payment_pending',
    metadata: { serviceLevel, priceKzt: finalPriceKzt, quoteId, notaryCity: notaryCity ?? null },
  }).then(({ error: e }) => { if (e) console.error('[upload-card] audit insert failed:', e.message); });

  // Pricing diagnostics — one structured line per quote so production pricing
  // decisions (fallbacks, operator-review reasons) are auditable without a DB query.
  const minimumCheckItem = pricingResult.items.find((i) => i.itemType === 'minimum_check');
  const resolvedLanguageGroup = minimumCheckItem?.metadataJson?.languageGroup ?? null;
  const fallbackUsed =
    resolvedLanguageGroup === 'other' ||
    !(pricingDocumentType in DOCUMENT_TYPE_COEFFICIENT) ||
    (serviceLevel === 'notarization_through_partners' && fulfillmentMethod === 'delivery' && !deliveryZone);
  console.log('[pricing] quote computed', {
    correlationId,
    jobId: job.id,
    quoteId,
    documentTypeReceived: documentType,
    documentTypeMapped: pricingDocumentType,
    serviceLevel,
    languagePair: `${sourceLang}→${targetLang}`,
    languageGroup: resolvedLanguageGroup,
    deliveryRequired: pricingInput.deliveryRequired,
    notaryCity: notaryCity ?? null,
    physicalPageCount: pricingInput.physicalPageCount,
    sourceWordCount: null, // not known at initial upload — OCR hasn't run yet
    fallbackUsed,
    requiresOperatorReview: pricingResult.requiresOperatorReview,
    reviewReasons: pricingResult.reviewReasons,
    finalAmountKzt: finalPriceKzt,
  });

  // Best-effort referral attachment — must not block order creation or payment.
  const refCode = (formData.get('refCode') as string | null) || null;
  if (refCode) {
    // Awaited, not fire-and-forget — see src/lib/documents/upload-card-shared.ts
    // for the WO-75-class Vercel unawaited-promise rationale.
    await attachReferralToOrder({
      jobId: job.id,
      userId: user.id,
      refCode,
      utmSource:   (formData.get('utmSource')   as string | null) || null,
      utmMedium:   (formData.get('utmMedium')   as string | null) || null,
      utmCampaign: (formData.get('utmCampaign') as string | null) || null,
      utmContent:  (formData.get('utmContent')  as string | null) || null,
      utmTerm:     (formData.get('utmTerm')     as string | null) || null,
      orderAmountKzt: basePreDiscountKzt,
      clientDiscountAppliedKzt: discountKzt > 0 ? discountKzt : null,
    }).catch(err => {
      console.error('[upload-card] referral attach failed (non-fatal):', (err as Error).message);
    });
  }

  return NextResponse.json({
    jobId: job.id,
    documentId: doc.id,
    priceKzt: finalPriceKzt,
    priceBeforeDiscountKzt: discountKzt > 0 ? basePreDiscountKzt : undefined,
    discountAppliedKzt: discountKzt > 0 ? discountKzt : undefined,
    discountCode: discountKzt > 0 ? refCodeForDiscount : undefined,
    quoteId,
    // Always false/undefined — requiresOperatorReview=true is classified and handled as a
    // terminal failure above, before any job is created.
    requiresOperatorReview: false,
    reviewReasons: undefined,
    currency: 'KZT',
    paymentRequired: true,
  });
}
