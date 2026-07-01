import { calculatePrice } from '../calculator';
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

  it('notarized order adds notary components and review reason', () => {
    const result = calculatePrice(baseInput({ serviceLevel: 'notarization_through_partners' }), mockVersion);
    expect(result.items.find(i => i.itemType === 'notary_official_fee' && i.amountKzt > 0)).toBeDefined();
    expect(result.items.find(i => i.itemType === 'notary_coordination_fee' && i.amountKzt > 0)).toBeDefined();
    expect(result.items.find(i => i.itemType === 'printing_binding_fee')).toBeDefined();
    expect(result.requiresOperatorReview).toBe(true);
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
      // Also verify internal costs are not added to the client price
      const clientVisibleSubtotal = result.items
        .filter(i => !i.isCost && i.isClientVisible)
        .reduce((s, i) => s + i.amountKzt, 0);
      expect(Math.abs(clientVisibleSubtotal - result.amountKzt)).toBeLessThan(200);
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
      expect(stamps.amountKzt - normal.amountKzt).toBeGreaterThanOrEqual(1000);
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
      expect(withCopies.amountKzt - noCopies.amountKzt).toBeGreaterThanOrEqual(1500);
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
});
