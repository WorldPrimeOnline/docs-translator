import {
  serializeVisualInventory,
  parseAndRemoveInventoryBlock,
  buildFinalVisualBlock,
} from '../visual-inventory';
import type { DetectedVisualElement } from '../detected-visual-element';

const FIXTURE_ELEMENTS: DetectedVisualElement[] = [
  { id: 'v1', page: 1, kind: 'logo',      occurrenceIndex: 0, position: 'header',      description: 'Company logo with text "SML Group"', confidence: 0.95, source: 'page_vision' },
  { id: 'v2', page: 1, kind: 'watermark', occurrenceIndex: 0, position: 'center',      description: 'Diagonal watermark "ORIGINAL"',        confidence: 0.85, source: 'page_vision' },
  { id: 'v3', page: 1, kind: 'signature', occurrenceIndex: 0, position: 'lower_left',  description: undefined,                              confidence: 0.92, source: 'page_vision' },
  { id: 'v4', page: 1, kind: 'signature', occurrenceIndex: 1, position: 'lower_right', description: undefined,                              confidence: 0.91, source: 'page_vision' },
  { id: 'v5', page: 1, kind: 'stamp',     occurrenceIndex: 0, position: 'lower_right', description: 'Round stamp with organization name',   confidence: 0.93, source: 'page_vision' },
  { id: 'v6', page: 1, kind: 'qr',        occurrenceIndex: 0, position: 'lower_right', description: 'QR code for document verification',    confidence: 0.98, source: 'page_vision' },
];

describe('serializeVisualInventory', () => {
  test('generates 6 tokens for 6 elements', () => {
    const { entries } = serializeVisualInventory(FIXTURE_ELEMENTS, 'en');
    expect(entries).toHaveLength(6);
  });

  test('tokens are sequential __WPO_VIS_0001__ through __WPO_VIS_0006__', () => {
    const { inventoryBlock } = serializeVisualInventory(FIXTURE_ELEMENTS, 'en');
    for (let i = 1; i <= 6; i++) {
      expect(inventoryBlock).toContain(`__WPO_VIS_${String(i).padStart(4, '0')}__`);
    }
  });

  test('two signatures produce two distinct tokens', () => {
    const { entries } = serializeVisualInventory(FIXTURE_ELEMENTS, 'en');
    const sigTokens = entries.filter(e => e.kind === 'signature').map(e => e.token);
    expect(sigTokens).toHaveLength(2);
    expect(sigTokens[0]).not.toBe(sigTokens[1]);
    expect(entries.find(e => e.token === sigTokens[0])?.position).toBe('lower_left');
    expect(entries.find(e => e.token === sigTokens[1])?.position).toBe('lower_right');
  });

  test('includes WPO_VISUAL_BLOCK_START sentinel', () => {
    const { inventoryBlock } = serializeVisualInventory(FIXTURE_ELEMENTS, 'ru');
    expect(inventoryBlock).toContain('WPO_VISUAL_BLOCK_START');
  });

  test('empty elements returns empty block', () => {
    const { inventoryBlock, entries } = serializeVisualInventory([], 'en');
    expect(inventoryBlock).toBe('');
    expect(entries).toHaveLength(0);
  });
});

describe('parseAndRemoveInventoryBlock — round-trip', () => {
  test('perfect round-trip: all 6 entries found, 0 missing', () => {
    const { inventoryBlock, entries } = serializeVisualInventory(FIXTURE_ELEMENTS, 'en');
    const documentBody = 'This is the translated document content.';
    const fullTranslation = inventoryBlock + '\n\n' + documentBody;

    const { parsedEntries, cleanedMarkdown, missingTokens } = parseAndRemoveInventoryBlock(
      fullTranslation,
      entries,
    );

    expect(parsedEntries).toHaveLength(6);
    expect(missingTokens).toHaveLength(0);
    expect(cleanedMarkdown).toContain('translated document content');
    expect(cleanedMarkdown).not.toMatch(/__WPO_VIS_\d{4}__/);
  });

  test('translated descriptions are captured correctly', () => {
    const { inventoryBlock, entries } = serializeVisualInventory(FIXTURE_ELEMENTS, 'ru');
    // Simulate Claude translating the description
    const translated = inventoryBlock
      .replace('Company logo with text "SML Group"', 'Логотип компании с текстом "SML Group"')
      .replace('Round stamp with organization name', 'Круглая печать с названием организации');

    const { parsedEntries } = parseAndRemoveInventoryBlock(translated + '\n\nДокумент', entries);

    const logoEntry = parsedEntries.find(e => e.kind === 'logo');
    expect(logoEntry?.description).toBe('Логотип компании с текстом "SML Group"');

    const stampEntry = parsedEntries.find(e => e.kind === 'stamp');
    expect(stampEntry?.description).toBe('Круглая печать с названием организации');
  });

  test('missing token is restored from source entries', () => {
    const { inventoryBlock, entries } = serializeVisualInventory(FIXTURE_ELEMENTS, 'en');
    // Drop one line (simulate Claude removing __WPO_VIS_0004__)
    const withMissing = inventoryBlock.replace(/^-\s*__WPO_VIS_0004__.*\n?/m, '');
    const fullTranslation = withMissing + '\nDocument content here.';

    const { parsedEntries, missingTokens } = parseAndRemoveInventoryBlock(fullTranslation, entries);

    expect(missingTokens).toContain('__WPO_VIS_0004__');
    // Still has 6 entries (restored)
    expect(parsedEntries).toHaveLength(6);
    const restored = parsedEntries.find(e => e.token === '__WPO_VIS_0004__');
    expect(restored).toBeTruthy();
    expect(restored?.position).toBe('lower_right'); // restored from source
  });
});

describe('buildFinalVisualBlock', () => {
  const entries = FIXTURE_ELEMENTS.map((el, i) => ({
    token: `__WPO_VIS_${String(i + 1).padStart(4, '0')}__`,
    kind: el.kind,
    page: el.page,
    position: el.position,
    description: el.description ?? '',
  }));

  test('block contains WPO_VISUAL_BLOCK_START sentinel', () => {
    const block = buildFinalVisualBlock(entries, 'en');
    expect(block).toContain('WPO_VISUAL_BLOCK_START');
  });

  test('block has 6 data rows', () => {
    const block = buildFinalVisualBlock(entries, 'en');
    // Count lines starting with | (header + separator + 6 rows = 8)
    const tableLines = block.split('\n').filter(l => l.trim().startsWith('|'));
    expect(tableLines.length).toBeGreaterThanOrEqual(8);
  });

  test('two signatures appear as two rows', () => {
    const block = buildFinalVisualBlock(entries, 'en');
    // Count "Signature" occurrences in the table
    const sigCount = (block.match(/\|\s*Signature\s*\|/g) ?? []).length;
    expect(sigCount).toBe(2);
  });

  test('two signatures in Russian appear as two rows', () => {
    const block = buildFinalVisualBlock(entries, 'ru');
    const sigCount = (block.match(/\|\s*Подпись\s*\|/g) ?? []).length;
    expect(sigCount).toBe(2);
  });

  test('no __WPO_VIS__ tokens in final block output', () => {
    const block = buildFinalVisualBlock(entries, 'en');
    expect(block).not.toMatch(/__WPO_VIS_\d{4}__/);
  });

  test('empty entries returns empty string', () => {
    const block = buildFinalVisualBlock([], 'en');
    expect(block).toBe('');
  });

  test('Kazakh locale uses Kazakh labels', () => {
    const singleEntry = [{ token: '__WPO_VIS_0001__', kind: 'stamp', page: 1, position: 'lower_right', description: '' }];
    const block = buildFinalVisualBlock(singleEntry, 'kk');
    expect(block).toContain('Мөр');
  });
});

describe('visual inventory — fixture regression: SML employment cert', () => {
  test('6-element fixture: logo, watermark, 2 signatures, stamp, QR', () => {
    const { entries } = serializeVisualInventory(FIXTURE_ELEMENTS, 'en');
    expect(entries.filter(e => e.kind === 'logo')).toHaveLength(1);
    expect(entries.filter(e => e.kind === 'watermark')).toHaveLength(1);
    expect(entries.filter(e => e.kind === 'signature')).toHaveLength(2);
    expect(entries.filter(e => e.kind === 'stamp')).toHaveLength(1);
    expect(entries.filter(e => e.kind === 'qr')).toHaveLength(1);
  });

  test('final block also has 6 rows', () => {
    const { inventoryBlock, entries } = serializeVisualInventory(FIXTURE_ELEMENTS, 'en');
    const fullTranslation = inventoryBlock + '\n\nDocument body.';
    const { parsedEntries } = parseAndRemoveInventoryBlock(fullTranslation, entries);
    const block = buildFinalVisualBlock(parsedEntries, 'en');
    const tableRows = block.split('\n').filter(l => l.startsWith('|') && !l.includes('---'));
    // header row + 6 data rows = 7
    expect(tableRows.length).toBeGreaterThanOrEqual(7);
  });
});

// ── Watermark visibleText fidelity ───────────────────────────────────────────
describe('watermark visibleText fidelity', () => {
  const WATERMARK_ELEMENTS: DetectedVisualElement[] = [
    {
      id: 'v1', page: 1, kind: 'watermark', occurrenceIndex: 0, position: 'center',
      description: 'Diagonal watermark across the page',
      visibleText: 'УЧЕБНЫЙ ОБРАЗЕЦ',
      confidence: 0.9, source: 'page_vision',
    },
  ];

  test('visibleText is serialized as a separate field (not embedded in description)', () => {
    const { inventoryBlock } = serializeVisualInventory(WATERMARK_ELEMENTS, 'en');
    expect(inventoryBlock).toContain('visibleText=УЧЕБНЫЙ ОБРАЗЕЦ');
    // Description should NOT embed the source text
    expect(inventoryBlock).not.toContain('description=Diagonal watermark across the page with text');
  });

  test('translatedText field placeholder is present in inventory', () => {
    const { inventoryBlock } = serializeVisualInventory(WATERMARK_ELEMENTS, 'en');
    expect(inventoryBlock).toContain('translatedText=');
  });

  test('clean translatedText is used in final block', () => {
    const { inventoryBlock, entries } = serializeVisualInventory(WATERMARK_ELEMENTS, 'en');
    // Simulate Claude filling translatedText= correctly — target only end-of-line placeholder
    const withTranslation = inventoryBlock.replace(
      /;\s*translatedText=\s*$/m,
      '; translatedText=TRAINING SAMPLE',
    );
    const { parsedEntries } = parseAndRemoveInventoryBlock(withTranslation + '\n\nBody.', entries);
    const block = buildFinalVisualBlock(parsedEntries, 'en');
    expect(block).toContain('TRAINING SAMPLE');
    expect(block).not.toContain('УЧЕБНЫЙ ОБРАЗЕЦ');
  });

  test('mixed-script translatedText (hallucination guard) falls back to visibleText', () => {
    const { inventoryBlock, entries } = serializeVisualInventory(WATERMARK_ELEMENTS, 'en');
    // Simulate Claude hallucinating a mixed-language blend
    const withHallucination = inventoryBlock.replace(
      /;\s*translatedText=\s*$/m,
      '; translatedText=SAMPLE ҮЛГІЛІК ОБРАЗЕЦ',
    );
    const { parsedEntries } = parseAndRemoveInventoryBlock(
      withHallucination + '\n\nBody.',
      entries,
    );
    // translatedText must have been rejected; visibleText (source) should be used
    const watermarkEntry = parsedEntries.find((e) => e.kind === 'watermark');
    expect(watermarkEntry?.translatedText).toBeUndefined();
    expect(watermarkEntry?.visibleText).toBe('УЧЕБНЫЙ ОБРАЗЕЦ');
    const block = buildFinalVisualBlock(parsedEntries, 'en');
    // The hallucinated blend must NOT appear
    expect(block).not.toContain('ҮЛГІЛІК');
    // Source text appears instead
    expect(block).toContain('УЧЕБНЫЙ ОБРАЗЕЦ');
  });

  test('buildFinalVisualBlock falls back to visibleText when translatedText absent', () => {
    const { inventoryBlock, entries } = serializeVisualInventory(WATERMARK_ELEMENTS, 'en');
    // No translatedText filled in
    const { parsedEntries } = parseAndRemoveInventoryBlock(
      inventoryBlock + '\n\nBody.',
      entries,
    );
    const block = buildFinalVisualBlock(parsedEntries, 'en');
    // Falls back to original source text — no hallucinated text
    expect(block).toContain('УЧЕБНЫЙ ОБРАЗЕЦ');
  });

  test('QR visibleText is NOT included in inventory (protected identifier)', () => {
    const qrEl: DetectedVisualElement = {
      id: 'v1', page: 1, kind: 'qr', occurrenceIndex: 0, position: 'lower_right',
      description: 'QR code', visibleText: 'https://verify.gov.kz?code=ABC123',
      confidence: 0.98, source: 'page_vision',
    };
    const { inventoryBlock, entries } = serializeVisualInventory([qrEl], 'en');
    expect(inventoryBlock).not.toContain('https://verify.gov.kz');
    expect(entries[0]?.visibleText).toBeUndefined();
  });
});

// ── lower_center position ─────────────────────────────────────────────────────
describe('lower_center position support', () => {
  const STAMP_ELEMENTS: DetectedVisualElement[] = [
    {
      id: 'v1', page: 1, kind: 'stamp', occurrenceIndex: 0, position: 'lower_center',
      description: 'Round company stamp', confidence: 0.93, source: 'page_vision',
    },
  ];

  test('lower_center is serialized in inventory', () => {
    const { inventoryBlock } = serializeVisualInventory(STAMP_ELEMENTS, 'en');
    expect(inventoryBlock).toContain('position=lower_center');
  });

  test('lower_center is localized to human-readable label in final visual block', () => {
    const { inventoryBlock, entries } = serializeVisualInventory(STAMP_ELEMENTS, 'en');
    const fullTranslation = inventoryBlock + '\n\nBody.';
    const { parsedEntries } = parseAndRemoveInventoryBlock(fullTranslation, entries);
    const block = buildFinalVisualBlock(parsedEntries, 'en');
    // Human-readable form — no raw enum value in rendered output
    expect(block).toContain('lower centre');
    expect(block).not.toContain('lower_center');
  });
});

// ── Internal marker stripping ─────────────────────────────────────────────────
describe('WPO_VISUAL_BLOCK_START marker not in final rendered content', () => {
  test('buildFinalVisualBlock output contains the sentinel (for dedup)', () => {
    const entries = [{ token: '__WPO_VIS_0001__', kind: 'logo', page: 1, position: 'header', description: 'Logo' }];
    const block = buildFinalVisualBlock(entries, 'en');
    expect(block).toContain('WPO_VISUAL_BLOCK_START');
  });

  test('after stripInternalMarkers, sentinel is gone', () => {
    const entries = [{ token: '__WPO_VIS_0001__', kind: 'logo', page: 1, position: 'header', description: 'Logo' }];
    const block = buildFinalVisualBlock(entries, 'en');
    const stripped = block.replace(/<!--\s*WPO_[A-Z_]+\s*-->/g, '');
    expect(stripped).not.toContain('WPO_VISUAL_BLOCK_START');
    // heading and table still present
    expect(stripped).toContain('Description of non-text elements');
    expect(stripped).toContain('Logo');
  });
});

// ── Compact descriptions ──────────────────────────────────────────────────────
describe('compact descriptions in buildFinalVisualBlock', () => {
  test('long logo description is compacted', () => {
    const entries = [{
      token: '__WPO_VIS_0001__', kind: 'logo', page: 1, position: 'header',
      description: 'Company logo depicting a stylized golden bridge over water with a blue circular background and ornate frame',
    }];
    const block = buildFinalVisualBlock(entries, 'en');
    // The description column should not contain the full verbose text
    expect(block).not.toContain('golden bridge over water');
    // Should use compact fallback
    expect(block).toContain('Company logo');
  });

  test('short description passes through unchanged', () => {
    const entries = [{
      token: '__WPO_VIS_0001__', kind: 'logo', page: 1, position: 'header',
      description: 'Company logo',
    }];
    const block = buildFinalVisualBlock(entries, 'en');
    expect(block).toContain('Company logo');
  });
});
