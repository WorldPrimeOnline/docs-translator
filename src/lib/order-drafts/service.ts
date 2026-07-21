/**
 * Public pre-checkout draft service.
 * Server-side only. A draft is never queued for the worker — conversion into a real
 * documents/jobs/price_quotes row happens at checkout time (post-login, pre-payment),
 * mirroring exactly what src/app/api/documents/upload-card/route.ts already does for
 * logged-in dashboard users. See docs/ai-context/50_PAYMENTS_FINANCE_FISCALIZATION.md.
 */
import { supabaseServer } from '@/lib/supabase/server';
import { downloadFile, uploadFile } from '@/lib/r2/client';
import { computeQuoteForJob, extractNotaryUrgencySnapshot, saveQuote } from '@/lib/pricing/service';
import { deriveBackcompatBooleans } from '@/lib/translation-workflow/output-plan';
import { attachReferralToOrder } from '@/lib/referral/server';
import { calculatePartnerDiscount } from '@/lib/partners/discount';
// 2026-07-24: deliberately NOT a top-level import — @/lib/document-analysis/analyze
// transitively pulls in pdf-parse/pdfjs-dist for PDF text-layer extraction, which crashed at
// module-init time ("ReferenceError: DOMMatrix is not defined") in some bundling contexts. This
// file is imported by @/lib/order-drafts/upload-shared.ts, which is in turn imported by
// /api/documents/upload-card/init/route.ts (for unrelated MIME/filename helpers) — so a static
// import here was silently pulling document-analysis into that route's bundle even though init
// never performs analysis. Loaded via a dynamic import() inside resolveDraftAnalysis() below,
// the only call site.
import { classifyPricingReviewReasons } from '@/lib/pricing/review-classification';
import type { PricingInput, PricingResult } from '@/lib/pricing/types';
import type { ServiceLevel } from '@/lib/translation-prompts/types';
import type { DraftAnalysisSnapshot, DraftFileKey, DraftPricingSnapshot, OrderDraftInput, OrderDraftRow } from './types';

// order_drafts / anonymous_rate_limit_events are not in the generated Supabase types —
// same `as any` escape hatch already used in src/lib/pricing/service.ts for price_quotes.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabaseServer as any;

export interface DraftOwner {
  sessionToken?: string | null;
  userId?: string | null;
}

export type DraftResult<T> = { ok: true; value: T } | { ok: false; error: string };

export function isOwner(draft: OrderDraftRow, owner: DraftOwner): boolean {
  if (draft.user_id) return draft.user_id === owner.userId;
  return !!owner.sessionToken && draft.anonymous_session_id === owner.sessionToken;
}

export async function getDraftRow(draftId: string): Promise<OrderDraftRow | null> {
  const { data, error } = await db.from('order_drafts').select('*').eq('id', draftId).maybeSingle();
  if (error || !data) return null;
  return data as OrderDraftRow;
}

export async function createDraft(
  input: OrderDraftInput,
  sessionToken: string,
  ipAddress: string | null,
): Promise<OrderDraftRow> {
  const { data, error } = await db
    .from('order_drafts')
    .insert({
      anonymous_session_id: sessionToken,
      source_language: input.sourceLanguage ?? null,
      target_language: input.targetLanguage ?? null,
      document_type: input.documentType ?? null,
      output_format: input.outputFormat ?? null,
      service_level: input.serviceLevel ?? 'electronic',
      applicant_type: input.applicantType ?? 'individual',
      notary_urgency_level: input.notaryUrgencyLevel ?? 'standard',
      notary_city: input.notaryCity ?? null,
      fulfillment_method: input.fulfillmentMethod ?? null,
      delivery_phone: input.deliveryPhone ?? null,
      delivery_address: input.deliveryAddress ?? null,
      delivery_zone: input.deliveryZone ?? null,
      customer_comment: input.customerComment ?? null,
      ref_code: input.refCode ?? null,
      utm_source: input.utmSource ?? null,
      utm_medium: input.utmMedium ?? null,
      utm_campaign: input.utmCampaign ?? null,
      utm_content: input.utmContent ?? null,
      utm_term: input.utmTerm ?? null,
      consent_accepted_at: input.consentAccepted ? new Date().toISOString() : null,
      ip_address: ipAddress,
    })
    .select('*')
    .single();

  if (error || !data) throw new Error(error?.message ?? 'draft_insert_failed');
  return data as OrderDraftRow;
}

// consentAccepted is intentionally excluded — it's a write-once boolean->timestamp
// flag (see updateDraftFields below), not a 1:1 column copy like every other field here.
const FIELD_MAP: Record<Exclude<keyof OrderDraftInput, 'consentAccepted'>, string> = {
  sourceLanguage: 'source_language',
  targetLanguage: 'target_language',
  documentType: 'document_type',
  outputFormat: 'output_format',
  serviceLevel: 'service_level',
  applicantType: 'applicant_type',
  notaryUrgencyLevel: 'notary_urgency_level',
  notaryCity: 'notary_city',
  fulfillmentMethod: 'fulfillment_method',
  deliveryPhone: 'delivery_phone',
  deliveryAddress: 'delivery_address',
  deliveryZone: 'delivery_zone',
  customerComment: 'customer_comment',
  refCode: 'ref_code',
  utmSource: 'utm_source',
  utmMedium: 'utm_medium',
  utmCampaign: 'utm_campaign',
  utmContent: 'utm_content',
  utmTerm: 'utm_term',
};

export async function updateDraftFields(
  draftId: string,
  patch: OrderDraftInput,
  owner: DraftOwner,
): Promise<DraftResult<OrderDraftRow>> {
  const draft = await getDraftRow(draftId);
  if (!draft) return { ok: false, error: 'DRAFT_NOT_FOUND' };
  if (!isOwner(draft, owner)) return { ok: false, error: 'FORBIDDEN' };
  if (draft.status === 'converted') return { ok: false, error: 'DRAFT_ALREADY_CONVERTED' };

  const patchDb: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const [key, column] of Object.entries(FIELD_MAP) as [keyof OrderDraftInput, string][]) {
    if (patch[key] !== undefined) patchDb[column] = patch[key];
  }

  // consentAccepted is a write-once flag, not a 1:1 column copy (like FIELD_MAP above):
  // it only ever sets the timestamp the first time, and is never cleared by a later
  // patch that omits or sends false — once given, consent stays recorded.
  if (patch.consentAccepted === true && !draft.consent_accepted_at) {
    patchDb.consent_accepted_at = new Date().toISOString();
  }

  // Editing any field after a price was already shown invalidates that snapshot.
  if (draft.status === 'price_calculated') {
    patchDb.status = 'draft_created';
    patchDb.pricing_snapshot = null;
  }

  const { data, error } = await db.from('order_drafts').update(patchDb).eq('id', draftId).select('*').single();
  if (error || !data) return { ok: false, error: error?.message ?? 'update_failed' };
  return { ok: true, value: data as OrderDraftRow };
}

export async function setDraftFile(
  draftId: string,
  fileKey: DraftFileKey,
  owner: DraftOwner,
): Promise<DraftResult<OrderDraftRow>> {
  const draft = await getDraftRow(draftId);
  if (!draft) return { ok: false, error: 'DRAFT_NOT_FOUND' };
  if (!isOwner(draft, owner)) return { ok: false, error: 'FORBIDDEN' };
  if (draft.status === 'converted') return { ok: false, error: 'DRAFT_ALREADY_CONVERTED' };

  const { data, error } = await db
    .from('order_drafts')
    .update({ file_keys: [fileKey], updated_at: new Date().toISOString() })
    .eq('id', draftId)
    .select('*')
    .single();

  if (error || !data) return { ok: false, error: error?.message ?? 'update_failed' };
  return { ok: true, value: data as OrderDraftRow };
}

function buildPricingInput(
  draft: OrderDraftRow,
  extra?: { documentId?: string; jobId?: string; userId?: string; analysisId?: string; analysis?: DraftAnalysisSnapshot | null },
): PricingInput {
  return {
    documentId: extra?.documentId,
    analysisId: extra?.analysisId,
    jobId: extra?.jobId,
    userId: extra?.userId ?? draft.user_id ?? undefined,
    sourceLanguage: draft.source_language!,
    targetLanguage: draft.target_language!,
    serviceLevel: (draft.service_level ?? 'electronic') as ServiceLevel,
    documentType: draft.document_type ?? undefined,
    // Electronic: unchanged conservative default (matches upload-card, no analysis call at all).
    // Non-electronic: real analysis-derived counts, wired via resolveDraftAnalysis() (2026-07-22).
    physicalPageCount: extra?.analysis ? (extra.analysis.physicalPageCount ?? undefined) : 1,
    sourceCharacterCountWithSpaces: extra?.analysis ? extra.analysis.characterCount : undefined,
    urgencyLevel: 'standard',
    scanQuality: 'normal',
    layoutComplexity: 'standard',
    visualMarksComplexity: 'normal',
    extraPaperCopies: 0,
    applicantType: (draft.applicant_type as PricingInput['applicantType']) ?? 'individual',
    notaryUrgencyLevel: (draft.notary_urgency_level as PricingInput['notaryUrgencyLevel']) ?? 'standard',
    deliveryZone: draft.delivery_zone as PricingInput['deliveryZone'],
    fulfillmentMethod: draft.fulfillment_method as PricingInput['fulfillmentMethod'],
    deliveryRequired: draft.fulfillment_method === 'delivery',
    salesChannel: 'direct',
  };
}

export type DraftAnalysisOutcome =
  | { kind: 'completed'; snapshot: DraftAnalysisSnapshot }
  | { kind: 'requires_operator_review'; reasons: string[] }
  | { kind: 'failed'; reason: string };

/**
 * order_drafts-specific equivalent of src/lib/document-analysis/service.ts's
 * resolveDocumentAnalysisForPricing() — there is no documents.id yet at draft stage (a real
 * document only exists after convertDraftToOrder()), so the "don't re-run OCR" cache lives on
 * order_drafts.analysis_snapshot instead of the document_analysis table, keyed by
 * file_keys[0].key. Invalidated only by a different file key (re-upload).
 */
async function resolveDraftAnalysis(draft: OrderDraftRow): Promise<DraftAnalysisOutcome> {
  const fileKey = draft.file_keys?.[0];
  if (!fileKey) return { kind: 'failed', reason: 'NO_FILE' };

  const cached = draft.analysis_snapshot;
  if (cached && cached.fileKey === fileKey.key) {
    return cached.requiresOperatorReview
      ? { kind: 'requires_operator_review', reasons: cached.reviewReasons }
      : { kind: 'completed', snapshot: cached };
  }

  let result;
  try {
    const buffer = await downloadFile(fileKey.key);
    // Dynamic import — see the top-of-file comment on why this is never a static import.
    const { analyzeDocumentForPricing } = await import('@/lib/document-analysis/analyze');
    result = await analyzeDocumentForPricing(buffer, fileKey.mimeType);
  } catch (err) {
    return { kind: 'failed', reason: err instanceof Error ? err.message : String(err) };
  }

  const snapshot: DraftAnalysisSnapshot = {
    fileKey: fileKey.key,
    method: result.method,
    characterCount: result.characterCount,
    physicalPageCount: result.physicalPageCount,
    requiresOperatorReview: result.requiresOperatorReview,
    reviewReasons: result.reviewReasons,
  };

  await db.from('order_drafts').update({ analysis_snapshot: snapshot, updated_at: new Date().toISOString() }).eq('id', draft.id);

  return snapshot.requiresOperatorReview
    ? { kind: 'requires_operator_review', reasons: snapshot.reviewReasons }
    : { kind: 'completed', snapshot };
}

export async function calculateDraftPrice(
  draftId: string,
  owner: DraftOwner,
): Promise<DraftResult<{ draft: OrderDraftRow; snapshot: DraftPricingSnapshot }>> {
  const draft = await getDraftRow(draftId);
  if (!draft) return { ok: false, error: 'DRAFT_NOT_FOUND' };
  if (!isOwner(draft, owner)) return { ok: false, error: 'FORBIDDEN' };
  if (draft.status === 'converted') return { ok: false, error: 'DRAFT_ALREADY_CONVERTED' };
  if (!draft.source_language || !draft.target_language || !draft.service_level) {
    return { ok: false, error: 'MISSING_FIELDS' };
  }
  if (draft.source_language === draft.target_language) {
    return { ok: false, error: 'LANGUAGE_PAIR_MUST_DIFFER' };
  }

  let analysis: DraftAnalysisSnapshot | undefined;
  if (draft.service_level !== 'electronic') {
    const analysisOutcome = await resolveDraftAnalysis(draft);
    if (analysisOutcome.kind === 'requires_operator_review') return { ok: false, error: 'ANALYSIS_REQUIRES_OPERATOR_REVIEW' };
    if (analysisOutcome.kind === 'failed') return { ok: false, error: 'ANALYSIS_FAILED' };
    analysis = analysisOutcome.snapshot;
  }

  const quoteResult = await computeQuoteForJob(buildPricingInput(draft, { analysis }));
  if ('error' in quoteResult) return { ok: false, error: quoteResult.error };

  const { version } = quoteResult;
  let { result: pricingResult } = quoteResult;

  // 2026-07-22/23: same fix as createCardOrder — WPO has no manual operator pricing process, so
  // requiresOperatorReview=true here is a terminal failure, never a priced draft with a note.
  // The genuine "document needs a human look" case is already handled above, at the analysis
  // stage (ANALYSIS_REQUIRES_OPERATOR_REVIEW). Classified rather than collapsed into one generic
  // code — see src/lib/pricing/review-classification.ts.
  if (pricingResult.requiresOperatorReview) {
    return { ok: false, error: classifyPricingReviewReasons(pricingResult.reviewReasons) };
  }

  const basePreDiscountKzt = Math.round(pricingResult.amountKzt);

  // Apply partner client discount server-side (re-validate; never trust client value) —
  // mirrors src/app/api/documents/upload-card/route.ts exactly.
  let discountKzt = 0;
  const refCodeForDiscount = draft.ref_code?.trim().toUpperCase() || null;
  if (refCodeForDiscount) {
    const { data: discountPartner } = await supabaseServer
      .from('partners')
      .select('client_discount_enabled, client_discount_type, client_discount_value, client_discount_min_order_amount, client_discount_max_amount, is_active')
      .eq('referral_code', refCodeForDiscount)
      .maybeSingle();

    discountKzt = calculatePartnerDiscount(basePreDiscountKzt, discountPartner);
  }

  // Patch the snapshot amount so the saved quote (and Halyk payment amount) equals what
  // the customer actually pays — without this, price_quotes.amount_kzt stays pre-discount.
  if (discountKzt > 0) {
    pricingResult = { ...pricingResult, amountKzt: basePreDiscountKzt - discountKzt };
  }

  const snapshot: DraftPricingSnapshot = {
    result: pricingResult,
    version,
    computedAt: new Date().toISOString(),
    priceBeforeDiscountKzt: discountKzt > 0 ? basePreDiscountKzt : undefined,
    discountAppliedKzt: discountKzt > 0 ? discountKzt : undefined,
    discountCode: discountKzt > 0 ? refCodeForDiscount : undefined,
  };

  const { data, error } = await db
    .from('order_drafts')
    .update({ pricing_snapshot: snapshot, status: 'price_calculated', updated_at: new Date().toISOString() })
    .eq('id', draftId)
    .select('*')
    .single();

  if (error || !data) return { ok: false, error: error?.message ?? 'update_failed' };
  return { ok: true, value: { draft: data as OrderDraftRow, snapshot } };
}

export async function attachDraftToUser(
  draftId: string,
  userId: string,
  sessionToken: string | null,
): Promise<DraftResult<OrderDraftRow>> {
  const draft = await getDraftRow(draftId);
  if (!draft) return { ok: false, error: 'DRAFT_NOT_FOUND' };
  if (draft.user_id === userId) return { ok: true, value: draft };
  if (draft.user_id && draft.user_id !== userId) return { ok: false, error: 'DRAFT_OWNED_BY_ANOTHER_USER' };
  if (!sessionToken || draft.anonymous_session_id !== sessionToken) return { ok: false, error: 'SESSION_MISMATCH' };

  const { data, error } = await db
    .from('order_drafts')
    .update({ user_id: userId, updated_at: new Date().toISOString() })
    .eq('id', draftId)
    .select('*')
    .single();

  if (error || !data) return { ok: false, error: error?.message ?? 'update_failed' };
  return { ok: true, value: data as OrderDraftRow };
}

export interface ConvertedOrder {
  jobId: string;
  documentId: string;
  quoteId: string | null;
  priceKzt: number;
}

/**
 * Convert a draft into a real order — document + job (status='payment_pending') +
 * price_quotes/price_quote_items/cost_reservations — using the SAME sequence
 * upload-card/route.ts already uses. Does NOT call processJob() and does NOT touch
 * Jira/Drive: those stay worker-only, gated on jobs.status='queued' + a paid
 * payment_transactions row, exactly as today.
 *
 * Idempotent: an atomic claim (UPDATE ... WHERE status='price_calculated') prevents a
 * double-click from creating two orders; a second call after conversion returns the
 * already-created ids instead of erroring.
 */
export async function convertDraftToOrder(draftId: string, userId: string): Promise<DraftResult<ConvertedOrder>> {
  const existing = await getDraftRow(draftId);
  if (!existing) return { ok: false, error: 'DRAFT_NOT_FOUND' };
  if (existing.user_id !== userId) return { ok: false, error: 'FORBIDDEN' };

  if (existing.status === 'converted' && existing.converted_job_id && existing.converted_document_id) {
    return {
      ok: true,
      value: {
        jobId: existing.converted_job_id,
        documentId: existing.converted_document_id,
        quoteId: existing.converted_quote_id,
        priceKzt: existing.converted_price_kzt ?? 0,
      },
    };
  }

  // Defense in depth: CheckoutClient already refuses to auto-convert without recorded
  // consent, but this is the actual guarantee — never create a payable order for a
  // draft that never had its Terms of Service/Privacy Policy consent recorded.
  if (!existing.consent_accepted_at) return { ok: false, error: 'CONSENT_NOT_ACCEPTED' };
  if (!existing.pricing_snapshot) return { ok: false, error: 'PRICE_NOT_CALCULATED' };
  if (!existing.file_keys || existing.file_keys.length === 0) return { ok: false, error: 'NO_FILE' };

  // Atomic claim — mirrors the worker's `UPDATE ... WHERE status='queued'` pattern.
  const { data: claimed } = await db
    .from('order_drafts')
    .update({ status: 'checkout_started', updated_at: new Date().toISOString() })
    .eq('id', draftId)
    .eq('status', 'price_calculated')
    .select('*')
    .maybeSingle();

  if (!claimed) {
    // Someone else already claimed it (concurrent click) — reload and check for completion.
    const reloaded = await getDraftRow(draftId);
    if (reloaded?.status === 'converted' && reloaded.converted_job_id && reloaded.converted_document_id) {
      return {
        ok: true,
        value: {
          jobId: reloaded.converted_job_id,
          documentId: reloaded.converted_document_id,
          quoteId: reloaded.converted_quote_id,
          priceKzt: reloaded.converted_price_kzt ?? 0,
        },
      };
    }
    return { ok: false, error: 'CONVERSION_IN_PROGRESS' };
  }
  const draft = claimed as OrderDraftRow;

  try {
    const snapshot = draft.pricing_snapshot!;
    const pricingResult: PricingResult = snapshot.result;
    const finalPriceKzt = Math.round(pricingResult.amountKzt);
    // Discount fields were computed and validated once, at calculateDraftPrice time —
    // re-derive them from the stored snapshot rather than re-querying the partner here.
    const basePreDiscountKzt = snapshot.priceBeforeDiscountKzt ?? finalPriceKzt;
    const discountAppliedKzt = snapshot.discountAppliedKzt ?? 0;
    const discountCode = snapshot.discountCode ?? null;
    const { notarized } = deriveBackcompatBooleans((draft.service_level ?? 'electronic') as ServiceLevel);

    const sourceFileKey = draft.file_keys[0]!;
    const docId = crypto.randomUUID();
    const realFileKey = `documents/${userId}/${docId}/original.pdf`;
    const fileBuffer = await downloadFile(sourceFileKey.key);
    await uploadFile(realFileKey, fileBuffer, 'application/pdf');

    const documentType = draft.output_format ? `${draft.document_type}|${draft.output_format}` : (draft.document_type ?? 'other');

    await db.from('users').upsert({ id: userId }, { onConflict: 'id', ignoreDuplicates: true });

    const { data: doc, error: docError } = await db
      .from('documents')
      .insert({
        id: docId,
        user_id: userId,
        filename: sourceFileKey.originalName,
        original_file_size: sourceFileKey.sizeBytes,
        file_key: realFileKey,
        source_language: draft.source_language,
        target_language: draft.target_language,
        document_type: documentType,
        status: 'processing',
        ip_address: draft.ip_address,
      })
      .select()
      .single();

    if (docError || !doc) {
      await db.from('order_drafts').update({ status: 'price_calculated' }).eq('id', draftId);
      return { ok: false, error: docError?.message ?? 'document_insert_failed' };
    }

    // Materialize the cached draft-stage analysis (resolveDraftAnalysis(), calculateDraftPrice)
    // into a real document_analysis row now that a real documents.id finally exists — never
    // re-runs analyzeDocumentForPricing() here. A draft can only reach pricing_snapshot !=
    // null (checked above) via a 'completed' (non-review) analysis, so this is always
    // status='completed' when analysis_snapshot is present.
    let analysisId: string | undefined;
    if (draft.analysis_snapshot) {
      const snap = draft.analysis_snapshot;
      const { data: analysisRow } = await db
        .from('document_analysis')
        .insert({
          document_id: doc.id,
          revision: 1,
          status: 'completed',
          method: snap.method,
          source_character_count_with_spaces: snap.characterCount,
          physical_page_count: snap.physicalPageCount,
          page_count_method: snap.physicalPageCount != null ? 'pdf_lib_page_count' : null,
          completed_at: new Date().toISOString(),
        })
        .select('id')
        .single();
      analysisId = analysisRow?.id;
    }

    const notaryUrgencySnapshot = extractNotaryUrgencySnapshot(pricingResult);

    const { data: job, error: jobError } = await db
      .from('jobs')
      .insert({
        document_id: doc.id,
        status: 'payment_pending',
        progress_percent: 0,
        priority: 0,
        payment_source: 'card_payment',
        notarized,
        service_level: draft.service_level,
        notary_city: draft.notary_city,
        applicant_type: draft.applicant_type,
        fulfillment_method: draft.fulfillment_method,
        delivery_phone: draft.delivery_phone,
        delivery_address: draft.delivery_address,
        price_kzt: finalPriceKzt,
        price_before_discount_kzt: discountAppliedKzt > 0 ? basePreDiscountKzt : null,
        discount_applied_kzt: discountAppliedKzt > 0 ? discountAppliedKzt : null,
        discount_code: discountAppliedKzt > 0 ? discountCode : null,
        customer_comment: draft.customer_comment,
        notary_urgency_level: notaryUrgencySnapshot?.level ?? null,
        notary_urgency_window: notaryUrgencySnapshot?.effectiveWindow ?? null,
        notary_urgency_multiplier: notaryUrgencySnapshot?.multiplier ?? null,
        notary_urgency_cutoff_at: notaryUrgencySnapshot?.cutoffAt ?? null,
        notary_urgency_fee_kzt: notaryUrgencySnapshot?.feeKzt ?? null,
      })
      .select()
      .single();

    if (jobError || !job) {
      await db.from('documents').update({ status: 'failed' }).eq('id', docId);
      await db.from('order_drafts').update({ status: 'price_calculated' }).eq('id', draftId);
      return { ok: false, error: jobError?.message ?? 'job_insert_failed' };
    }

    const pricingInput = buildPricingInput(draft, { documentId: doc.id, jobId: job.id, userId, analysisId, analysis: draft.analysis_snapshot });
    const notaryCutoffExpiry = pricingResult.context.notaryCutoff?.quoteExpiresAt;
    const cutoffExpiresAt = notaryCutoffExpiry && notaryCutoffExpiry.length > 0 ? notaryCutoffExpiry : undefined;
    const savedQuote = await saveQuote(pricingInput, pricingResult, snapshot.version, 24, cutoffExpiresAt);
    const quoteId = 'quoteId' in savedQuote ? savedQuote.quoteId : null;

    if ('error' in savedQuote) {
      console.error('[order-drafts] failed to save quote (non-fatal):', savedQuote.error);
    }

    await db.from('job_audit_log').insert({
      job_id: job.id,
      actor: userId,
      source: 'order-draft-convert',
      action: 'job_created',
      new_status: 'payment_pending',
      metadata: { serviceLevel: draft.service_level, priceKzt: finalPriceKzt, discountAppliedKzt, quoteId, draftId },
    }).then(({ error: e }: { error: { message: string } | null }) => {
      if (e) console.error('[order-drafts] audit insert failed:', e.message);
    });

    if (draft.ref_code) {
      // Awaited, not fire-and-forget — see src/lib/documents/upload-card-shared.ts
      // for the WO-75-class Vercel unawaited-promise rationale.
      await attachReferralToOrder({
        jobId: job.id,
        userId,
        refCode: draft.ref_code,
        utmSource: draft.utm_source,
        utmMedium: draft.utm_medium,
        utmCampaign: draft.utm_campaign,
        utmContent: draft.utm_content,
        utmTerm: draft.utm_term,
        orderAmountKzt: basePreDiscountKzt,
        clientDiscountAppliedKzt: discountAppliedKzt > 0 ? discountAppliedKzt : null,
      }).catch((err: unknown) => {
        console.error('[order-drafts] referral attach failed (non-fatal):', (err as Error).message);
      });
    }

    await db
      .from('order_drafts')
      .update({
        status: 'converted',
        converted_job_id: job.id,
        converted_document_id: doc.id,
        converted_quote_id: quoteId,
        converted_price_kzt: finalPriceKzt,
        updated_at: new Date().toISOString(),
      })
      .eq('id', draftId);

    return { ok: true, value: { jobId: job.id, documentId: doc.id, quoteId, priceKzt: finalPriceKzt } };
  } catch (err) {
    console.error('[order-drafts] conversion failed:', err);
    await db.from('order_drafts').update({ status: 'price_calculated' }).eq('id', draftId);
    return { ok: false, error: 'CONVERSION_FAILED' };
  }
}
