import type { PricingInput, PricingResult, PricingVersion, QuoteLineItem, QuoteStatus } from './types';
import {
  resolveLanguageGroup,
  BASE_MINIMUM_KZT,
  EXTRA_WORD_RATE_KZT,
  ADDITIONAL_PAGE_RATE_KZT,
  DOCUMENT_TYPE_COEFFICIENT,
  URGENCY_COEFFICIENT,
  NOTARY_CONFIG,
  PRICE_ROUNDING_INCREMENT,
} from './config';

function roundToIncrement(amount: number, increment: number): number {
  return Math.ceil(amount / increment) * increment;
}

export function calculatePrice(input: PricingInput, version: PricingVersion): PricingResult {
  const reviewReasons: string[] = [];
  const items: QuoteLineItem[] = [];
  let sortOrder = 0;
  const nextSort = () => sortOrder++;

  const { serviceLevel } = input;
  const urgency = input.urgencyLevel ?? 'standard';
  const complexity = input.complexity ?? 'simple';
  const salesChannel = input.salesChannel ?? 'direct';
  const sourceWords = Math.max(0, input.sourceWordCount ?? 0);
  const physicalPages = Math.max(1, input.physicalPageCount ?? 1);
  const includedWords = 250;
  const includedPages = 1;

  // 1. Resolve language group
  const { group, requiresReview: langRequiresReview } = resolveLanguageGroup(
    input.sourceLanguage,
    input.targetLanguage,
  );
  const languagePair = `${input.sourceLanguage}→${input.targetLanguage}`;

  if (langRequiresReview) {
    reviewReasons.push(`Language pair '${languagePair}' requires operator confirmation`);
  }

  if (serviceLevel === 'notarization_through_partners' && urgency === 'two_to_four_hours') {
    reviewReasons.push('Urgency "2-4 hours" for notarized orders requires operator confirmation');
  }

  // 2. Base minimum check
  const baseMinimum = BASE_MINIMUM_KZT[group][serviceLevel];

  const serviceLevelShort =
    serviceLevel === 'electronic' ? 'electronic'
    : serviceLevel === 'official_with_translator_signature_and_provider_stamp' ? 'official'
    : 'notarized';

  items.push({
    itemType: 'minimum_check',
    label: `Base minimum (${group}, ${serviceLevelShort})`,
    quantity: 1,
    unitPriceKzt: baseMinimum,
    amountKzt: baseMinimum,
    isClientVisible: true,
    isCost: false,
    sortOrder: nextSort(),
  });

  let translationPortion = baseMinimum;

  // 3. Extra words (beyond 250 included)
  const extraWords = Math.max(0, sourceWords - includedWords);
  if (extraWords > 0) {
    const wordRateKey: 'electronic' | 'official' = serviceLevel === 'electronic' ? 'electronic' : 'official';
    const wordRate = EXTRA_WORD_RATE_KZT[group][wordRateKey];
    const wordAmount = extraWords * wordRate;

    items.push({
      itemType: 'extra_words',
      label: `Extra words (${extraWords} words × ${wordRate} KZT)`,
      quantity: extraWords,
      unitPriceKzt: wordRate,
      amountKzt: wordAmount,
      isClientVisible: true,
      isCost: false,
      sortOrder: nextSort(),
    });
    translationPortion += wordAmount;
  }

  // 4. Additional physical pages (beyond 1 included)
  const additionalPages = Math.max(0, physicalPages - includedPages);
  if (additionalPages > 0) {
    const pageRateKey: 'electronic' | 'official' = serviceLevel === 'electronic' ? 'electronic' : 'official';
    const pageRate = ADDITIONAL_PAGE_RATE_KZT[pageRateKey][complexity];
    const pageAmount = additionalPages * pageRate;

    items.push({
      itemType: 'additional_pages',
      label: `Additional pages (${additionalPages} pages × ${pageRate} KZT)`,
      quantity: additionalPages,
      unitPriceKzt: pageRate,
      amountKzt: pageAmount,
      isClientVisible: true,
      isCost: false,
      sortOrder: nextSort(),
    });
    translationPortion += pageAmount;
  }

  // 5. Document type coefficient (applied to translation portion only)
  const docType = input.documentType ?? 'other';
  const docCoeff = DOCUMENT_TYPE_COEFFICIENT[docType] ?? DOCUMENT_TYPE_COEFFICIENT['other'] ?? 1.10;
  if (docCoeff !== 1.00) {
    const docFee = translationPortion * (docCoeff - 1);
    items.push({
      itemType: 'document_type_coefficient',
      label: `Document complexity (${docType}, ×${docCoeff.toFixed(2)})`,
      quantity: 1,
      unitPriceKzt: docFee,
      amountKzt: docFee,
      isClientVisible: true,
      isCost: false,
      sortOrder: nextSort(),
      metadataJson: { coefficient: docCoeff, documentType: docType },
    });
    translationPortion += docFee;
  }

  // 6. Urgency coefficient (applied to translation/layout portion only)
  const urgencyCoeff = URGENCY_COEFFICIENT[urgency] ?? 1.00;
  if (urgencyCoeff !== 1.00) {
    const urgencyFee = translationPortion * (urgencyCoeff - 1);
    items.push({
      itemType: 'urgency_fee',
      label: `Urgency (${urgency}, ×${urgencyCoeff.toFixed(2)})`,
      quantity: 1,
      unitPriceKzt: urgencyFee,
      amountKzt: urgencyFee,
      isClientVisible: true,
      isCost: false,
      sortOrder: nextSort(),
      metadataJson: { coefficient: urgencyCoeff, urgencyLevel: urgency },
    });
    translationPortion += urgencyFee;
  }

  let subtotal = translationPortion;

  // 7. Official service label (0 cost — baked into base minimum)
  if (serviceLevel === 'official_with_translator_signature_and_provider_stamp') {
    items.push({
      itemType: 'official_service_fee',
      label: 'Official translation service (included in minimum)',
      quantity: 1,
      unitPriceKzt: 0,
      amountKzt: 0,
      isClientVisible: true,
      isCost: false,
      sortOrder: nextSort(),
      metadataJson: { note: 'included in base minimum' },
    });
  }

  // 8. Notary components
  let notaryFee = 0;
  let notaryCoordFee = 0;
  let printingFee = 0;

  if (serviceLevel === 'notarization_through_partners') {
    // MRP-based estimate — requires notary confirmation before production use
    const mrpValue = version.mrpValue ?? 3.69;
    const mrpKzt = mrpValue * 1000; // Approx: 1 MRP ≈ 3690 KZT
    notaryFee = Math.round(mrpKzt * NOTARY_CONFIG.mrpCoefficient_individual);
    notaryCoordFee = NOTARY_CONFIG.notaryCoordinationFeeDefault;
    printingFee = NOTARY_CONFIG.printingBindingFee;

    items.push(
      {
        itemType: 'notary_official_fee',
        label: 'Notary official fee (MRP-based estimate)',
        quantity: 1,
        unitPriceKzt: notaryFee,
        amountKzt: notaryFee,
        isClientVisible: true,
        isCost: false,
        sortOrder: nextSort(),
        metadataJson: { note: 'TODO: confirm with notary', mrpValue, mrpCoeff: NOTARY_CONFIG.mrpCoefficient_individual },
      },
      {
        itemType: 'notary_coordination_fee',
        label: 'Notary coordination',
        quantity: 1,
        unitPriceKzt: notaryCoordFee,
        amountKzt: notaryCoordFee,
        isClientVisible: true,
        isCost: false,
        sortOrder: nextSort(),
      },
      {
        itemType: 'printing_binding_fee',
        label: 'Printing & binding',
        quantity: 1,
        unitPriceKzt: printingFee,
        amountKzt: printingFee,
        isClientVisible: true,
        isCost: false,
        sortOrder: nextSort(),
      },
    );

    subtotal += notaryFee + notaryCoordFee + printingFee;
    reviewReasons.push('Notarized order: MRP-based fee requires notary confirmation before production launch');
  }

  // 9. Delivery
  let deliveryFee = 0;
  if (input.deliveryRequired && input.fulfillmentMethod === 'delivery') {
    deliveryFee = NOTARY_CONFIG.deliveryFeeAlmatyStandard;
    items.push({
      itemType: 'delivery_fee',
      label: 'Delivery (Almaty standard)',
      quantity: 1,
      unitPriceKzt: deliveryFee,
      amountKzt: deliveryFee,
      isClientVisible: true,
      isCost: false,
      sortOrder: nextSort(),
    });
    subtotal += deliveryFee;
  }

  // 10. Internal reserves (hidden from client)
  const aiItReserve = version.aiItReservePerPageKzt * physicalPages;
  const taxReserve = subtotal * version.taxRate;
  const acquiringFee = subtotal * version.acquiringRate;
  const riskReserve = subtotal * version.riskReserveRate;
  const ownerReserve = subtotal * version.ownerReserveRate;

  let marketingReserve = 0;
  let partnerCommission = 0;
  if (salesChannel === 'direct') {
    marketingReserve = subtotal * version.marketingRateDirect;
  } else if (salesChannel === 'referral') {
    partnerCommission = subtotal * version.partnerCommissionRate;
    marketingReserve = subtotal * 0.02;
  }

  // Translator cost estimate: 30% of translation portion
  const translatorReserved = Math.round(translationPortion * 0.30);

  items.push(
    { itemType: 'ai_it_reserve',     label: 'AI/IT reserve',              quantity: physicalPages, unitPriceKzt: version.aiItReservePerPageKzt, amountKzt: aiItReserve,     isClientVisible: false, isCost: true, sortOrder: nextSort() },
    { itemType: 'tax_reserve',       label: 'Tax reserve (3%)',           quantity: 1,             unitPriceKzt: taxReserve,                    amountKzt: taxReserve,      isClientVisible: false, isCost: true, sortOrder: nextSort() },
    { itemType: 'acquiring_reserve', label: 'Acquiring fee (2.5%)',       quantity: 1,             unitPriceKzt: acquiringFee,                  amountKzt: acquiringFee,    isClientVisible: false, isCost: true, sortOrder: nextSort() },
    { itemType: 'risk_reserve',      label: 'Risk/chargeback reserve (5%)', quantity: 1,           unitPriceKzt: riskReserve,                   amountKzt: riskReserve,     isClientVisible: false, isCost: true, sortOrder: nextSort() },
    { itemType: 'owner_reserve',     label: 'Owner reserve (7%)',         quantity: 1,             unitPriceKzt: ownerReserve,                  amountKzt: ownerReserve,    isClientVisible: false, isCost: true, sortOrder: nextSort() },
    { itemType: 'marketing_reserve', label: 'Marketing/CAC reserve',      quantity: 1,             unitPriceKzt: marketingReserve,              amountKzt: marketingReserve, isClientVisible: false, isCost: true, sortOrder: nextSort() },
  );

  if (partnerCommission > 0) {
    items.push({ itemType: 'partner_commission', label: 'Partner commission', quantity: 1, unitPriceKzt: partnerCommission, amountKzt: partnerCommission, isClientVisible: false, isCost: true, sortOrder: nextSort() });
  }

  const targetProfit = subtotal * version.targetProfitRate;

  // 11. Round final client price
  const roundedAmount = roundToIncrement(subtotal, PRICE_ROUNDING_INCREMENT);
  const roundingAdj = roundedAmount - subtotal;
  if (Math.abs(roundingAdj) > 0.01) {
    items.push({
      itemType: 'rounding_adjustment',
      label: 'Rounding adjustment',
      quantity: 1,
      unitPriceKzt: roundingAdj,
      amountKzt: roundingAdj,
      isClientVisible: false,
      isCost: false,
      sortOrder: nextSort(),
    });
  }

  const totalCosts = aiItReserve + taxReserve + acquiringFee + riskReserve + ownerReserve
    + marketingReserve + partnerCommission + translatorReserved + notaryFee + notaryCoordFee;
  const estimatedMargin = roundedAmount - totalCosts;

  const finalStatus: QuoteStatus = reviewReasons.length > 0 ? 'requires_operator_review' : 'quoted';

  return {
    amountKzt: Math.max(0, roundedAmount),
    currency: 'KZT',
    status: finalStatus,
    items,
    pricingVersionId: version.id,
    pricingVersionCode: version.code,
    requiresOperatorReview: reviewReasons.length > 0,
    reviewReasons,
    internalCosts: {
      taxReserve,
      acquiringFee,
      riskReserve,
      ownerReserve,
      marketingReserve,
      partnerCommission,
      aiItReserve,
      translatorReserved,
      notaryFee,
      notaryCoordFee,
      courierCost: deliveryFee,
      printingCost: printingFee,
    },
    margin: {
      grossRevenue: roundedAmount,
      totalCosts,
      targetProfit,
      estimatedMarginKzt: estimatedMargin,
      estimatedMarginRate: roundedAmount > 0 ? estimatedMargin / roundedAmount : 0,
    },
    context: {
      languagePair,
      baseMinimumKzt: baseMinimum,
      extraWords,
      additionalPages,
      documentCoefficient: docCoeff,
      urgencyCoefficient: urgencyCoeff,
      includedWordCount: includedWords,
      includedPageCount: includedPages,
    },
  };
}
