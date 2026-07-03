import type { PricingInput, PricingResult, PricingVersion, QuoteLineItem, QuoteStatus, NotaryCutoffSnapshot } from './types';
import {
  resolveLanguageGroup,
  BASE_MINIMUM_KZT,
  EXTRA_WORD_RATE_KZT,
  ADDITIONAL_PAGE_RATE_KZT,
  DOCUMENT_TYPE_COEFFICIENT,
  URGENCY_COEFFICIENT,
  SCAN_QUALITY_SURCHARGE,
  LAYOUT_COMPLEXITY_CONFIG,
  VISUAL_MARKS_FEE_KZT,
  DELIVERY_ZONE_FEE_KZT,
  NOTARY_APPLICANT_MRP_COEFFICIENT,
  EXTRA_PAPER_COPY_FEE_KZT,
  NOTARY_CONFIG,
  PRICE_ROUNDING_INCREMENT,
  PRESENTATION_SLIDE_FEE_KZT,
  MARGIN_FLOOR_CONFIG,
} from './config';
import { getNotaryCutoffWindow } from './almaty-time';

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
  const scanQuality = input.scanQuality ?? 'normal';
  const layoutComplexity = input.layoutComplexity ?? 'standard';
  const visualMarks = input.visualMarksComplexity ?? 'normal';
  const applicantType = input.applicantType ?? 'individual';
  const extraCopies = Math.max(0, input.extraPaperCopies ?? 0);
  const sourceWords = Math.max(0, input.sourceWordCount ?? 0);
  const physicalPages = Math.max(1, input.physicalPageCount ?? 1);
  const includedWords = 250;
  const includedPages = 1;
  const docType = input.documentType ?? 'other';

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
    metadataJson: { languageGroup: group, serviceLevel, baseMinimum },
  });

  // 2a. Included words/pages — zero-value rows for audit trail
  items.push({
    itemType: 'included_words',
    label: `Included words (up to ${includedWords})`,
    quantity: includedWords,
    unitPriceKzt: 0,
    amountKzt: 0,
    isClientVisible: true,
    isCost: false,
    sortOrder: nextSort(),
    metadataJson: { included_word_count: includedWords, included_in_minimum: true },
  });

  items.push({
    itemType: 'included_pages',
    label: `Included pages (${includedPages})`,
    quantity: includedPages,
    unitPriceKzt: 0,
    amountKzt: 0,
    isClientVisible: true,
    isCost: false,
    sortOrder: nextSort(),
    metadataJson: { included_page_count: includedPages, included_in_minimum: true },
  });

  let translationPortion = baseMinimum;

  // 3. Extra words (beyond 250 included)
  const extraWords = Math.max(0, sourceWords - includedWords);
  if (extraWords > 0) {
    const wordRateKey: 'electronic' | 'official' = serviceLevel === 'electronic' ? 'electronic' : 'official';
    const wordRate = EXTRA_WORD_RATE_KZT[group][wordRateKey];
    const wordAmount = extraWords * wordRate;

    items.push({
      itemType: 'extra_words_fee',
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

  // 4. Additional physical pages (beyond 1 included) — skipped for presentations (see 4b)
  const additionalPages = Math.max(0, physicalPages - includedPages);
  if (docType !== 'presentation' && additionalPages > 0) {
    const pageRateKey: 'electronic' | 'official' = serviceLevel === 'electronic' ? 'electronic' : 'official';
    const pageRate = ADDITIONAL_PAGE_RATE_KZT[pageRateKey][complexity];
    const pageAmount = additionalPages * pageRate;

    items.push({
      itemType: 'extra_pages_fee',
      label: `Extra pages (${additionalPages} pages × ${pageRate} KZT)`,
      quantity: additionalPages,
      unitPriceKzt: pageRate,
      amountKzt: pageAmount,
      isClientVisible: true,
      isCost: false,
      sortOrder: nextSort(),
    });
    translationPortion += pageAmount;
  }

  // 4b. Presentation slides: per-slide fee beyond the 1st included slide
  if (docType === 'presentation') {
    if (input.physicalPageCount != null && input.physicalPageCount < 1) {
      reviewReasons.push('presentation_slide_count_unknown');
    } else if (physicalPages > 1) {
      const additionalSlides = physicalPages - 1;
      const slideRateKey: 'electronic' | 'official' | 'notarized' =
        serviceLevel === 'electronic' ? 'electronic'
        : serviceLevel === 'notarization_through_partners' ? 'notarized'
        : 'official';
      const slideRate = PRESENTATION_SLIDE_FEE_KZT[slideRateKey];
      const slidesFee = additionalSlides * slideRate;

      items.push({
        itemType: 'presentation_slides_fee',
        label: `Дополнительные слайды презентации (${additionalSlides} × ${slideRate} KZT)`,
        quantity: additionalSlides,
        unitPriceKzt: slideRate,
        amountKzt: slidesFee,
        isClientVisible: true,
        isCost: false,
        sortOrder: nextSort(),
        metadataJson: { additionalSlides, slideRate, serviceLevel },
      });
      translationPortion += slidesFee;
    }
  }

  // 5. Document type coefficient (applied to translation portion only)
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
  // Always emit urgency_fee row — zero when standard, non-zero when urgent
  const urgencyCoeffOrReview = URGENCY_COEFFICIENT[urgency] ?? 1.00;
  let urgencyCoeff = 1.00;
  if (urgencyCoeffOrReview === 'operator_review') {
    reviewReasons.push(`Urgency level '${urgency}' requires operator confirmation`);
  } else {
    urgencyCoeff = urgencyCoeffOrReview;
  }
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
  } else if (urgencyCoeffOrReview !== 'operator_review') {
    // Zero-value row: standard urgency — visible in operator audit
    items.push({
      itemType: 'urgency_fee',
      label: `Urgency (${urgency}, standard)`,
      quantity: 1,
      unitPriceKzt: 0,
      amountKzt: 0,
      isClientVisible: false,
      isCost: false,
      sortOrder: nextSort(),
      metadataJson: { urgencyLevel: urgency, included_in_minimum: true },
    });
  }

  // 7. Readability surcharge / scan quality (applied to translation portion after urgency)
  const scanSurchargeOrReview = SCAN_QUALITY_SURCHARGE[scanQuality] ?? 0;
  if (scanSurchargeOrReview === 'operator_review') {
    reviewReasons.push(`Scan quality '${scanQuality}' requires operator review`);
  } else if (scanSurchargeOrReview > 0) {
    const scanFee = Math.round(translationPortion * scanSurchargeOrReview);
    items.push({
      itemType: 'readability_surcharge',
      label: `Readability surcharge (${scanQuality}, +${(scanSurchargeOrReview * 100).toFixed(0)}%)`,
      quantity: 1,
      unitPriceKzt: scanFee,
      amountKzt: scanFee,
      isClientVisible: true,
      isCost: false,
      sortOrder: nextSort(),
      metadataJson: { scanQuality, surchargeRate: scanSurchargeOrReview },
    });
    translationPortion += scanFee;
  }

  // 8. Layout fee (fixed per page or multiplier — applied to translation portion)
  const layoutConfig = LAYOUT_COMPLEXITY_CONFIG[layoutComplexity];
  if (layoutConfig.type === 'operator_review') {
    reviewReasons.push(`Layout complexity '${layoutComplexity}' requires operator review`);
  } else if (layoutConfig.type === 'fixed_per_page' && layoutConfig.feePerPage > 0) {
    const layoutFee = layoutConfig.feePerPage * physicalPages;
    items.push({
      itemType: 'layout_fee',
      label: `Layout complexity (${layoutComplexity}, ${physicalPages} page(s) × ${layoutConfig.feePerPage} KZT)`,
      quantity: physicalPages,
      unitPriceKzt: layoutConfig.feePerPage,
      amountKzt: layoutFee,
      isClientVisible: true,
      isCost: false,
      sortOrder: nextSort(),
      metadataJson: { layoutComplexity, feePerPage: layoutConfig.feePerPage },
    });
    translationPortion += layoutFee;
  } else if (layoutConfig.type === 'translation_portion_multiplier') {
    const layoutFee = Math.round(translationPortion * layoutConfig.multiplier);
    items.push({
      itemType: 'layout_fee',
      label: `Layout complexity (${layoutComplexity}, +${(layoutConfig.multiplier * 100).toFixed(0)}%)`,
      quantity: 1,
      unitPriceKzt: layoutFee,
      amountKzt: layoutFee,
      isClientVisible: true,
      isCost: false,
      sortOrder: nextSort(),
      metadataJson: { layoutComplexity, multiplier: layoutConfig.multiplier },
    });
    translationPortion += layoutFee;
  }

  let subtotal = translationPortion;

  // 9. Official package components (human review, translator signature, provider stamp)
  // For official and notarized service levels: included in minimum (zero amount, with metadata).
  // For electronic: these components do not apply.
  if (serviceLevel !== 'electronic') {
    items.push(
      {
        itemType: 'human_review_fee',
        label: 'Human review (included in package)',
        quantity: 1,
        unitPriceKzt: 0,
        amountKzt: 0,
        isClientVisible: true,
        isCost: false,
        sortOrder: nextSort(),
        metadataJson: { included_in_official_package: true },
      },
      {
        itemType: 'translator_signature_fee',
        label: 'Translator signature (included in package)',
        quantity: 1,
        unitPriceKzt: 0,
        amountKzt: 0,
        isClientVisible: true,
        isCost: false,
        sortOrder: nextSort(),
        metadataJson: { included_in_official_package: true },
      },
      {
        itemType: 'provider_stamp_fee',
        label: 'Provider stamp (included in package)',
        quantity: 1,
        unitPriceKzt: 0,
        amountKzt: 0,
        isClientVisible: true,
        isCost: false,
        sortOrder: nextSort(),
        metadataJson: { included_in_official_package: true },
      },
    );
  }

  // 10. Visual marks fee (added to subtotal, NOT part of translation portion)
  const visualMarksFee = VISUAL_MARKS_FEE_KZT[visualMarks] ?? 0;
  if (visualMarksFee > 0) {
    items.push({
      itemType: 'visual_marks_fee',
      label: `Visual marks (${visualMarks})`,
      quantity: 1,
      unitPriceKzt: visualMarksFee,
      amountKzt: visualMarksFee,
      isClientVisible: true,
      isCost: false,
      sortOrder: nextSort(),
      metadataJson: { visualMarksComplexity: visualMarks },
    });
    subtotal += visualMarksFee;
  }

  // 11. Notary components
  let notaryFee = 0;
  let notaryCoordFee = 0;
  let printingFee = 0;
  let notaryCutoffSnapshot: NotaryCutoffSnapshot | undefined;

  if (serviceLevel === 'notarization_through_partners') {
    const mrpValue = version.mrpValue ?? 3.69;
    const mrpKzt = mrpValue * 1000;

    const mrpCoeffOrReview = NOTARY_APPLICANT_MRP_COEFFICIENT[applicantType];
    let mrpCoeff: number;
    if (mrpCoeffOrReview === 'operator_review') {
      reviewReasons.push(`Applicant type '${applicantType}' requires operator confirmation for notary fee`);
      mrpCoeff = NOTARY_CONFIG.mrpCoefficient_individual;
    } else {
      mrpCoeff = mrpCoeffOrReview;
    }

    notaryFee = Math.round(mrpKzt * mrpCoeff);
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
        metadataJson: { note: 'TODO: confirm with notary', mrpValue, mrpCoeff, applicantType },
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
    // notary_official_fee is a deterministic MRP-based formula, so it can be auto-quoted.
    // Notary slot / translator availability is confirmed by ops after payment, not before —
    // it must never gate whether a price is shown or checkout can start.

    // 11a. Notary urgency — applies ONLY to coordination fee, NOT to MRP-based official fee
    const notaryUrgencyLevel = input.notaryUrgencyLevel ?? 'standard';
    if (notaryUrgencyLevel === 'same_day') {
      const cutoffInfo = getNotaryCutoffWindow();
      const notaryUrgencyMultiplier = cutoffInfo.multiplier;
      notaryCutoffSnapshot = {
        notaryUrgencyLevel,
        effectiveWindow: cutoffInfo.window,
        multiplier: notaryUrgencyMultiplier,
        quoteExpiresAt: cutoffInfo.quoteExpiresAt,
        cutoffAt: cutoffInfo.cutoffAt,
        pricingTimezone: 'Asia/Almaty',
        windowLabel: cutoffInfo.windowLabel,
      };

      if (notaryUrgencyMultiplier > 1.0) {
        const urgencySurcharge = Math.round(notaryCoordFee * (notaryUrgencyMultiplier - 1.0));
        const label =
          cutoffInfo.window === 'after_18'
            ? 'Night notarization surcharge (×2)'
            : 'Same-day notarization surcharge (+50%)';
        items.push({
          itemType: 'notary_urgency_fee',
          label,
          quantity: 1,
          unitPriceKzt: urgencySurcharge,
          amountKzt: urgencySurcharge,
          isClientVisible: true,
          isCost: false,
          sortOrder: nextSort(),
          metadataJson: {
            notaryUrgencyLevel,
            effectiveWindow: cutoffInfo.window,
            multiplier: notaryUrgencyMultiplier,
            pricingTimezone: 'Asia/Almaty',
          },
        });
        subtotal += urgencySurcharge;
      }
    } else {
      notaryCutoffSnapshot = {
        notaryUrgencyLevel: 'standard',
        effectiveWindow: 'standard',
        multiplier: 1.0,
        quoteExpiresAt: '',
        cutoffAt: null,
        pricingTimezone: 'Asia/Almaty',
        windowLabel: 'standard',
      };
    }

    // Extra paper copies (notarization only)
    if (extraCopies > 0) {
      const copiesFee = extraCopies * EXTRA_PAPER_COPY_FEE_KZT;
      items.push({
        itemType: 'extra_paper_copies',
        label: `Extra paper copies (${extraCopies} × ${EXTRA_PAPER_COPY_FEE_KZT} KZT)`,
        quantity: extraCopies,
        unitPriceKzt: EXTRA_PAPER_COPY_FEE_KZT,
        amountKzt: copiesFee,
        isClientVisible: true,
        isCost: false,
        sortOrder: nextSort(),
      });
      subtotal += copiesFee;
    }
  } else {
    // Non-notarized: zero-value rows to show notary was not requested
    items.push(
      {
        itemType: 'notary_official_fee',
        label: 'Notary official fee (not requested)',
        quantity: 1,
        unitPriceKzt: 0,
        amountKzt: 0,
        isClientVisible: false,
        isCost: false,
        sortOrder: nextSort(),
        metadataJson: { not_requested: true },
      },
      {
        itemType: 'notary_coordination_fee',
        label: 'Notary coordination (not requested)',
        quantity: 1,
        unitPriceKzt: 0,
        amountKzt: 0,
        isClientVisible: false,
        isCost: false,
        sortOrder: nextSort(),
        metadataJson: { not_requested: true },
      },
    );
  }

  // 12. Delivery fee
  let deliveryFee = 0;
  let deliveryFeeAdded = false;
  if (input.deliveryRequired && input.fulfillmentMethod === 'delivery') {
    if (input.deliveryZone) {
      const zoneFeeOrReview = DELIVERY_ZONE_FEE_KZT[input.deliveryZone];
      if (zoneFeeOrReview === 'operator_review') {
        reviewReasons.push(`Delivery zone '${input.deliveryZone}' requires operator confirmation`);
      } else {
        deliveryFee = zoneFeeOrReview;
      }
    } else {
      deliveryFee = NOTARY_CONFIG.deliveryFeeAlmatyStandard;
    }
    if (deliveryFee > 0) {
      items.push({
        itemType: 'delivery_fee',
        label: `Delivery (${input.deliveryZone ?? 'almaty_standard'})`,
        quantity: 1,
        unitPriceKzt: deliveryFee,
        amountKzt: deliveryFee,
        isClientVisible: true,
        isCost: false,
        sortOrder: nextSort(),
        metadataJson: { deliveryZone: input.deliveryZone ?? 'almaty_standard' },
      });
      subtotal += deliveryFee;
      deliveryFeeAdded = true;
    }
  }
  if (!deliveryFeeAdded) {
    // Zero-value row: delivery not required — visible in operator audit
    items.push({
      itemType: 'delivery_fee',
      label: 'Delivery (not required)',
      quantity: 1,
      unitPriceKzt: 0,
      amountKzt: 0,
      isClientVisible: false,
      isCost: false,
      sortOrder: nextSort(),
      metadataJson: { delivery_required: false },
    });
  }

  // 13. Fixed internal costs/reserves — these do NOT scale with the final client price.
  // (Unlike tax/acquiring/risk/owner/marketing below, which are configured as a percentage
  // of whatever the client is actually charged.)
  const aiItReserve = version.aiItReservePerPageKzt * physicalPages;
  // Translator cost estimate: 30% of translation portion — fixed once word/page inputs are known.
  const translatorReserved = Math.round(translationPortion * 0.30);

  items.push(
    { itemType: 'ai_it_reserve', label: 'AI/IT reserve', quantity: physicalPages, unitPriceKzt: version.aiItReservePerPageKzt, amountKzt: aiItReserve, isClientVisible: false, isCost: true, sortOrder: nextSort() },
    { itemType: 'translator_reserved_cost', label: 'Translator cost estimate (30% of translation)', quantity: 1, unitPriceKzt: translatorReserved, amountKzt: translatorReserved, isClientVisible: false, isCost: true, sortOrder: nextSort(), metadataJson: { rate: 0.30, translationPortion } },
  );

  // notaryFee/notaryCoordFee/deliveryFee/printingFee are client-charged pass-throughs (their
  // matching revenue items were pushed above in steps 11/12) but are real internal costs too —
  // must be counted here or margin looks inflated for notarized/delivery orders.
  const fixedInternalCosts = aiItReserve + translatorReserved + notaryFee + notaryCoordFee + deliveryFee + printingFee;

  const targetProfit = subtotal * version.targetProfitRate;
  items.push({
    itemType: 'target_profit',
    label: 'Target profit allocation',
    quantity: 1,
    unitPriceKzt: targetProfit,
    amountKzt: targetProfit,
    isClientVisible: false,
    isCost: false,
    sortOrder: nextSort(),
    metadataJson: { rate: version.targetProfitRate },
  });

  // 14. Round the raw client price (normal rounding, before any margin-floor adjustment)
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
  const rawPriceBeforeMarginFloor = roundedAmount;

  // 15. Percentage-of-final-price reserve rate for this order's sales channel. Mirrors the
  // channel logic used below when the actual reserve items are computed: direct pays
  // marketingRateDirect; referral pays partnerCommissionRate plus a flat 2% marketing top-up;
  // any other channel currently contributes 0 (pre-existing gap, unchanged by this feature).
  let marketingOrPartnerRate = 0;
  if (salesChannel === 'direct') {
    marketingOrPartnerRate = version.marketingRateDirect;
  } else if (salesChannel === 'referral') {
    marketingOrPartnerRate = version.partnerCommissionRate + 0.02;
  }
  const percentageReserveRate = version.taxRate + version.acquiringRate + version.riskReserveRate
    + version.ownerReserveRate + marketingOrPartnerRate;

  // 16. Margin floor — automatic pricing floor, never blocks checkout.
  // Tax, Halyk acquiring, risk, owner, and marketing/partner reserves are each a percentage of
  // whatever the client is actually charged — so they must be sized against the FINAL price,
  // not the pre-floor subtotal. Recomputing them at the old subtotal after raising the price
  // would understate real tax/acquiring liability on the higher amount. So:
  //   1. Estimate margin at the raw (pre-floor) price using percentage reserves at that price.
  //   2. If margin < target, solve for the price where fixed costs + percentage reserves
  //      (sized against that same solved-for price) leave exactly the target margin:
  //      price = fixed_costs / (1 - percentage_reserve_rate - target_margin_rate)
  //   3. Round up (rounding only increases price, so it cannot undercut the floor).
  //   4. Recompute the actual percentage-reserve line items against the true final price (§17).
  const targetMarginFloorRate = MARGIN_FLOOR_CONFIG.targetMarginRate[serviceLevel];

  const percentageReserveAtRaw = rawPriceBeforeMarginFloor * percentageReserveRate;
  const totalCostsBeforeFloor = fixedInternalCosts + percentageReserveAtRaw;
  const estimatedMarginBeforeFloor = rawPriceBeforeMarginFloor - totalCostsBeforeFloor;
  const estimatedMarginRateBeforeFloor = rawPriceBeforeMarginFloor > 0
    ? estimatedMarginBeforeFloor / rawPriceBeforeMarginFloor
    : 0;

  let finalAmount = rawPriceBeforeMarginFloor;
  let marginFloorAdjustmentKzt = 0;
  let minimumPriceForMargin: number | null = null;

  if (MARGIN_FLOOR_CONFIG.enableMarginFloor && estimatedMarginRateBeforeFloor < targetMarginFloorRate) {
    const denominator = 1 - percentageReserveRate - targetMarginFloorRate;
    if (denominator <= 0) {
      // Configuration error: the configured percentage reserves plus the target margin exceed
      // 100% of revenue, so no finite price can satisfy the floor. Fail loudly rather than
      // silently emit a quote that doesn't actually meet the margin floor.
      throw new Error(
        `MARGIN_FLOOR_CONFIG_ERROR: percentage reserve rate (${percentageReserveRate}) + target margin rate (${targetMarginFloorRate}) >= 100% for pricing version '${version.code}', service level '${serviceLevel}'. Cannot solve for a valid margin-floor price — fix pricing_versions rates before quoting.`,
      );
    }
    minimumPriceForMargin = fixedInternalCosts / denominator;
    const floorRoundingIncrement = MARGIN_FLOOR_CONFIG.roundingKzt[serviceLevel];
    const flooredAmount = roundToIncrement(
      Math.max(rawPriceBeforeMarginFloor, minimumPriceForMargin),
      floorRoundingIncrement,
    );
    marginFloorAdjustmentKzt = flooredAmount - rawPriceBeforeMarginFloor;
    finalAmount = flooredAmount;

    items.push({
      itemType: 'margin_floor_adjustment',
      label: 'Margin floor adjustment',
      quantity: 1,
      unitPriceKzt: marginFloorAdjustmentKzt,
      amountKzt: marginFloorAdjustmentKzt,
      isClientVisible: false,
      isCost: false,
      sortOrder: nextSort(),
      metadataJson: {
        target_margin_rate: targetMarginFloorRate,
        raw_final_price: rawPriceBeforeMarginFloor,
        fixed_internal_costs: fixedInternalCosts,
        percentage_reserve_rate: percentageReserveRate,
        internal_costs_before_adjustment: totalCostsBeforeFloor,
        estimated_margin_rate_before_adjustment: estimatedMarginRateBeforeFloor,
        minimum_price_for_margin: minimumPriceForMargin,
        rounding_rule: floorRoundingIncrement,
        reason: 'margin_below_target',
      },
    });
  }

  // 17. Recompute percentage-based reserves against the TRUE final price (whether or not the
  // floor moved it) — this is what will actually be charged/processed, so it's what tax and
  // Halyk acquiring fees are really sized against.
  const taxReserve = finalAmount * version.taxRate;
  const acquiringFee = finalAmount * version.acquiringRate;
  const riskReserve = finalAmount * version.riskReserveRate;
  const ownerReserve = finalAmount * version.ownerReserveRate;

  let marketingReserve = 0;
  let partnerCommission = 0;
  if (salesChannel === 'direct') {
    marketingReserve = finalAmount * version.marketingRateDirect;
  } else if (salesChannel === 'referral') {
    partnerCommission = finalAmount * version.partnerCommissionRate;
    marketingReserve = finalAmount * 0.02;
  }

  items.push(
    { itemType: 'tax_reserve',            label: 'Tax reserve (3%)',              quantity: 1, unitPriceKzt: taxReserve,      amountKzt: taxReserve,      isClientVisible: false, isCost: true, sortOrder: nextSort(), metadataJson: { rate: version.taxRate, computedAgainst: 'final_price' } },
    { itemType: 'acquiring_fee_estimate', label: 'Acquiring fee estimate (2.5%)', quantity: 1, unitPriceKzt: acquiringFee,    amountKzt: acquiringFee,    isClientVisible: false, isCost: true, sortOrder: nextSort(), metadataJson: { rate: version.acquiringRate, computedAgainst: 'final_price' } },
    { itemType: 'risk_chargeback_reserve',label: 'Risk/chargeback reserve (5%)',  quantity: 1, unitPriceKzt: riskReserve,     amountKzt: riskReserve,     isClientVisible: false, isCost: true, sortOrder: nextSort(), metadataJson: { rate: version.riskReserveRate, computedAgainst: 'final_price' } },
    { itemType: 'owner_reserve',          label: 'Owner reserve (7%)',            quantity: 1, unitPriceKzt: ownerReserve,    amountKzt: ownerReserve,    isClientVisible: false, isCost: true, sortOrder: nextSort(), metadataJson: { rate: version.ownerReserveRate, computedAgainst: 'final_price' } },
    { itemType: 'marketing_cac_reserve',  label: 'Marketing/CAC reserve',        quantity: 1, unitPriceKzt: marketingReserve, amountKzt: marketingReserve, isClientVisible: false, isCost: true, sortOrder: nextSort(), metadataJson: { computedAgainst: 'final_price' } },
  );

  if (partnerCommission > 0) {
    items.push({
      itemType: 'partner_commission_cost',
      label: 'Partner commission',
      quantity: 1,
      unitPriceKzt: partnerCommission,
      amountKzt: partnerCommission,
      isClientVisible: false,
      isCost: true,
      sortOrder: nextSort(),
      metadataJson: { salesChannel, rate: version.partnerCommissionRate, computedAgainst: 'final_price' },
    });
  } else {
    // Zero-value row: no partner commission for direct sales
    items.push({
      itemType: 'partner_commission_cost',
      label: 'Partner commission (direct — none)',
      quantity: 1,
      unitPriceKzt: 0,
      amountKzt: 0,
      isClientVisible: false,
      isCost: true,
      sortOrder: nextSort(),
      metadataJson: { salesChannel, not_applicable: true },
    });
  }

  const percentageReservesAtFinal = taxReserve + acquiringFee + riskReserve + ownerReserve + marketingReserve + partnerCommission;
  const totalCosts = fixedInternalCosts + percentageReservesAtFinal;
  const estimatedMargin = finalAmount - totalCosts;
  const estimatedMarginRate = finalAmount > 0 ? estimatedMargin / finalAmount : 0;

  const finalStatus: QuoteStatus = reviewReasons.length > 0 ? 'requires_operator_review' : 'quoted';

  return {
    amountKzt: Math.max(0, finalAmount),
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
      grossRevenue: finalAmount,
      totalCosts,
      targetProfit,
      estimatedMarginKzt: estimatedMargin,
      estimatedMarginRate,
      rawPriceBeforeMarginFloor,
      estimatedMarginRateBeforeFloor,
      marginFloorAdjustmentKzt,
      targetMarginFloorRate,
      profitBufferAboveTargetKzt: estimatedMargin - finalAmount * targetMarginFloorRate,
      profitBufferAboveTargetRate: estimatedMarginRate - targetMarginFloorRate,
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
      ...(notaryCutoffSnapshot ? { notaryCutoff: notaryCutoffSnapshot } : {}),
    },
  };
}
