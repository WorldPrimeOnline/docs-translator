/**
 * Pricing service — DB integration for price quotes.
 * Server-side only. Never import in client bundles.
 */
import { supabaseServer } from '@/lib/supabase/server';
import { calculatePrice } from './calculator';
import type { PricingInput, PricingResult, PricingVersion, QuoteStatus } from './types';

// ─── Raw DB row shapes (new tables not yet in generated supabase.ts) ───────────

interface PricingVersionRow {
  id: string;
  code: string;
  status: string;
  currency: string;
  internal_fx_rate: string | number | null;
  mrp_value: string | number | null;
  tax_rate: string | number;
  acquiring_rate: string | number;
  risk_reserve_rate: string | number;
  owner_reserve_rate: string | number;
  marketing_rate_direct: string | number;
  partner_commission_rate: string | number;
  target_profit_rate: string | number;
  ai_it_reserve_per_page_kzt: string | number;
  valid_from: string;
  valid_to: string | null;
  metadata: Record<string, unknown>;
}

interface PriceQuoteRow {
  id: string;
  job_id: string | null;
  user_id: string | null;
  status: string;
  amount_kzt: string | number;
  expires_at: string;
}

// ─── DB helpers (cast to any for new tables) ──────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabaseServer as any;

// ─── Public API ──────────────────────────────────────────────────────────────

export async function getActivePricingVersion(): Promise<PricingVersion | null> {
  const { data, error } = await db
    .from('pricing_versions')
    .select('*')
    .eq('status', 'active')
    .or(`valid_to.is.null,valid_to.gt.${new Date().toISOString()}`)
    .order('valid_from', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;

  const row = data as PricingVersionRow;
  return {
    id: row.id,
    code: row.code,
    status: row.status as PricingVersion['status'],
    currency: row.currency,
    internalFxRate: row.internal_fx_rate != null ? Number(row.internal_fx_rate) : null,
    mrpValue: row.mrp_value != null ? Number(row.mrp_value) : null,
    taxRate: Number(row.tax_rate),
    acquiringRate: Number(row.acquiring_rate),
    riskReserveRate: Number(row.risk_reserve_rate),
    ownerReserveRate: Number(row.owner_reserve_rate),
    marketingRateDirect: Number(row.marketing_rate_direct),
    partnerCommissionRate: Number(row.partner_commission_rate),
    targetProfitRate: Number(row.target_profit_rate),
    aiItReservePerPageKzt: Number(row.ai_it_reserve_per_page_kzt),
    validFrom: row.valid_from,
    validTo: row.valid_to,
    metadata: row.metadata ?? {},
  };
}

export async function computeQuoteForJob(
  input: PricingInput,
): Promise<{ result: PricingResult; version: PricingVersion } | { error: string }> {
  const version = await getActivePricingVersion();
  if (!version) return { error: 'PRICING_NOT_CONFIGURED' };
  const result = calculatePrice(input, version);
  return { result, version };
}

export async function saveQuote(
  input: PricingInput,
  result: PricingResult,
  expiresInHours = 24,
): Promise<{ quoteId: string } | { error: string }> {
  const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000).toISOString();

  const { data: quote, error: quoteError } = await db
    .from('price_quotes')
    .insert({
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
      included_word_count: result.context.includedWordCount,
      included_page_count: result.context.includedPageCount,
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
      breakdown_json: { items: result.items.filter(i => i.isClientVisible) },
      internal_cost_json: result.internalCosts,
      margin_json: result.margin,
    })
    .select('id')
    .single();

  if (quoteError || !quote) {
    return { error: quoteError?.message ?? 'quote_insert_failed' };
  }

  const quoteId = (quote as { id: string }).id;

  // Insert line items
  if (result.items.length > 0) {
    await db.from('price_quote_items').insert(
      result.items.map(item => ({
        quote_id: quoteId,
        item_type: item.itemType,
        label: item.label,
        quantity: item.quantity,
        unit_price_kzt: item.unitPriceKzt ?? null,
        amount_kzt: item.amountKzt,
        is_client_visible: item.isClientVisible,
        is_cost: item.isCost,
        sort_order: item.sortOrder,
        metadata_json: item.metadataJson ?? {},
      })),
    );
  }

  // Create cost reservations
  const reservations: Array<{
    quote_id: string;
    job_id: string | null;
    cost_type: string;
    amount_kzt: number;
    status: string;
    notes: string;
  }> = [];

  const addReservation = (cost_type: string, amount_kzt: number, notes: string) => {
    if (amount_kzt > 0.01) {
      reservations.push({ quote_id: quoteId, job_id: input.jobId ?? null, cost_type, amount_kzt, status: 'reserved', notes });
    }
  };

  addReservation('ai_it_reserve',            result.internalCosts.aiItReserve,       'AI/IT processing cost reserve');
  addReservation('tax_reserve',              result.internalCosts.taxReserve,        'Tax reserve (KZ)');
  addReservation('acquiring_fee_estimate',   result.internalCosts.acquiringFee,      'Halyk ePay acquiring fee estimate');
  addReservation('risk_reserve',             result.internalCosts.riskReserve,       'Chargeback/risk reserve');
  addReservation('owner_reserve',            result.internalCosts.ownerReserve,      'Owner reserve');
  addReservation('marketing_reserve',        result.internalCosts.marketingReserve,  'Marketing/CAC reserve');
  addReservation('translator_reserved_cost', result.internalCosts.translatorReserved, 'Translator cost estimate (30% of translation)');
  if (result.internalCosts.partnerCommission > 0) {
    addReservation('partner_commission', result.internalCosts.partnerCommission, 'Partner commission');
  }

  if (reservations.length > 0) {
    await db.from('cost_reservations').insert(reservations);
  }

  return { quoteId };
}

export async function markQuotePaymentPending(quoteId: string): Promise<void> {
  await db
    .from('price_quotes')
    .update({ status: 'payment_pending', updated_at: new Date().toISOString() })
    .eq('id', quoteId)
    .in('status', ['quoted', 'requires_operator_review', 'payment_pending']);
}

export async function markQuotePaid(quoteId: string, paymentTransactionId: string): Promise<void> {
  const now = new Date().toISOString();
  await db
    .from('price_quotes')
    .update({ status: 'paid', paid_at: now, price_locked_at: now, updated_at: now })
    .eq('id', quoteId);

  await db
    .from('cost_reservations')
    .update({ status: 'committed', payment_transaction_id: paymentTransactionId, updated_at: now })
    .eq('quote_id', quoteId)
    .eq('status', 'reserved');
}

export async function verifyQuotePayable(
  quoteId: string,
  jobId: string,
  userId: string,
): Promise<{ ok: true; amountKzt: number; status: QuoteStatus } | { ok: false; error: string }> {
  const { data: quote, error } = await db
    .from('price_quotes')
    .select('id, job_id, user_id, status, amount_kzt, expires_at')
    .eq('id', quoteId)
    .maybeSingle();

  if (error || !quote) return { ok: false, error: 'QUOTE_NOT_FOUND' };

  const row = quote as PriceQuoteRow;
  if (row.user_id !== userId) return { ok: false, error: 'QUOTE_NOT_FOUND' };
  if (row.job_id !== jobId)   return { ok: false, error: 'QUOTE_JOB_MISMATCH' };

  const status = row.status as QuoteStatus;

  if (new Date(row.expires_at) < new Date() && !['paid', 'payment_pending'].includes(status)) {
    await db.from('price_quotes').update({ status: 'expired', updated_at: new Date().toISOString() }).eq('id', quoteId);
    return { ok: false, error: 'QUOTE_EXPIRED' };
  }
  if (status === 'expired')   return { ok: false, error: 'QUOTE_EXPIRED' };
  if (status === 'paid')      return { ok: false, error: 'QUOTE_ALREADY_PAID' };
  if (status === 'canceled')  return { ok: false, error: 'QUOTE_CANCELED' };
  if (!['quoted', 'payment_pending', 'requires_operator_review'].includes(status)) {
    return { ok: false, error: 'QUOTE_NOT_PAYABLE' };
  }
  if (Number(row.amount_kzt) <= 0) return { ok: false, error: 'QUOTE_AMOUNT_ZERO' };

  return { ok: true, amountKzt: Number(row.amount_kzt), status };
}
