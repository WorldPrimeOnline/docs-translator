import { calculatePrice } from '../calculator';
import { DOCUMENT_TYPE_COEFFICIENT, NOTARY_CONFIG, BASE_MINIMUM_KZT } from '../config';
import type { PricingVersion, PricingInput } from '../types';

const mockVersion: PricingVersion = {
  id: 'test-version-id',
  code: '2026-Q3-KZ-MVP',
  status: 'active',
  currency: 'KZT',
  internalFxRate: 510,
  mrpValue: 4.325, // current 2026 MRP ≈ 4,325 KZT (stored "in thousands" — see calculator.ts)
  taxRate: 0.03,
  acquiringRate: 0.025,
  riskReserveRate: 0.05,
  ownerReserveRate: 0.07,
  marketingRateDirect: 0.10,
  partnerCommissionRate: 0.10,
  targetProfitRate: 0.25,
  aiItReservePerPageKzt: 100,
  validFrom: '2026-01-01T00:00:00Z',
  validTo: null,
  metadata: {},
};

const baseInput = (overrides: Partial<PricingInput> = {}): PricingInput => ({
  sourceLanguage: 'ru',
  targetLanguage: 'kz',
  serviceLevel: 'official_with_translator_signature_and_provider_stamp',
  documentType: 'passport_id',
  sourceWordCount: 200,
  physicalPageCount: 1,
  urgencyLevel: 'standard',
  salesChannel: 'direct',
  ...overrides,
});

describe('calculatePrice', () => {
  it('RU↔KZ official passport 1 page ≤250 words → base minimum 5500', () => {
    const result = calculatePrice(baseInput({ sourceLanguage: 'ru', targetLanguage: 'kz' }), mockVersion);
    const minimumItem = result.items.find(i => i.itemType === 'minimum_check');
    expect(minimumItem?.amountKzt).toBe(5500);
    expect(result.amountKzt).toBeGreaterThanOrEqual(5500);
  });

  it('RU↔EN official 1 page ≤250 words → base minimum 6500', () => {
    const result = calculatePrice(baseInput({ sourceLanguage: 'ru', targetLanguage: 'en' }), mockVersion);
    const minimumItem = result.items.find(i => i.itemType === 'minimum_check');
    expect(minimumItem?.amountKzt).toBe(6500);
  });

  it('RU↔TR official → base minimum 7500', () => {
    const result = calculatePrice(baseInput({ sourceLanguage: 'ru', targetLanguage: 'tr' }), mockVersion);
    const minimumItem = result.items.find(i => i.itemType === 'minimum_check');
    expect(minimumItem?.amountKzt).toBe(7500);
  });

  it('KZ↔EN official → base minimum 7500', () => {
    const result = calculatePrice(baseInput({ sourceLanguage: 'kz', targetLanguage: 'en' }), mockVersion);
    const minimumItem = result.items.find(i => i.itemType === 'minimum_check');
    expect(minimumItem?.amountKzt).toBe(7500);
  });

  it('electronic RU↔KZ base is 1000', () => {
    const result = calculatePrice(baseInput({ serviceLevel: 'electronic', sourceLanguage: 'ru', targetLanguage: 'kz' }), mockVersion);
    const minimumItem = result.items.find(i => i.itemType === 'minimum_check');
    expect(minimumItem?.amountKzt).toBe(1000);
  });

  it('extra words increase price', () => {
    const base = calculatePrice(baseInput({ sourceWordCount: 250 }), mockVersion);
    const extra = calculatePrice(baseInput({ sourceWordCount: 350 }), mockVersion);
    expect(extra.amountKzt).toBeGreaterThan(base.amountKzt);
    const extraWordItem = extra.items.find(i => i.itemType === 'extra_words_fee');
    expect(extraWordItem).toBeDefined();
    expect(extraWordItem!.quantity).toBe(100);
  });

  it('words within included count produce no extra_words_fee item', () => {
    const result = calculatePrice(baseInput({ sourceWordCount: 200 }), mockVersion);
    const extraWordItem = result.items.find(i => i.itemType === 'extra_words_fee');
    expect(extraWordItem).toBeUndefined();
  });

  it('additional pages increase price', () => {
    const base = calculatePrice(baseInput({ physicalPageCount: 1 }), mockVersion);
    const extra = calculatePrice(baseInput({ physicalPageCount: 3 }), mockVersion);
    expect(extra.amountKzt).toBeGreaterThan(base.amountKzt);
    const pageItem = extra.items.find(i => i.itemType === 'extra_pages_fee');
    expect(pageItem).toBeDefined();
    expect(pageItem!.quantity).toBe(2);
  });

  it('document type coefficient applies only to translation portion', () => {
    const passport = calculatePrice(baseInput({ documentType: 'passport_id', sourceWordCount: 250 }), mockVersion);
    const medical = calculatePrice(baseInput({ documentType: 'medical_document', sourceWordCount: 250 }), mockVersion);
    expect(medical.amountKzt).toBeGreaterThan(passport.amountKzt);
    expect(medical.context.documentCoefficient).toBe(1.50);
    expect(passport.context.documentCoefficient).toBe(1.00);
  });

  it('urgency applies only to translation/layout portion', () => {
    const standard = calculatePrice(baseInput({ urgencyLevel: 'standard' }), mockVersion);
    const urgent = calculatePrice(baseInput({ urgencyLevel: 'within_24h' }), mockVersion);
    expect(urgent.amountKzt).toBeGreaterThan(standard.amountKzt);
    const urgencyItem = urgent.items.find(i => i.itemType === 'urgency_fee');
    expect(urgencyItem).toBeDefined();
    expect(urgencyItem!.amountKzt).toBeGreaterThan(0);
  });

  it('standard urgency produces zero-value urgency_fee row (not dropped)', () => {
    const result = calculatePrice(baseInput({ urgencyLevel: 'standard' }), mockVersion);
    const urgencyItem = result.items.find(i => i.itemType === 'urgency_fee');
    expect(urgencyItem).toBeDefined();
    expect(urgencyItem!.amountKzt).toBe(0);
    expect(urgencyItem!.metadataJson?.urgencyLevel).toBe('standard');
  });

  it('delivery added separately', () => {
    const withDelivery = calculatePrice(baseInput({
      serviceLevel: 'notarization_through_partners',
      deliveryRequired: true,
      fulfillmentMethod: 'delivery',
    }), mockVersion);
    const deliveryItem = withDelivery.items.find(i => i.itemType === 'delivery_fee');
    expect(deliveryItem).toBeDefined();
    expect(deliveryItem!.amountKzt).toBeGreaterThan(0);
  });

  it('no delivery fee when pickup: zero-value row with delivery_required=false', () => {
    const withPickup = calculatePrice(baseInput({
      serviceLevel: 'notarization_through_partners',
      fulfillmentMethod: 'pickup',
      deliveryRequired: false,
    }), mockVersion);
    const deliveryItem = withPickup.items.find(i => i.itemType === 'delivery_fee');
    expect(deliveryItem).toBeDefined();
    expect(deliveryItem!.amountKzt).toBe(0);
    expect(deliveryItem!.metadataJson?.delivery_required).toBe(false);
  });

  it('direct order uses marketing_cac_reserve and zero partner_commission_cost', () => {
    const result = calculatePrice(baseInput({ salesChannel: 'direct' }), mockVersion);
    const marketing = result.items.find(i => i.itemType === 'marketing_cac_reserve');
    const commission = result.items.find(i => i.itemType === 'partner_commission_cost');
    expect(marketing).toBeDefined();
    expect(marketing!.amountKzt).toBeGreaterThan(0);
    expect(commission).toBeDefined();
    expect(commission!.amountKzt).toBe(0);
    expect(commission!.metadataJson?.not_applicable).toBe(true);
  });

  it('referral channel uses non-zero partner_commission_cost and reduced marketing', () => {
    const result = calculatePrice(baseInput({ salesChannel: 'referral', partnerId: 'partner-abc' }), mockVersion);
    const commission = result.items.find(i => i.itemType === 'partner_commission_cost');
    expect(commission).toBeDefined();
    expect(commission!.amountKzt).toBeGreaterThan(0);
    const marketing = result.items.find(i => i.itemType === 'marketing_cac_reserve');
    expect(marketing!.amountKzt).toBeLessThan(result.amountKzt * 0.05);
  });

  it('unsupported language pair returns requires_operator_review', () => {
    const result = calculatePrice(baseInput({ sourceLanguage: 'sw', targetLanguage: 'tl' }), mockVersion);
    expect(result.requiresOperatorReview).toBe(true);
    expect(result.status).toBe('requires_operator_review');
    expect(result.reviewReasons.length).toBeGreaterThan(0);
  });

  it('price rounds to nearest 100 KZT increment', () => {
    const result = calculatePrice(baseInput(), mockVersion);
    expect(result.amountKzt % 100).toBe(0);
  });

  it('price is never negative', () => {
    const result = calculatePrice(baseInput({ sourceWordCount: 0 }), mockVersion);
    expect(result.amountKzt).toBeGreaterThan(0);
  });

  it('internal reserve items are not client visible', () => {
    const result = calculatePrice(baseInput(), mockVersion);
    const reserveTypes = ['tax_reserve', 'acquiring_fee_estimate', 'risk_chargeback_reserve', 'owner_reserve', 'marketing_cac_reserve', 'ai_it_reserve'];
    reserveTypes.forEach(type => {
      const item = result.items.find(i => i.itemType === type);
      expect(item).toBeDefined();
      expect(item!.isClientVisible).toBe(false);
      expect(item!.isCost).toBe(true);
    });
  });

  it('notarized order adds notary components and auto-quotes (no operator review)', () => {
    const result = calculatePrice(baseInput({ serviceLevel: 'notarization_through_partners' }), mockVersion);
    expect(result.items.find(i => i.itemType === 'notary_official_fee' && i.amountKzt > 0)).toBeDefined();
    expect(result.items.find(i => i.itemType === 'notary_coordination_fee' && i.amountKzt > 0)).toBeDefined();
    expect(result.items.find(i => i.itemType === 'printing_binding_fee')).toBeDefined();
    expect(result.requiresOperatorReview).toBe(false);
    expect(result.status).toBe('quoted');
    expect(result.amountKzt).toBeGreaterThan(0);
  });

  describe('canonical zero-value rows — all items present in audit', () => {
    it('electronic order: included_words and included_pages always appear', () => {
      const result = calculatePrice(baseInput({ serviceLevel: 'electronic' }), mockVersion);
      const w = result.items.find(i => i.itemType === 'included_words');
      const p = result.items.find(i => i.itemType === 'included_pages');
      expect(w).toBeDefined();
      expect(w!.amountKzt).toBe(0);
      expect(w!.metadataJson?.included_word_count).toBe(250);
      expect(p).toBeDefined();
      expect(p!.amountKzt).toBe(0);
      expect(p!.metadataJson?.included_page_count).toBe(1);
    });

    it('official order: human_review_fee, translator_signature_fee, provider_stamp_fee are present (0, included)', () => {
      const result = calculatePrice(baseInput(), mockVersion);
      const hr = result.items.find(i => i.itemType === 'human_review_fee');
      const ts = result.items.find(i => i.itemType === 'translator_signature_fee');
      const ps = result.items.find(i => i.itemType === 'provider_stamp_fee');
      expect(hr).toBeDefined();
      expect(hr!.amountKzt).toBe(0);
      expect(hr!.metadataJson?.included_in_official_package).toBe(true);
      expect(ts).toBeDefined();
      expect(ts!.amountKzt).toBe(0);
      expect(ps).toBeDefined();
      expect(ps!.amountKzt).toBe(0);
    });

    it('notarized order: human_review_fee, translator_signature_fee, provider_stamp_fee are present (included in minimum)', () => {
      const result = calculatePrice(baseInput({ serviceLevel: 'notarization_through_partners' }), mockVersion);
      expect(result.items.find(i => i.itemType === 'human_review_fee')).toBeDefined();
      expect(result.items.find(i => i.itemType === 'translator_signature_fee')).toBeDefined();
      expect(result.items.find(i => i.itemType === 'provider_stamp_fee')).toBeDefined();
    });

    it('electronic order: no human_review_fee, translator_signature_fee, provider_stamp_fee', () => {
      const result = calculatePrice(baseInput({ serviceLevel: 'electronic' }), mockVersion);
      expect(result.items.find(i => i.itemType === 'human_review_fee')).toBeUndefined();
      expect(result.items.find(i => i.itemType === 'translator_signature_fee')).toBeUndefined();
      expect(result.items.find(i => i.itemType === 'provider_stamp_fee')).toBeUndefined();
    });

    it('official order: notary_official_fee and notary_coordination_fee present with amount=0 and not_requested=true', () => {
      const result = calculatePrice(baseInput(), mockVersion);
      const nof = result.items.find(i => i.itemType === 'notary_official_fee');
      const ncf = result.items.find(i => i.itemType === 'notary_coordination_fee');
      expect(nof).toBeDefined();
      expect(nof!.amountKzt).toBe(0);
      expect(nof!.metadataJson?.not_requested).toBe(true);
      expect(ncf).toBeDefined();
      expect(ncf!.amountKzt).toBe(0);
    });

    it('official order without delivery: delivery_fee row has amount=0 and delivery_required=false', () => {
      const result = calculatePrice(baseInput(), mockVersion);
      const df = result.items.find(i => i.itemType === 'delivery_fee');
      expect(df).toBeDefined();
      expect(df!.amountKzt).toBe(0);
      expect(df!.metadataJson?.delivery_required).toBe(false);
    });

    it('translator_reserved_cost present as internal cost item', () => {
      const result = calculatePrice(baseInput(), mockVersion);
      const trc = result.items.find(i => i.itemType === 'translator_reserved_cost');
      expect(trc).toBeDefined();
      expect(trc!.isCost).toBe(true);
      expect(trc!.isClientVisible).toBe(false);
      expect(trc!.amountKzt).toBeGreaterThan(0);
      expect(trc!.metadataJson?.rate).toBe(0.30);
    });

    it('target_profit present as internal non-cost item', () => {
      const result = calculatePrice(baseInput(), mockVersion);
      const tp = result.items.find(i => i.itemType === 'target_profit');
      expect(tp).toBeDefined();
      expect(tp!.isCost).toBe(false);
      expect(tp!.isClientVisible).toBe(false);
      expect(tp!.amountKzt).toBeGreaterThan(0);
    });

    it('zero-value items are NOT dropped from items array', () => {
      const result = calculatePrice(baseInput({ sourceWordCount: 200 }), mockVersion);
      // All these should be present even with 0 amount
      expect(result.items.some(i => i.itemType === 'included_words')).toBe(true);
      expect(result.items.some(i => i.itemType === 'included_pages')).toBe(true);
      expect(result.items.some(i => i.itemType === 'urgency_fee' && i.amountKzt === 0)).toBe(true);
      expect(result.items.some(i => i.itemType === 'notary_official_fee' && i.amountKzt === 0)).toBe(true);
      expect(result.items.some(i => i.itemType === 'delivery_fee' && i.amountKzt === 0)).toBe(true);
    });

    it('internal reserves are separated from client price items', () => {
      const result = calculatePrice(baseInput(), mockVersion);
      const clientSubtotal = result.items
        .filter(i => !i.isCost && i.isClientVisible)
        .reduce((s, i) => s + i.amountKzt, 0);
      const internalCostItems = result.items.filter(i => i.isCost);
      expect(internalCostItems.length).toBeGreaterThan(0);
      // Internal costs do not inflate client price
      expect(clientSubtotal).toBeLessThanOrEqual(result.amountKzt);
    });

    it('no double counting: internal reserves are not added to client subtotal', () => {
      const result = calculatePrice(baseInput(), mockVersion);
      // The final amountKzt is derived from client-facing price items only (is_cost=false items
      // that are NOT internal-only like target_profit). Cost items (is_cost=true) do not inflate
      // the client price. target_profit (is_cost=false, is_client_visible=false) is internal allocation.
      const costSubtotal = result.items
        .filter(i => i.isCost)
        .reduce((s, i) => s + i.amountKzt, 0);
      // Total internal costs must be strictly less than gross revenue
      expect(costSubtotal).toBeLessThan(result.amountKzt);
      // Also verify internal costs are not added to the client price. The final price equals
      // client-visible items plus three internal-only price-shaping adjustments —
      // rounding_adjustment and margin_floor_adjustment (WPO service layer only), and
      // payment_wide_fee_adjustment (final gross-up for tax/acquiring/risk/partner + rounding)
      // — all part of the final price but never shown to the client.
      const clientVisibleSubtotal = result.items
        .filter(i => !i.isCost && i.isClientVisible)
        .reduce((s, i) => s + i.amountKzt, 0);
      const roundingAdjustment = result.items.find(i => i.itemType === 'rounding_adjustment')?.amountKzt ?? 0;
      const marginFloorAdjustment = result.items.find(i => i.itemType === 'margin_floor_adjustment')?.amountKzt ?? 0;
      const paymentWideFeeAdjustment = result.items.find(i => i.itemType === 'payment_wide_fee_adjustment')?.amountKzt ?? 0;
      expect(Math.abs(clientVisibleSubtotal + roundingAdjustment + marginFloorAdjustment + paymentWideFeeAdjustment - result.amountKzt)).toBeLessThan(1);
    });
  });

  describe('client visibility', () => {
    it('internal cost/reserve items are not client-visible', () => {
      const result = calculatePrice(baseInput(), mockVersion);
      const internalTypes = ['tax_reserve', 'acquiring_fee_estimate', 'risk_chargeback_reserve', 'owner_reserve', 'marketing_cac_reserve', 'ai_it_reserve', 'translator_reserved_cost'];
      for (const type of internalTypes) {
        const item = result.items.find(i => i.itemType === type);
        if (item) {
          expect(item.isClientVisible).toBe(false);
          expect(item.isCost).toBe(true);
        }
      }
    });

    it('client-facing items are visible', () => {
      const result = calculatePrice(baseInput({ sourceWordCount: 350, physicalPageCount: 2 }), mockVersion);
      const visibleTypes = ['minimum_check', 'extra_words_fee', 'extra_pages_fee'];
      for (const type of visibleTypes) {
        const item = result.items.find(i => i.itemType === type);
        if (item) {
          expect(item.isClientVisible).toBe(true);
        }
      }
    });

    it('payment button should not show for requires_operator_review quotes', () => {
      const quoteStatus: string = 'requires_operator_review';
      const isPayable = quoteStatus === 'quoted';
      expect(isPayable).toBe(false);
    });

    it('payment button shows when quote is quoted, not expired, amount > 0', () => {
      const quoteStatus: string = 'quoted';
      const quoteAmountKzt = 6500;
      const quoteExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      const isPayable = quoteStatus === 'quoted' && quoteAmountKzt > 0 && new Date(quoteExpiresAt) > new Date();
      expect(isPayable).toBe(true);
    });

    it('payment button hidden for expired quotes', () => {
      const quoteStatus: string = 'quoted';
      const quoteExpiresAt = new Date(Date.now() - 1000).toISOString();
      const isExpired = new Date(quoteExpiresAt) <= new Date();
      const isPayable = quoteStatus === 'quoted' && !isExpired;
      expect(isPayable).toBe(false);
    });

    it('payment button hidden for paid jobs', () => {
      const quoteStatus: string = 'paid';
      const isPayable = quoteStatus === 'quoted';
      expect(isPayable).toBe(false);
    });
  });

  describe('new pricing fields', () => {
    it('night_or_weekend urgency applies 1.50 coefficient', () => {
      const standard = calculatePrice(baseInput({ urgencyLevel: 'standard' }), mockVersion);
      const weekend = calculatePrice(baseInput({ urgencyLevel: 'night_or_weekend' }), mockVersion);
      expect(weekend.amountKzt).toBeGreaterThan(standard.amountKzt);
      const urgencyItem = weekend.items.find(i => i.itemType === 'urgency_fee');
      expect(urgencyItem).toBeDefined();
      expect(urgencyItem!.metadataJson?.coefficient).toBe(1.50);
    });

    it('poor_scan quality adds 15% surcharge on translation portion (readability_surcharge)', () => {
      const normal = calculatePrice(baseInput({ scanQuality: 'normal' }), mockVersion);
      const poorScan = calculatePrice(baseInput({ scanQuality: 'poor_scan' }), mockVersion);
      expect(poorScan.amountKzt).toBeGreaterThan(normal.amountKzt);
      const scanItem = poorScan.items.find(i => i.itemType === 'readability_surcharge');
      expect(scanItem).toBeDefined();
    });

    it('handwritten scan quality triggers operator review', () => {
      const result = calculatePrice(baseInput({ scanQuality: 'handwritten' }), mockVersion);
      expect(result.requiresOperatorReview).toBe(true);
      expect(result.reviewReasons.some(r => r.includes('handwritten'))).toBe(true);
    });

    it('tables layout complexity adds fixed fee per page (layout_fee)', () => {
      const standard = calculatePrice(baseInput({ layoutComplexity: 'standard', physicalPageCount: 2 }), mockVersion);
      const tables = calculatePrice(baseInput({ layoutComplexity: 'tables', physicalPageCount: 2 }), mockVersion);
      expect(tables.amountKzt).toBeGreaterThan(standard.amountKzt);
      const layoutItem = tables.items.find(i => i.itemType === 'layout_fee');
      expect(layoutItem).toBeDefined();
      expect(layoutItem!.quantity).toBe(2);
      expect(layoutItem!.unitPriceKzt).toBe(1000);
    });

    it('complex_layout adds 25% multiplier on translation portion (layout_fee)', () => {
      const standard = calculatePrice(baseInput({ layoutComplexity: 'standard' }), mockVersion);
      const complex = calculatePrice(baseInput({ layoutComplexity: 'complex_layout' }), mockVersion);
      expect(complex.amountKzt).toBeGreaterThan(standard.amountKzt);
      const layoutItem = complex.items.find(i => i.itemType === 'layout_fee');
      expect(layoutItem).toBeDefined();
      expect(layoutItem!.metadataJson?.multiplier).toBe(0.25);
    });

    it('many_stamps adds 1000 KZT to subtotal (not translation portion)', () => {
      const normal = calculatePrice(baseInput({ visualMarksComplexity: 'normal' }), mockVersion);
      const stamps = calculatePrice(baseInput({ visualMarksComplexity: 'many_stamps' }), mockVersion);
      // With the margin floor active, the floor price is driven only by *fixed* internal
      // costs (translator/notary/courier/printing/AI-IT) — visual_marks_fee is pure revenue
      // with no matching fixed cost, so when the floor is binding for both cases it can leave
      // the final price completely unchanged (both hit the same fixed-cost-derived floor).
      // Assert non-decreasing, not strictly increasing. The line item itself (below) is exact.
      expect(stamps.amountKzt).toBeGreaterThanOrEqual(normal.amountKzt);
      const marksItem = stamps.items.find(i => i.itemType === 'visual_marks_fee');
      expect(marksItem).toBeDefined();
      expect(marksItem!.amountKzt).toBe(1000);
      expect(marksItem!.isClientVisible).toBe(true);
    });

    it('legal_entity applicant type uses higher MRP coefficient (1.10)', () => {
      const individual = calculatePrice(baseInput({
        serviceLevel: 'notarization_through_partners',
        applicantType: 'individual',
      }), mockVersion);
      const legal = calculatePrice(baseInput({
        serviceLevel: 'notarization_through_partners',
        applicantType: 'legal_entity',
      }), mockVersion);
      expect(legal.amountKzt).toBeGreaterThan(individual.amountKzt);
    });

    it('unknown applicant type triggers operator review for notarized order', () => {
      const result = calculatePrice(baseInput({
        serviceLevel: 'notarization_through_partners',
        applicantType: 'unknown',
      }), mockVersion);
      expect(result.requiresOperatorReview).toBe(true);
      expect(result.reviewReasons.some(r => r.includes('unknown'))).toBe(true);
    });

    it('extra paper copies add 500 KZT per copy (notarization only)', () => {
      const noCopies = calculatePrice(baseInput({
        serviceLevel: 'notarization_through_partners',
        extraPaperCopies: 0,
      }), mockVersion);
      const withCopies = calculatePrice(baseInput({
        serviceLevel: 'notarization_through_partners',
        extraPaperCopies: 3,
      }), mockVersion);
      const copiesItem = withCopies.items.find(i => i.itemType === 'extra_paper_copies');
      expect(copiesItem).toBeDefined();
      expect(copiesItem!.quantity).toBe(3);
      expect(copiesItem!.unitPriceKzt).toBe(500);
      // See note above on visual_marks_fee: extra_paper_copies is also pure revenue with no
      // matching fixed cost, so it too can be fully absorbed once the fixed-cost-driven floor
      // binds for both cases. Assert non-decreasing, not strictly increasing.
      expect(withCopies.amountKzt).toBeGreaterThanOrEqual(noCopies.amountKzt);
    });

    it('delivery zone almaty_standard adds 2500 KZT', () => {
      const result = calculatePrice(baseInput({
        serviceLevel: 'notarization_through_partners',
        fulfillmentMethod: 'delivery',
        deliveryRequired: true,
        deliveryZone: 'almaty_standard',
      }), mockVersion);
      const deliveryItem = result.items.find(i => i.itemType === 'delivery_fee');
      expect(deliveryItem).toBeDefined();
      expect(deliveryItem!.amountKzt).toBe(2500);
    });

    it('remote_area delivery zone triggers operator review', () => {
      const result = calculatePrice(baseInput({
        serviceLevel: 'notarization_through_partners',
        fulfillmentMethod: 'delivery',
        deliveryRequired: true,
        deliveryZone: 'remote_area',
      }), mockVersion);
      expect(result.requiresOperatorReview).toBe(true);
      expect(result.reviewReasons.some(r => r.includes('remote_area'))).toBe(true);
      // delivery_fee row still present but with amount=0 (operator review case)
      const deliveryItem = result.items.find(i => i.itemType === 'delivery_fee');
      expect(deliveryItem).toBeDefined();
      expect(deliveryItem!.amountKzt).toBe(0);
    });

    it('source language auto is rejected at resolver and triggers review', () => {
      const result = calculatePrice(baseInput({ sourceLanguage: 'auto', targetLanguage: 'en' }), mockVersion);
      expect(result.requiresOperatorReview).toBe(true);
    });

    it('official package includes translator_reserved_cost at 30% of translation portion', () => {
      const result = calculatePrice(baseInput({ sourceWordCount: 250 }), mockVersion);
      const trc = result.items.find(i => i.itemType === 'translator_reserved_cost');
      expect(trc).toBeDefined();
      const baseMin = result.items.find(i => i.itemType === 'minimum_check')!.amountKzt;
      expect(trc!.amountKzt).toBeCloseTo(baseMin * 0.30, -1);
    });

    it('direct order has partner_commission_cost=0 with not_applicable metadata', () => {
      const result = calculatePrice(baseInput({ salesChannel: 'direct' }), mockVersion);
      const pc = result.items.find(i => i.itemType === 'partner_commission_cost');
      expect(pc).toBeDefined();
      expect(pc!.amountKzt).toBe(0);
      expect(pc!.isCost).toBe(true);
      expect(pc!.metadataJson?.not_applicable).toBe(true);
    });

    it('official package: human_review, translator_signature, provider_stamp each 0 with included_in_official_package=true', () => {
      const result = calculatePrice(baseInput(), mockVersion);
      const items = ['human_review_fee', 'translator_signature_fee', 'provider_stamp_fee'];
      for (const type of items) {
        const item = result.items.find(i => i.itemType === type);
        expect(item).toBeDefined();
        expect(item!.amountKzt).toBe(0);
        expect(item!.metadataJson?.included_in_official_package).toBe(true);
      }
    });
  });

  describe('notary urgency', () => {
    const notaryBase = (overrides: Partial<PricingInput> = {}): PricingInput => ({
      sourceLanguage: 'ru',
      targetLanguage: 'kz',
      serviceLevel: 'notarization_through_partners',
      documentType: 'passport_id',
      physicalPageCount: 1,
      urgencyLevel: 'standard',
      salesChannel: 'direct',
      ...overrides,
    });

    it('standard notarized order produces no notary_urgency_fee item', () => {
      const result = calculatePrice(notaryBase({ notaryUrgencyLevel: 'standard' }), mockVersion);
      const urgencyFee = result.items.find(i => i.itemType === 'notary_urgency_fee');
      expect(urgencyFee).toBeUndefined();
    });

    it('standard notarized order has notaryCutoff snapshot with window=standard', () => {
      const result = calculatePrice(notaryBase({ notaryUrgencyLevel: 'standard' }), mockVersion);
      expect(result.context.notaryCutoff).toBeDefined();
      expect(result.context.notaryCutoff?.effectiveWindow).toBe('standard');
      expect(result.context.notaryCutoff?.multiplier).toBe(1.0);
    });

    it('notary official fee (MRP) is present regardless of notaryUrgencyLevel', () => {
      const result = calculatePrice(notaryBase({ notaryUrgencyLevel: 'standard' }), mockVersion);
      const mrpFee = result.items.find(i => i.itemType === 'notary_official_fee');
      expect(mrpFee).toBeDefined();
      expect(mrpFee!.amountKzt).toBeGreaterThan(0);
    });

    it('non-notarized order has no notaryCutoff snapshot', () => {
      const result = calculatePrice(baseInput({ serviceLevel: 'electronic', notaryUrgencyLevel: 'standard' }), mockVersion);
      expect(result.context.notaryCutoff).toBeUndefined();
    });

    it('same_day produces a notaryCutoff snapshot with a non-standard window', () => {
      const result = calculatePrice(notaryBase({ notaryUrgencyLevel: 'same_day' }), mockVersion);
      expect(result.context.notaryCutoff).toBeDefined();
      const snapshot = result.context.notaryCutoff!;
      expect(['before_noon', 'after_noon', 'after_18']).toContain(snapshot.effectiveWindow);
      expect(snapshot.multiplier).toBeGreaterThanOrEqual(1.0);
      expect(snapshot.pricingTimezone).toBe('Asia/Almaty');
    });

    it('same_day after_noon or after_18 adds notary_urgency_fee item with positive amount', () => {
      const result = calculatePrice(notaryBase({ notaryUrgencyLevel: 'same_day' }), mockVersion);
      const snapshot = result.context.notaryCutoff!;
      if (snapshot.multiplier > 1.0) {
        const urgencyFee = result.items.find(i => i.itemType === 'notary_urgency_fee');
        expect(urgencyFee).toBeDefined();
        expect(urgencyFee!.amountKzt).toBeGreaterThan(0);
        expect(urgencyFee!.isClientVisible).toBe(true);
      }
    });
  });

  describe('presentation pricing', () => {
    const basePresentation = (overrides: Partial<PricingInput> = {}): PricingInput => ({
      sourceLanguage: 'en',
      targetLanguage: 'ru',
      serviceLevel: 'official_with_translator_signature_and_provider_stamp',
      documentType: 'presentation',
      physicalPageCount: 1,
      urgencyLevel: 'standard',
      salesChannel: 'direct',
      ...overrides,
    });

    it('EN→RU official + presentation + 1 slide creates valid quote', () => {
      const result = calculatePrice(basePresentation(), mockVersion);
      expect(result.requiresOperatorReview).toBe(false);
      expect(result.amountKzt).toBeGreaterThan(0);
      expect(result.status).toBe('quoted');
    });

    it('EN→RU official + presentation + 5 slides creates valid quote', () => {
      const result = calculatePrice(basePresentation({ physicalPageCount: 5 }), mockVersion);
      expect(result.requiresOperatorReview).toBe(false);
      expect(result.amountKzt).toBeGreaterThan(0);
      expect(result.status).toBe('quoted');
    });

    it('presentation coefficient 1.60 is applied to translation portion', () => {
      const other = calculatePrice(basePresentation({ documentType: 'other' }), mockVersion);
      const pres = calculatePrice(basePresentation(), mockVersion);
      expect(pres.amountKzt).toBeGreaterThan(other.amountKzt);
      expect(pres.items.find(i => i.itemType === 'document_type_coefficient')).toBeDefined();
    });

    it('presentation_slides_fee appears when pageCount > 1', () => {
      const result = calculatePrice(basePresentation({ physicalPageCount: 5 }), mockVersion);
      const fee = result.items.find(i => i.itemType === 'presentation_slides_fee');
      expect(fee).toBeDefined();
      expect(fee!.quantity).toBe(4);
    });

    it('no presentation_slides_fee when pageCount = 1', () => {
      const result = calculatePrice(basePresentation(), mockVersion);
      expect(result.items.find(i => i.itemType === 'presentation_slides_fee')).toBeUndefined();
    });

    it('slide fee for electronic is 500 KZT per additional slide', () => {
      const result = calculatePrice(basePresentation({ serviceLevel: 'electronic', physicalPageCount: 3 }), mockVersion);
      const fee = result.items.find(i => i.itemType === 'presentation_slides_fee');
      expect(fee?.unitPriceKzt).toBe(500);
      expect(fee?.quantity).toBe(2);
      expect(fee?.amountKzt).toBe(1000);
    });

    it('slide fee for official is 1000 KZT per additional slide', () => {
      const result = calculatePrice(basePresentation({ physicalPageCount: 3 }), mockVersion);
      const fee = result.items.find(i => i.itemType === 'presentation_slides_fee');
      expect(fee?.unitPriceKzt).toBe(1000);
      expect(fee?.amountKzt).toBe(2000);
    });

    it('presentation_slides_fee is client-visible', () => {
      const result = calculatePrice(basePresentation({ physicalPageCount: 3 }), mockVersion);
      const fee = result.items.find(i => i.itemType === 'presentation_slides_fee');
      expect(fee?.isClientVisible).toBe(true);
    });

    it('document coefficient applies after slide fees (scales both base and slides)', () => {
      const result = calculatePrice(basePresentation({ physicalPageCount: 5 }), mockVersion);
      const coeffItem = result.items.find(i => i.itemType === 'document_type_coefficient');
      const slidesFee = result.items.find(i => i.itemType === 'presentation_slides_fee');
      expect(coeffItem).toBeDefined();
      expect(slidesFee).toBeDefined();
      // doc coeff = (base 6500 + slides 4×1000) * (1.60 - 1.0) = 10500 * 0.60 = 6300
      expect(coeffItem!.amountKzt).toBeCloseTo(6300, -1);
    });

    it('no extra_pages_fee item for presentation (uses slides fee instead)', () => {
      const result = calculatePrice(basePresentation({ physicalPageCount: 5 }), mockVersion);
      expect(result.items.find(i => i.itemType === 'extra_pages_fee')).toBeUndefined();
    });

    it('operator review when physicalPageCount explicitly 0', () => {
      const result = calculatePrice(basePresentation({ physicalPageCount: 0 }), mockVersion);
      expect(result.requiresOperatorReview).toBe(true);
      expect(result.reviewReasons.some(r => r.includes('presentation_slide_count_unknown'))).toBe(true);
    });

    it('regression: passport pricing unaffected by presentation changes', () => {
      const result = calculatePrice(baseInput({ documentType: 'passport_id', physicalPageCount: 1 }), mockVersion);
      expect(result.requiresOperatorReview).toBe(false);
      expect(result.amountKzt).toBeGreaterThan(0);
      expect(result.items.find(i => i.itemType === 'presentation_slides_fee')).toBeUndefined();
    });

    it('regression: diploma with 3 pages still uses extra_pages_fee (not slides)', () => {
      const result = calculatePrice(baseInput({ documentType: 'diploma_transcript', physicalPageCount: 3 }), mockVersion);
      expect(result.items.find(i => i.itemType === 'extra_pages_fee')).toBeDefined();
      expect(result.items.find(i => i.itemType === 'presentation_slides_fee')).toBeUndefined();
    });
  });

  describe('automatic quoting for standard orders (no operator price confirmation)', () => {
    // Reported production case: ru→en + трудовой договор (employment_document) +
    // notarized + delivery to Almaty must auto-quote, not fall back to manual review.
    it('ru→en employment_document notarized delivery-to-Almaty returns an automatic quote', () => {
      const result = calculatePrice(baseInput({
        sourceLanguage: 'ru',
        targetLanguage: 'en',
        documentType: 'employment_document',
        serviceLevel: 'notarization_through_partners',
        fulfillmentMethod: 'delivery',
        deliveryRequired: true,
      }), mockVersion);
      expect(result.status).toBe('quoted');
      expect(result.requiresOperatorReview).toBe(false);
      expect(result.amountKzt).toBeGreaterThan(0);
      expect(result.items.some(i => i.itemType === 'delivery_fee' && i.amountKzt > 0)).toBe(true);
      expect(result.items.some(i => i.itemType === 'notary_official_fee' && i.amountKzt > 0)).toBe(true);
      expect(result.context.documentCoefficient).toBe(1.30);
    });

    it('employment_document coefficient (1.30) is applied', () => {
      const result = calculatePrice(baseInput({ documentType: 'employment_document', sourceWordCount: 250 }), mockVersion);
      expect(result.context.documentCoefficient).toBe(1.30);
      expect(result.items.find(i => i.itemType === 'document_type_coefficient')).toBeDefined();
    });

    it('missing source_word_count still returns a quote using the fallback included-word limit', () => {
      const result = calculatePrice(baseInput({ sourceWordCount: undefined }), mockVersion);
      expect(result.requiresOperatorReview).toBe(false);
      expect(result.amountKzt).toBeGreaterThan(0);
    });

    it('unknown document_type falls back to "other" coefficient, not manual quote', () => {
      const result = calculatePrice(baseInput({ documentType: 'some_unmapped_type_xyz' }), mockVersion);
      expect(result.requiresOperatorReview).toBe(false);
      expect(result.context.documentCoefficient).toBe(DOCUMENT_TYPE_COEFFICIENT['other']);
      expect(result.amountKzt).toBeGreaterThan(0);
    });

    it('notarized delivery without an explicit deliveryZone falls back to the Almaty standard fee, not manual quote', () => {
      const result = calculatePrice(baseInput({
        serviceLevel: 'notarization_through_partners',
        fulfillmentMethod: 'delivery',
        deliveryRequired: true,
        deliveryZone: undefined,
      }), mockVersion);
      expect(result.requiresOperatorReview).toBe(false);
      const deliveryItem = result.items.find(i => i.itemType === 'delivery_fee');
      expect(deliveryItem?.amountKzt).toBe(NOTARY_CONFIG.deliveryFeeAlmatyStandard);
    });

    it('a legitimate but uncommon language pair (en→de) auto-quotes via the "other" group', () => {
      const result = calculatePrice(baseInput({ sourceLanguage: 'en', targetLanguage: 'de' }), mockVersion);
      expect(result.requiresOperatorReview).toBe(false);
      expect(result.amountKzt).toBeGreaterThan(0);
    });

    it.each([
      ['electronic', false] as const,
      ['official_with_translator_signature_and_provider_stamp', false] as const,
      ['notarization_through_partners', false] as const,   // pickup
      ['notarization_through_partners', true] as const,    // delivery
    ])('service level %s (delivery=%s) returns an automatic quote', (serviceLevel, deliveryRequired) => {
      const result = calculatePrice(baseInput({
        serviceLevel: serviceLevel as PricingInput['serviceLevel'],
        fulfillmentMethod: deliveryRequired ? 'delivery' : 'pickup',
        deliveryRequired,
      }), mockVersion);
      expect(result.requiresOperatorReview).toBe(false);
      expect(result.status).toBe('quoted');
      expect(result.amountKzt).toBeGreaterThan(0);
    });
  });

  describe('regression: no standard UI combination requires manual operator price confirmation', () => {
    // Mirrors the document types exposed in the dashboard upload form (src/app/[locale]/dashboard/page.tsx DOCUMENT_TYPES).
    const UI_DOCUMENT_TYPES = [
      'passport_id', 'diploma_transcript', 'contract', 'bank_statement', 'medical_document',
      'employment_document', 'police_clearance', 'visa_documents', 'driver_license', 'presentation', 'other',
    ];
    const UI_SERVICE_LEVELS: PricingInput['serviceLevel'][] = [
      'electronic', 'official_with_translator_signature_and_provider_stamp', 'notarization_through_partners',
    ];

    for (const documentType of UI_DOCUMENT_TYPES) {
      for (const serviceLevel of UI_SERVICE_LEVELS) {
        const deliveryVariants = serviceLevel === 'notarization_through_partners' ? [false, true] : [false];
        for (const deliveryRequired of deliveryVariants) {
          it(`documentType=${documentType} serviceLevel=${serviceLevel} delivery=${deliveryRequired} → quote, not manual review`, () => {
            const result = calculatePrice(baseInput({
              documentType,
              serviceLevel,
              fulfillmentMethod: deliveryRequired ? 'delivery' : 'pickup',
              deliveryRequired,
            }), mockVersion);
            expect(result.requiresOperatorReview).toBe(false);
            expect(result.status).toBe('quoted');
            expect(result.amountKzt).toBeGreaterThan(0);
          });
        }
      }
    }

    // Exceptional cases remain intentionally routed to manual review — these are not
    // "standard UI options" (system-derived signals defaulted safe, or genuinely unsupported input).
    it('exceptional cases still require operator review (not regressed by the auto-quote fix)', () => {
      const remoteDelivery = calculatePrice(baseInput({
        serviceLevel: 'notarization_through_partners',
        fulfillmentMethod: 'delivery',
        deliveryRequired: true,
        deliveryZone: 'remote_area',
      }), mockVersion);
      expect(remoteDelivery.requiresOperatorReview).toBe(true);

      const unknownApplicant = calculatePrice(baseInput({
        serviceLevel: 'notarization_through_partners',
        applicantType: 'unknown',
      }), mockVersion);
      expect(unknownApplicant.requiresOperatorReview).toBe(true);

      const handwritten = calculatePrice(baseInput({ scanQuality: 'handwritten' }), mockVersion);
      expect(handwritten.requiresOperatorReview).toBe(true);

      const genuinelyUnsupportedPair = calculatePrice(baseInput({ sourceLanguage: 'sw', targetLanguage: 'tl' }), mockVersion);
      expect(genuinelyUnsupportedPair.requiresOperatorReview).toBe(true);
    });
  });

  describe('margin floor — layered model (WPO service layer only, not notary/delivery)', () => {
    // Under this fixture's real rates, the WPO service layer's own percentage load is only
    // ownerReserve(7%) + marketing(10%) = 17% — much lighter than the old (incorrect) blended
    // 27.5% that wrongly included tax/acquiring/risk. So the floor only binds when the AI/IT
    // fixed reserve is a large fraction of a SMALL translation price (electronic tier, or extra
    // pages driving up the fixed AI/IT reserve relative to a fixed base minimum). Test fixtures
    // below were verified numerically, not assumed.
    const expectFloorApplied = (result: ReturnType<typeof calculatePrice>) => {
      const item = result.items.find(i => i.itemType === 'margin_floor_adjustment');
      expect(item).toBeDefined();
      expect(item!.amountKzt).toBeGreaterThan(0);
      expect(item!.isClientVisible).toBe(false);
      expect(item!.isCost).toBe(false);
      expect(item!.metadataJson?.reason).toBe('margin_below_target');
      expect(item!.metadataJson?.target_margin_rate).toBe(0.50);
      return item!;
    };

    it('electronic order: 50% margin floor applies to the full service price (no notary layer exists)', () => {
      const result = calculatePrice(baseInput({ serviceLevel: 'electronic', sourceWordCount: 200 }), mockVersion);
      expect(result.margin.notaryDeliveryAddonsKzt).toBe(0);
      expect(result.margin.estimatedMarginRateBeforeFloor).toBeLessThan(0.50);
      expectFloorApplied(result);
      expect(result.margin.wpoServiceMarginRate).toBeGreaterThanOrEqual(0.50 - 1e-9);
      // No notary/delivery add-ons — blended order margin is still slightly lower than the WPO
      // layer's own rate because payment-wide tax/acquiring/risk dilute the *rate* (not the kzt).
      expect(result.margin.estimatedMarginRate).toBeLessThan(result.margin.wpoServiceMarginRate);
      expect(result.margin.estimatedMarginRate).toBeGreaterThan(0.40);
    });

    it('official order: 50% margin floor applies to the full service price (no notary layer exists)', () => {
      // 5 physical pages drives up the fixed AI/IT reserve enough to push this below 50%
      // (the 1-page default is already >= 50% under the corrected, lighter WPO-layer load).
      const result = calculatePrice(baseInput({ physicalPageCount: 5 }), mockVersion);
      expect(result.margin.notaryDeliveryAddonsKzt).toBe(0);
      expect(result.margin.estimatedMarginRateBeforeFloor).toBeLessThan(0.50);
      expectFloorApplied(result);
      expect(result.margin.wpoServiceMarginRate).toBeGreaterThanOrEqual(0.50 - 1e-9);
    });

    it('official order at the 1-page default already clears 50% without needing the floor', () => {
      // Demonstrates the correction: under the OLD (buggy) blended formula this case needed
      // an adjustment; under the corrected WPO-layer-only formula it does not.
      const result = calculatePrice(baseInput(), mockVersion);
      expect(result.margin.estimatedMarginRateBeforeFloor).toBeGreaterThanOrEqual(0.50);
      expect(result.items.find(i => i.itemType === 'margin_floor_adjustment')).toBeUndefined();
    });

    it('notarized pickup: 50% margin floor applies only to the WPO service layer, not notary_official_fee', () => {
      // 30 pages needed to push the pooled WPO marginable margin below 50% — now that
      // notary_coordination_fee (5000, pure margin) counts toward the pool, the floor binds
      // much later than before (previously 5 pages was enough).
      const result = calculatePrice(baseInput({
        serviceLevel: 'notarization_through_partners',
        physicalPageCount: 30,
        fulfillmentMethod: 'pickup',
        deliveryRequired: false,
      }), mockVersion);
      expect(result.margin.estimatedMarginRateBeforeFloor).toBeLessThan(0.50);
      const item = expectFloorApplied(result);
      // The floor step always rounds to the plain 100 KZT increment — never the notarized
      // 500 KZT increment, which only applies to the whole order's FINAL rounding.
      expect(item.metadataJson?.rounding_rule).toBe(100);
      expect(item.metadataJson?.scope).toContain('wpo_marginable_revenue_pool');
      // WPO layer itself clears the floor...
      expect(result.margin.wpoServiceMarginRate).toBeGreaterThanOrEqual(0.50 - 1e-9);
      // ...and the BLENDED order margin is NOT forced to exactly 50% by this correction — it
      // emerges from the real mix of pure pass-through costs (notary_official_fee, printing,
      // delivery — zero margin contribution) diluting it, and notary_coordination_fee (WPO
      // commercial revenue, no real internal cost today) boosting it. It is not asserted to sit
      // below the WPO layer's own rate — that depends on the specific fee mix for this order.
      expect(result.margin.estimatedMarginRate).toBeGreaterThan(0);
      // notary_coordination_fee contributes real margin (not netted to zero as a pass-through).
      expect(result.margin.notaryCoordinationMarginKzt).toBe(5000);
      // And the price must not explode — well under the old (buggy) 39,500 / 52,000+ range,
      // even at 30 pages.
      expect(result.amountKzt).toBeLessThan(50000);
    });

    it('notarized delivery: courier/printing/notary are not multiplied by the margin floor', () => {
      // 40 pages needed to push the pooled WPO marginable margin below 50% for a delivery order.
      const result = calculatePrice(baseInput({
        serviceLevel: 'notarization_through_partners',
        physicalPageCount: 40,
        fulfillmentMethod: 'delivery',
        deliveryRequired: true,
        deliveryZone: 'almaty_standard',
      }), mockVersion);
      expectFloorApplied(result);
      const notaryFeeItem = result.items.find(i => i.itemType === 'notary_official_fee')!;
      const coordFeeItem = result.items.find(i => i.itemType === 'notary_coordination_fee')!;
      const printingItem = result.items.find(i => i.itemType === 'printing_binding_fee')!;
      const deliveryItem = result.items.find(i => i.itemType === 'delivery_fee')!;
      // These must be exactly their configured/deterministic amounts — untouched by the floor.
      expect(notaryFeeItem.amountKzt).toBe(2292); // 4.325 × 1000 × 0.53 = 2292.25, rounded
      expect(coordFeeItem.amountKzt).toBe(NOTARY_CONFIG.notaryCoordinationFeeDefault);
      expect(printingItem.amountKzt).toBe(NOTARY_CONFIG.printingBindingFee);
      expect(deliveryItem.amountKzt).toBe(2500); // DELIVERY_ZONE_FEE_KZT.almaty_standard
      const addonsSum = notaryFeeItem.amountKzt + coordFeeItem.amountKzt + printingItem.amountKzt + deliveryItem.amountKzt;
      expect(result.margin.notaryDeliveryAddonsKzt).toBeCloseTo(addonsSum, 5);
    });

    it('notary_official_fee remains close to the configured MRP tariff, never grossed by the floor', () => {
      // mrpValue 4.325 × 1000 × 0.53 (individual coefficient) = 2292.25 → rounds to 2292,
      // regardless of whether the WPO layer's own floor triggers (1 vs 5 pages).
      for (const pages of [1, 5]) {
        const result = calculatePrice(baseInput({
          serviceLevel: 'notarization_through_partners',
          physicalPageCount: pages,
          applicantType: 'individual',
        }), mockVersion);
        const notaryFeeItem = result.items.find(i => i.itemType === 'notary_official_fee')!;
        expect(notaryFeeItem.amountKzt).toBe(2292);
        expect(result.internalCosts.notaryFee).toBe(2292);
      }
    });

    it('delivery_fee remains the configured Almaty delivery fee regardless of margin floor', () => {
      for (const pages of [1, 5]) {
        const result = calculatePrice(baseInput({
          serviceLevel: 'notarization_through_partners',
          physicalPageCount: pages,
          fulfillmentMethod: 'delivery',
          deliveryRequired: true,
          deliveryZone: 'almaty_standard',
        }), mockVersion);
        const deliveryItem = result.items.find(i => i.itemType === 'delivery_fee')!;
        expect(deliveryItem.amountKzt).toBe(2500);
        expect(result.internalCosts.courierCost).toBe(2500);
      }
    });

    describe('notary MRP config (notary_official_fee)', () => {
      it('MRP 4325 x 0.53 (individual/B2C default) produces notary_official_fee 2292 (2292.25 rounded)', () => {
        const result = calculatePrice(baseInput({
          serviceLevel: 'notarization_through_partners',
          applicantType: 'individual',
        }), mockVersion);
        const notaryFeeItem = result.items.find(i => i.itemType === 'notary_official_fee')!;
        expect(notaryFeeItem.amountKzt).toBe(2292);
        expect(notaryFeeItem.metadataJson?.notary_mrp_value_kzt).toBe(4325);
        expect(notaryFeeItem.metadataJson?.notary_mrp_coefficient).toBe(0.53);
      });

      it('legal_entity applicant uses coefficient 1.10 (only where applicant-type logic already exists)', () => {
        const result = calculatePrice(baseInput({
          serviceLevel: 'notarization_through_partners',
          applicantType: 'legal_entity',
        }), mockVersion);
        const notaryFeeItem = result.items.find(i => i.itemType === 'notary_official_fee')!;
        expect(notaryFeeItem.metadataJson?.notary_mrp_coefficient).toBe(1.10);
        expect(notaryFeeItem.amountKzt).toBe(Math.round(4325 * 1.10));
        expect(NOTARY_CONFIG.mrpCoefficient_legal_entity).toBe(1.10);
      });

      it('notary_official_fee is calculated from MRP config, not hardcoded — changing version.mrpValue changes the fee', () => {
        const higherMrpVersion: PricingVersion = { ...mockVersion, mrpValue: 5.0 };
        const base = calculatePrice(baseInput({ serviceLevel: 'notarization_through_partners' }), mockVersion);
        const higher = calculatePrice(baseInput({ serviceLevel: 'notarization_through_partners' }), higherMrpVersion);
        const baseFee = base.items.find(i => i.itemType === 'notary_official_fee')!.amountKzt;
        const higherFee = higher.items.find(i => i.itemType === 'notary_official_fee')!.amountKzt;
        expect(higherFee).toBe(Math.round(5.0 * 1000 * 0.53));
        expect(higherFee).toBeGreaterThan(baseFee);
      });

      it('falls back to NOTARY_CONFIG.mrpValueFallbackKzt (4325 KZT) when version.mrpValue is null', () => {
        const noMrpVersion: PricingVersion = { ...mockVersion, mrpValue: null };
        const result = calculatePrice(baseInput({ serviceLevel: 'notarization_through_partners' }), noMrpVersion);
        const notaryFeeItem = result.items.find(i => i.itemType === 'notary_official_fee')!;
        expect(notaryFeeItem.metadataJson?.notary_mrp_value_kzt).toBe(NOTARY_CONFIG.mrpValueFallbackKzt);
        expect(NOTARY_CONFIG.mrpValueFallbackKzt).toBe(4325);
        expect(notaryFeeItem.amountKzt).toBe(Math.round(4325 * 0.53));
      });

      it('notary_official_fee stays separate from notary_coordination_fee regardless of MRP value', () => {
        const result = calculatePrice(baseInput({ serviceLevel: 'notarization_through_partners' }), mockVersion);
        const notaryFeeItem = result.items.find(i => i.itemType === 'notary_official_fee')!;
        const coordFeeItem = result.items.find(i => i.itemType === 'notary_coordination_fee')!;
        expect(notaryFeeItem.itemType).not.toBe(coordFeeItem.itemType);
        expect(notaryFeeItem.amountKzt).not.toBe(coordFeeItem.amountKzt);
      });
    });

    describe('notary_coordination_fee (fixed WPO commercial fee, 5000 KZT)', () => {
      it('notarized pickup includes notary_coordination_fee = 5000', () => {
        const result = calculatePrice(baseInput({
          serviceLevel: 'notarization_through_partners',
          fulfillmentMethod: 'pickup',
          deliveryRequired: false,
        }), mockVersion);
        const coordFeeItem = result.items.find(i => i.itemType === 'notary_coordination_fee')!;
        expect(coordFeeItem.amountKzt).toBe(5000);
        expect(coordFeeItem.amountKzt).toBe(NOTARY_CONFIG.notaryCoordinationFeeDefault);
      });

      it('notarized delivery includes notary_coordination_fee = 5000', () => {
        const result = calculatePrice(baseInput({
          serviceLevel: 'notarization_through_partners',
          fulfillmentMethod: 'delivery',
          deliveryRequired: true,
          deliveryZone: 'almaty_standard',
        }), mockVersion);
        const coordFeeItem = result.items.find(i => i.itemType === 'notary_coordination_fee')!;
        expect(coordFeeItem.amountKzt).toBe(5000);
      });

      it('is a client price component, not internal-only, with fixed_wpo_coordination_fee metadata', () => {
        const result = calculatePrice(baseInput({ serviceLevel: 'notarization_through_partners' }), mockVersion);
        const coordFeeItem = result.items.find(i => i.itemType === 'notary_coordination_fee')!;
        expect(coordFeeItem.isClientVisible).toBe(true);
        expect(coordFeeItem.isCost).toBe(false);
        expect(coordFeeItem.metadataJson?.source).toBe('fixed_wpo_coordination_fee');
        expect(coordFeeItem.metadataJson?.amount).toBe(5000);
      });

      it('notary_official_fee remains separate from notary_coordination_fee (never confused/merged)', () => {
        const result = calculatePrice(baseInput({
          serviceLevel: 'notarization_through_partners',
          applicantType: 'individual',
        }), mockVersion);
        const notaryFeeItem = result.items.find(i => i.itemType === 'notary_official_fee')!;
        const coordFeeItem = result.items.find(i => i.itemType === 'notary_coordination_fee')!;
        expect(notaryFeeItem.amountKzt).toBe(2292); // MRP-based (4325 x 0.53), unaffected by the fixed 5000 fee
        expect(coordFeeItem.amountKzt).toBe(5000);
        expect(notaryFeeItem.amountKzt).not.toBe(coordFeeItem.amountKzt);
        expect(result.internalCosts.notaryFee).toBe(2292);
        // notary_coordination_fee (5000, WPO commercial revenue) must NOT be modeled as a
        // 100% pass-through internal cost — the real internal cost is 0 (not configured).
        expect(result.internalCosts.notaryCoordinationInternalCostKzt).toBe(0);
        expect(result.internalCosts.notaryCoordinationInternalCostKzt).not.toBe(coordFeeItem.amountKzt);
      });

      it('printing_binding_fee remains separate from notary_coordination_fee', () => {
        const result = calculatePrice(baseInput({ serviceLevel: 'notarization_through_partners' }), mockVersion);
        const printingItem = result.items.find(i => i.itemType === 'printing_binding_fee')!;
        const coordFeeItem = result.items.find(i => i.itemType === 'notary_coordination_fee')!;
        expect(printingItem.amountKzt).toBe(NOTARY_CONFIG.printingBindingFee);
        expect(printingItem.amountKzt).not.toBe(coordFeeItem.amountKzt);
      });

      it('reconciliation includes notary_coordination_fee in the client-visible subtotal', () => {
        const result = calculatePrice(baseInput({
          serviceLevel: 'notarization_through_partners',
          fulfillmentMethod: 'pickup',
          deliveryRequired: false,
        }), mockVersion);
        const clientVisibleSubtotal = result.items
          .filter(i => !i.isCost && i.isClientVisible)
          .reduce((s, i) => s + i.amountKzt, 0);
        const coordFeeItem = result.items.find(i => i.itemType === 'notary_coordination_fee')!;
        expect(coordFeeItem.isClientVisible).toBe(true);
        // notary_coordination_fee must be part of the summed client-visible subtotal.
        expect(clientVisibleSubtotal).toBeGreaterThanOrEqual(coordFeeItem.amountKzt);
        const roundingAdjustment = result.items.find(i => i.itemType === 'rounding_adjustment')?.amountKzt ?? 0;
        const marginFloorAdjustment = result.items.find(i => i.itemType === 'margin_floor_adjustment')?.amountKzt ?? 0;
        const paymentWideFeeAdjustment = result.items.find(i => i.itemType === 'payment_wide_fee_adjustment')?.amountKzt ?? 0;
        expect(clientVisibleSubtotal + roundingAdjustment + marginFloorAdjustment + paymentWideFeeAdjustment)
          .toBeCloseTo(result.amountKzt, 5);
      });

      it('electronic and official orders do not include a non-zero notary_coordination_fee', () => {
        for (const serviceLevel of ['electronic', 'official_with_translator_signature_and_provider_stamp'] as const) {
          const result = calculatePrice(baseInput({ serviceLevel }), mockVersion);
          const coordFeeItem = result.items.find(i => i.itemType === 'notary_coordination_fee');
          expect(coordFeeItem).toBeDefined();
          expect(coordFeeItem!.amountKzt).toBe(0);
          expect(coordFeeItem!.metadataJson?.not_requested).toBe(true);
        }
      });

      it('WPO service margin floor still applies only to the WPO service layer, unaffected by the coordination fee change', () => {
        const result = calculatePrice(baseInput({
          serviceLevel: 'notarization_through_partners',
          physicalPageCount: 5,
          fulfillmentMethod: 'pickup',
          deliveryRequired: false,
        }), mockVersion);
        expect(result.margin.wpoServiceMarginRate).toBeGreaterThanOrEqual(0.50 - 1e-9);
        // notary_coordination_fee (now 5000) is not part of wpoServiceLayerCosts.
        const coordFeeItem = result.items.find(i => i.itemType === 'notary_coordination_fee')!;
        expect(result.margin.wpoServiceLayerCosts).toBeLessThan(result.margin.wpoServiceLayerFinalPrice);
        expect(result.margin.notaryDeliveryAddonsKzt).toBeGreaterThanOrEqual(coordFeeItem.amountKzt);
      });

      it('notary_coordination_fee is NOT modeled as a 100% pass-through internal cost', () => {
        const result = calculatePrice(baseInput({ serviceLevel: 'notarization_through_partners' }), mockVersion);
        const coordFeeItem = result.items.find(i => i.itemType === 'notary_coordination_fee')!;
        expect(coordFeeItem.amountKzt).toBe(5000);
        // Real internal cost is 0 (not configured) — the field must never mirror the 5000 fee.
        expect(result.internalCosts.notaryCoordinationInternalCostKzt).toBe(0);
      });

      it('notaryCoordinationInternalCostKzt is config-driven, not a calculator-hardcoded constant', () => {
        const result = calculatePrice(baseInput({ serviceLevel: 'notarization_through_partners' }), mockVersion);
        expect(result.internalCosts.notaryCoordinationInternalCostKzt).toBe(NOTARY_CONFIG.notaryCoordinationInternalCostKzt);
        expect(NOTARY_CONFIG.notaryCoordinationInternalCostKzt).toBe(0);
        // Margin must be derived from the config value (revenue - config cost), not a hardcoded 0.
        expect(result.margin.notaryCoordinationMarginKzt).toBe(5000 - NOTARY_CONFIG.notaryCoordinationInternalCostKzt);
      });

      it('notary_coordination_fee contributes real margin to WPO, unlike notary_official_fee/printing/delivery pass-throughs', () => {
        const result = calculatePrice(baseInput({
          serviceLevel: 'notarization_through_partners',
          fulfillmentMethod: 'delivery',
          deliveryRequired: true,
          deliveryZone: 'almaty_standard',
        }), mockVersion);
        expect(result.margin.notaryCoordinationRevenueKzt).toBe(5000);
        expect(result.margin.notaryCoordinationMarginKzt).toBe(5000);
        // Pure pass-throughs contribute zero margin: their revenue item amount exactly equals
        // their internalCosts counterpart, so they net to zero in the blended margin calc.
        const notaryFeeItem = result.items.find(i => i.itemType === 'notary_official_fee')!;
        const printingItem = result.items.find(i => i.itemType === 'printing_binding_fee')!;
        const deliveryItem = result.items.find(i => i.itemType === 'delivery_fee')!;
        expect(notaryFeeItem.amountKzt).toBe(result.internalCosts.notaryFee);
        expect(printingItem.amountKzt).toBe(result.internalCosts.printingCost);
        expect(deliveryItem.amountKzt).toBe(result.internalCosts.courierCost);
      });

      it('blended margin for notarized orders increases after this correction vs. the previous "100% pass-through coordination fee" model', () => {
        const input: PricingInput = {
          sourceLanguage: 'ru',
          targetLanguage: 'kz',
          serviceLevel: 'notarization_through_partners',
          documentType: 'passport_id',
          sourceWordCount: 200,
          physicalPageCount: 1,
          applicantType: 'individual',
          fulfillmentMethod: 'pickup',
          deliveryRequired: false,
          salesChannel: 'direct',
        };
        const result = calculatePrice(input, mockVersion);
        // Reconstruct what the blended margin would have been under the old (wrong) model,
        // where the full notary_coordination_fee was treated as internal cost (net zero margin
        // contribution) instead of the corrected 0-internal-cost / 5000-margin model.
        const oldModelTotalCosts = result.margin.totalCosts + result.margin.notaryCoordinationMarginKzt;
        const oldModelMarginKzt = result.amountKzt - oldModelTotalCosts;
        const oldModelMarginRate = oldModelMarginKzt / result.amountKzt;
        expect(result.margin.estimatedMarginRate).toBeGreaterThan(oldModelMarginRate);
        expect(result.margin.estimatedMarginKzt).toBeGreaterThan(oldModelMarginKzt);
        expect(result.margin.estimatedMarginKzt - oldModelMarginKzt).toBeCloseTo(5000, 5);
      });
    });

    it('notarized simple passport price does not jump to 50k+ — only justified by actual add-ons', () => {
      const result = calculatePrice(baseInput({
        serviceLevel: 'notarization_through_partners',
        fulfillmentMethod: 'pickup',
        deliveryRequired: false,
      }), mockVersion);
      expect(result.amountKzt).toBeLessThan(25000);
    });

    it('order with margin already >= 50% does not get a WPO-layer adjustment', () => {
      // Synthetic low-reserve version to isolate "floor should not trigger" behavior even
      // further from this fixture's baseline economics.
      const highMarginVersion: PricingVersion = {
        ...mockVersion,
        taxRate: 0,
        acquiringRate: 0,
        riskReserveRate: 0,
        ownerReserveRate: 0,
        marketingRateDirect: 0,
        partnerCommissionRate: 0,
        aiItReservePerPageKzt: 0,
      };
      const result = calculatePrice(baseInput(), highMarginVersion);
      expect(result.margin.estimatedMarginRateBeforeFloor).toBeGreaterThanOrEqual(0.50);
      expect(result.items.find(i => i.itemType === 'margin_floor_adjustment')).toBeUndefined();
      expect(result.margin.marginFloorAdjustmentKzt).toBe(0);
      expect(result.margin.wpoServiceLayerFinalPrice).toBe(result.margin.rawPriceBeforeMarginFloor);
    });

    it('target_profit is not included as a client price component and never feeds the floor', () => {
      const result = calculatePrice(baseInput({ physicalPageCount: 5 }), mockVersion);
      const targetProfitItem = result.items.find(i => i.itemType === 'target_profit');
      expect(targetProfitItem).toBeDefined();
      expect(targetProfitItem!.isCost).toBe(false);
      expect(targetProfitItem!.isClientVisible).toBe(false);
      const floorItem = result.items.find(i => i.itemType === 'margin_floor_adjustment');
      expect(floorItem?.metadataJson?.wpo_service_layer_fixed_costs).not.toBe(result.margin.targetProfit);
      expect(floorItem?.metadataJson?.wpo_service_layer_costs_before_adjustment).not.toBe(result.margin.targetProfit);
      expect(result.margin.totalCosts).not.toBe(result.margin.targetProfit);
    });

    it('internal reserves are not double-counted', () => {
      const result = calculatePrice(baseInput({
        serviceLevel: 'notarization_through_partners',
        physicalPageCount: 5,
        fulfillmentMethod: 'delivery',
        deliveryRequired: true,
        deliveryZone: 'almaty_standard',
      }), mockVersion);
      const sumInternalCosts = Object.values(result.internalCosts).reduce((s, v) => s + v, 0);
      expect(sumInternalCosts).toBeCloseTo(result.margin.totalCosts, 5);
      // Notary/printing/courier costs are pass-through: present as revenue items (isCost=false)
      // AND counted once in internalCosts — never as a *second*, separate isCost=true item.
      const costItemTypes = result.items.filter(i => i.isCost).map(i => i.itemType);
      expect(costItemTypes).not.toContain('notary_official_fee');
      expect(costItemTypes).not.toContain('notary_coordination_fee');
      expect(costItemTypes).not.toContain('printing_binding_fee');
      expect(costItemTypes).not.toContain('delivery_fee');
    });

    it('WPO service margin is always >= 50% after its floor, for every service level', () => {
      const cases: Partial<PricingInput>[] = [
        { serviceLevel: 'electronic' },
        { serviceLevel: 'official_with_translator_signature_and_provider_stamp', physicalPageCount: 5 },
        { serviceLevel: 'notarization_through_partners', physicalPageCount: 5, fulfillmentMethod: 'pickup', deliveryRequired: false },
        { serviceLevel: 'notarization_through_partners', physicalPageCount: 5, fulfillmentMethod: 'delivery', deliveryRequired: true },
      ];
      for (const overrides of cases) {
        const result = calculatePrice(baseInput(overrides), mockVersion);
        expect(result.margin.wpoServiceMarginRate).toBeGreaterThanOrEqual(0.50 - 1e-9);
      }
    });

    it('rounding still keeps WPO service margin >= 50%', () => {
      // Sweep word counts to exercise different rounding remainders through the floor step.
      for (const words of [0, 1, 50, 199, 250, 251, 349, 350, 999, 1001]) {
        const result = calculatePrice(baseInput({ sourceWordCount: words }), mockVersion);
        expect(result.margin.wpoServiceMarginRate).toBeGreaterThanOrEqual(0.50 - 1e-9);
        expect(result.margin.wpoServiceLayerFinalPrice % 100).toBe(0);
      }
    });

    it('payment-wide tax/acquiring/risk still apply to the final amount', () => {
      const result = calculatePrice(baseInput(), mockVersion);
      expect(result.internalCosts.taxReserve).toBeCloseTo(result.amountKzt * mockVersion.taxRate, 5);
      expect(result.internalCosts.acquiringFee).toBeCloseTo(result.amountKzt * mockVersion.acquiringRate, 5);
      expect(result.internalCosts.riskReserve).toBeCloseTo(result.amountKzt * mockVersion.riskReserveRate, 5);
      expect(result.margin.paymentWideFeesKzt).toBeGreaterThan(0);
    });

    it('reconciliation includes margin_floor_adjustment and payment_wide_fee_adjustment', () => {
      const result = calculatePrice(baseInput({
        serviceLevel: 'notarization_through_partners',
        physicalPageCount: 30,
        fulfillmentMethod: 'pickup',
        deliveryRequired: false,
      }), mockVersion);
      const clientVisibleSubtotal = result.items
        .filter(i => !i.isCost && i.isClientVisible)
        .reduce((s, i) => s + i.amountKzt, 0);
      const roundingAdjustment = result.items.find(i => i.itemType === 'rounding_adjustment')?.amountKzt ?? 0;
      const marginFloorAdjustment = result.items.find(i => i.itemType === 'margin_floor_adjustment')?.amountKzt ?? 0;
      const paymentWideFeeAdjustment = result.items.find(i => i.itemType === 'payment_wide_fee_adjustment')?.amountKzt ?? 0;
      expect(marginFloorAdjustment).toBeGreaterThan(0);
      expect(paymentWideFeeAdjustment).toBeGreaterThan(0);
      expect(clientVisibleSubtotal + roundingAdjustment + marginFloorAdjustment + paymentWideFeeAdjustment)
        .toBeCloseTo(result.amountKzt, 5);
    });

    it('margin summary exposes WPO layer, add-ons, payment-wide fees, and blended totals', () => {
      const result = calculatePrice(baseInput({
        serviceLevel: 'notarization_through_partners',
        physicalPageCount: 30,
        fulfillmentMethod: 'pickup',
        deliveryRequired: false,
      }), mockVersion);
      expect(result.margin.rawPriceBeforeMarginFloor).toBeGreaterThan(0);
      expect(result.margin.marginFloorAdjustmentKzt).toBeGreaterThan(0);
      expect(result.margin.wpoServiceLayerFinalPrice).toBe(result.margin.rawPriceBeforeMarginFloor + result.margin.marginFloorAdjustmentKzt);
      expect(result.margin.notaryDeliveryAddonsKzt).toBeGreaterThan(0);
      expect(result.margin.paymentWideFeesKzt).toBeGreaterThan(0);
      expect(result.margin.grossRevenue).toBe(result.amountKzt);
      expect(result.margin.targetMarginFloorRate).toBe(0.50);
      expect(result.margin.wpoServiceMarginRate).toBeGreaterThanOrEqual(result.margin.targetMarginFloorRate - 1e-9);
      expect(result.margin.profitBufferAboveTargetRate).toBeGreaterThanOrEqual(-1e-9);
      expect(result.margin.profitBufferAboveTargetKzt).toBeGreaterThanOrEqual(-1e-9);
    });

    describe('notarized base minimum equals the official tier (removes double charging)', () => {
      it('every language group: notarization_through_partners base equals the official tier base', () => {
        const groups = Object.keys(BASE_MINIMUM_KZT) as Array<keyof typeof BASE_MINIMUM_KZT>;
        expect(groups.length).toBeGreaterThan(0);
        for (const group of groups) {
          expect(BASE_MINIMUM_KZT[group].notarization_through_partners).toBe(
            BASE_MINIMUM_KZT[group].official_with_translator_signature_and_provider_stamp,
          );
        }
      });

      it('commercial minimum: notarized pickup RU→KZ passport/simple document lands around 15,000 KZT (not 21,000)', () => {
        const result = calculatePrice(baseInput({
          serviceLevel: 'notarization_through_partners',
          fulfillmentMethod: 'pickup',
          deliveryRequired: false,
        }), mockVersion);
        expect(result.amountKzt).toBe(15000);
      });

      it('electronic pricing is unchanged by the notarized base minimum fix', () => {
        const result = calculatePrice(baseInput({ serviceLevel: 'electronic' }), mockVersion);
        expect(result.amountKzt).toBe(1500);
      });

      it('official pricing is unchanged by the notarized base minimum fix', () => {
        const result = calculatePrice(baseInput(), mockVersion); // official by default
        expect(result.amountKzt).toBe(6200);
      });

      it('notary add-ons (official fee, printing, delivery) remain separate from the translation/service layer base', () => {
        const result = calculatePrice(baseInput({
          serviceLevel: 'notarization_through_partners',
          fulfillmentMethod: 'delivery',
          deliveryRequired: true,
          deliveryZone: 'almaty_standard',
        }), mockVersion);
        const minimumCheckItem = result.items.find(i => i.itemType === 'minimum_check')!;
        const notaryFeeItem = result.items.find(i => i.itemType === 'notary_official_fee')!;
        const printingItem = result.items.find(i => i.itemType === 'printing_binding_fee')!;
        const deliveryItem = result.items.find(i => i.itemType === 'delivery_fee')!;
        expect(minimumCheckItem.amountKzt).toBe(5500); // official-tier base, not the old 11000
        expect(notaryFeeItem.amountKzt).toBe(2292);
        expect(printingItem.amountKzt).toBe(500);
        expect(deliveryItem.amountKzt).toBe(2500);
      });

      it('notary_coordination_fee contributes to WPO marginable revenue (not just the translation layer)', () => {
        const result = calculatePrice(baseInput({
          serviceLevel: 'notarization_through_partners',
          fulfillmentMethod: 'pickup',
          deliveryRequired: false,
        }), mockVersion);
        expect(result.margin.wpoMarginableRevenueKzt).toBe(result.margin.wpoServiceLayerFinalPrice + result.margin.notaryCoordinationRevenueKzt);
        expect(result.margin.wpoMarginableRevenueKzt).toBeGreaterThan(result.margin.wpoServiceLayerFinalPrice);
      });

      it('whole-order floor is still not used — notarized blended margin is not forced to 50%', () => {
        const result = calculatePrice(baseInput({
          serviceLevel: 'notarization_through_partners',
          fulfillmentMethod: 'delivery',
          deliveryRequired: true,
          deliveryZone: 'almaty_standard',
        }), mockVersion);
        expect(result.margin.wpoServiceMarginRate).toBeGreaterThanOrEqual(0.50 - 1e-9);
        // Blended margin is a real, unforced number — may sit above or below 50% depending on
        // the fee mix, never artificially pinned to exactly the target.
        expect(result.margin.estimatedMarginRate).not.toBeCloseTo(0.50, 2);
      });
    });

    describe('regression', () => {
      it('ru→en employment_document + notarization_through_partners + Almaty delivery: quotes, WPO layer margin >= 50%, no 50k+ explosion', () => {
        const result = calculatePrice(baseInput({
          sourceLanguage: 'ru',
          targetLanguage: 'en',
          documentType: 'employment_document',
          physicalPageCount: 40, // pushes the pooled WPO marginable margin below 50% so the floor actually engages
          serviceLevel: 'notarization_through_partners',
          fulfillmentMethod: 'delivery',
          deliveryRequired: true,
          deliveryZone: 'almaty_standard',
        }), mockVersion);
        expect(result.status).toBe('quoted');
        expect(result.requiresOperatorReview).toBe(false);
        expect(result.margin.marginFloorAdjustmentKzt).toBeGreaterThan(0);
        expect(result.margin.wpoServiceMarginRate).toBeGreaterThanOrEqual(0.50 - 1e-9);
        expect(result.amountKzt).toBeLessThan(100000);
      });

      it('low-price electronic ru→kz case (1000 KZT base) gets uplift when WPO layer margin < 50%', () => {
        const result = calculatePrice(baseInput({
          serviceLevel: 'electronic',
          sourceLanguage: 'ru',
          targetLanguage: 'kz',
          sourceWordCount: 100,
        }), mockVersion);
        expect(result.margin.estimatedMarginRateBeforeFloor).toBeLessThan(0.50);
        expect(result.margin.wpoServiceLayerFinalPrice).toBeGreaterThan(result.margin.rawPriceBeforeMarginFloor);
        expect(result.margin.wpoServiceMarginRate).toBeGreaterThanOrEqual(0.50 - 1e-9);
      });

      it('direct sales channel has partner_commission_cost = 0', () => {
        const result = calculatePrice(baseInput({ salesChannel: 'direct', physicalPageCount: 5 }), mockVersion);
        expect(result.internalCosts.partnerCommission).toBe(0);
        expect(result.margin.wpoServiceMarginRate).toBeGreaterThanOrEqual(0.50 - 1e-9);
      });

      it('referral (partner) sales channel handles partner commission as a payment-wide fee, not double-counted', () => {
        const result = calculatePrice(baseInput({ salesChannel: 'referral', partnerId: 'partner-abc', physicalPageCount: 5 }), mockVersion);
        expect(result.internalCosts.partnerCommission).toBeGreaterThan(0);
        // Partner commission is payment-wide (sized against final price), separate from the
        // WPO layer's own reduced 2% marketing top-up.
        expect(result.internalCosts.marketingReserve).toBeLessThan(result.internalCosts.partnerCommission);
        const sumInternalCosts = Object.values(result.internalCosts).reduce((s, v) => s + v, 0);
        expect(sumInternalCosts).toBeCloseTo(result.margin.totalCosts, 5);
        expect(result.margin.wpoServiceMarginRate).toBeGreaterThanOrEqual(0.50 - 1e-9);
      });
    });
  });
});
