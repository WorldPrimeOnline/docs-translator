/**
 * @jest-environment node
 */
import { extractVisualElementsFromOcr } from '../visual-elements';
import { ensureVisualElementsBlock, buildVisualElementsBlock } from '../visual-elements-block';

describe('extractVisualElementsFromOcr', () => {
  it('detects QR bracket marker', () => {
    const md = 'Some text\n[QR code present]\nMore text';
    const elements = extractVisualElementsFromOcr(md);
    expect(elements.some((e) => e.kind === 'qr')).toBe(true);
  });

  it('detects stamp bracket marker', () => {
    const md = 'Document content\n[round stamp]\nSignature block';
    const elements = extractVisualElementsFromOcr(md);
    expect(elements.some((e) => e.kind === 'stamp')).toBe(true);
  });

  it('detects MRZ line', () => {
    const md = 'Passport data\nP<KAZIVANOVA<<ANNA<<<<<<<<<<<<<<<<<<<<<<\nKZ0123456<1KAZ8901010F3012319<<<<<<<<<6\nEnd of doc';
    const elements = extractVisualElementsFromOcr(md);
    expect(elements.some((e) => e.kind === 'mrz')).toBe(true);
  });

  it('detects verification URL', () => {
    const md = 'Verify at https://verify.example.gov/check?doc=12345 or call us.';
    const elements = extractVisualElementsFromOcr(md);
    expect(elements.some((e) => e.kind === 'verification_string')).toBe(true);
  });

  it('does not return base64 image data in text field', () => {
    const md = '![photo](data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKD)\nSome text';
    const elements = extractVisualElementsFromOcr(md);
    const imgElement = elements.find((e) => e.source === 'mistral_ocr');
    if (imgElement) {
      // text field must not contain base64 payload
      expect(imgElement.text).not.toMatch(/data:image/);
      expect(imgElement.text).not.toMatch(/base64,/);
    }
    // Whether image is detected or not (alt is 'photo', kind should be photo)
    expect(elements.some((e) => e.kind === 'photo' || e.kind === 'unknown_image')).toBe(true);
  });

  it('detects Russian stamp marker', () => {
    const md = 'Содержание документа\n[печать учреждения]\nДата выдачи';
    const elements = extractVisualElementsFromOcr(md);
    expect(elements.some((e) => e.kind === 'stamp')).toBe(true);
  });

  it('returns deduplicated elements', () => {
    const md = '[QR code present]\n[QR code present]\n[QR code present]';
    const elements = extractVisualElementsFromOcr(md);
    const qrElements = elements.filter((e) => e.kind === 'qr');
    expect(qrElements.length).toBe(1);
  });
});

describe('ensureVisualElementsBlock', () => {
  it('appends block when not present', () => {
    const md = 'Some translated content.';
    const result = ensureVisualElementsBlock(md, [], 'ru');
    expect(result).toContain('## Описание нетекстовых элементов оригинала');
  });

  it('does not duplicate when heading already present', () => {
    const md = 'Content\n\n## Описание нетекстовых элементов оригинала\n\nNo elements.';
    const result = ensureVisualElementsBlock(md, [], 'ru');
    const count = (result.match(/нетекстовых элементов/g) ?? []).length;
    expect(count).toBe(1);
  });

  it('produces empty message in Russian when no elements', () => {
    const block = buildVisualElementsBlock([], 'ru');
    expect(block).toContain('Нет явно распознанных нетекстовых элементов.');
  });

  it('produces empty message in English when no elements', () => {
    const block = buildVisualElementsBlock([], 'en');
    expect(block).toContain('No clearly identified non-text elements.');
  });

  it('does not duplicate when English heading already present', () => {
    const md = 'Content\n\n## Description of non-text elements in the original\n\nNo elements.';
    const result = ensureVisualElementsBlock(md, [], 'en');
    const count = (result.match(/non-text elements/gi) ?? []).length;
    expect(count).toBe(1);
  });
});
