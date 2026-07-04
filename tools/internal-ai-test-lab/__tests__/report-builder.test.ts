import {
  buildReportData,
  renderReportHtml,
  renderReportJson,
  renderReportMarkdown,
  INTERNAL_TEST_WATERMARK,
  type BuildReportDataInput,
} from '../lib/report-builder';

function baseInput(overrides: Partial<BuildReportDataInput> = {}): BuildReportDataInput {
  return {
    runSummary: {
      runId: 'run123',
      timestamp: '2026-07-02T18:46:00.000Z',
      environment: 'staging',
      operatorEmail: 'admin@example.com',
      sourceFile: { name: 'passport.pdf', sizeBytes: 12345, sha256: 'deadbeef', mimeType: 'application/pdf', inputKind: 'pdf' },
      sourceLanguage: 'ru',
      targetLanguage: 'en',
      documentType: { raw: 'passport', canonical: 'passport_id' },
      serviceLevel: { raw: 'official_translation', canonical: 'official_with_translator_signature_and_provider_stamp' },
      urgency: 'standard',
      fulfillmentMethod: null,
      notaryCity: null,
      deliveryCity: null,
    },
    ocrSummary: {
      provider: 'mistral',
      model: null,
      pageCount: 1,
      extractedWordCount: 300,
      confidence: 'not available',
      warnings: [],
    },
    translationSummary: {
      llmProvider: 'anthropic',
      model: 'claude-sonnet-4-5-20250929',
      promptVersion: 'n/a',
      translationMode: 'translator_review_draft',
      visualElementsHandling: { count: 2, kinds: ['stamp', 'signature'] },
      officialMarkersStatus: 'draft only — requires human translator/notary review before delivery',
      warnings: [],
    },
    renderedOutput: {
      translatedPdfPath: 'rendered/translated-document.INTERNAL_TEST.pdf',
      translatedDocxPath: 'rendered/translated-document.INTERNAL_TEST.docx',
      translatedHtmlPath: 'rendered/translated-document.INTERNAL_TEST.html',
      warnings: [],
    },
    pricingContext: {
      pricingVersion: 'v2026.1',
      languagePair: 'ru-en',
      languageGroup: 'ru_en_uz',
      documentType: 'passport_id',
      serviceLevel: 'official_with_translator_signature_and_provider_stamp',
      physicalPages: 1,
      sourceWordCount: 300,
      includedWords: 250,
      includedPages: 1,
      urgency: 'standard',
      fulfillmentMethod: null,
    },
    clientPriceComponents: [
      { itemType: 'minimum_check', label: 'Base minimum', quantity: 1, unitPriceKzt: 5000, amountKzt: 5000, visibleToClient: true, metadata: {} },
      { itemType: 'included_words', label: 'Included words', quantity: 250, unitPriceKzt: 0, amountKzt: 0, visibleToClient: true, metadata: { included_in_minimum: true, reason: 'Included in minimum check' } },
    ],
    internalCosts: [
      { costType: 'notaryFee', label: 'Notary official fee', amountKzt: 0, metadata: { applicable: false, reason: 'Not applicable / zero for this order configuration' } },
    ],
    margin: {
      grossRevenueKzt: 5000,
      totalInternalCostsKzt: 2000,
      targetProfitKzt: 500,
      estimatedMarginKzt: 3000,
      estimatedMarginPercent: 60,
      rawPriceBeforeMarginFloorKzt: 5000,
      marginFloorAdjustmentKzt: 0,
      estimatedMarginPercentBeforeFloor: 60,
      targetMarginFloorPercent: 50,
      wpoServiceLayerFinalPriceKzt: 5000,
      wpoMarginableRevenueKzt: 5000,
      wpoServiceLayerCostsKzt: 2000,
      wpoServiceMarginKzt: 3000,
      wpoServiceMarginPercent: 60,
      profitBufferAboveTargetKzt: 500,
      profitBufferAboveTargetPercent: 10,
      notaryDeliveryAddonsKzt: 0,
      notaryCoordinationRevenueKzt: 0,
      notaryCoordinationMarginKzt: 0,
      paymentWideFeePercent: 0,
      paymentWideFeesKzt: 0,
      paymentWideFeeAdjustmentKzt: 0,
    },
    reconciliation: {
      rawSubtotalKzt: 5000,
      roundingAdjustmentKzt: 0,
      roundingAdjustmentFound: false,
      marginFloorAdjustmentKzt: 0,
      marginFloorAdjustmentFound: false,
      paymentWideFeeAdjustmentKzt: 0,
      paymentWideFeeAdjustmentFound: false,
      canonicalSubtotalKzt: 5000,
      finalAmountKzt: 5000,
      differenceKzt: 0,
      status: 'OK',
      reasons: [],
    },
    pricingError: null,
    ...overrides,
  };
}

describe('buildReportData', () => {
  it('embeds the internal-test watermark', () => {
    const data = buildReportData(baseInput());
    expect(data.watermark).toBe(INTERNAL_TEST_WATERMARK);
    expect(data.watermark).toContain('INTERNAL TEST');
    expect(data.watermark).toContain('NOT FOR DELIVERY');
  });

  it('aggregates warnings from all sections', () => {
    const data = buildReportData(baseInput({
      pricingError: 'PRICING_NOT_CONFIGURED',
      ocrSummary: { provider: 'mistral', model: null, pageCount: 1, extractedWordCount: 5, confidence: 'not available', warnings: ['low word count'] },
    }));
    expect(data.allWarnings).toContain('low word count');
    expect(data.allWarnings.some((w) => w.includes('PRICING_NOT_CONFIGURED'))).toBe(true);
  });

  it('flags a WARNING reconciliation status in the aggregated warnings, including the specific reason', () => {
    const data = buildReportData(baseInput({
      reconciliation: {
        rawSubtotalKzt: 5000,
        roundingAdjustmentKzt: 0,
        roundingAdjustmentFound: false,
        marginFloorAdjustmentKzt: 0,
        marginFloorAdjustmentFound: false,
        paymentWideFeeAdjustmentKzt: 0,
        paymentWideFeeAdjustmentFound: false,
        canonicalSubtotalKzt: 5000,
        finalAmountKzt: 5200,
        differenceKzt: 200,
        status: 'WARNING',
        reasons: ['Final amount (5200 KZT) differs from raw subtotal (5000 KZT) by 200 KZT, but no rounding_adjustment item was found to explain it.'],
      },
    }));
    expect(data.allWarnings.some((w) => w.toLowerCase().includes('reconciliation'))).toBe(true);
    expect(data.allWarnings.some((w) => w.includes('no rounding_adjustment item was found'))).toBe(true);
  });

  it('populates debug JSON fields', () => {
    const data = buildReportData(baseInput());
    expect(data.debug.priceBreakdownJson).toBe(data.clientPriceComponents);
    expect(data.debug.internalCostJson).toBe(data.internalCosts);
    expect(data.debug.marginJson).toBe(data.margin);
  });
});

describe('renderReportJson', () => {
  it('round-trips through JSON.parse', () => {
    const data = buildReportData(baseInput());
    const json = renderReportJson(data);
    const parsed = JSON.parse(json);
    expect(parsed.runSummary.runId).toBe('run123');
    expect(parsed.watermark).toBe(INTERNAL_TEST_WATERMARK);
  });
});

describe('renderReportMarkdown', () => {
  it('includes all 10 required report sections', () => {
    const md = renderReportMarkdown(buildReportData(baseInput()));
    expect(md).toContain('## 1. Test Run Summary');
    expect(md).toContain('## 2. OCR Summary');
    expect(md).toContain('## 3. Translation Summary');
    expect(md).toContain('## 4. Rendered Output');
    expect(md).toContain('## 5. Pricing Context');
    expect(md).toContain('## 6. Client / Revenue Price Components');
    expect(md).toContain('## 7. Internal Cost / Reserve Allocation');
    expect(md).toContain('## 8. Margin Summary');
    expect(md).toContain('## 9. Reconciliation');
    expect(md).toContain('## 10. Debug JSON');
  });

  it('renders zero-amount rows in the price components table', () => {
    const md = renderReportMarkdown(buildReportData(baseInput()));
    expect(md).toContain('included_words');
    expect(md).toContain('Included in minimum check');
  });

  it('contains the watermark', () => {
    const md = renderReportMarkdown(buildReportData(baseInput()));
    expect(md).toContain(INTERNAL_TEST_WATERMARK);
  });

  it('explains a missing pricing computation instead of silently omitting the section', () => {
    const md = renderReportMarkdown(buildReportData(baseInput({ pricingContext: null, margin: null, reconciliation: null, pricingError: 'PRICING_NOT_CONFIGURED' })));
    expect(md).toContain('Pricing not computed: PRICING_NOT_CONFIGURED');
  });
});

describe('renderReportHtml', () => {
  it('is well-formed enough to contain the watermark banner twice (top and bottom)', () => {
    const html = renderReportHtml(buildReportData(baseInput()));
    const occurrences = html.split(INTERNAL_TEST_WATERMARK).length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(2);
  });

  it('escapes HTML-sensitive characters in dynamic fields', () => {
    const data = buildReportData(baseInput({
      runSummary: { ...baseInput().runSummary, operatorEmail: '<script>alert(1)</script>' },
    }));
    const html = renderReportHtml(data);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
