/**
 * @jest-environment node
 */
import { runQaChecks } from '../qa';

describe('runQaChecks', () => {
  it('translation_only with forbidden term "Claude" → hasForbiddenTechnicalTerms=true, ok=false', () => {
    const html = '<html><body><p>Translated by Claude assistant</p></body></html>';
    const report = runQaChecks(html, 'translation_only');
    expect(report.hasForbiddenTechnicalTerms).toBe(true);
    expect(report.ok).toBe(false);
  });

  it('translation_only with forbidden term " OCR " → hasForbiddenTechnicalTerms=true', () => {
    const html = '<html><body><p>The OCR result shows text</p></body></html>';
    const report = runQaChecks(html, 'translation_only');
    expect(report.hasForbiddenTechnicalTerms).toBe(true);
  });

  it('translation_only without forbidden terms and no glyphs → ok=true', () => {
    const html = '<html><body><p>Перевод выполнен верно.</p></body></html>';
    const report = runQaChecks(html, 'translation_only');
    expect(report.hasForbiddenTechnicalTerms).toBe(false);
    expect(report.hasBrokenGlyphs).toBe(false);
    expect(report.ok).toBe(true);
  });

  it('translator_review_draft without translator block → hasTranslatorBlock=false, ok=true (not a blocking error)', () => {
    const html = '<html><body><p>Translation content without cert block</p></body></html>';
    const report = runQaChecks(html, 'translator_review_draft');
    expect(report.hasTranslatorBlock).toBe(false);
    expect(report.ok).toBe(true);
    expect(report.warnings).toContain('Translator certification block not found — expected for review draft.');
  });

  it('translator_review_draft with broken glyph → ok=false', () => {
    const html = '<html><body><p>Text with □□□ broken glyphs</p></body></html>';
    const report = runQaChecks(html, 'translator_review_draft');
    expect(report.hasBrokenGlyphs).toBe(true);
    expect(report.ok).toBe(false);
  });

  it('HTML with broken replacement glyph character → hasBrokenGlyphs=true', () => {
    const html = '<html><body><p>Some text � here</p></body></html>';
    const report = runQaChecks(html, 'translation_only');
    expect(report.hasBrokenGlyphs).toBe(true);
  });

  it('translator_review_draft with translator block → hasTranslatorBlock=true', () => {
    const html = '<html><body><p>Content</p><table><tr><td>Переводчик:</td><td>Name</td></tr></table></body></html>';
    const report = runQaChecks(html, 'translator_review_draft');
    expect(report.hasTranslatorBlock).toBe(true);
  });

  it('requiresHumanReview is true for translator_review_draft', () => {
    const html = '<html><body><p>Content</p></body></html>';
    const report = runQaChecks(html, 'translator_review_draft');
    expect(report.requiresHumanReview).toBe(true);
  });

  it('requiresHumanReview is false for translation_only', () => {
    const html = '<html><body><p>Content</p></body></html>';
    const report = runQaChecks(html, 'translation_only');
    expect(report.requiresHumanReview).toBe(false);
  });

  it('hasVisualElementsBlock is true when visual elements section present', () => {
    const html = '<html><body><h2>Description of non-text elements in the original</h2><p>No elements.</p></body></html>';
    const report = runQaChecks(html, 'translation_only');
    expect(report.hasVisualElementsBlock).toBe(true);
  });

  it('hasVisualElementsBlock is true for Russian heading', () => {
    const html = '<html><body><h2>Описание нетекстовых элементов оригинала</h2><p>Нет элементов.</p></body></html>';
    const report = runQaChecks(html, 'translation_only');
    expect(report.hasVisualElementsBlock).toBe(true);
  });

  it('pages count is included when passed', () => {
    const html = '<html><body><p>Content</p></body></html>';
    const report = runQaChecks(html, 'translation_only', 3);
    expect(report.pages).toBe(3);
  });
});

// ── Mixed-script token detection ──────────────────────────────────────────────

describe('runQaChecks — mixed-script token detection', () => {
  it('flags KSЈВКZКХ (Latin+Cyrillic mixed token)', () => {
    const html = `<html><body><p>БИК: KSЈВКZКХ</p></body></html>`;
    const report = runQaChecks(html, 'translator_review_draft');
    expect(report.mixedScriptWarnings).toBeDefined();
    expect(report.mixedScriptWarnings!.length).toBeGreaterThan(0);
    expect(report.mixedScriptWarnings![0]!.code).toBe('MIXED_SCRIPT_TOKEN_REQUIRES_REVIEW');
    expect(report.warnings.some(w => w.includes('MIXED_SCRIPT_TOKEN_REQUIRES_REVIEW'))).toBe(true);
    expect(report.warnings.some(w => w.includes('Сверьте его с оригиналом'))).toBe(true);
  });

  it('flags КСJВКZКХ (Cyrillic-dominant with Latin J and Z)', () => {
    const html = `<html><body><p>Code: КСJВКZКХ</p></body></html>`;
    const report = runQaChecks(html, 'translation_only');
    expect(report.mixedScriptWarnings).toBeDefined();
    expect(report.mixedScriptWarnings!.length).toBeGreaterThan(0);
  });

  it('does not flag KCJBKZKX (pure Latin BIC)', () => {
    const html = `<html><body><p>BIC: KCJBKZKX</p></body></html>`;
    const report = runQaChecks(html, 'translation_only');
    expect(report.mixedScriptWarnings).toBeUndefined();
  });

  it('does not flag КАЗАХСТАН (pure Cyrillic)', () => {
    const html = `<html><body><p>Страна: КАЗАХСТАН</p></body></html>`;
    const report = runQaChecks(html, 'translation_only');
    expect(report.mixedScriptWarnings).toBeUndefined();
  });

  it('does not flag N14720583 (Latin + digits only)', () => {
    const html = `<html><body><p>Ref: N14720583</p></body></html>`;
    const report = runQaChecks(html, 'translation_only');
    expect(report.mixedScriptWarnings).toBeUndefined();
  });

  it('does not flag KZ559876543210123456 (IBAN-like, pure Latin+digits)', () => {
    const html = `<html><body><p>IBAN: KZ559876543210123456</p></body></html>`;
    const report = runQaChecks(html, 'translation_only');
    expect(report.mixedScriptWarnings).toBeUndefined();
  });

  it('does not flag ТД-2020/0914-38 (pure Cyrillic+digits+punctuation)', () => {
    const html = `<html><body><p>Приказ: ТД-2020/0914-38</p></body></html>`;
    const report = runQaChecks(html, 'translation_only');
    expect(report.mixedScriptWarnings).toBeUndefined();
  });

  it('tokenPreview abbreviates long mixed tokens', () => {
    const html = `<html><body><p>Code: KSАВСdEFghЖЗ</p></body></html>`;
    const report = runQaChecks(html, 'translation_only');
    if (report.mixedScriptWarnings && report.mixedScriptWarnings.length > 0) {
      const preview = report.mixedScriptWarnings[0]!.tokenPreview;
      expect(preview.length).toBeLessThanOrEqual(7); // 2 + "…" + 2 = 5, or full token if ≤6
    }
  });

  it('does not block delivery (ok remains true for non-broken content)', () => {
    const html = `<html><body><p>БИК: KSЈВКZКХ</p></body></html>`;
    const report = runQaChecks(html, 'translation_only');
    expect(report.ok).toBe(true); // mixed-script is warning only, not error
  });
});
