/**
 * @jest-environment node
 */

// Tests for convert-to-pdf behaviour around Unicode safety.
// The key invariant: no code path should silently replace Cyrillic/Kazakh/CJK
// characters with spaces, '?', or Latin transliterations.

describe('convert-to-pdf — Unicode safety', () => {
  it('does not contain a destructive replace(/[^\\x00-\\xFF]/g) call', async () => {
    // Read the actual source to verify no destructive regex exists.
    const fs = await import('fs');
    const path = await import('path');
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/convert-to-pdf.ts'),
      'utf-8',
    );

    // These patterns are explicitly forbidden
    expect(src).not.toMatch(/replace\(\/\[\\^\s*\\\\x00-\\\\xFF\]\//);
    expect(src).not.toContain("replace(/[^\\x00-\\xFF]/g, '?')");
    expect(src).not.toContain("replace(/[^\\x00-\\xFF]/g, ' ')");

    // No CYRILLIC_TO_LATIN transliteration table
    expect(src).not.toContain('CYRILLIC_TO_LATIN');
  });

  it('upload-card route blocks DOCX files before any conversion', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/app/api/documents/upload-card/route.ts'),
      'utf-8',
    );

    // Must contain an explicit DOCX_MIME block before the conversion step
    expect(src).toContain('DOCX_NOT_SUPPORTED');
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
