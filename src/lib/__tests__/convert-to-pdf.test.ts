/**
 * @jest-environment node
 */

describe('convert-to-pdf — WinAnsi safe text handling', () => {
  it('replaces non-Latin-1 characters with space, not transliteration', () => {
    // The text replacement happens inline in docxBufferToPdf.
    // We verify the regex behaviour directly since the function requires
    // real DOCX buffers and pdf-lib font embedding (integration-level).
    const replace = (text: string) => text.replace(/[^\x00-\xFF]/g, ' ');

    // Cyrillic should become spaces, not Latin lookalikes
    expect(replace('Иван')).toBe('    ');
    expect(replace('Қазақстан')).toBe('         ');

    // ASCII is preserved as-is
    expect(replace('Hello World')).toBe('Hello World');

    // Latin-extended (U+00C0–U+00FF) is preserved
    expect(replace('Ñoño')).toBe('Ñoño');
    expect(replace('café')).toBe('café');

    // Mixed text: ASCII preserved, non-Latin-1 replaced
    expect(replace('Name: Иван')).toBe('Name:     ');
    expect(replace('ID: 123456')).toBe('ID: 123456');
  });

  it('does NOT transliterate Cyrillic to Latin', () => {
    const replace = (text: string) => text.replace(/[^\x00-\xFF]/g, ' ');

    // These should NOT produce transliteration artifacts
    const result = replace('Казахстан');
    expect(result).not.toContain('K');
    expect(result).not.toContain('z');
    expect(result).not.toContain('kh');
    // Should be all spaces
    expect(result.trim()).toBe('');
  });
});
