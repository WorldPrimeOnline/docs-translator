/**
 * Item 8 (2026-07-02 dashboard bug report): the output-format (DOCX/HTML)
 * selector must only be shown for serviceLevel === 'electronic'. Official
 * and notarization workflows produce their own artifacts (AI draft DOCX ->
 * human review -> final PDF/notary package) and must never expose this
 * selector — it has no effect on their pipeline at all.
 *
 * No React Testing Library / jsdom is configured in this project, so this
 * is a static source check (same pattern as
 * tools/internal-ai-test-lab/__tests__/no-forbidden-integrations.test.ts).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const DASHBOARD_SRC = fs.readFileSync(
  path.resolve(__dirname, '../../app/[locale]/dashboard/page.tsx'),
  'utf-8',
);

describe('dashboard — output-format selector visibility', () => {
  it('the outputFormat <select> block is gated on serviceLevel === \'electronic\'', () => {
    const selectBlockMatch = DASHBOARD_SRC.match(
      /\{serviceLevel === 'electronic' && \(\s*<div className="flex flex-col gap-1\.5">\s*<label[^>]*>\{t\('outputFormat'\)\}<\/label>/,
    );
    expect(selectBlockMatch).not.toBeNull();
  });

  it('the outputFormat <select> only offers docx/html, never pdf', () => {
    const selectTagIndex = DASHBOARD_SRC.indexOf("t('outputFormat')");
    expect(selectTagIndex).toBeGreaterThan(-1);
    const nearby = DASHBOARD_SRC.slice(selectTagIndex, selectTagIndex + 400);
    expect(nearby).toContain("option value=\"docx\"");
    expect(nearby).toContain("option value=\"html\"");
    expect(nearby).not.toContain('option value="pdf"');
  });

  it('the electronicOutput disclaimer is also gated on serviceLevel === \'electronic\' (not shown for official/notarized)', () => {
    const occurrences = DASHBOARD_SRC.split("serviceLevel === 'electronic'").length - 1;
    // At least 3: the format <select> gate, the upload-form disclaimer, and the
    // ActiveOrderCard result-section disclaimer (entry.serviceLevel === 'electronic').
    expect(occurrences).toBeGreaterThanOrEqual(3);
  });
});
