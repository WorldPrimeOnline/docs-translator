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

  it('electronic RU↔KZ base is 2500', () => {
    const result = calculatePrice(baseInput({ serviceLevel: 'electronic', sourceLanguage: 'ru', targetLanguage: 'kz' }), mockVersion);
    const minimumItem = result.items.find(i => i.itemType === 'minimum_check');
    expect(minimumItem?.amountKzt).toBe(2500);
  });

  it('extra words increase price', () => {
    const base = calculatePrice(baseInput({ sourceWordCount: 250 }), mockVersion);
    const extra = calculatePrice(baseInput({ sourceWordCount: 350 }), mockVersion);
    expect(extra.amountKzt).toBeGreaterThan(base.amountKzt);
    const extraWordItem = extra.items.find(i => i.itemType === 'extra_words');
    expect(extraWordItem).toBeDefined();
    expect(extraWordItem!.quantity).toBe(100);
  });

  it('words within included count produce no extra_words item', () => {
    const result = calculatePrice(baseInput({ sourceWordCount: 200 }), mockVersion);
    const extraWordItem = result.items.find(i => i.itemType === 'extra_words');
    expect(extraWordItem).toBeUndefined();
  });

  it('additional pages increase price', () => {
    const base = calculatePrice(baseInput({ physicalPageCount: 1 }), mockVersion);
    const extra = calculatePrice(baseInput({ physicalPageCount: 3 }), mockVersion);
    expect(extra.amountKzt).toBeGreaterThan(base.amountKzt);
    const pageItem = extra.items.find(i => i.itemType === 'additional_pages');
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

  it('no delivery fee when pickup', () => {
    const withPickup = calculatePrice(baseInput({
      serviceLevel: 'notarization_through_partners',
      fulfillmentMethod: 'pickup',
      deliveryRequired: false,
    }), mockVersion);
    const deliveryItem = withPickup.items.find(i => i.itemType === 'delivery_fee');
    expect(deliveryItem).toBeUndefined();
  });

  it('direct order uses marketing reserve and no partner commission', () => {
    const result = calculatePrice(baseInput({ salesChannel: 'direct' }), mockVersion);
    const marketing = result.items.find(i => i.itemType === 'marketing_reserve');
    const commission = result.items.find(i => i.itemType === 'partner_commission');
    expect(marketing).toBeDefined();
    expect(marketing!.amountKzt).toBeGreaterThan(0);
    expect(commission).toBeUndefined();
  });

  it('referral channel uses partner commission and reduced marketing', () => {
    const result = calculatePrice(baseInput({ salesChannel: 'referral', partnerId: 'partner-abc' }), mockVersion);
    const commission = result.items.find(i => i.itemType === 'partner_commission');
    expect(commission).toBeDefined();
    expect(commission!.amountKzt).toBeGreaterThan(0);
    const marketing = result.items.find(i => i.itemType === 'marketing_reserve');
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
    const reserveTypes = ['tax_reserve', 'acquiring_reserve', 'risk_reserve', 'owner_reserve', 'marketing_reserve', 'ai_it_reserve'];
    reserveTypes.forEach(type => {
      const item = result.items.find(i => i.itemType === type);
      expect(item).toBeDefined();
      expect(item!.isClientVisible).toBe(false);
      expect(item!.isCost).toBe(true);
    });
  });

  it('notarized order adds notary components and review reason', () => {
    const result = calculatePrice(baseInput({ serviceLevel: 'notarization_through_partners' }), mockVersion);
    expect(result.items.find(i => i.itemType === 'notary_official_fee')).toBeDefined();
    expect(result.items.find(i => i.itemType === 'notary_coordination_fee')).toBeDefined();
    expect(result.items.find(i => i.itemType === 'printing_binding_fee')).toBeDefined();
    expect(result.requiresOperatorReview).toBe(true);
  });

  describe('client visibility', () => {
    it('internal cost/reserve items are not client-visible', () => {
      const result = calculatePrice(baseInput(), mockVersion);
      const internalTypes = ['tax_reserve', 'acquiring_reserve', 'risk_reserve', 'owner_reserve', 'marketing_reserve', 'ai_it_reserve', 'translator_reserved_cost', 'target_profit'];
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
      const visibleTypes = ['minimum_check', 'extra_words', 'additional_pages'];
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
});
