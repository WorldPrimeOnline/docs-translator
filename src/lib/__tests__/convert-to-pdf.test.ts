/**
 * @jest-environment node
 */

// Tests for convert-to-pdf Unicode safety and DOCX support.
// Key invariants:
//  1. No code path silently replaces Cyrillic/Kazakh/CJK with spaces/? or transliterates.
//  2. upload-card route accepts DOCX (no DOCX_NOT_SUPPORTED rejection).
//  3. migration 0016 correctly constrains payment_source.

describe('convert-to-pdf — Unicode safety', () => {
  it('does not contain a destructive replace(/[^\\x00-\\xFF]/g) call', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/convert-to-pdf.ts'),
      'utf-8',
    );

    expect(src).not.toMatch(/replace\(\/\[\\^\s*\\\\x00-\\\\xFF\]\//);
    expect(src).not.toContain("replace(/[^\\x00-\\xFF]/g, '?')");
    expect(src).not.toContain("replace(/[^\\x00-\\xFF]/g, ' ')");
    expect(src).not.toContain('CYRILLIC_TO_LATIN');
  });

  it('uses fontkit + NotoSans for DOCX conversion (not WinAnsi StandardFonts)', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/convert-to-pdf.ts'),
      'utf-8',
    );

    expect(src).toContain('@pdf-lib/fontkit');
    expect(src).toContain('NotoSans-Regular.ttf');
    expect(src).toContain('registerFontkit');
    // No fallback to StandardFonts.Helvetica (WinAnsi)
    expect(src).not.toContain('StandardFonts.Helvetica');
  });

  it('NotoSans-Regular.ttf is present in public/fonts', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const fontPath = path.join(process.cwd(), 'public', 'fonts', 'NotoSans-Regular.ttf');
    expect(fs.existsSync(fontPath)).toBe(true);
    const size = fs.statSync(fontPath).size;
    expect(size).toBeGreaterThan(100_000); // font should be > 100 KB
  });

  it('NotoSans-Regular.ttf covers Cyrillic and Kazakh codepoints', async () => {
    const fontkit = await import('@pdf-lib/fontkit');
    const fs = await import('fs');
    const path = await import('path');
    const fontBytes = fs.readFileSync(
      path.join(process.cwd(), 'public', 'fonts', 'NotoSans-Regular.ttf'),
    );
    const font = fontkit.default.create(fontBytes);

    const cyrillicA = font.glyphForCodePoint(0x0410); // А
    const kazakhQ = font.glyphForCodePoint(0x049B);   // қ
    const latinA = font.glyphForCodePoint(0x0041);    // A

    expect(cyrillicA.id).toBeGreaterThan(0);
    expect(kazakhQ.id).toBeGreaterThan(0);
    expect(latinA.id).toBeGreaterThan(0);
  });
});

describe('convert-to-pdf — upload-card DOCX support', () => {
  it('upload-card route does NOT block DOCX files', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/app/api/documents/upload-card/route.ts'),
      'utf-8',
    );

    // DOCX_NOT_SUPPORTED rejection must be absent
    expect(src).not.toContain('DOCX_NOT_SUPPORTED');
    expect(src).not.toContain('DOCX files are not supported');
    // DOCX must be in the allowed MIME types map
    expect(src).toContain('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  });
});

describe('convert-to-pdf — migration constraint', () => {
  it('migration 0016 grants card_payment in payment_source constraint', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const sql = fs.readFileSync(
      path.join(process.cwd(), 'supabase/migrations/0016_fix_jobs_payment_source_constraint.sql'),
      'utf-8',
    );

    expect(sql).toContain('card_payment');
    expect(sql).toContain('subscription');
    expect(sql).toContain('jobs_payment_source_check');
    expect(sql).toContain('payment_pending');
    expect(sql).toContain('DROP CONSTRAINT IF EXISTS');
  });
});
