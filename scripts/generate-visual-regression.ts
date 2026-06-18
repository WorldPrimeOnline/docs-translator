/**
 * Generates visual analysis regression artifacts for the official translation pipeline.
 * Exercises serializeVisualInventory + parseAndRemoveInventoryBlock + buildFinalVisualBlock
 * and produces DOCX + HTML + a JSON summary — without any real API calls.
 *
 * Run: npx tsx scripts/generate-visual-regression.ts
 */
import fs from 'fs';
import path from 'path';
import { renderToDocx } from '../worker/src/lib/docx-renderer';
import { renderToHtml } from '../worker/src/lib/renderer';
import { serializeVisualInventory, parseAndRemoveInventoryBlock, buildFinalVisualBlock } from '../worker/src/lib/visual-inventory';
import type { DetectedVisualElement } from '../worker/src/lib/detected-visual-element';

const FIXTURE_ELEMENTS: DetectedVisualElement[] = [
  {
    id: 'v1', page: 1, kind: 'logo', occurrenceIndex: 0, position: 'header',
    description: 'Company logo with text "SML Group"', confidence: 0.95, source: 'page_vision',
  },
  {
    id: 'v2', page: 1, kind: 'watermark', occurrenceIndex: 0, position: 'center',
    description: 'Diagonal watermark "ORIGINAL"', confidence: 0.85, source: 'page_vision',
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
    id: 'v5', page: 1, kind: 'stamp', occurrenceIndex: 0, position: 'lower_right',
    description: 'Round stamp with organization name', confidence: 0.93, source: 'page_vision',
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
`;

const renderMeta = {
  sourceLang: 'ru',
  targetLang: 'en',
  documentType: 'employment_document' as const,
  translatedAt: new Date().toISOString().split('T')[0] ?? '',
  filename: 'sml_employment_cert.pdf',
};

async function main(): Promise<void> {
  const outDir = path.join(process.cwd(), 'tmp', 'visual-regression');
  fs.mkdirSync(outDir, { recursive: true });

  const targetLanguage = 'en';

  // Step 1: Serialize visual inventory
  const { inventoryBlock, entries } = serializeVisualInventory(FIXTURE_ELEMENTS, targetLanguage);
  console.log(`Serialized ${entries.length} visual inventory entries`);

  // Step 2: Simulate "translated with inventory prepended"
  // (In real flow, Claude receives `inventoryBlock + '\n\n' + protectedMarkdown` and returns
  //  a translated version. Here we simulate a perfect-pass translation.)
  const simulatedTranslation = inventoryBlock + '\n\n' + DOCUMENT_BODY;

  // Step 3: Parse inventory out of translation
  const { parsedEntries, cleanedMarkdown, missingTokens } = parseAndRemoveInventoryBlock(
    simulatedTranslation,
    entries,
  );
  console.log(`Parsed ${parsedEntries.length} inventory entries (${missingTokens.length} missing → restored)`);

  // Step 4: Build final visual block
  const visualBlock = buildFinalVisualBlock(parsedEntries, targetLanguage);
  const finalMarkdown = cleanedMarkdown.trimEnd() + '\n\n' + visualBlock;

  console.log('\nGenerating DOCX...');
  const docxBuf = await renderToDocx(finalMarkdown, renderMeta, []);
  const docxPath = path.join(outDir, 'ai_draft.docx');
  fs.writeFileSync(docxPath, docxBuf);
  console.log(`  DOCX: ${docxPath} (${docxBuf.length} bytes)`);

  console.log('Generating HTML preview...');
  const html = await renderToHtml(finalMarkdown, renderMeta, []);
  const htmlPath = path.join(outDir, 'preview.html');
  fs.writeFileSync(htmlPath, html, 'utf-8');
  console.log(`  HTML: ${htmlPath} (${Buffer.byteLength(html, 'utf-8')} bytes)`);

  const summary = {
    generatedAt: new Date().toISOString(),
    fixtureElements: FIXTURE_ELEMENTS.length,
    inventoryEntries: entries.length,
    parsedEntries: parsedEntries.length,
    missingTokens,
    finalMarkdownLength: finalMarkdown.length,
    docxBytes: docxBuf.length,
    htmlBytes: Buffer.byteLength(html, 'utf-8'),
    elements: parsedEntries.map(e => ({
      token: e.token,
      kind: e.kind,
      page: e.page,
      position: e.position,
      description: e.description || null,
    })),
  };
  const summaryPath = path.join(outDir, 'visual-summary.json');
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf-8');
  console.log(`  JSON: ${summaryPath}`);

  console.log('\nDone.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
