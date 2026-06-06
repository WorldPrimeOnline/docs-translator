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
