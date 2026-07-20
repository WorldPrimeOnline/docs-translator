import type { PricingInput, PricingResult, PricingVersion, QuoteLineItem, QuoteStatus, NotaryCutoffSnapshot, NewModelBreakdown } from './types';
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
  TRANSLATION_PAGE_CHAR_DIVISOR,
  MIN_TRANSLATION_PAGES,
} from './config';
import { getNotaryCutoffWindow } from './almaty-time';
import { toDecimal, roundToKopeks, roundUpToStep, applyRate, charsToPages, computeTranslationAmount, sumMoney, moneyDifference } from './money';

function roundToIncrement(amount: number, increment: number): number {
  return Math.ceil(amount / increment) * increment;
}

/**
 * LEGACY formula — electronic service level only, as of the 2026-07-17 flat-formula rewrite.
 * This function is unchanged, byte-for-byte, from before the rewrite — electronic pricing
 * must remain exactly as it was. Its notary-specific branches are dead code when called with
 * serviceLevel='electronic' (which is the only way calculatePrice() invokes it now), kept only
 * because splitting them out risked introducing a subtle behavior change; safer to leave the
 * whole function untouched and simply stop calling it for official/notary.
 */
function calculateElectronicPrice(input: PricingInput, version: PricingVersion): PricingResult {
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

  // wpoServiceSubtotal: Layer A (translation/WPO service) — this is the ONLY layer the 50%
  // margin floor ever applies to. notaryAddonsTotal: Layer B (notary/courier/printing/delivery
  // pass-through) — added to the final price afterward, never grossed up by the floor.
  let wpoServiceSubtotal = translationPortion;
  let notaryAddonsTotal = 0;

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
    wpoServiceSubtotal += visualMarksFee;
  }

  // 11. Notary components
  let notaryFee = 0;
  let notaryCoordFee = 0;
  let printingFee = 0;
  let notaryCutoffSnapshot: NotaryCutoffSnapshot | undefined;

  if (serviceLevel === 'notarization_through_partners') {
    // version.mrpValue (pricing_versions.mrp_value) is stored "in thousands of KZT" (e.g. 3.69
    // means 3,690 KZT) — that convention is unchanged here. NOTARY_CONFIG.mrpValueFallbackKzt
    // is a plain-KZT fallback used only when the version doesn't carry an mrp_value at all.
    const mrpKzt = version.mrpValue != null ? version.mrpValue * 1000 : NOTARY_CONFIG.mrpValueFallbackKzt;

    // 'unknown' is no longer a submittable value from any customer-facing entry point
    // (OrderForm, upload-card, order-drafts — 2026-07-11 fix: notarized orders now require
    // an explicit individual/legal_entity choice). This branch is defensive-only, for
    // pre-existing legacy jobs rows that may still carry 'unknown' or a malformed value.
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
        metadataJson: {
          note: 'TODO: confirm with notary',
          notary_mrp_value_kzt: mrpKzt,
          notary_mrp_coefficient: mrpCoeff,
          applicantType,
        },
      },
      {
        itemType: 'notary_coordination_fee',
        label: 'Notary coordination (WPO fixed fee)',
        quantity: 1,
        unitPriceKzt: notaryCoordFee,
        amountKzt: notaryCoordFee,
        isClientVisible: true,
        isCost: false,
        sortOrder: nextSort(),
        // Fixed WPO commercial fee — NOT inferred from MRP, NOT the notary_official_fee.
        metadataJson: { source: 'fixed_wpo_coordination_fee', amount: notaryCoordFee },
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

    notaryAddonsTotal += notaryFee + notaryCoordFee + printingFee;
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
        notaryAddonsTotal += urgencySurcharge;
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
      notaryAddonsTotal += copiesFee;
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
      notaryAddonsTotal += deliveryFee;
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

  // 13. WPO service layer — fixed costs. Translator + AI/IT are the only WPO-controlled fixed
  // costs currently modeled (a "fixed ops allocation" bucket was requested but does not exist
  // in this schema yet — see PR notes). These are NEVER notary/courier/printing pass-throughs.
  const aiItReserve = version.aiItReservePerPageKzt * physicalPages;
  const translatorReserved = Math.round(translationPortion * 0.30);

  items.push(
    { itemType: 'ai_it_reserve', label: 'AI/IT reserve', quantity: physicalPages, unitPriceKzt: version.aiItReservePerPageKzt, amountKzt: aiItReserve, isClientVisible: false, isCost: true, sortOrder: nextSort() },
    { itemType: 'translator_reserved_cost', label: 'Translator cost estimate (30% of translation)', quantity: 1, unitPriceKzt: translatorReserved, amountKzt: translatorReserved, isClientVisible: false, isCost: true, sortOrder: nextSort(), metadataJson: { rate: 0.30, translationPortion } },
  );

  const wpoServiceLayerFixedCosts = aiItReserve + translatorReserved;

  // target_profit is a benchmark only (never a cost, never fed into any floor formula below).
  // Its basis (wpoServiceSubtotal + notaryAddonsTotal) is unchanged from before this correction.
  const targetProfit = (wpoServiceSubtotal + notaryAddonsTotal) * version.targetProfitRate;
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

  // 14. Round the WPO service layer's raw price (before its own floor step). This layer never
  // includes notary/delivery pass-throughs, so it always uses the plain 100 KZT increment
  // regardless of service level.
  const wpoServiceLayerRawPrice = roundToIncrement(wpoServiceSubtotal, PRICE_ROUNDING_INCREMENT);
  const roundingAdj = wpoServiceLayerRawPrice - wpoServiceSubtotal;
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
  const rawPriceBeforeMarginFloor = wpoServiceLayerRawPrice;

  // 15. WPO service layer's percentage reserve rate: owner reserve + marketing/CAC (or the
  // referral top-up). Tax, Halyk acquiring, risk, and partner commission are PAYMENT-WIDE
  // (§18) — they apply to the whole final client price (WPO layer + notary/delivery add-ons),
  // not just this layer, so they must never gross up the notary official fee.
  let wpoLayerMarketingRate = 0;
  if (salesChannel === 'direct') {
    wpoLayerMarketingRate = version.marketingRateDirect;
  } else if (salesChannel === 'referral') {
    wpoLayerMarketingRate = 0.02; // top-up only; partner commission itself is payment-wide
  }
  const wpoServiceLayerPercentageReserveRate = version.ownerReserveRate + wpoLayerMarketingRate;

  // 16. notary_coordination_fee is WPO's own commercial fee, NOT a pass-through — it is
  // WPO-controlled revenue that must count toward the margin floor, alongside the translation
  // layer. Its real internal cost is config-driven (currently 0 / not configured). Computed
  // here (rather than later) because it's now a required input to the floor formula below.
  const notaryCoordinationInternalCost = NOTARY_CONFIG.notaryCoordinationInternalCostKzt;

  // 17. Margin floor — checked against the WPO MARGINABLE REVENUE POOL, not the translation
  // layer alone: pool = translation/service layer price + notary_coordination_fee (both
  // WPO-controlled revenue). notary_official_fee/printing/delivery are NEVER included here —
  // they are real pass-through costs, added only after this floor step (§19).
  //   1. Estimate the pool's margin at the layer's raw (pre-floor) price + the fixed
  //      coordination fee revenue.
  //   2. If margin < target, solve for the TRANSLATION LAYER's own price that, combined with
  //      the fixed (never-adjusted) coordination fee, leaves exactly the target margin on the
  //      pool: R >= (fixedCosts + notaryCoordinationInternalCost) / denominator - notaryCoordFee.
  //      A large notary_coordination_fee cushion means the translation layer often needs little
  //      or no adjustment — that's the intended effect, not a bug.
  //   3. Round up to the plain 100 KZT increment (never the notarized 500 KZT increment — that
  //      applies only to the whole order's final rounding in §19).
  //   4. Recompute owner/marketing reserves against the TRUE final pool value (§18).
  const targetMarginFloorRate = MARGIN_FLOOR_CONFIG.targetMarginRate[serviceLevel];

  const wpoMarginableRevenueBeforeFloor = wpoServiceLayerRawPrice + notaryCoordFee;
  const wpoMarginableCostsBeforeFloor = wpoServiceLayerFixedCosts + notaryCoordinationInternalCost
    + wpoServiceLayerPercentageReserveRate * wpoMarginableRevenueBeforeFloor;
  const estimatedMarginBeforeFloor = wpoMarginableRevenueBeforeFloor - wpoMarginableCostsBeforeFloor;
  const estimatedMarginRateBeforeFloor = wpoMarginableRevenueBeforeFloor > 0
    ? estimatedMarginBeforeFloor / wpoMarginableRevenueBeforeFloor
    : 0;

  let wpoServiceLayerFinalPrice = wpoServiceLayerRawPrice;
  let marginFloorAdjustmentKzt = 0;
  let minimumPriceForMargin: number | null = null;

  if (MARGIN_FLOOR_CONFIG.enableMarginFloor && estimatedMarginRateBeforeFloor < targetMarginFloorRate) {
    const denominator = 1 - wpoServiceLayerPercentageReserveRate - targetMarginFloorRate;
    if (denominator <= 0) {
      // Configuration error: configured WPO-layer reserves plus the target margin exceed 100%
      // of the marginable pool's revenue, so no finite price can satisfy the floor. Fail loudly
      // rather than silently emit a quote that doesn't actually meet the margin floor.
      throw new Error(
        `MARGIN_FLOOR_CONFIG_ERROR: WPO service layer percentage reserve rate (${wpoServiceLayerPercentageReserveRate}) + target margin rate (${targetMarginFloorRate}) >= 100% for pricing version '${version.code}', service level '${serviceLevel}'. Cannot solve for a valid margin-floor price — fix pricing_versions rates before quoting.`,
      );
    }
    // notary_coordination_fee is fixed/never adjusted — only the translation layer's own price
    // is solved for here. A larger coordination fee reduces how much the layer needs to rise.
    minimumPriceForMargin = (wpoServiceLayerFixedCosts + notaryCoordinationInternalCost) / denominator - notaryCoordFee;
    const flooredAmount = roundToIncrement(
      Math.max(wpoServiceLayerRawPrice, minimumPriceForMargin),
      PRICE_ROUNDING_INCREMENT,
    );
    marginFloorAdjustmentKzt = flooredAmount - wpoServiceLayerRawPrice;
    wpoServiceLayerFinalPrice = flooredAmount;

    items.push({
      itemType: 'margin_floor_adjustment',
      label: 'WPO margin floor adjustment (translation/service layer only)',
      quantity: 1,
      unitPriceKzt: marginFloorAdjustmentKzt,
      amountKzt: marginFloorAdjustmentKzt,
      isClientVisible: false,
      isCost: false,
      sortOrder: nextSort(),
      metadataJson: {
        target_margin_rate: targetMarginFloorRate,
        raw_wpo_service_layer_price: wpoServiceLayerRawPrice,
        notary_coordination_fee_in_pool: notaryCoordFee,
        wpo_marginable_revenue_before_adjustment: wpoMarginableRevenueBeforeFloor,
        wpo_service_layer_fixed_costs: wpoServiceLayerFixedCosts,
        notary_coordination_internal_cost: notaryCoordinationInternalCost,
        wpo_service_layer_percentage_reserve_rate: wpoServiceLayerPercentageReserveRate,
        wpo_marginable_costs_before_adjustment: wpoMarginableCostsBeforeFloor,
        estimated_margin_rate_before_adjustment: estimatedMarginRateBeforeFloor,
        minimum_price_for_margin: minimumPriceForMargin,
        rounding_rule: PRICE_ROUNDING_INCREMENT,
        reason: 'margin_below_target',
        scope: 'wpo_marginable_revenue_pool (translation layer + notary_coordination_fee) — never applied to notary_official_fee, printing, or courier',
      },
    });
  }

  // 18. Recompute the WPO marginable revenue pool against the TRUE final translation-layer
  // price. Owner/marketing reserves scale with the COMBINED pool (not the translation layer
  // alone), since notary_coordination_fee is real WPO-controlled revenue too. For non-notarized
  // orders notaryCoordFee is 0, so this is identical to the translation layer alone — unchanged.
  const wpoMarginableRevenueKzt = wpoServiceLayerFinalPrice + notaryCoordFee;
  const ownerReserve = wpoMarginableRevenueKzt * version.ownerReserveRate;
  let marketingReserve = 0;
  if (salesChannel === 'direct') {
    marketingReserve = wpoMarginableRevenueKzt * version.marketingRateDirect;
  } else if (salesChannel === 'referral') {
    marketingReserve = wpoMarginableRevenueKzt * 0.02;
  }

  items.push(
    { itemType: 'owner_reserve',         label: 'Owner reserve (7%)',     quantity: 1, unitPriceKzt: ownerReserve,    amountKzt: ownerReserve,    isClientVisible: false, isCost: true, sortOrder: nextSort(), metadataJson: { rate: version.ownerReserveRate, computedAgainst: 'wpo_marginable_revenue_pool' } },
    { itemType: 'marketing_cac_reserve', label: 'Marketing/CAC reserve', quantity: 1, unitPriceKzt: marketingReserve, amountKzt: marketingReserve, isClientVisible: false, isCost: true, sortOrder: nextSort(), metadataJson: { computedAgainst: 'wpo_marginable_revenue_pool' } },
  );

  const wpoServiceLayerCosts = wpoServiceLayerFixedCosts + notaryCoordinationInternalCost + ownerReserve + marketingReserve;
  const wpoServiceMarginKzt = wpoMarginableRevenueKzt - wpoServiceLayerCosts;
  const wpoServiceMarginRate = wpoMarginableRevenueKzt > 0 ? wpoServiceMarginKzt / wpoMarginableRevenueKzt : 0;

  // 18. Notary/delivery add-ons (Layer B) — pure pass-through, added AFTER the floor so they can
  // never be grossed up by it. notaryAddonsTotal already accumulated notary_official_fee,
  // notary_coordination_fee, printing_binding_fee, notary_urgency_fee, extra_paper_copies, and
  // delivery_fee as those revenue items were pushed in steps 11/12.
  const finalBeforePaymentWideFees = wpoServiceLayerFinalPrice + notaryAddonsTotal;

  // 19. Payment-wide percentage fees — tax, Halyk acquiring, risk reserve, and (referral)
  // partner commission. These apply to the WHOLE final client price (including notary/delivery)
  // because that's the amount actually processed/invoiced/at chargeback risk — but they must
  // never be a reason to treat notary_official_fee as WPO-marginable revenue.
  const paymentWidePartnerRate = salesChannel === 'referral' ? version.partnerCommissionRate : 0;
  const paymentWideFeeRate = version.taxRate + version.acquiringRate + version.riskReserveRate + paymentWidePartnerRate;
  const finalRoundingIncrement = MARGIN_FLOOR_CONFIG.roundingKzt[serviceLevel];

  let finalClientPrice: number;
  if (paymentWideFeeRate > 0) {
    const paymentWideDenominator = 1 - paymentWideFeeRate;
    if (paymentWideDenominator <= 0) {
      throw new Error(
        `MARGIN_FLOOR_CONFIG_ERROR: payment-wide fee rate (${paymentWideFeeRate}) >= 100% for pricing version '${version.code}'. Cannot solve for a valid final price — fix pricing_versions rates before quoting.`,
      );
    }
    finalClientPrice = roundToIncrement(finalBeforePaymentWideFees / paymentWideDenominator, finalRoundingIncrement);
  } else {
    finalClientPrice = roundToIncrement(finalBeforePaymentWideFees, finalRoundingIncrement);
  }

  // 20. Recompute payment-wide fees against the TRUE final client price.
  const taxReserve = finalClientPrice * version.taxRate;
  const acquiringFee = finalClientPrice * version.acquiringRate;
  const riskReserve = finalClientPrice * version.riskReserveRate;
  const partnerCommission = salesChannel === 'referral' ? finalClientPrice * version.partnerCommissionRate : 0;

  items.push(
    { itemType: 'tax_reserve',            label: 'Tax reserve (3%)',              quantity: 1, unitPriceKzt: taxReserve,     amountKzt: taxReserve,     isClientVisible: false, isCost: true, sortOrder: nextSort(), metadataJson: { rate: version.taxRate, computedAgainst: 'final_client_price' } },
    { itemType: 'acquiring_fee_estimate', label: 'Acquiring fee estimate (2.5%)', quantity: 1, unitPriceKzt: acquiringFee,   amountKzt: acquiringFee,   isClientVisible: false, isCost: true, sortOrder: nextSort(), metadataJson: { rate: version.acquiringRate, computedAgainst: 'final_client_price' } },
    { itemType: 'risk_chargeback_reserve',label: 'Risk/chargeback reserve (5%)',  quantity: 1, unitPriceKzt: riskReserve,    amountKzt: riskReserve,    isClientVisible: false, isCost: true, sortOrder: nextSort(), metadataJson: { rate: version.riskReserveRate, computedAgainst: 'final_client_price' } },
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
      metadataJson: { salesChannel, rate: version.partnerCommissionRate, computedAgainst: 'final_client_price' },
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

  const paymentWideFeesKzt = taxReserve + acquiringFee + riskReserve + partnerCommission;

  // 21. payment_wide_fee_adjustment — the gap between (WPO layer + notary add-ons) and the
  // final client price: the payment-wide fee gross-up plus the final-rounding residual.
  // Internal-only, but part of the final price (reconciliation must include it), same pattern
  // as margin_floor_adjustment and rounding_adjustment above.
  const paymentWideFeeAdjustmentKzt = finalClientPrice - finalBeforePaymentWideFees;
  if (Math.abs(paymentWideFeeAdjustmentKzt) > 0.01) {
    items.push({
      itemType: 'payment_wide_fee_adjustment',
      label: 'Payment-wide fee adjustment (tax/acquiring/risk/partner + final rounding)',
      quantity: 1,
      unitPriceKzt: paymentWideFeeAdjustmentKzt,
      amountKzt: paymentWideFeeAdjustmentKzt,
      isClientVisible: false,
      isCost: false,
      sortOrder: nextSort(),
      metadataJson: {
        payment_wide_fee_rate: paymentWideFeeRate,
        final_before_payment_wide_fees: finalBeforePaymentWideFees,
        final_client_price: finalClientPrice,
        rounding_rule: finalRoundingIncrement,
      },
    });
  }

  // 22. Whole-order (blended) totals — for reporting/backward-compatible top-level fields.
  // Notarized orders are EXPECTED to have a blended rate well below 50% — that's the point of
  // this correction: only the WPO marginable revenue pool is floor-protected, not
  // notary_official_fee/courier/printing.
  //
  // notary_coordination_fee's real internal cost (notaryCoordinationInternalCost, §16) is
  // already counted inside wpoServiceLayerCosts above (it's part of the marginable pool) — do
  // NOT add it again here, or it would be double-counted in the blended totalCosts below.
  const notaryCoordinationMarginKzt = notaryCoordFee - notaryCoordinationInternalCost;

  const notaryDeliveryAddonsKzt = notaryAddonsTotal;
  const notaryDeliveryPassthroughCosts = notaryFee + printingFee + deliveryFee;
  const totalCosts = wpoServiceLayerCosts + notaryDeliveryPassthroughCosts + paymentWideFeesKzt;
  const estimatedMargin = finalClientPrice - totalCosts;
  const estimatedMarginRate = finalClientPrice > 0 ? estimatedMargin / finalClientPrice : 0;

  const finalStatus: QuoteStatus = reviewReasons.length > 0 ? 'requires_operator_review' : 'quoted';

  return {
    amountKzt: Math.max(0, finalClientPrice),
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
      notaryCoordinationInternalCostKzt: notaryCoordinationInternalCost,
      courierCost: deliveryFee,
      printingCost: printingFee,
    },
    margin: {
      grossRevenue: finalClientPrice,
      totalCosts,
      targetProfit,
      estimatedMarginKzt: estimatedMargin,
      estimatedMarginRate,
      rawPriceBeforeMarginFloor,
      estimatedMarginRateBeforeFloor,
      marginFloorAdjustmentKzt,
      targetMarginFloorRate,
      wpoServiceLayerFinalPrice,
      wpoMarginableRevenueKzt,
      wpoServiceLayerCosts,
      wpoServiceMarginKzt,
      wpoServiceMarginRate,
      profitBufferAboveTargetKzt: wpoServiceMarginKzt - wpoMarginableRevenueKzt * targetMarginFloorRate,
      profitBufferAboveTargetRate: wpoServiceMarginRate - targetMarginFloorRate,
      notaryDeliveryAddonsKzt,
      notaryCoordinationRevenueKzt: notaryCoordFee,
      notaryCoordinationMarginKzt,
      paymentWideFeeRate,
      paymentWideFeesKzt,
      paymentWideFeeAdjustmentKzt,
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

/**
 * NEW flat formula (2026-07-17 rewrite) — official_with_translator_signature_and_provider_stamp
 * and notarization_through_partners only. Replaces per-document-type/urgency/scan-quality/
 * layout/visual-marks/presentation modifiers and the two-layer margin-floor mechanism with a
 * transparent T/O/N/C/P/W/M formula. See docs/ai-context/DECISIONS.md (2026-07-17) for the
 * full approved model and worked fixtures.
 *
 * Pure function — never queries the DB itself. The caller (src/lib/pricing/service.ts) resolves
 * `languageRate`, `sourceCharacterCountWithSpaces` (from a completed document_analysis
 * revision), and `partnerCommissionRateOverride` (from partners.commission_rate) before calling
 * this. Missing/invalid required inputs route to operator_review — never a fabricated value.
 */
function calculateOfficialNotaryPrice(input: PricingInput, version: PricingVersion): PricingResult {
  const reviewReasons: string[] = [];
  const items: QuoteLineItem[] = [];
  let sortOrder = 0;
  const nextSort = () => sortOrder++;

  const { serviceLevel } = input;
  const salesChannel = input.salesChannel ?? 'direct';
  const applicantType = input.applicantType ?? 'individual';
  const extraCopies = Math.max(0, input.extraPaperCopies ?? 0);
  const fulfillmentMethod = input.fulfillmentMethod;
  const deliveryRequired = input.deliveryRequired ?? false;
  const languagePair = `${input.sourceLanguage}→${input.targetLanguage}`;

  // 1. Presentations are not yet priced by this formula — forced operator_review.
  if (input.documentType === 'presentation') {
    reviewReasons.push('presentation_pricing_not_yet_supported — presentations require a dedicated pricing flow not yet implemented');
  }

  // 2. Scan quality / layout — non-standard triggers operator_review, NO automatic surcharge
  // (removed per the 2026-07-17 decision — see docs/ai-context/DECISIONS.md).
  const scanQuality = input.scanQuality ?? 'normal';
  if (scanQuality !== 'normal') {
    reviewReasons.push(`Scan quality '${scanQuality}' requires operator review (no automatic surcharge in the new formula)`);
  }
  const layoutComplexity = input.layoutComplexity ?? 'standard';
  if (layoutComplexity !== 'standard') {
    reviewReasons.push(`Layout complexity '${layoutComplexity}' requires operator review (no automatic fee in the new formula)`);
  }
  const visualMarksComplexity = input.visualMarksComplexity ?? 'normal';
  if (visualMarksComplexity !== 'normal') {
    reviewReasons.push(`Visual marks complexity '${visualMarksComplexity}' requires operator review (no automatic surcharge in the new formula — stamps/signatures/QR/photos are standard handling)`);
  }

  // 3. Language rate — resolved by the caller. Missing/inactive/flagged -> operator_review,
  // never a fabricated rate (see src/lib/pricing/service.ts getLanguageRate()).
  const languageRate = input.languageRate;
  let ratePerPage = 0;
  if (!languageRate) {
    reviewReasons.push(`No active language rate found for ${languagePair} — requires operator review`);
  } else {
    ratePerPage = languageRate.rateKztPerTranslationPage;
    if (languageRate.requiresOperatorReview) {
      reviewReasons.push(`Language rate for ${languagePair} is marked requires_operator_review`);
    }
    if (!languageRate.active) {
      reviewReasons.push(`Language rate for ${languagePair} is inactive — requires operator review`);
    }
  }

  // 4. Character count — must come from a completed document_analysis revision, never guessed.
  const characterCount = input.sourceCharacterCountWithSpaces;
  if (characterCount == null || characterCount <= 0) {
    reviewReasons.push('No character count available from document analysis — requires operator review');
  }
  const safeCharacterCount = characterCount != null && characterCount > 0 ? characterCount : 0;
  const translationPageCountExact = Math.max(
    MIN_TRANSLATION_PAGES,
    charsToPages(safeCharacterCount, TRANSLATION_PAGE_CHAR_DIVISOR).toNumber(),
  );

  // 5. T — translation amount, computed directly from the integer character count (never from
  // a previously-rounded page count — see money.ts computeTranslationAmount).
  const T = safeCharacterCount > 0 && ratePerPage > 0
    ? computeTranslationAmount(safeCharacterCount, ratePerPage, TRANSLATION_PAGE_CHAR_DIVISOR)
    : 0;
  if (T > 0) {
    items.push({
      itemType: 'translation_amount',
      label: `Перевод (${translationPageCountExact.toFixed(2)} стр. × ${ratePerPage} ₸)`,
      quantity: translationPageCountExact,
      unitPriceKzt: ratePerPage,
      amountKzt: T,
      isClientVisible: true,
      isCost: false,
      sortOrder: nextSort(),
      metadataJson: {
        sourceCharacterCountWithSpaces: safeCharacterCount,
        translationPageCountExact,
        languageRateId: languageRate?.id ?? null,
      },
    });
  }

  // 6. O — OCR/technical processing, physical pages (cheap pdf-lib page count, no OCR needed).
  const physicalPageCount = Math.max(1, input.physicalPageCount ?? 1);
  const O = roundToKopeks(toDecimal(physicalPageCount).times(version.ocrRatePerPhysicalPageKzt));
  items.push({
    itemType: 'ocr_amount',
    label: `OCR и техническая обработка (${physicalPageCount} стр. × ${version.ocrRatePerPhysicalPageKzt} ₸)`,
    quantity: physicalPageCount,
    unitPriceKzt: version.ocrRatePerPhysicalPageKzt,
    amountKzt: O,
    isClientVisible: true,
    isCost: false,
    sortOrder: nextSort(),
  });

  // 7. N — notary official fee (0 for official; MRP × applicant coefficient for notary).
  // Same MRP-based logic as the legacy formula — unchanged, just no margin-floor step after it.
  let N = 0;
  let notaryPayoutKzt = 0;
  if (serviceLevel === 'notarization_through_partners') {
    const mrpKzt = version.mrpValue != null ? version.mrpValue * 1000 : NOTARY_CONFIG.mrpValueFallbackKzt;
    const mrpCoeffOrReview = NOTARY_APPLICANT_MRP_COEFFICIENT[applicantType];
    let mrpCoeff: number;
    if (mrpCoeffOrReview === 'operator_review') {
      reviewReasons.push(`Applicant type '${applicantType}' requires operator confirmation for notary fee`);
      mrpCoeff = NOTARY_CONFIG.mrpCoefficient_individual;
    } else {
      mrpCoeff = mrpCoeffOrReview;
    }
    N = roundToKopeks(toDecimal(mrpKzt).times(mrpCoeff));
    notaryPayoutKzt = N;
    items.push({
      itemType: 'notary_official_fee',
      label: 'Нотариус (МРП × коэффициент заявителя)',
      quantity: 1,
      unitPriceKzt: N,
      amountKzt: N,
      isClientVisible: true,
      isCost: false,
      sortOrder: nextSort(),
      metadataJson: { mrpKzt, mrpCoeff, applicantType },
    });
  }

  // 8. C — courier, notarization_through_partners + delivery only.
  let C = 0;
  let courierPayoutKzt = 0;
  if (serviceLevel === 'notarization_through_partners' && deliveryRequired && fulfillmentMethod === 'delivery') {
    C = Number(version.courierFeeKzt);
    courierPayoutKzt = C;
    items.push({
      itemType: 'courier_amount',
      label: 'Курьер',
      quantity: 1,
      unitPriceKzt: C,
      amountKzt: C,
      isClientVisible: true,
      isCost: false,
      sortOrder: nextSort(),
    });
  }

  // 9. P — printing/binding (+ extra paper copies, notary only). Both configurable, currently
  // 0 ₸/0 ₸ by default pending real confirmation from the notary partner.
  const basePrintingFee = Number(version.printingFeeKzt) || 0;
  let extraCopiesFee = 0;
  if (serviceLevel === 'notarization_through_partners' && extraCopies > 0) {
    extraCopiesFee = roundToKopeks(toDecimal(extraCopies).times(version.extraPaperCopyFeeKzt));
  }
  const P = roundToKopeks(toDecimal(basePrintingFee).plus(extraCopiesFee));
  const printingCostKzt = P;
  if (basePrintingFee > 0) {
    items.push({
      itemType: 'printing_fee', label: 'Печать/сшивка', quantity: 1,
      unitPriceKzt: basePrintingFee, amountKzt: basePrintingFee,
      isClientVisible: true, isCost: false, sortOrder: nextSort(),
    });
  }
  if (extraCopiesFee > 0) {
    items.push({
      itemType: 'extra_paper_copies',
      label: `Доп. бумажные копии (${extraCopies} × ${version.extraPaperCopyFeeKzt} ₸)`,
      quantity: extraCopies, unitPriceKzt: version.extraPaperCopyFeeKzt, amountKzt: extraCopiesFee,
      isClientVisible: true, isCost: false, sortOrder: nextSort(),
    });
  }

  // 10. W_base / notary urgency / W_final — urgency applies ONLY to the coordination fee, and
  // ONLY for notarization_through_partners (always ×1 for official — see docs/ai-context/DECISIONS.md §6.6).
  // NOT rounded to kopeks here — W_base/W_final are intermediate formula values, not yet a
  // terminal ledger amount. The approved model's own worked examples carry full precision
  // through this step (e.g. "1 587,675 ₸") and round only at genuine terminal points: T (per
  // money.ts computeTranslationAmount), the retail rounding step, and final reserve amounts
  // computed against actualPayment. Rounding here would compound into a visibly wrong
  // componentSubtotal/retail for some inputs.
  const componentsForCoordination = toDecimal(T).plus(N).plus(C).toNumber();
  const W_base = toDecimal(componentsForCoordination).times(version.wpoCoordinationRate).toNumber();

  let notaryUrgencyMultiplier = 1;
  let notaryCutoffSnapshot: NotaryCutoffSnapshot | undefined;
  if (serviceLevel === 'notarization_through_partners') {
    const notaryUrgencyLevel = input.notaryUrgencyLevel ?? 'standard';
    if (notaryUrgencyLevel === 'same_day') {
      const cutoffInfo = getNotaryCutoffWindow(input.nowOverride ? new Date(input.nowOverride) : undefined);
      notaryUrgencyMultiplier = cutoffInfo.multiplier;
      notaryCutoffSnapshot = {
        notaryUrgencyLevel,
        effectiveWindow: cutoffInfo.window,
        multiplier: cutoffInfo.multiplier,
        quoteExpiresAt: cutoffInfo.quoteExpiresAt,
        cutoffAt: cutoffInfo.cutoffAt,
        pricingTimezone: 'Asia/Almaty',
        windowLabel: cutoffInfo.windowLabel,
      };
    } else {
      notaryCutoffSnapshot = {
        notaryUrgencyLevel: 'standard', effectiveWindow: 'standard', multiplier: 1.0,
        quoteExpiresAt: '', cutoffAt: null, pricingTimezone: 'Asia/Almaty', windowLabel: 'standard',
      };
    }
  }
  const W_final = toDecimal(W_base).times(notaryUrgencyMultiplier).toNumber();
  const urgencySurcharge = toDecimal(W_final).minus(W_base).toNumber();

  items.push({
    itemType: 'wpo_coordination_base',
    label: `Базовая комиссия WPO (${(version.wpoCoordinationRate * 100).toFixed(0)}%)`,
    quantity: 1, unitPriceKzt: W_base, amountKzt: W_base,
    isClientVisible: true, isCost: false, sortOrder: nextSort(),
  });
  if (urgencySurcharge > 0) {
    items.push({
      itemType: 'wpo_coordination_urgency_surcharge',
      label: `Надбавка за срочность (×${notaryUrgencyMultiplier.toFixed(1)})`,
      quantity: 1, unitPriceKzt: urgencySurcharge, amountKzt: urgencySurcharge,
      isClientVisible: true, isCost: false, sortOrder: nextSort(),
    });
  }
  items.push({
    itemType: 'wpo_coordination_final',
    label: 'Итоговая комиссия WPO',
    quantity: 1, unitPriceKzt: W_final, amountKzt: W_final,
    isClientVisible: true, isCost: false, sortOrder: nextSort(),
    metadataJson: { coordinationBaseAmountKzt: W_base, notaryUrgencyMultiplier, urgencySurchargeKzt: urgencySurcharge },
  });

  // 11. M — manual adjustment. Pre-quote only; mandatory reason when non-zero (see
  // "Manual adjustment & quote immutability" in docs/ai-context/DECISIONS.md).
  const M = input.manualAdjustmentKzt ?? 0;
  if (M !== 0) {
    if (!input.manualAdjustmentReason || input.manualAdjustmentReason.trim() === '') {
      reviewReasons.push('Manual adjustment requires a reason');
    }
    items.push({
      itemType: 'manual_adjustment',
      label: `Ручная корректировка: ${input.manualAdjustmentReason?.trim() || '(причина не указана)'}`,
      quantity: 1, unitPriceKzt: M, amountKzt: M,
      isClientVisible: true, isCost: false, sortOrder: nextSort(),
    });
  }

  // 12. component_subtotal = T + O + N + C + P + W_final + M — full precision preserved (not
  // rounded to kopeks); only retail_before_rounding/retail below are genuine rounding points.
  const componentSubtotal = toDecimal(T).plus(O).plus(N).plus(C).plus(P).plus(W_final).plus(M).toNumber();

  // 13. Gross-up. Derived from the version's rate columns every time — never stored, so it
  // can never drift from its components (tax + acquiring + risk + marketing + ai_it + owner + channel).
  const grossUpRate = toDecimal(version.taxRate)
    .plus(version.acquiringRate)
    .plus(version.riskReserveRate)
    .plus(version.marketingRateDirect)
    .plus(version.aiItRate)
    .plus(version.ownerReserveRate)
    .plus(version.channelReserveRate)
    .toNumber();
  const oneMinusGrossUp = toDecimal(1).minus(grossUpRate);
  if (oneMinusGrossUp.lte(0)) {
    throw new Error(
      `PRICING_CONFIG_INVALID: gross_up_rate (${grossUpRate}) >= 100% for pricing version '${version.code}'. Cannot solve for a valid price — fix pricing_versions rates before quoting.`,
    );
  }
  const retailBeforeRounding = roundToKopeks(toDecimal(componentSubtotal).dividedBy(oneMinusGrossUp));
  const grossUpAmount = moneyDifference(retailBeforeRounding, componentSubtotal);

  const roundingStep = serviceLevel === 'notarization_through_partners'
    ? version.roundingStepNotaryKzt
    : version.roundingStepOfficialKzt;
  const retailPrice = roundUpToStep(retailBeforeRounding, roundingStep);
  const roundingAdjustment = moneyDifference(retailPrice, retailBeforeRounding);

  // 14. Referral discount — applied to the ROUNDED retail price. Never re-rounded afterward.
  const clientDiscount = salesChannel === 'referral' ? applyRate(retailPrice, version.clientDiscountRate) : 0;
  const actualPayment = moneyDifference(retailPrice, clientDiscount);

  // 15. Partner commission — referral only, from the caller-resolved per-partner rate
  // (partners.commission_rate), falling back to the version-level rate only if no partner
  // record exists. Computed against actualPayment, not retail.
  const partnerCommissionRate = salesChannel === 'referral'
    ? (input.partnerCommissionRateOverride ?? version.partnerCommissionRate)
    : 0;
  const partnerCommissionKzt = salesChannel === 'referral' ? applyRate(actualPayment, partnerCommissionRate) : 0;

  // 16. Reserves — all computed against actualPayment, never retail or the translation rate.
  const taxReserveKzt = applyRate(actualPayment, version.taxRate);
  const acquiringFeeKzt = applyRate(actualPayment, version.acquiringRate);
  const riskReserveKzt = applyRate(actualPayment, version.riskReserveRate);
  const marketingReserveKzt = applyRate(actualPayment, version.marketingRateDirect);
  const aiItReserveKzt = applyRate(actualPayment, version.aiItRate);
  const ownerReserveKzt = applyRate(actualPayment, version.ownerReserveRate);
  const translatorPayoutKzt = applyRate(T, version.translatorPayoutRate);

  // 17. Channel budget — computed against the ROUNDED retail price, never retailBeforeRounding.
  const channelBudgetKzt = applyRate(retailPrice, version.channelReserveRate);
  const unusedChannelReserveKzt = roundToKopeks(
    toDecimal(channelBudgetKzt).minus(clientDiscount).minus(partnerCommissionKzt),
  );
  if (unusedChannelReserveKzt < 0) {
    reviewReasons.push('unused_channel_reserve is negative — channel_reserve_rate configuration cannot cover this discount/commission combination');
  }

  // 18. Result — deliberately NOT called "net profit"/"чистая прибыль" anywhere user-facing;
  // this is margin BEFORE the business's own fixed costs (see NewModelBreakdown doc comment).
  const totalAllocationsKzt = roundToKopeks(
    toDecimal(translatorPayoutKzt)
      .plus(notaryPayoutKzt).plus(courierPayoutKzt).plus(printingCostKzt)
      .plus(taxReserveKzt).plus(acquiringFeeKzt).plus(partnerCommissionKzt)
      .plus(riskReserveKzt).plus(marketingReserveKzt).plus(aiItReserveKzt).plus(ownerReserveKzt)
      .plus(unusedChannelReserveKzt),
  );
  const netProfitWpoKzt = moneyDifference(actualPayment, totalAllocationsKzt);
  const netMargin = actualPayment > 0 ? netProfitWpoKzt / actualPayment : 0;
  const totalInternalReservesKzt = roundToKopeks(
    toDecimal(riskReserveKzt).plus(marketingReserveKzt).plus(aiItReserveKzt).plus(ownerReserveKzt).plus(unusedChannelReserveKzt),
  );
  const totalCashRetainedByWpoKzt = sumMoney(netProfitWpoKzt, totalInternalReservesKzt);
  const reconciliationDifferenceKzt = moneyDifference(actualPayment, sumMoney(totalAllocationsKzt, netProfitWpoKzt));

  const finalStatus: QuoteStatus = reviewReasons.length > 0 ? 'requires_operator_review' : 'quoted';

  const newModel: NewModelBreakdown = {
    translationAmountKzt: T,
    ocrAmountKzt: O,
    notaryAmountKzt: N,
    courierAmountKzt: C,
    printingAmountKzt: P,
    coordinationBaseAmountKzt: W_base,
    notaryUrgencyMultiplier,
    urgencySurchargeKzt: urgencySurcharge,
    coordinationFinalAmountKzt: W_final,
    manualAdjustmentKzt: M,
    componentSubtotalKzt: componentSubtotal,
    grossUpRate,
    grossUpAmountKzt: grossUpAmount,
    retailBeforeRoundingKzt: retailBeforeRounding,
    roundingStepKzt: roundingStep,
    roundingAdjustmentKzt: roundingAdjustment,
    retailPriceKzt: retailPrice,
    salesChannel,
    clientDiscountKzt: clientDiscount,
    actualPaymentKzt: actualPayment,
    partnerCommissionRate,
    channelBudgetKzt,
    unusedChannelReserveKzt,
    translatorPayoutKzt,
    notaryPayoutKzt,
    courierPayoutKzt,
    printingCostKzt,
    acquiringFeeKzt,
    taxReserveKzt,
    partnerCommissionKzt,
    riskReserveKzt,
    marketingReserveKzt,
    aiItReserveKzt,
    ownerReserveKzt,
    totalAllocationsKzt,
    netProfitWpoKzt,
    netMargin,
    totalInternalReservesKzt,
    totalCashRetainedByWpoKzt,
    reconciliationDifferenceKzt,
    languageRateId: languageRate?.id ?? null,
    ratePerTranslationPageKzt: ratePerPage,
  };

  return {
    amountKzt: Math.max(0, actualPayment),
    currency: 'KZT',
    status: finalStatus,
    items,
    pricingVersionId: version.id,
    pricingVersionCode: version.code,
    newModel,
    requiresOperatorReview: reviewReasons.length > 0,
    reviewReasons,
    context: {
      languagePair,
      translationPageCountExact,
      sourceCharacterCountWithSpaces: safeCharacterCount,
      ...(notaryCutoffSnapshot ? { notaryCutoff: notaryCutoffSnapshot } : {}),
    },
  };
}

/**
 * Dispatcher — electronic uses the untouched legacy formula; official/notary use the new flat
 * formula (2026-07-17 rewrite). Same signature/contract as before the rewrite, so every
 * existing call site (src/lib/pricing/service.ts computeQuoteForJob, etc.) is unaffected.
 */
export function calculatePrice(input: PricingInput, version: PricingVersion): PricingResult {
  if (input.serviceLevel === 'electronic') {
    return calculateElectronicPrice(input, version);
  }
  return calculateOfficialNotaryPrice(input, version);
}
