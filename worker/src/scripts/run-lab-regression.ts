/**
 * Repeatability test — 3 real translation runs on the lab report source PDF.
 *
 * Runs OCR once, then translates 3 times with temperature:0 (stabilization measure —
 * does not guarantee identical outputs; the API may still vary).
 *
 * Outputs per run saved to tmp/translation-quality-regression/run-{1,2,3}/:
 *   ocr-markdown.md
 *   raw-translated-markdown.md
 *   restored-markdown.md
 *   quality-report.json
 *
 * Usage (from repo root):
 *   npx tsx worker/src/scripts/run-lab-regression.ts
 */

// ── Env setup MUST happen before any worker module imports ───────────────────
import fs from 'fs';
import path from 'path';

const envPath = path.resolve(__dirname, '../../../.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.+)$/);
    if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2]!.trim();
  }
}
process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'https://placeholder.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'placeholder';
process.env.R2_ACCOUNT_ID ??= 'placeholder';
process.env.R2_ACCESS_KEY_ID ??= 'placeholder';
process.env.R2_SECRET_ACCESS_KEY ??= 'placeholder';
process.env.R2_BUCKET_NAME ??= 'placeholder';

// ── Main (dynamic imports to ensure env is set before module initialisation) ─
async function main(): Promise<void> {
  const { extractTextFromPdf } = await import('../lib/ocr');
  const { translateDocument, retranslateWithCorrection } = await import('../lib/translator');
  const {
    runTranslationQualityGate,
    buildQualityRetryPrompt,
    selectBestTranslation,
    formatQualityLogLine,
    extractCertificationIdentifiers,
  } = await import('../lib/translation-quality-gate');
  const { extractAndProtectValues, restoreProtectedValues } = await import('../lib/protected-values');

  const SOURCE_PDF = path.resolve(__dirname, '../../../tmp/translation-quality-regression/source.pdf');
  const OUT_BASE = path.resolve(__dirname, '../../../tmp/translation-quality-regression');

  if (!fs.existsSync(SOURCE_PDF)) {
    console.error(`Source PDF not found: ${SOURCE_PDF}`);
    process.exit(1);
  }

  // ── OCR (once, shared across all runs) ────────────────────────────────────
  console.log('OCR pass (once)…');
  const pdfBuffer = fs.readFileSync(SOURCE_PDF);
  const ocrResult = await extractTextFromPdf(pdfBuffer);
  console.log(`OCR done: ${ocrResult.markdown.length} chars, ${ocrResult.pageCount} page(s)`);
  const ocrMd = ocrResult.markdown;

  // ── Three translation runs ────────────────────────────────────────────────
  interface RunResult {
    run: number;
    translatedTableCount: number;
    unmatchedSourceTableCount: number;
    sourceTableCount: number;
    remainingSourceScriptRatio: number;
    certIds: string[];
    pvCoverage: number;
    retryUsed: boolean;
    selectedResult: string;
    issues: Array<{ code: string; severity: string }>;
  }

  const results: RunResult[] = [];

  for (let run = 1; run <= 3; run++) {
    console.log(`\n── Run ${run}/3 ──`);
    const runDir = path.join(OUT_BASE, `run-${run}`);
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, 'ocr-markdown.md'), ocrMd);

    const { protectedMarkdown, values: pvList } = extractAndProtectValues(ocrMd);

    const rawTranslated = await translateDocument(protectedMarkdown, 'th', 'ru', 'medical_document');
    fs.writeFileSync(path.join(runDir, 'raw-translated-markdown.md'), rawTranslated);

    const { restoredMarkdown: initialRestored } = restoreProtectedValues(rawTranslated, pvList);
    const initialQuality = runTranslationQualityGate({
      sourceMarkdown: ocrMd,
      translatedMarkdown: initialRestored,
      sourceLang: 'th',
      targetLang: 'ru',
    });

    let finalMd = initialRestored;
    let retryUsed = false;
    let selectedResult = 'none';
    let finalQuality = initialQuality;

    if (initialQuality.hasRetryRequired) {
      console.log(`  issues: ${initialQuality.issues.map(i => i.code).join(', ')}`);
      console.log(`  retrying…`);
      const retryPrompt = buildQualityRetryPrompt(initialQuality.issues, initialQuality.metrics);
      try {
        const retryRaw = await retranslateWithCorrection(
          protectedMarkdown, 'th', 'ru', 'medical_document', retryPrompt,
        );
        const { restoredMarkdown: retryRestored } = restoreProtectedValues(retryRaw, pvList);
        const retryQuality = runTranslationQualityGate({
          sourceMarkdown: ocrMd,
          translatedMarkdown: retryRestored,
          sourceLang: 'th',
          targetLang: 'ru',
        });
        const best = selectBestTranslation(
          { markdown: initialRestored as string, result: initialQuality },
          { markdown: retryRestored as string, result: retryQuality },
        );
        finalMd = best.markdown;
        finalQuality = best.result;
        retryUsed = true;
        selectedResult = best.selectedFrom;
      } catch (e) {
        console.warn(`  retry failed: ${e instanceof Error ? e.message : String(e)}`);
        selectedResult = 'initial';
      }
    }

    fs.writeFileSync(path.join(runDir, 'restored-markdown.md'), finalMd);

    const certIds = Array.from(extractCertificationIdentifiers(finalMd));
    const r: RunResult = {
      run,
      translatedTableCount: finalQuality.metrics.translatedTableCount,
      unmatchedSourceTableCount: finalQuality.metrics.unmatchedSourceTableCount,
      sourceTableCount: finalQuality.metrics.sourceTableCount,
      remainingSourceScriptRatio: finalQuality.metrics.remainingSourceScriptRatio,
      certIds,
      pvCoverage: finalQuality.metrics.protectedValueCoverageRatio,
      retryUsed,
      selectedResult,
      issues: finalQuality.issues.map(i => ({ code: i.code, severity: i.severity })),
    };

    fs.writeFileSync(
      path.join(runDir, 'quality-report.json'),
      JSON.stringify({ metrics: finalQuality.metrics, issues: finalQuality.issues }, null, 2),
    );

    console.log(`  ${formatQualityLogLine(finalQuality.metrics, finalQuality.issues, { retryUsed, selectedResult: retryUsed ? selectedResult as 'initial' | 'retry' : 'none' })}`);
    console.log(`  translated_tables=${r.translatedTableCount}/${r.sourceTableCount}  unmatched_src=${r.unmatchedSourceTableCount}`);
    console.log(`  thai_ratio=${(r.remainingSourceScriptRatio * 100).toFixed(2)}%`);
    console.log(`  cert_ids=[${certIds.join(', ') || 'none'}]`);
    console.log(`  pv_coverage=${(r.pvCoverage * 100).toFixed(1)}%`);
    console.log(`  retry=${retryUsed}  selected=${selectedResult}`);
    if (r.issues.length > 0) {
      console.log(`  remaining_issues=[${r.issues.map(i => i.code).join(', ')}]`);
    }

    results.push(r);
  }

  // ── Verdict ───────────────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════════');
  console.log('REPEATABILITY VERDICT');
  console.log('══════════════════════════════════════════');

  const passes = results.map(r => {
    const tablesOk = r.unmatchedSourceTableCount === 0;
    const thaiOk = r.remainingSourceScriptRatio < 0.02;
    // Check via quality gate result — if UNSUPPORTED_CERTIFICATION_IDENTIFIER remains, it's a cert failure
    const certOk = !r.issues.some(i => i.code === 'UNSUPPORTED_CERTIFICATION_IDENTIFIER');
    const pvOk = r.pvCoverage >= 0.99;
    return { tablesOk, thaiOk, certOk, pvOk, ok: tablesOk && thaiOk && certOk && pvOk };
  });

  for (let i = 0; i < 3; i++) {
    const r = results[i]!;
    const p = passes[i]!;
    console.log(`\nRun ${r.run}: ${p.ok ? 'PASS ✓' : 'FAIL ✗'}`);
    console.log(`  patient_metadata_table: ${p.tablesOk ? '✓' : '✗'} (unmatched_src=${r.unmatchedSourceTableCount})`);
    console.log(`  no_long_thai:           ${p.thaiOk ? '✓' : '✗'} (thai_ratio=${(r.remainingSourceScriptRatio * 100).toFixed(2)}%)`);
    console.log(`  cert_ids_ok:            ${p.certOk ? '✓' : '✗'} (${r.certIds.join(', ') || 'none'})`);
    console.log(`  pv_coverage:            ${p.pvOk ? '✓' : '✗'} (${(r.pvCoverage * 100).toFixed(1)}%)`);
  }

  const passCount = passes.filter(p => p.ok).length;
  console.log(`\n${passCount}/3 acceptance criteria met.`);
  console.log('NOTE: temperature:0 is a stabilization measure — Anthropic API may still vary across runs.');

  if (passCount < 3) process.exit(1);
}

main().catch(err => { console.error(err); process.exit(1); });
