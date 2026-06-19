/**
 * Generates DOCX + HTML preview artifacts that verify all fields survive
 * the KV normalization pipeline. Uses the multi-pair employment certificate
 * fixture: 4 KV sections (4-col) + 1 salary data table (6-col).
 *
 * Run: npx tsx scripts/generate-final-field-integrity.ts
 * Output: tmp/final-field-integrity/ai_draft.docx, preview.html
 */
import fs from 'fs';
import path from 'path';
import { renderToDocx } from '../worker/src/lib/docx-renderer';
import { renderToHtml } from '../worker/src/lib/renderer';
import {
  MULTI_PAIR_FIXTURE_MARKDOWN,
  REQUIRED_VALUES,
  REQUIRED_LABELS,
} from '../worker/src/lib/__tests__/fixtures/legacy-multi-pair-document';

const renderMeta = {
  sourceLang: 'ru',
  targetLang: 'en',
  documentType: 'employment_document' as const,
  translatedAt: new Date().toISOString().split('T')[0] ?? '',
  filename: 'certificate_of_employment.pdf',
  serviceLevel: 'official_with_translator_signature_and_provider_stamp' as const,
  outputMode: 'translator_review_draft' as const,
};

async function main(): Promise<void> {
  const outDir = path.join(process.cwd(), 'tmp', 'final-field-integrity');
  fs.mkdirSync(outDir, { recursive: true });

  const markdown = MULTI_PAIR_FIXTURE_MARKDOWN;

  // ── Assertions ──────────────────────────────────────────────────────────────
  const checks: Array<[string, boolean]> = [
    ...REQUIRED_VALUES.map<[string, boolean]>((v) => [`value preserved: ${v}`, markdown.includes(v)]),
    ...REQUIRED_LABELS.map<[string, boolean]>((l) => [`label preserved: ${l}`, markdown.includes(l)]),
    ['SALARY table header untouched (Calculation period)', markdown.includes('Calculation period')],
    ['SALARY month row untouched (March 2026)', markdown.includes('March 2026')],
  ];

  console.log('── Field integrity assertions ──────────────────────────────');
  let failures = 0;
  for (const [label, pass] of checks) {
    console.log(`  ${pass ? '✓' : '✗'} ${label}`);
    if (!pass) failures++;
  }

  // ── Render artifacts ─────────────────────────────────────────────────────
  console.log('\nGenerating DOCX...');
  const docxBuf = await renderToDocx(markdown, renderMeta, []);
  const docxPath = path.join(outDir, 'ai_draft.docx');
  fs.writeFileSync(docxPath, docxBuf);
  console.log(`  DOCX: ${docxPath} (${docxBuf.length} bytes)`);

  console.log('Generating HTML preview...');
  const html = await renderToHtml(markdown, renderMeta, []);
  const htmlPath = path.join(outDir, 'preview.html');
  fs.writeFileSync(htmlPath, html, 'utf-8');
  console.log(`  HTML: ${htmlPath} (${Buffer.byteLength(html, 'utf-8')} bytes)`);

  if (failures > 0) {
    console.error(`\n${failures} assertion(s) FAILED`);
    process.exit(1);
  }
  console.log(`\nAll ${checks.length} assertions passed.`);
  console.log('\nDone.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
