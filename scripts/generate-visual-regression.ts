/**
 * Generates visual analysis regression artifacts for the official translation pipeline.
 * Exercises the full visual inventory pipeline + confusable protection + marker stripping.
 * Produces DOCX + HTML preview in tmp/visual-regression-fixed/.
 *
 * Run: npx tsx scripts/generate-visual-regression.ts
 */
import fs from 'fs';
import path from 'path';
import { renderToDocx } from '../worker/src/lib/docx-renderer';
import { renderToHtml } from '../worker/src/lib/renderer';
import { serializeVisualInventory, parseAndRemoveInventoryBlock, buildFinalVisualBlock } from '../worker/src/lib/visual-inventory';
import { extractAndProtectValues, restoreProtectedValues, detectMixedScriptConfusables } from '../worker/src/lib/protected-values';
import type { DetectedVisualElement } from '../worker/src/lib/detected-visual-element';

// Fixture: employment certificate with 6 visual elements
// Stamp is lower_center (not lower_right), watermark has visibleText
const FIXTURE_ELEMENTS: DetectedVisualElement[] = [
  {
    id: 'v1', page: 1, kind: 'logo', occurrenceIndex: 0, position: 'header',
    description: 'Company logo inside a circular emblem', confidence: 0.95, source: 'page_vision',
  },
  {
    id: 'v2', page: 1, kind: 'watermark', occurrenceIndex: 0, position: 'center',
    description: 'Diagonal watermark across the page',
    visibleText: 'УЧЕБНЫЙ ОБРАЗЕЦ',
    confidence: 0.85, source: 'page_vision',
  },
  {
    id: 'v3', page: 1, kind: 'signature', occurrenceIndex: 0, position: 'lower_left',
    description: undefined, confidence: 0.92, source: 'page_vision',
  },
  {
    id: 'v4', page: 1, kind: 'signature', occurrenceIndex: 1, position: 'lower_right',
    description: undefined, confidence: 0.91, source: 'page_vision',
  },
  {
    id: 'v5', page: 1, kind: 'stamp', occurrenceIndex: 0, position: 'lower_center',
    description: 'Round company stamp',
    visibleText: 'SML GROUP LLP',
    confidence: 0.93, source: 'page_vision',
  },
  {
    id: 'v6', page: 1, kind: 'qr', occurrenceIndex: 0, position: 'lower_right',
    description: 'QR code for document verification', confidence: 0.98, source: 'page_vision',
  },
];

const DOCUMENT_BODY = `
# EMPLOYMENT CERTIFICATE

## Organization Information
| Field | Value |
|-------|-------|
| Organization | SML Group LLP |
| BIN | 047291638 |
| Certificate No. | SML-2026-06-17-071 |

## Employee Information
| Field | Value |
|-------|-------|
| Full Name | YUDENOV GLEB ALEXANDROVICH |
| IIN | 201240012345 |
| Passport | N14720583 |

## Employment Information
| Field | Value |
|-------|-------|
| Position | Senior Software Engineer |
| Employment Contract No. | TD-2020/0914-38 |
| Department | Information Technology |

## Salary Information
| Calculation period | Base salary | Bonus | Compensation | Total gross amount | Amount payable |
|--------------------|-------------|-------|--------------|-------------------|----------------|
| March 2026 | 865 000,00 KZT | 95 000,00 KZT | 28 500,00 KZT | 988 500,00 KZT | 801 472,35 KZT |
| April 2026 | 865 000,00 KZT | 0,00 KZT | 28 500,00 KZT | 893 500,00 KZT | 724 618,10 KZT |
| May 2026 | 865 000,00 KZT | 127 500,00 KZT | 34 750,00 KZT | 1 027 250,00 KZT | 832 906,44 KZT |

## Bank Details
| Field | Value |
|-------|-------|
| IIK/IBAN | KZ559876543210123456 |
| BIC/SWIFT | KCJBKZKX |

## Manager
Chief Executive Officer

[round stamp]

[director signature]

[accountant signature]

Verification code: SML-74-KZ-170626-Q8X5
`;

const renderMeta = {
  sourceLang: 'ru',
  targetLang: 'en',
  documentType: 'employment_document' as const,
  translatedAt: new Date().toISOString().split('T')[0] ?? '',
  filename: 'sml_employment_cert.pdf',
  serviceLevel: 'official_with_translator_signature_and_provider_stamp' as const,
  outputMode: 'translator_review_draft' as const,
};

/** Mimic stripInternalMarkers from processor.ts */
function stripInternalMarkers(md: string): string {
  return md.replace(/<!--\s*WPO_[A-Z_]+\s*-->/g, '').replace(/\n{3,}/g, '\n\n');
}

async function main(): Promise<void> {
  const outDir = path.join(process.cwd(), 'tmp', 'visual-regression-fixed');
  fs.mkdirSync(outDir, { recursive: true });

  const targetLanguage = 'en';

  // ── Step 1: Extract + protect values ─────────────────────────────────────
  const { protectedMarkdown, values: pvList } = extractAndProtectValues(DOCUMENT_BODY);
  console.log(`Protected values: ${pvList.length}`);
  const bicPv = pvList.find(v => v.original === 'KCJBKZKX');
  const ibanPv = pvList.find(v => v.original === 'KZ559876543210123456');
  console.log(`  BIC protected: ${bicPv ? `YES (${bicPv.token})` : 'NO — PROBLEM!'}`);
  console.log(`  IBAN protected: ${ibanPv ? `YES (${ibanPv.token})` : 'NO — PROBLEM!'}`);

  // ── Step 2: Serialize visual inventory ───────────────────────────────────
  const { inventoryBlock, entries } = serializeVisualInventory(FIXTURE_ELEMENTS, targetLanguage);
  console.log(`Serialized ${entries.length} visual inventory entries`);
  console.log(`  Watermark visibleText in inventory: ${inventoryBlock.includes('УЧЕБНЫЙ ОБРАЗЕЦ') ? 'YES' : 'NO'}`);
  console.log(`  Stamp lower_center in inventory: ${inventoryBlock.includes('position=lower_center') ? 'YES' : 'NO'}`);

  // ── Step 3: Simulate translation (Claude pass-through in script) ─────────
  const markdownForTranslation = inventoryBlock + '\n\n' + protectedMarkdown;
  // Simulate perfect translation: inventory preserved, body translated
  const simulatedTranslation = markdownForTranslation
    .replace('УЧЕБНЫЙ ОБРАЗЕЦ', 'TRAINING SAMPLE'); // watermark description translated

  // ── Step 4: Parse inventory out ──────────────────────────────────────────
  const { parsedEntries, cleanedMarkdown, missingTokens } = parseAndRemoveInventoryBlock(
    simulatedTranslation,
    entries,
  );
  console.log(`Parsed inventory: ${parsedEntries.length} entries, missing=${missingTokens.length}`);

  // ── Step 5: Restore protected values ─────────────────────────────────────
  const { restoredMarkdown, forcedRestores } = restoreProtectedValues(cleanedMarkdown, pvList);
  console.log(`Forced restores: ${forcedRestores.length}`);

  // ── Step 6: Build final visual block ─────────────────────────────────────
  const visualBlock = buildFinalVisualBlock(parsedEntries, targetLanguage);
  const fullMarkdown = restoredMarkdown.trimEnd() + '\n\n' + visualBlock;

  // ── Step 7: Strip internal markers ───────────────────────────────────────
  const markdownForRender = stripInternalMarkers(fullMarkdown);

  // ── Assertions ───────────────────────────────────────────────────────────
  const checks: Array<[string, boolean]> = [
    ['KCJBKZKX preserved exactly', markdownForRender.includes('KCJBKZKX')],
    ['No KSЈВКZКХ (reported damaged form)', !markdownForRender.includes('KSЈВКZКХ')],
    ['KZ559876543210123456 preserved', markdownForRender.includes('KZ559876543210123456')],
    ['SML-2026-06-17-071 preserved', markdownForRender.includes('SML-2026-06-17-071')],
    ['N14720583 preserved', markdownForRender.includes('N14720583')],
    ['SML-74-KZ-170626-Q8X5 preserved', markdownForRender.includes('SML-74-KZ-170626-Q8X5')],
    ['No WPO_VISUAL_BLOCK_START in render input', !markdownForRender.includes('WPO_VISUAL_BLOCK_START')],
    ['No WPO_VISUAL_BLOCK_END in render input', !markdownForRender.includes('WPO_VISUAL_BLOCK_END')],
    ['Watermark TRAINING SAMPLE in visual block', markdownForRender.includes('TRAINING SAMPLE')],
    // Position label must be human-readable, not raw enum (no underscores in position column)
    ['Stamp shows "lower centre" (localized)', markdownForRender.includes('lower centre')],
    ['No raw "lower_center" in output', !markdownForRender.includes('lower_center')],
    ['No raw "upper_left" in output', !markdownForRender.includes('upper_left')],
    ['BIC not confusable-corrupted', !detectMixedScriptConfusables(
      markdownForRender.match(/KCJBKZKX|KСJВKZKХ|KSЈВКZКХ/)?.[0] ?? 'KCJBKZKX',
    )],
    ['logo = 1', parsedEntries.filter(e => e.kind === 'logo').length === 1],
    ['watermark = 1', parsedEntries.filter(e => e.kind === 'watermark').length === 1],
    ['signature = 2', parsedEntries.filter(e => e.kind === 'signature').length === 2],
    ['stamp = 1', parsedEntries.filter(e => e.kind === 'stamp').length === 1],
    ['qr = 1', parsedEntries.filter(e => e.kind === 'qr').length === 1],
    ['No golden bridge hallucination', !markdownForRender.includes('golden bridge')],
  ];

  console.log('\n── Assertions ──────────────────────────────────────────────');
  let failures = 0;
  for (const [label, pass] of checks) {
    const icon = pass ? '✓' : '✗';
    console.log(`  ${icon} ${label}`);
    if (!pass) failures++;
  }
  if (failures > 0) {
    console.error(`\n${failures} assertion(s) FAILED`);
  } else {
    console.log('\nAll assertions passed');
  }

  // ── Render artifacts ─────────────────────────────────────────────────────
  console.log('\nGenerating DOCX...');
  const docxBuf = await renderToDocx(markdownForRender, renderMeta, []);
  const docxPath = path.join(outDir, 'ai_draft.docx');
  fs.writeFileSync(docxPath, docxBuf);
  console.log(`  DOCX: ${docxPath} (${docxBuf.length} bytes)`);

  console.log('Generating HTML preview...');
  const html = await renderToHtml(markdownForRender, renderMeta, []);
  const htmlPath = path.join(outDir, 'preview.html');
  fs.writeFileSync(htmlPath, html, 'utf-8');
  console.log(`  HTML: ${htmlPath} (${Buffer.byteLength(html, 'utf-8')} bytes)`);

  const summary = {
    generatedAt: new Date().toISOString(),
    assertions: checks.map(([label, pass]) => ({ label, pass })),
    failures,
    fixtureElements: FIXTURE_ELEMENTS.length,
    inventoryEntries: entries.length,
    parsedEntries: parsedEntries.length,
    missingTokens,
    forcedRestores,
    protectedValues: pvList.map(pv => ({ token: pv.token, type: pv.type, original: pv.original })),
    visualElements: parsedEntries.map(e => ({
      token: e.token, kind: e.kind, page: e.page, position: e.position,
      description: e.description || null, visibleText: e.visibleText || null,
    })),
  };
  const summaryPath = path.join(outDir, 'visual-summary.json');
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf-8');
  console.log(`  JSON: ${summaryPath}`);

  if (failures > 0) process.exit(1);
  console.log('\nDone.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
