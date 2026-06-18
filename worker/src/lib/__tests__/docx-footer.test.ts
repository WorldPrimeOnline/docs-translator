/**
 * Tests that the DOCX footer uses proper fldSimple PAGE/NUMPAGES fields
 * rather than the legacy <w:pgNum/> element.
 */
import { renderToDocx } from '../docx-renderer';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const SIMPLE_BODY = `# Test Document\n\nSome content here.\n`;

const META = {
  sourceLang: 'ru',
  targetLang: 'en',
  documentType: 'other' as const,
  translatedAt: '2026-06-17',
  filename: 'test.pdf',
  serviceLevel: 'electronic' as const,
};

async function extractFooterXml(docxBuf: Buffer): Promise<string> {
  const tmpPath = path.join(os.tmpdir(), `wpo-footer-test-${Date.now()}.docx`);
  try {
    fs.writeFileSync(tmpPath, docxBuf);
    // Extract footer XML; may be footer1.xml, footer2.xml, etc.
    const result = execSync(
      `unzip -p "${tmpPath}" "word/footer*.xml" 2>/dev/null || echo ""`,
    ).toString();
    return result;
  } finally {
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
  }
}

describe('DOCX footer field instructions', () => {
  let footerXml: string;

  beforeAll(async () => {
    const buf = await renderToDocx(SIMPLE_BODY, META, []);
    footerXml = await extractFooterXml(buf);
  }, 30000);

  test('footer XML is non-empty (footer was generated)', () => {
    expect(footerXml.length).toBeGreaterThan(50);
  });

  test('PAGE instruction present as fldSimple', () => {
    expect(footerXml).toContain('w:instr="PAGE"');
  });

  test('NUMPAGES instruction present as fldSimple', () => {
    expect(footerXml).toContain('w:instr="NUMPAGES"');
  });

  test('no legacy <w:pgNum/> element in footer', () => {
    expect(footerXml).not.toContain('<w:pgNum');
  });
});
