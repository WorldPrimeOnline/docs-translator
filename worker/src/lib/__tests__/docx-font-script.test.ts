/**
 * Regression tests for script-aware font rendering in DOCX output.
 *
 * Verifies that mixed-script text (Cyrillic+Thai, Latin+Arabic, etc.) produces
 * per-run w:rFonts elements with the correct Noto font for each script, and
 * that Latin/Cyrillic-only text does not receive unnecessary font overrides.
 */

import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { detectUnicodeScript, splitTextByScript } from '../unicode-script';
import { renderToDocx } from '../docx-renderer';
import type { DocxMeta } from '../docx-renderer';

// ── Unicode-script unit tests ──────────────────────────────────────────────────

describe('detectUnicodeScript', () => {
  it('classifies Latin A–Z', () => {
    expect(detectUnicodeScript(0x0041)).toBe('latin'); // A
    expect(detectUnicodeScript(0x007A)).toBe('latin'); // z
    expect(detectUnicodeScript(0x00C0)).toBe('latin'); // À
  });

  it('classifies Cyrillic А–Я', () => {
    expect(detectUnicodeScript(0x0410)).toBe('cyrillic'); // А
    expect(detectUnicodeScript(0x044F)).toBe('cyrillic'); // я
  });

  it('classifies Thai block', () => {
    expect(detectUnicodeScript(0x0E01)).toBe('thai'); // ก
    expect(detectUnicodeScript(0x0E40)).toBe('thai'); // เ
    expect(detectUnicodeScript(0x0E44)).toBe('thai'); // ไ
  });

  it('classifies digits and common punctuation as common', () => {
    expect(detectUnicodeScript(0x0020)).toBe('common'); // space
    expect(detectUnicodeScript(0x0028)).toBe('common'); // (
    expect(detectUnicodeScript(0x0029)).toBe('common'); // )
    expect(detectUnicodeScript(0x0031)).toBe('common'); // 1
    expect(detectUnicodeScript(0x002C)).toBe('common'); // ,
    expect(detectUnicodeScript(0x002E)).toBe('common'); // .
  });
});

describe('splitTextByScript', () => {
  it('pure Latin → one segment', () => {
    const segs = splitTextByScript('Hello World');
    expect(segs).toHaveLength(1);
    expect(segs[0]!.script).toBe('latin');
    expect(segs[0]!.text).toBe('Hello World');
  });

  it('pure Cyrillic → one segment', () => {
    const segs = splitTextByScript('Привет мир');
    expect(segs).toHaveLength(1);
    expect(segs[0]!.script).toBe('cyrillic');
  });

  it('pure Thai → one segment', () => {
    const segs = splitTextByScript('กรุงเทพมหานคร');
    expect(segs).toHaveLength(1);
    expect(segs[0]!.script).toBe('thai');
  });

  it('mixed Cyrillic+Thai: open paren attaches to Cyrillic, close paren attaches to Thai', () => {
    const segs = splitTextByScript('Мыанг Войлеб (เมืองวอยเล็บ)');
    // "(" attaches to the preceding Cyrillic run (left-leaning rule)
    // ")" attaches to the final Thai run (trailing common absorbed into preceding run)
    expect(segs).toHaveLength(2);
    expect(segs[0]!.script).toBe('cyrillic');
    expect(segs[0]!.text).toBe('Мыанг Войлеб (');
    expect(segs[1]!.script).toBe('thai');
    expect(segs[1]!.text).toBe('เมืองวอยเล็บ)');
  });

  it('mixed Latin+Thai with slash separator', () => {
    const segs = splitTextByScript('Bangkok (กรุงเทพมหานคร)');
    expect(segs[0]!.script).toBe('latin');
    expect(segs[0]!.text).toContain('Bangkok');
    expect(segs[1]!.script).toBe('thai');
  });

  it('digits-only string → single common segment', () => {
    const segs = splitTextByScript('2026-06-18');
    expect(segs).toHaveLength(1);
    expect(segs[0]!.script).toBe('common');
  });

  it('empty string → empty array', () => {
    expect(splitTextByScript('')).toHaveLength(0);
  });

  it('leading spaces attach to first script', () => {
    const segs = splitTextByScript('  กรุง');
    expect(segs).toHaveLength(1);
    expect(segs[0]!.script).toBe('thai');
    expect(segs[0]!.text).toBe('  กรุง');
  });

  it('no single-character splitting: multi-char Thai produces one run', () => {
    const segs = splitTextByScript('เมืองวอยเล็บ');
    expect(segs).toHaveLength(1);
    expect(segs[0]!.text).toBe('เมืองวอยเล็บ');
  });
});

// ── DOCX XML integration tests ─────────────────────────────────────────────────

const META: DocxMeta = {
  sourceLang: 'th',
  targetLang: 'ru',
  documentType: 'other',
  translatedAt: '2026-06-18',
  filename: 'test.pdf',
  serviceLevel: 'electronic',
};

async function getDocxXml(buf: Buffer): Promise<string> {
  const tmp = path.join(os.tmpdir(), `wpo-font-script-${Date.now()}.docx`);
  try {
    fs.writeFileSync(tmp, buf);
    return execSync(`unzip -p "${tmp}" "word/document.xml"`).toString();
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  }
}

describe('DOCX script-aware font rendering', () => {
  describe('Thai text in body paragraph', () => {
    let xml: string;

    beforeAll(async () => {
      const md = `# ผลการตรวจเลือด\n\nMыанг Войлеб (เมืองวอยเล็บ)`;
      const buf = await renderToDocx(md, META);
      xml = await getDocxXml(buf);
    }, 30000);

    it('Thai characters are present in document.xml', () => {
      expect(xml).toContain('เมืองวอยเล็บ');
    });

    it('Thai run has Noto Sans Thai in w:rFonts (cs attribute)', () => {
      // Find runs containing Thai characters and check their rPr
      const runRe = /<w:r\b[^>]*>([\s\S]*?)<\/w:r>/g;
      let m: RegExpExecArray | null;
      let foundThaiRun = false;
      while ((m = runRe.exec(xml)) !== null) {
        const runXml = m[0];
        if (/[฀-๿]/.test(runXml)) {
          expect(runXml).toContain('Noto Sans Thai');
          expect(runXml).toMatch(/w:cs="Noto Sans Thai"/);
          foundThaiRun = true;
          break;
        }
      }
      expect(foundThaiRun).toBe(true);
    });

    it('Cyrillic run does NOT get Thai font', () => {
      const runRe = /<w:r\b[^>]*>([\s\S]*?)<\/w:r>/g;
      let m: RegExpExecArray | null;
      while ((m = runRe.exec(xml)) !== null) {
        const runXml = m[0];
        if (/[А-яЁё]/.test(runXml)) {
          expect(runXml).not.toContain('Noto Sans Thai');
          break;
        }
      }
    });
  });

  describe('mixed-script table cells', () => {
    let xml: string;

    beforeAll(async () => {
      const md = [
        '## รายการ',
        '',
        '| ชื่อ | ค่า |',
        '|---|---|',
        '| Мыанг Войлеб (เมืองวอยเล็บ) | 12345 |',
        '| Иванов (อีวานอฟ) | 67890 |',
      ].join('\n');
      const buf = await renderToDocx(md, META);
      xml = await getDocxXml(buf);
    }, 30000);

    it('Thai characters in table cells are present', () => {
      expect(xml).toContain('เมืองวอยเล็บ');
      expect(xml).toContain('อีวานอฟ');
    });

    it('Thai runs in table cells have w:cs="Noto Sans Thai"', () => {
      const runRe = /<w:r\b[^>]*>([\s\S]*?)<\/w:r>/g;
      let m: RegExpExecArray | null;
      const thaiRunsWithFont: string[] = [];
      while ((m = runRe.exec(xml)) !== null) {
        const runXml = m[0];
        if (/[฀-๿]/.test(runXml)) {
          thaiRunsWithFont.push(runXml);
        }
      }
      expect(thaiRunsWithFont.length).toBeGreaterThan(0);
      for (const run of thaiRunsWithFont) {
        expect(run).toMatch(/w:cs="Noto Sans Thai"/);
      }
    });
  });

  describe('pure Latin/Cyrillic document (no regression)', () => {
    let xml: string;

    beforeAll(async () => {
      const md = [
        '# CERTIFICATE OF EMPLOYMENT',
        '',
        '## Employee',
        '| Field | Value |',
        '|---|---|',
        '| Full Name | YUDENOV GLEB ALEXANDROVICH |',
        '| Position | Senior Software Engineer |',
      ].join('\n');
      const buf = await renderToDocx(md, { ...META, sourceLang: 'ru', targetLang: 'en' });
      xml = await getDocxXml(buf);
    }, 30000);

    it('document renders without errors', () => {
      expect(xml).toContain('CERTIFICATE OF EMPLOYMENT');
    });

    it('no spurious Noto Sans Thai font in a Latin-only document', () => {
      // No Thai characters, so no Noto Sans Thai should appear
      expect(xml).not.toContain('Noto Sans Thai');
    });
  });
});
