/**
 * Server-only shared logic for the dashboard/card-payment upload flow
 * (documents/upload-card). Used by the legacy single-request endpoint
 * (src/app/api/documents/upload-card/route.ts) AND the direct-to-R2 init/complete
 * endpoints in that same directory, so business-field validation, size limits, auth,
 * and the R2 key convention can never drift between them.
 *
 * Deliberately separate from src/lib/order-drafts/upload-shared.ts: this flow has
 * different business rules (full auth required, no anonymous session, terms-accepted
 * gate, Halyk-enabled gate, document+job created immediately rather than deferred to
 * a later "convert" step) — only the feature-agnostic pieces (MIME resolution,
 * magic-byte check, R2 key shape) are reused from there, not the draft-specific logic.
 *
 * Transitively server-only: pulls in next/headers via getAuthUser, which throws if
 * bundled into a client component.
 */
import { z } from 'zod';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { NextRequest } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { isValidNotaryCity } from '@/lib/notary/cities';
import { buildRawKey, isValidRawKey } from '@/lib/r2/upload-key-utils';
import { deriveBackcompatBooleans } from '@/lib/translation-workflow/output-plan';
import { computeQuoteForJob, extractNotaryUrgencySnapshot, saveQuote } from '@/lib/pricing/service';
import { DOCUMENT_TYPE_COEFFICIENT } from '@/lib/pricing/config';
import { attachReferralToOrder } from '@/lib/referral/server';
import { calculatePartnerDiscount } from '@/lib/partners/discount';
import type { Database } from '@/types';
import type { ServiceLevel } from '@/lib/translation-prompts/types';

// Same values the legacy endpoint has always enforced — moved here (not duplicated)
// so the legacy route and the new init/complete endpoints share one source.
export const MAX_FILE_SIZE_EACH = 25 * 1024 * 1024;
export const MAX_TOTAL_SIZE = 50 * 1024 * 1024;

const VALID_SERVICE_LEVELS = [
  'electronic',
  'official_with_translator_signature_and_provider_stamp',
  'notarization_through_partners',
] as const;

// 'unknown' is intentionally not a submittable value — it directly determines the notary
// MRP tariff (individual vs legal_entity, a ~2x difference), so notarized orders must always
// carry an explicit choice. See src/lib/pricing/config.ts NOTARY_APPLICANT_MRP_COEFFICIENT.
const VALID_APPLICANT_TYPES = ['individual', 'legal_entity'] as const;
const VALID_DELIVERY_ZONES = ['almaty_standard', 'remote_area', 'other_city', 'urgent_delivery'] as const;
const VALID_NOTARY_URGENCY = ['standard', 'same_day'] as const;

export const UploadFormSchema = z
  .object({
    sourceLang: z.string().min(1).refine((v) => v !== 'auto', { message: 'Source language must be specified explicitly' }),
    targetLang: z.string().min(1),
    documentType: z.string().min(1),
    serviceLevel: z.enum(VALID_SERVICE_LEVELS).default('electronic'),
    applicantType: z.enum(VALID_APPLICANT_TYPES).optional(),
    notaryUrgencyLevel: z.enum(VALID_NOTARY_URGENCY).default('standard'),
    deliveryZone: z.enum(VALID_DELIVERY_ZONES).optional(),
    notaryCity: z.string().optional(),
    fulfillmentMethod: z.enum(['pickup', 'delivery']).optional(),
    deliveryPhone: z.string().max(30).optional(),
    deliveryAddress: z.string().max(500).optional(),
    customerComment: z.string().max(2000).optional().transform((v) => v?.trim() || undefined),
  })
  .superRefine((data, ctx) => {
    if (data.serviceLevel === 'notarization_through_partners') {
      if (!data.notaryCity) {
        ctx.addIssue({ code: 'custom', path: ['notaryCity'], message: 'City is required for notarization orders' });
      } else if (
        typeof isValidNotaryCity === 'function' &&
        (() => {
          try { return isValidNotaryCity(data.notaryCity!); }
          catch { return true; }
        })() === false
      ) {
        ctx.addIssue({ code: 'custom', path: ['notaryCity'], message: 'City not supported for notarization' });
      }
      if (!data.fulfillmentMethod) {
        ctx.addIssue({ code: 'custom', path: ['fulfillmentMethod'], message: 'Fulfillment method is required' });
      }
      if (!data.applicantType) {
        ctx.addIssue({ code: 'custom', path: ['applicantType'], message: 'Applicant type is required for notarization orders' });
      }
      if (data.fulfillmentMethod === 'delivery') {
        if (!data.deliveryPhone) ctx.addIssue({ code: 'custom', path: ['deliveryPhone'], message: 'Phone is required for delivery' });
        if (!data.deliveryAddress) ctx.addIssue({ code: 'custom', path: ['deliveryAddress'], message: 'Address is required for delivery' });
      }
    }
  });

/**
 * Normalizes `null` and `""` to `undefined` before validating as an optional string.
 *
 * Why this exists: `ReferralParams` (src/lib/referral/capture.ts) types every UTM
 * field as `string | null`, because `URLSearchParams.get()` returns `null` — not
 * `undefined` — for a parameter that isn't in the URL. A caller that spreads
 * `loadReferralParams()` straight into a request body (without an explicit
 * `?? undefined` guard) therefore sends explicit `null`, which a plain
 * `z.string().optional()` rejects (only `undefined`/absent satisfies "optional", not
 * `null`). This is a defensive backend normalization independent of the frontend fix —
 * it also protects against already-cached old frontend bundles.
 */
function nullableOptionalString(max: number) {
  return z.preprocess(
    (val) => (val === null || val === '' ? undefined : val),
    z.string().max(max).optional(),
  );
}

/**
 * Shared referral/UTM field schema for both upload-card/init and upload-card/complete
 * — one definition so the two endpoints can't drift on how they tolerate null/empty
 * values. Never used to relax required business fields (sourceLang, targetLang,
 * documentType, serviceLevel, uploadAttemptId, uploads, raw keys) — those keep their
 * own validation in UploadFormSchema/CompleteBodySchema/InitBodySchema untouched.
 */
export const OptionalUtmFieldsSchema = z.object({
  refCode: nullableOptionalString(50),
  utmSource: nullableOptionalString(200),
  utmMedium: nullableOptionalString(200),
  utmCampaign: nullableOptionalString(200),
  utmContent: nullableOptionalString(200),
  utmTerm: nullableOptionalString(200),
});

export function getClientIp(req: NextRequest): string | null {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return req.headers.get('x-real-ip')?.trim() ?? null;
}

export async function getAuthUser() {
  const cookieStore = await cookies();
  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (toSet) => {
          toSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        },
      },
    },
  );
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

// ─── Direct-to-R2 raw key convention: card-upload-raw/{userId}/{uploadAttemptId}/{uuid} ───
// `uploadAttemptId` is client-generated (once per submit) and doubles as the
// idempotency anchor: it becomes documents.id, so a retried /complete call can detect
// "this document already exists" instead of creating a duplicate order. It grants no
// privilege by itself — ownership is enforced by the {userId} segment, which only the
// authenticated request's own user id can ever match server-side.
const CARD_UPLOAD_RAW_PREFIX = 'card-upload-raw';

export function cardRawKeyScope(userId: string, uploadAttemptId: string): string {
  return `${userId}/${uploadAttemptId}`;
}

export function buildCardRawUploadKey(userId: string, uploadAttemptId: string): string {
  return buildRawKey(CARD_UPLOAD_RAW_PREFIX, cardRawKeyScope(userId, uploadAttemptId));
}

export function isValidCardRawUploadKey(key: string, userId: string, uploadAttemptId: string): boolean {
  return isValidRawKey(key, CARD_UPLOAD_RAW_PREFIX, cardRawKeyScope(userId, uploadAttemptId));
}

export function cardFinalUploadKey(userId: string, uploadAttemptId: string): string {
  return `documents/${userId}/${uploadAttemptId}/original.pdf`;
}

/** Same 10-uploads/hour-per-user limit the legacy endpoint has always enforced. */
export async function checkCardUploadRateLimit(userId: string): Promise<boolean> {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count } = await supabaseServer
    .from('documents')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('created_at', oneHourAgo);
  return count === null || count < 10;
}

export interface ExistingCardOrder {
  jobId: string;
  documentId: string;
  priceKzt: number;
  priceBeforeDiscountKzt?: number;
  discountAppliedKzt?: number;
  discountCode?: string;
}

/**
 * Idempotency check: uploadAttemptId is used as documents.id, so a retried /complete
 * call (client never got the first response, but the server had already finished)
 * can detect the existing document+job and replay a success response instead of
 * creating a duplicate order. Quote id is intentionally omitted on replay — the
 * dashboard payment button re-fetches the current quote via /api/jobs, not from this
 * response, so it isn't needed for the payment flow to keep working.
 */
export async function findExistingCardOrder(userId: string, uploadAttemptId: string): Promise<ExistingCardOrder | null> {
  const { data: doc } = await supabaseServer
    .from('documents')
    .select('id')
    .eq('id', uploadAttemptId)
    .eq('user_id', userId)
    .maybeSingle();

  if (!doc) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: job } = await (supabaseServer as any)
    .from('jobs')
    .select('id, price_kzt, price_before_discount_kzt, discount_applied_kzt, discount_code')
    .eq('document_id', doc.id)
    .maybeSingle();

  if (!job) return null;

  return {
    jobId: job.id as string,
    documentId: doc.id,
    priceKzt: (job.price_kzt as number | null) ?? 0,
    priceBeforeDiscountKzt: (job.price_before_discount_kzt as number | null) ?? undefined,
    discountAppliedKzt: (job.discount_applied_kzt as number | null) ?? undefined,
    discountCode: (job.discount_code as string | null) ?? undefined,
  };
}

export interface CardOrderInput {
  userId: string;
  userEmail: string | null;
  uploadAttemptId: string;
  fileKey: string;
  filename: string;
  originalFileSize: number;
  ipAddress: string | null;
  sourceLang: string;
  targetLang: string;
  documentType: string;
  serviceLevel: ServiceLevel;
  applicantType?: 'individual' | 'legal_entity';
  notaryUrgencyLevel: 'standard' | 'same_day';
  deliveryZone?: 'almaty_standard' | 'remote_area' | 'other_city' | 'urgent_delivery';
  notaryCity?: string;
  fulfillmentMethod?: 'pickup' | 'delivery';
  deliveryPhone?: string;
  deliveryAddress?: string;
  customerComment?: string;
  refCode?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmContent?: string | null;
  utmTerm?: string | null;
}

export interface CardOrderSuccess {
  jobId: string;
  documentId: string;
  priceKzt: number;
  priceBeforeDiscountKzt?: number;
  discountAppliedKzt?: number;
  discountCode?: string;
  quoteId: string | null;
  requiresOperatorReview: boolean;
  reviewReasons?: string[];
}

export type CardOrderResult =
  | { ok: true; value: CardOrderSuccess }
  | { ok: false; status: number; error: string };

/**
 * Creates document + job (payment_pending) + quote, exactly mirroring the legacy
 * upload-card/route.ts tail (same pricing engine call, same discount logic, same
 * job fields, same audit log, same best-effort referral attach) — the only
 * difference is that the file is already in R2 by the time this runs (verified,
 * converted, and uploaded by the /complete route), instead of being received as a
 * multipart body in the same request.
 */
export async function createCardOrder(input: CardOrderInput): Promise<CardOrderResult> {
  const correlationId = crypto.randomUUID();
  const { notarized } = deriveBackcompatBooleans(input.serviceLevel);
  const pricingDocumentType = input.documentType.includes('|') ? input.documentType.split('|')[0]! : input.documentType;

  await supabaseServer
    .from('users')
    .upsert({ id: input.userId, email: input.userEmail ?? '' }, { onConflict: 'id', ignoreDuplicates: true });

  // uploadAttemptId is the primary key (documents.id), so a bare .insert() would
  // violate the PK and permanently strand a retry if a *prior* attempt got as far as
  // creating the document but then failed at pricing/job-insert below (status='failed').
  // Check for that row first and reuse it instead of re-inserting.
  const { data: existingDoc } = await supabaseServer
    .from('documents')
    .select('id')
    .eq('id', input.uploadAttemptId)
    .eq('user_id', input.userId)
    .maybeSingle();

  if (existingDoc) {
    // Defense in depth against a race with a concurrent /complete call that already
    // finished: if a job already exists for this document, this isn't a partial
    // failure to recover from — it's the fully-completed case. Replay it instead of
    // creating a second job for the same document.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: existingJob } = await (supabaseServer as any)
      .from('jobs')
      .select('id, price_kzt, price_before_discount_kzt, discount_applied_kzt, discount_code')
      .eq('document_id', existingDoc.id)
      .maybeSingle();

    if (existingJob) {
      return {
        ok: true,
        value: {
          jobId: existingJob.id as string,
          documentId: existingDoc.id,
          priceKzt: (existingJob.price_kzt as number | null) ?? 0,
          priceBeforeDiscountKzt: (existingJob.price_before_discount_kzt as number | null) ?? undefined,
          discountAppliedKzt: (existingJob.discount_applied_kzt as number | null) ?? undefined,
          discountCode: (existingJob.discount_code as string | null) ?? undefined,
          quoteId: null,
          requiresOperatorReview: false,
        },
      };
    }
  }

  const documentPayload = {
    id: input.uploadAttemptId,
    user_id: input.userId,
    filename: input.filename,
    original_file_size: input.originalFileSize,
    file_key: input.fileKey,
    source_language: input.sourceLang,
    target_language: input.targetLang,
    document_type: input.documentType,
    status: 'processing' as const,
    ip_address: input.ipAddress,
  };

  const { data: doc, error: docError } = existingDoc
    ? await supabaseServer.from('documents').update(documentPayload).eq('id', existingDoc.id).select().single()
    : await supabaseServer.from('documents').insert(documentPayload).select().single();

  if (docError || !doc) {
    console.error('[upload-card/complete] document insert failed', {
      correlationId,
      code: docError?.code,
      message: docError?.message,
      details: docError?.details,
      hint: docError?.hint,
    });
    return { ok: false, status: 500, error: 'Failed to create document record' };
  }

  const pricingInput = {
    documentId: doc.id,
    userId: input.userId,
    sourceLanguage: input.sourceLang,
    targetLanguage: input.targetLang,
    serviceLevel: input.serviceLevel,
    documentType: pricingDocumentType,
    physicalPageCount: 1, // conservative default; OCR hasn't run yet
    urgencyLevel: 'standard' as const,
    scanQuality: 'normal' as const,
    layoutComplexity: 'standard' as const,
    visualMarksComplexity: 'normal' as const,
    extraPaperCopies: 0,
    applicantType: input.applicantType,
    notaryUrgencyLevel: input.notaryUrgencyLevel,
    deliveryZone: input.deliveryZone,
    fulfillmentMethod: input.fulfillmentMethod,
    deliveryRequired: input.fulfillmentMethod === 'delivery',
    salesChannel: 'direct' as const,
  };

  const quoteResult = await computeQuoteForJob(pricingInput);

  if ('error' in quoteResult) {
    console.error('[upload-card/complete] pricing not configured:', quoteResult.error, { correlationId });
    await supabaseServer.from('documents').update({ status: 'failed' }).eq('id', doc.id);
    return { ok: false, status: 503, error: 'PRICING_NOT_CONFIGURED' };
  }

  let { result: pricingResult } = quoteResult;
  const basePreDiscountKzt = Math.round(pricingResult.amountKzt);

  let discountKzt = 0;
  const refCodeForDiscount = input.refCode?.trim().toUpperCase() || null;
  if (refCodeForDiscount) {
    const { data: discountPartner } = await supabaseServer
      .from('partners')
      .select('client_discount_enabled, client_discount_type, client_discount_value, client_discount_min_order_amount, client_discount_max_amount, is_active')
      .eq('referral_code', refCodeForDiscount)
      .maybeSingle();

    discountKzt = calculatePartnerDiscount(basePreDiscountKzt, discountPartner);
  }

  const finalPriceKzt = basePreDiscountKzt - discountKzt;

  if (discountKzt > 0) {
    pricingResult = { ...pricingResult, amountKzt: finalPriceKzt };
  }

  const notaryUrgencySnapshot = extractNotaryUrgencySnapshot(pricingResult);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const jobInsertPayload: any = {
    document_id: doc.id,
    status: 'payment_pending',
    progress_percent: 0,
    priority: 0,
    payment_source: 'card_payment',
    notarized,
    service_level: input.serviceLevel,
    notary_city: input.notaryCity ?? null,
    applicant_type: notarized ? input.applicantType : null,
    fulfillment_method: input.fulfillmentMethod ?? null,
    delivery_phone: input.deliveryPhone ?? null,
    delivery_address: input.deliveryAddress ?? null,
    price_kzt: finalPriceKzt,
    price_before_discount_kzt: discountKzt > 0 ? basePreDiscountKzt : null,
    discount_applied_kzt: discountKzt > 0 ? discountKzt : null,
    discount_code: discountKzt > 0 ? refCodeForDiscount : null,
    customer_comment: input.customerComment ?? null,
    notary_urgency_level: notaryUrgencySnapshot?.level ?? null,
    notary_urgency_window: notaryUrgencySnapshot?.effectiveWindow ?? null,
    notary_urgency_multiplier: notaryUrgencySnapshot?.multiplier ?? null,
    notary_urgency_cutoff_at: notaryUrgencySnapshot?.cutoffAt ?? null,
    notary_urgency_fee_kzt: notaryUrgencySnapshot?.feeKzt ?? null,
  };
  const { data: job, error: jobError } = await supabaseServer
    .from('jobs')
    .insert(jobInsertPayload)
    .select()
    .single();

  if (jobError || !job) {
    console.error('[upload-card/complete] job insert failed', {
      correlationId,
      code: jobError?.code,
      message: jobError?.message,
      details: jobError?.details,
      hint: jobError?.hint,
    });
    await supabaseServer.from('documents').update({ status: 'failed' }).eq('id', doc.id);
    return { ok: false, status: 500, error: 'Failed to create job' };
  }

  const notaryCutoffExpiry = pricingResult.context.notaryCutoff?.quoteExpiresAt;
  const cutoffExpiresAt = notaryCutoffExpiry && notaryCutoffExpiry.length > 0 ? notaryCutoffExpiry : undefined;
  const savedQuote = await saveQuote({ ...pricingInput, jobId: job.id }, pricingResult, 24, cutoffExpiresAt);
  const quoteId = 'quoteId' in savedQuote ? savedQuote.quoteId : null;

  if ('error' in savedQuote) {
    console.error('[upload-card/complete] failed to save quote (non-fatal):', savedQuote.error, { correlationId });
  }

  await supabaseServer.from('job_audit_log').insert({
    job_id: job.id,
    actor: input.userId,
    source: 'upload-card',
    action: 'job_created',
    new_status: 'payment_pending',
    metadata: { serviceLevel: input.serviceLevel, priceKzt: finalPriceKzt, quoteId, notaryCity: input.notaryCity ?? null },
  }).then(({ error: e }) => { if (e) console.error('[upload-card/complete] audit insert failed:', e.message); });

  const minimumCheckItem = pricingResult.items.find((i) => i.itemType === 'minimum_check');
  const resolvedLanguageGroup = minimumCheckItem?.metadataJson?.languageGroup ?? null;
  const fallbackUsed =
    resolvedLanguageGroup === 'other' ||
    !(pricingDocumentType in DOCUMENT_TYPE_COEFFICIENT) ||
    (input.serviceLevel === 'notarization_through_partners' && input.fulfillmentMethod === 'delivery' && !input.deliveryZone);
  console.log('[pricing] quote computed', {
    correlationId,
    jobId: job.id,
    quoteId,
    documentTypeReceived: input.documentType,
    documentTypeMapped: pricingDocumentType,
    serviceLevel: input.serviceLevel,
    languagePair: `${input.sourceLang}→${input.targetLang}`,
    languageGroup: resolvedLanguageGroup,
    deliveryRequired: pricingInput.deliveryRequired,
    notaryCity: input.notaryCity ?? null,
    physicalPageCount: pricingInput.physicalPageCount,
    sourceWordCount: null,
    fallbackUsed,
    requiresOperatorReview: pricingResult.requiresOperatorReview,
    reviewReasons: pricingResult.reviewReasons,
    finalAmountKzt: finalPriceKzt,
  });

  if (input.refCode) {
    // Awaited, not fire-and-forget: a Vercel serverless function's unawaited
    // promises are not guaranteed to run to completion after the response is
    // returned (same class of bug fixed for markQuotePaid/confirmReferral in
    // the Halyk callback route — WO-75, 2026-07-09). attachReferralToOrder()
    // itself never throws (catches internally), so this cannot turn a referral
    // failure into an order-creation failure.
    await attachReferralToOrder({
      jobId: job.id,
      userId: input.userId,
      refCode: input.refCode,
      utmSource: input.utmSource ?? null,
      utmMedium: input.utmMedium ?? null,
      utmCampaign: input.utmCampaign ?? null,
      utmContent: input.utmContent ?? null,
      utmTerm: input.utmTerm ?? null,
      orderAmountKzt: basePreDiscountKzt,
      clientDiscountAppliedKzt: discountKzt > 0 ? discountKzt : null,
    }).catch(err => {
      console.error('[upload-card/complete] referral attach failed (non-fatal):', (err as Error).message);
    });
  }

  return {
    ok: true,
    value: {
      jobId: job.id,
      documentId: doc.id,
      priceKzt: finalPriceKzt,
      priceBeforeDiscountKzt: discountKzt > 0 ? basePreDiscountKzt : undefined,
      discountAppliedKzt: discountKzt > 0 ? discountKzt : undefined,
      discountCode: discountKzt > 0 ? refCodeForDiscount ?? undefined : undefined,
      quoteId,
      requiresOperatorReview: pricingResult.requiresOperatorReview,
      reviewReasons: pricingResult.requiresOperatorReview ? pricingResult.reviewReasons : undefined,
    },
  };
}
