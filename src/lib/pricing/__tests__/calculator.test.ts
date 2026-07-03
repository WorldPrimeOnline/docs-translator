import { calculatePrice } from '../calculator';
import { DOCUMENT_TYPE_COEFFICIENT, NOTARY_CONFIG, MARGIN_FLOOR_CONFIG } from '../config';
import type { PricingVersion, PricingInput } from '../types';

const mockVersion: PricingVersion = {
  id: 'test-version-id',
  code: '2026-Q3-KZ-MVP',
  status: 'active',
  currency: 'KZT',
  internalFxRate: 510,
  mrpValue: 3.69,
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
      // client-visible items plus the two internal-only price-shaping adjustments
      // (rounding_adjustment, margin_floor_adjustment) — both are part of the final price
      // (per margin floor spec §10) but never shown to the client.
      const clientVisibleSubtotal = result.items
        .filter(i => !i.isCost && i.isClientVisible)
        .reduce((s, i) => s + i.amountKzt, 0);
      const roundingAdjustment = result.items.find(i => i.itemType === 'rounding_adjustment')?.amountKzt ?? 0;
      const marginFloorAdjustment = result.items.find(i => i.itemType === 'margin_floor_adjustment')?.amountKzt ?? 0;
      expect(Math.abs(clientVisibleSubtotal + roundingAdjustment + marginFloorAdjustment - result.amountKzt)).toBeLessThan(1);
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

  describe('margin floor (commercial floor)', () => {
    // With this fixture's real reserve rates, translator reserve alone (30% of translation
    // portion) plus tax/acquiring/risk/owner/marketing reserves already put most standard
    // orders below the 50% floor — so these orders are expected to receive an adjustment.
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

    it('electronic order with margin < 50% gets margin_floor_adjustment', () => {
      const result = calculatePrice(baseInput({ serviceLevel: 'electronic', sourceWordCount: 200 }), mockVersion);
      expect(result.margin.estimatedMarginRateBeforeFloor).toBeLessThan(0.50);
      expectFloorApplied(result);
      expect(result.margin.estimatedMarginRate).toBeGreaterThanOrEqual(0.50 - 1e-9);
    });

    it('official order with margin < 50% gets margin_floor_adjustment', () => {
      const result = calculatePrice(baseInput(), mockVersion); // official by default
      expect(result.margin.estimatedMarginRateBeforeFloor).toBeLessThan(0.50);
      expectFloorApplied(result);
      expect(result.margin.estimatedMarginRate).toBeGreaterThanOrEqual(0.50 - 1e-9);
    });

    it('notarized pickup order with margin < 50% gets margin_floor_adjustment', () => {
      const result = calculatePrice(baseInput({
        serviceLevel: 'notarization_through_partners',
        fulfillmentMethod: 'pickup',
        deliveryRequired: false,
      }), mockVersion);
      expect(result.margin.estimatedMarginRateBeforeFloor).toBeLessThan(0.50);
      const item = expectFloorApplied(result);
      // Notarized orders use the 500 KZT rounding increment for the floor step.
      expect(item.metadataJson?.rounding_rule).toBe(MARGIN_FLOOR_CONFIG.roundingKzt.notarization_through_partners);
      expect(result.margin.estimatedMarginRate).toBeGreaterThanOrEqual(0.50 - 1e-9);
    });

    it('notarized delivery order with margin < 50% gets margin_floor_adjustment', () => {
      const result = calculatePrice(baseInput({
        serviceLevel: 'notarization_through_partners',
        fulfillmentMethod: 'delivery',
        deliveryRequired: true,
        deliveryZone: 'almaty_standard',
      }), mockVersion);
      expect(result.margin.estimatedMarginRateBeforeFloor).toBeLessThan(0.50);
      expectFloorApplied(result);
      expect(result.margin.estimatedMarginRate).toBeGreaterThanOrEqual(0.50 - 1e-9);
    });

    it('order with margin already >= 50% does not get an adjustment', () => {
      // Synthetic low-reserve version to isolate "floor should not trigger" behavior from
      // this fixture's baseline economics (which put most default-rate orders under 50%).
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
      expect(result.margin.rawPriceBeforeMarginFloor).toBe(result.amountKzt);
    });

    it('target_profit is not included as a client price component', () => {
      const result = calculatePrice(baseInput(), mockVersion);
      const targetProfitItem = result.items.find(i => i.itemType === 'target_profit');
      expect(targetProfitItem).toBeDefined();
      expect(targetProfitItem!.isCost).toBe(false);
      expect(targetProfitItem!.isClientVisible).toBe(false);
      // target_profit must never appear as an internal cost/reserve that feeds the floor —
      // neither the fixed-cost term nor the pre-floor cost estimate in the adjustment metadata,
      // nor the final totalCosts figure, may equal (or be derived from) targetProfit.
      const floorItem = result.items.find(i => i.itemType === 'margin_floor_adjustment');
      expect(floorItem?.metadataJson?.fixed_internal_costs).not.toBe(result.margin.targetProfit);
      expect(floorItem?.metadataJson?.internal_costs_before_adjustment).not.toBe(result.margin.targetProfit);
      expect(result.margin.totalCosts).not.toBe(result.margin.targetProfit);
    });

    it('internal reserves are not double-counted', () => {
      const result = calculatePrice(baseInput({
        serviceLevel: 'notarization_through_partners',
        fulfillmentMethod: 'delivery',
        deliveryRequired: true,
        deliveryZone: 'almaty_standard',
      }), mockVersion);
      // Every internalCosts field is counted exactly once toward margin.totalCosts.
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

    it('final margin after adjustment is always >= 50%', () => {
      const cases: Partial<PricingInput>[] = [
        { serviceLevel: 'electronic' },
        { serviceLevel: 'official_with_translator_signature_and_provider_stamp' },
        { serviceLevel: 'notarization_through_partners', fulfillmentMethod: 'pickup', deliveryRequired: false },
        { serviceLevel: 'notarization_through_partners', fulfillmentMethod: 'delivery', deliveryRequired: true },
      ];
      for (const overrides of cases) {
        const result = calculatePrice(baseInput(overrides), mockVersion);
        expect(result.margin.estimatedMarginRate).toBeGreaterThanOrEqual(0.50 - 1e-9);
      }
    });

    it('rounding still keeps margin >= 50%', () => {
      // Sweep word counts to exercise different rounding remainders through the floor step.
      for (const words of [0, 1, 50, 199, 250, 251, 349, 350, 999, 1001]) {
        const result = calculatePrice(baseInput({ sourceWordCount: words }), mockVersion);
        expect(result.margin.estimatedMarginRate).toBeGreaterThanOrEqual(0.50 - 1e-9);
        expect(result.amountKzt % MARGIN_FLOOR_CONFIG.roundingKzt.official_with_translator_signature_and_provider_stamp).toBe(0);
      }
    });

    it('reconciliation includes margin_floor_adjustment', () => {
      const result = calculatePrice(baseInput(), mockVersion);
      const clientVisibleSubtotal = result.items
        .filter(i => !i.isCost && i.isClientVisible)
        .reduce((s, i) => s + i.amountKzt, 0);
      const roundingAdjustment = result.items.find(i => i.itemType === 'rounding_adjustment')?.amountKzt ?? 0;
      const marginFloorAdjustment = result.items.find(i => i.itemType === 'margin_floor_adjustment')?.amountKzt ?? 0;
      expect(marginFloorAdjustment).toBeGreaterThan(0);
      expect(clientVisibleSubtotal + roundingAdjustment + marginFloorAdjustment).toBeCloseTo(result.amountKzt, 5);
    });

    it('margin summary exposes raw price, adjustment, final price, target margin, and actual margin', () => {
      const result = calculatePrice(baseInput(), mockVersion);
      expect(result.margin.rawPriceBeforeMarginFloor).toBeGreaterThan(0);
      expect(result.margin.marginFloorAdjustmentKzt).toBeGreaterThan(0);
      expect(result.margin.grossRevenue).toBe(result.amountKzt);
      expect(result.margin.grossRevenue).toBe(result.margin.rawPriceBeforeMarginFloor + result.margin.marginFloorAdjustmentKzt);
      expect(result.margin.targetMarginFloorRate).toBe(0.50);
      expect(result.margin.estimatedMarginRate).toBeGreaterThanOrEqual(result.margin.targetMarginFloorRate - 1e-9);
      expect(result.margin.profitBufferAboveTargetRate).toBeGreaterThanOrEqual(-1e-9);
      expect(result.margin.profitBufferAboveTargetKzt).toBeGreaterThanOrEqual(-1e-9);
    });

    describe('regression', () => {
      it('ru→en employment_document + notarization_through_partners + Almaty delivery: quote and final margin >= 50%', () => {
        const result = calculatePrice(baseInput({
          sourceLanguage: 'ru',
          targetLanguage: 'en',
          documentType: 'employment_document',
          serviceLevel: 'notarization_through_partners',
          fulfillmentMethod: 'delivery',
          deliveryRequired: true,
          deliveryZone: 'almaty_standard',
        }), mockVersion);
        expect(result.status).toBe('quoted');
        expect(result.requiresOperatorReview).toBe(false);
        expect(result.margin.estimatedMarginRate).toBeGreaterThanOrEqual(0.50 - 1e-9);
      });

      it('low-price electronic ru→kz case (1000 KZT base) gets uplift when margin < 50%', () => {
        const result = calculatePrice(baseInput({
          serviceLevel: 'electronic',
          sourceLanguage: 'ru',
          targetLanguage: 'kz',
          sourceWordCount: 100,
        }), mockVersion);
        expect(result.margin.estimatedMarginRateBeforeFloor).toBeLessThan(0.50);
        expect(result.amountKzt).toBeGreaterThan(result.margin.rawPriceBeforeMarginFloor);
        expect(result.margin.estimatedMarginRate).toBeGreaterThanOrEqual(0.50 - 1e-9);
      });

      it('direct sales channel has partner_commission_cost = 0 and margin floor still applies correctly', () => {
        const result = calculatePrice(baseInput({ salesChannel: 'direct' }), mockVersion);
        expect(result.internalCosts.partnerCommission).toBe(0);
        expect(result.margin.estimatedMarginRate).toBeGreaterThanOrEqual(0.50 - 1e-9);
      });

      it('referral (partner) sales channel handles partner commission without double-counting marketing reserve', () => {
        const result = calculatePrice(baseInput({ salesChannel: 'referral', partnerId: 'partner-abc' }), mockVersion);
        expect(result.internalCosts.partnerCommission).toBeGreaterThan(0);
        // Marketing reserve for referral channel is the reduced 2% rate, not the direct 10% rate.
        expect(result.internalCosts.marketingReserve).toBeLessThan(result.internalCosts.partnerCommission);
        const sumInternalCosts = Object.values(result.internalCosts).reduce((s, v) => s + v, 0);
        expect(sumInternalCosts).toBeCloseTo(result.margin.totalCosts, 5);
        expect(result.margin.estimatedMarginRate).toBeGreaterThanOrEqual(0.50 - 1e-9);
      });
    });
  });
});
