/**
 * UX correction (2026-07-03, following item 8 of the 2026-07-02 dashboard bug
 * report): the "Output format" area must never disappear across service
 * levels.
 *
 * - Electronic: interactive <select> with DOCX/HTML only, no PDF option.
 * - Official / notarized: same area stays visible but becomes a read-only,
 *   localized notice (no selectable DOCX/HTML/PDF dropdown) — their pipeline
 *   produces its own artifacts (AI draft DOCX -> human review -> final
 *   PDF/notary package) and this selector has no effect on them.
 *
 * No React Testing Library / jsdom is configured in this project, so this is
 * a static source check (same pattern as
 * tools/internal-ai-test-lab/__tests__/no-forbidden-integrations.test.ts).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const DASHBOARD_SRC = fs.readFileSync(
  path.resolve(__dirname, '../../app/[locale]/dashboard/page.tsx'),
  'utf-8',
);

/** The full "Output format" area block, from its label to the closing wrapper </div>. */
function extractOutputFormatBlock(): string {
  const labelIdx = DASHBOARD_SRC.indexOf("{t('outputFormat')}</label>");
  expect(labelIdx).toBeGreaterThan(-1);
  const start = DASHBOARD_SRC.lastIndexOf('<div className="flex flex-col gap-1.5">', labelIdx);
  expect(start).toBeGreaterThan(-1);
  // Grab a generous window past the label — enough to include both branches
  // of the ternary without needing a full JSX parser.
  return DASHBOARD_SRC.slice(start, start + 1200);
}

describe('dashboard — output format area is never conditionally removed', () => {
  it('the "Output format" label/area is NOT wrapped in a serviceLevel-gated {condition && (...)} block', () => {
    // Old (buggy) shape: {serviceLevel === 'electronic' && (<div>...outputFormat label...</div>)}
    // The label must be reachable unconditionally — only its CONTENTS branch by serviceLevel.
    const block = extractOutputFormatBlock();
    // The label appears before any serviceLevel branching within its own wrapper div.
    const labelPos = block.indexOf("{t('outputFormat')}</label>");
    const ternaryPos = block.indexOf("serviceLevel === 'electronic' ?");
    expect(labelPos).toBeGreaterThan(-1);
    expect(ternaryPos).toBeGreaterThan(-1);
    expect(ternaryPos).toBeGreaterThan(labelPos);
  });
});

describe('electronic — interactive DOCX/HTML selector', () => {
  it('renders a <select> bound to outputFormat state for serviceLevel === electronic', () => {
    const block = extractOutputFormatBlock();
    expect(block).toContain("serviceLevel === 'electronic' ?");
    expect(block).toContain('<select value={outputFormat}');
  });

  it('offers only docx and html options, never pdf', () => {
    const block = extractOutputFormatBlock();
    const selectIdx = block.indexOf('<select value={outputFormat}');
    const selectSection = block.slice(selectIdx, selectIdx + 300);
    expect(selectSection).toContain('option value="docx"');
    expect(selectSection).toContain('option value="html"');
    expect(selectSection).not.toContain('option value="pdf"');
  });
});

describe('official — read-only final-format notice, no selectable dropdown', () => {
  it('the non-electronic branch renders a read-only div, not a <select>', () => {
    const block = extractOutputFormatBlock();
    const elseIdx = block.indexOf(') : (');
    expect(elseIdx).toBeGreaterThan(-1);
    const elseSection = block.slice(elseIdx, elseIdx + 500);
    expect(elseSection).toContain('data-testid="output-format-readonly"');
    expect(elseSection).toContain('aria-disabled="true"');
    expect(elseSection).not.toContain('<select');
    expect(elseSection).not.toContain('option value="docx"');
    expect(elseSection).not.toContain('option value="html"');
    expect(elseSection).not.toContain('option value="pdf"');
  });

  it('shows the official final-format i18n key when serviceLevel is official (not notarized)', () => {
    const block = extractOutputFormatBlock();
    expect(block).toContain("? tElectronic('finalFormat.notarized')");
    expect(block).toContain(": tElectronic('finalFormat.official')");
    // official is the ternary's else-branch (default), notarized is the explicit check
    const notarizedCheckIdx = block.indexOf("serviceLevel === 'notarization_through_partners'\n                    ?");
    expect(notarizedCheckIdx).toBeGreaterThan(-1);
  });
});

describe('notary — read-only notary-package/PDF notice, no selectable dropdown', () => {
  it('branches on notarization_through_partners specifically to show the notarized key', () => {
    const block = extractOutputFormatBlock();
    expect(block).toContain("serviceLevel === 'notarization_through_partners'");
    expect(block).toContain("tElectronic('finalFormat.notarized')");
  });
});

describe('official/notary do not allow selecting DOCX/HTML', () => {
  it('the <select> for outputFormat only exists inside the electronic branch of the ternary', () => {
    const block = extractOutputFormatBlock();
    const ternaryIdx = block.indexOf("serviceLevel === 'electronic' ?");
    const selectIdx = block.indexOf('<select value={outputFormat}');
    const elseIdx = block.indexOf(') : (');
    expect(selectIdx).toBeGreaterThan(ternaryIdx);
    expect(selectIdx).toBeLessThan(elseIdx);
  });
});

describe('i18n keys used by the output-format area exist', () => {
  it('finalFormat.official and finalFormat.notarized are referenced (not hardcoded strings)', () => {
    expect(DASHBOARD_SRC).toContain("tElectronic('finalFormat.official')");
    expect(DASHBOARD_SRC).toContain("tElectronic('finalFormat.notarized')");
    expect(DASHBOARD_SRC).not.toContain('Final format: PDF after translator review');
    expect(DASHBOARD_SRC).not.toContain('Final format: notary package');
  });
});
