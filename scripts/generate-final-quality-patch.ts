/**
 * Generates final quality patch artifacts verifying visual fidelity,
 * pagination, and structural correctness.
 *
 * Run: npx tsx scripts/generate-final-quality-patch.ts
 * Output: tmp/final-quality-patch/ai_draft.docx + preview.pdf (via LibreOffice)
 */
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { renderToDocx } from '../worker/src/lib/docx-renderer';
import { renderToHtml } from '../worker/src/lib/renderer';
import {
  serializeVisualInventory,
  parseAndRemoveInventoryBlock,
  buildFinalVisualBlock,
} from '../worker/src/lib/visual-inventory';
import type { DetectedVisualElement } from '../worker/src/lib/detected-visual-element';

// ── Fixture visual elements (6 elements) ─────────────────────────────────────
const FIXTURE_ELEMENTS: DetectedVisualElement[] = [
  { id: 'v1', page: 1, kind: 'logo',      occurrenceIndex: 0, position: 'header',       description: 'Company logo', confidence: 0.95, source: 'page_vision' },
  { id: 'v2', page: 1, kind: 'watermark', occurrenceIndex: 0, position: 'center',        description: 'Diagonal watermark across the page', visibleText: 'УЧЕБНЫЙ ОБРАЗЕЦ', confidence: 0.85, source: 'page_vision' },
  { id: 'v3', page: 1, kind: 'signature', occurrenceIndex: 0, position: 'lower_left',    description: undefined, confidence: 0.92, source: 'page_vision' },
  { id: 'v4', page: 1, kind: 'signature', occurrenceIndex: 1, position: 'lower_right',   description: undefined, confidence: 0.91, source: 'page_vision' },
  { id: 'v5', page: 1, kind: 'stamp',     occurrenceIndex: 0, position: 'lower_center',  description: 'Round company stamp', visibleText: 'SML GROUP LLP', confidence: 0.93, source: 'page_vision' },
  { id: 'v6', page: 1, kind: 'qr',        occurrenceIndex: 0, position: 'lower_right',   description: 'QR code for document verification', confidence: 0.98, source: 'page_vision' },
];

// ── Document body ─────────────────────────────────────────────────────────────
const DOCUMENT_BODY = `
# EMPLOYMENT CERTIFICATE

## EMPLOYER

| Employer name | LLP "Severny Most Logistik" | Certificate number | № SML-2026-06-17-071 |
|---|---|---|---|
| BIN | 201240012345 | Date of issue | June 17, 2026 |
| Legal address | Republic of Kazakhstan, Almaty | Basis for issuance | employee application |
| Telephone | +7 (727) 333-45-67 | Purpose | for submission upon request |
| Email | info@sml.kz | Number of pages | 2 (two) |
| Valid until | July 17, 2026 |  |  |

## EMPLOYEE

| Last name | Nurtayeva | Identity document | № 047291638 |
|---|---|---|---|
| First name | Adelia | Foreign passport number | N14720583 |
| Patronymic | Maratovna | Residential address | Almaty |
| Latin spelling | NURTAYEVA ADELIA | IIN | 930208450176 |

## EMPLOYMENT

| Position | Lead Specialist | Contract type | Open-ended employment contract |
|---|---|---|---|
| Department | International Logistics | Work schedule | Full-time |
| Start date | September 14, 2020 | Work format | Combined |
| Contract number | ТД-2020/0914-38 | Employee status | Active employee |

## INCOME

| Calculation period | Base salary | Bonus | Compensation | Total gross amount | Amount payable |
|--------------------|-------------|-------|--------------|-------------------|----------------|
| March 2026 | 865 000,00 KZT | 95 000,00 KZT | 28 500,00 KZT | 988 500,00 KZT | 801 472,35 KZT |
| April 2026 | 865 000,00 KZT | 0,00 KZT | 28 500,00 KZT | 893 500,00 KZT | 724 618,10 KZT |
| May 2026 | 865 000,00 KZT | 127 500,00 KZT | 34 750,00 KZT | 1 027 250,00 KZT | 832 906,44 KZT |

## LEAVE

| First day | August 3, 2026 | Declared city of stay | Milan |
|---|---|---|---|
| Last day | August 21, 2026 | Departure date | August 2, 2026 |
| Calendar days | 19 | Return date | August 22, 2026 |
| Working days | 13 | First working day | August 24, 2026 |
| Country | Italian Republic |  |  |

## BANK DETAILS

| Field | Value |
|---|---|
| IIK/IBAN | KZ559876543210123456 |
| BIC/SWIFT | KCJBKZKX |

## MANAGER

Chief Executive Officer

Verification code: SML-74-KZ-170626-Q8X5
`;

const renderMeta = {
  sourceLang: 'ru',
  targetLang: 'en',
  documentType: 'employment_document' as const,
  translatedAt: new Date().toISOString().split('T')[0] ?? '',
  filename: 'certificate_of_employment.pdf',
  serviceLevel: 'official_with_translator_signature_and_provider_stamp' as const,
  outputMode: 'translator_review_draft' as const,
};

function stripInternalMarkers(md: string): string {
  return md.replace(/<!--\s*WPO_[A-Z_]+\s*-->/g, '').replace(/\n{3,}/g, '\n\n');
}

async function main(): Promise<void> {
  const outDir = path.join(process.cwd(), 'tmp', 'final-quality-patch');
  fs.mkdirSync(outDir, { recursive: true });

  const targetLanguage = 'en';

  // ── Step 1: Visual inventory serialization ────────────────────────────────
  const { inventoryBlock, entries } = serializeVisualInventory(FIXTURE_ELEMENTS, targetLanguage);
  console.log(`Serialized ${entries.length} visual inventory entries`);

  // Simulate translation: Claude preserves visibleText, fills translatedText
  const simulatedTranslation = inventoryBlock
    .replace(/;\s*translatedText=\s*$/m, '; translatedText=TRAINING SAMPLE');

  // ── Step 2: Parse inventory ────────────────────────────────────────────────
  const fullMarkdown = simulatedTranslation + '\n\n' + DOCUMENT_BODY;
  const { parsedEntries, cleanedMarkdown, missingTokens } = parseAndRemoveInventoryBlock(
    fullMarkdown,
    entries,
  );
  console.log(`Parsed ${parsedEntries.length} entries, missing=${missingTokens.length}`);

  // ── Step 3: Build visual block ─────────────────────────────────────────────
  const visualBlock = buildFinalVisualBlock(parsedEntries, targetLanguage);
  const fullContent = cleanedMarkdown.trimEnd() + '\n\n' + visualBlock;
  const markdownForRender = stripInternalMarkers(fullContent);

  // ── Assertions ────────────────────────────────────────────────────────────
  const REQUIRED_VALUES = [
    'SML-2026-06-17-071', '047291638', 'N14720583', '201240012345',
    '930208450176', 'KZ559876543210123456', 'KCJBKZKX',
    'ТД-2020/0914-38', 'SML-74-KZ-170626-Q8X5', 'Milan',
  ];

  const checks: Array<[string, boolean]> = [
    ...REQUIRED_VALUES.map<[string, boolean]>((v) => [`value preserved: ${v}`, markdownForRender.includes(v)]),
    ['watermark uses TRAINING SAMPLE (not hallucinated)', markdownForRender.includes('TRAINING SAMPLE') && !markdownForRender.includes('ҮЛГІЛІК')],
    ['watermark source УЧЕБНЫЙ ОБРАЗЕЦ NOT in render (translated version used)', !markdownForRender.includes('УЧЕБНЫЙ ОБРАЗЕЦ')],
    ['visual block has 4-col table', markdownForRender.match(/\|[^|]+\|[^|]+\|[^|]+\|[^|]+\|/) !== null],
    ['no WPO_PV tokens in output', !markdownForRender.includes('__WPO_PV_')],
    ['no WPO_VIS tokens in output', !markdownForRender.includes('__WPO_VIS_')],
    ['no WPO_VISUAL_BLOCK_START in output', !markdownForRender.includes('WPO_VISUAL_BLOCK_START')],
    ['logo=1', parsedEntries.filter(e => e.kind === 'logo').length === 1],
    ['watermark=1', parsedEntries.filter(e => e.kind === 'watermark').length === 1],
    ['stamp=1', parsedEntries.filter(e => e.kind === 'stamp').length === 1],
    ['signature=2', parsedEntries.filter(e => e.kind === 'signature').length === 2],
    ['qr=1', parsedEntries.filter(e => e.kind === 'qr').length === 1],
  ];

  console.log('\n── Assertions ──────────────────────────────────────────────');
  let failures = 0;
  for (const [label, pass] of checks) {
    console.log(`  ${pass ? '✓' : '✗'} ${label}`);
    if (!pass) failures++;
  }

  // ── Render DOCX ───────────────────────────────────────────────────────────
  console.log('\nGenerating DOCX...');
  const docxBuf = await renderToDocx(markdownForRender, renderMeta, []);
  const docxPath = path.join(outDir, 'ai_draft.docx');
  fs.writeFileSync(docxPath, docxBuf);
  console.log(`  DOCX: ${docxPath} (${docxBuf.length} bytes)`);

  // ── Render HTML (preview) ─────────────────────────────────────────────────
  console.log('Generating HTML preview...');
  const html = await renderToHtml(markdownForRender, renderMeta, []);
  const htmlPath = path.join(outDir, 'preview.html');
  fs.writeFileSync(htmlPath, html, 'utf-8');
  console.log(`  HTML: ${htmlPath} (${Buffer.byteLength(html, 'utf-8')} bytes)`);

  // ── LibreOffice PDF render ─────────────────────────────────────────────────
  console.log('Rendering PDF via LibreOffice...');
  const pdfPath = path.join(outDir, 'preview.pdf');
  try {
    execSync(
      `libreoffice --headless --convert-to pdf --outdir "${outDir}" "${docxPath}"`,
      { timeout: 60000, stdio: 'pipe' },
    );
    // LibreOffice names it ai_draft.pdf
    const loPdf = path.join(outDir, 'ai_draft.pdf');
    if (fs.existsSync(loPdf)) {
      fs.renameSync(loPdf, pdfPath);
    }
    if (fs.existsSync(pdfPath)) {
      const pdfSize = fs.statSync(pdfPath).size;
      console.log(`  PDF: ${pdfPath} (${pdfSize} bytes)`);

      // Count pages using pdfinfo if available
      try {
        const info = execSync(`pdfinfo "${pdfPath}" 2>/dev/null || echo "Pages: ?"`, { encoding: 'utf8' });
        const pagesMatch = info.match(/Pages:\s*(\d+)/);
        console.log(`  Pages: ${pagesMatch?.[1] ?? '?'}`);
      } catch { /* pdfinfo not installed */ }
    } else {
      console.warn('  PDF not found after LibreOffice conversion');
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`  LibreOffice render failed: ${msg.slice(0, 120)}`);
    console.warn('  Continuing without PDF');
  }

  if (failures > 0) {
    console.error(`\n${failures} assertion(s) FAILED`);
    process.exit(1);
  }
  console.log(`\nAll ${checks.length} assertions passed.`);
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
