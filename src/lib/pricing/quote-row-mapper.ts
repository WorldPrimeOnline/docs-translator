/**
 * Single persistence mapper: PricingInput + PricingResult (legacy electronic OR new-model
 * official/notary) -> the exact row shape saveQuote() inserts into public.price_quotes.
 *
 * 2026-07-27 incident: saveQuote() failed on a real Official (new-model) quote with a NOT NULL
 * violation on included_word_count. Root cause — that field mapping (and included_page_count's,
 * identical pattern) was buried inline inside a 40-field object literal mixing legacy-only and
 * new-model-only fields with no single place to audit "does every NOT NULL column always get a
 * real, non-fabricated value regardless of which formula produced this result?". Centralizing
 * the mapping here makes that audit possible in one place instead of re-deriving it from a large
 * inline .insert() call every time a new price_quotes column is added.
 *
 * included_word_count / included_page_count are legacy-electronic-formula-only concepts (words/
 * pages included in the base price before per-extra billing) with NO equivalent in the new
 * official/notarization_through_partners formula, which bills by character/physical page count
 * directly and has no "included before surcharge" pool at all. result.context only ever sets
 * these two fields for the legacy formula (see types.ts: "Legacy-formula-only (electronic)").
 * For new-model results they are correctly, deliberately null — migration 0062 made both columns
 * nullable for exactly this reason (NEVER fabricate a placeholder number here; a fabricated
 * "250 included words" on a character-billed quote would be actively misleading in Jira/refund
 * math, not just cosmetically wrong).
 */
import type { PricingInput, PricingResult, PricingVersion } from './types';

export interface PriceQuoteInsertRow {
  job_id: string | null;
  document_id: string | null;
  user_id: string | null;
  pricing_version_id: string;
  status: string;
  amount_kzt: number;
  currency: string;
  expires_at: string;
  source_word_count: number | null;
  physical_page_count: number;
  /** Legacy-electronic-only real value; null (nullable since migration 0062) for new-model quotes. */
  included_word_count: number | null;
  /** Legacy-electronic-only real value; null (nullable since migration 0062) for new-model quotes. */
  included_page_count: number | null;
  source_language: string;
  target_language: string;
  language_pair: string;
  document_type: string | null;
  service_level: string;
  urgency_level: string;
  fulfillment_method: string | null;
  delivery_required: boolean;
  partner_id: string | null;
  sales_channel: string;
  pricing_context_json: PricingResult['context'];
  breakdown_json: { items: PricingResult['items'] };
  internal_cost_json: PricingResult['internalCosts'] | Record<string, never>;
  margin_json: PricingResult['margin'] | Record<string, never>;
  analysis_id: string | null;
  language_rate_id: string | null;
  source_character_count_with_spaces: number | null;
  translation_page_count_exact: number | null;
  manual_adjustment_kzt: number;
  wpo_financial_breakdown_json: PricingResult['newModel'] | Record<string, never>;
  formula_version: string | null;
}

export function buildPriceQuoteInsertRow(
  input: PricingInput,
  result: PricingResult,
  version: PricingVersion,
  expiresAt: string,
): PriceQuoteInsertRow {
  const nm = result.newModel;

  return {
    job_id: input.jobId ?? null,
    document_id: input.documentId ?? null,
    user_id: input.userId ?? null,
    pricing_version_id: result.pricingVersionId,
    status: result.status,
    amount_kzt: result.amountKzt,
    currency: result.currency,
    expires_at: expiresAt,
    source_word_count: input.sourceWordCount ?? null,
    physical_page_count: input.physicalPageCount ?? 1,
    included_word_count: result.context.includedWordCount ?? null,
    included_page_count: result.context.includedPageCount ?? null,
    source_language: input.sourceLanguage,
    target_language: input.targetLanguage,
    language_pair: result.context.languagePair,
    document_type: input.documentType ?? null,
    service_level: input.serviceLevel,
    urgency_level: input.urgencyLevel ?? 'standard',
    fulfillment_method: input.fulfillmentMethod ?? null,
    delivery_required: input.deliveryRequired ?? false,
    partner_id: input.partnerId ?? null,
    sales_channel: input.salesChannel ?? 'direct',
    pricing_context_json: result.context,
    breakdown_json: { items: result.items.filter((i) => i.isClientVisible) },
    internal_cost_json: result.internalCosts ?? {},
    margin_json: result.margin ?? {},
    // ─── New-model fields (undefined/null for the legacy electronic formula) ──
    analysis_id: input.analysisId ?? null,
    language_rate_id: nm?.languageRateId ?? null,
    source_character_count_with_spaces: result.context.sourceCharacterCountWithSpaces ?? null,
    translation_page_count_exact: result.context.translationPageCountExact ?? null,
    manual_adjustment_kzt: nm?.manualAdjustmentKzt ?? 0,
    wpo_financial_breakdown_json: nm ?? {},
    // Snapshotted at save time so a later edit to pricing_versions.metadata can never change
    // what formula an already-quoted (let alone already-paid) order is recorded against.
    formula_version: (version.metadata?.formula_version as string | undefined) ?? null,
  };
}
