/**
 * Regression tests for script-aware font rendering in DOCX output.
 *
 * Covers all scripts reachable from the UI language list:
 *   Latin (en/de/fr/es/it/tr), Cyrillic (ru/kk/uz), Thai, Arabic,
 *   Simplified Chinese, Japanese (Hiragana+Kanji), Korean (Hangul).
 *
 * Kazakh, Uzbek, Turkish use Latin or Cyrillic extended — no separate font needed.
 */

import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { detectUnicodeScript, splitTextByScript, hasDominantRtlScript } from '../unicode-script';
import { renderToDocx } from '../docx-renderer';
import type { DocxMeta } from '../docx-renderer';

// ── Helpers ────────────────────────────────────────────────────────────────────

async function getDocxXml(buf: Buffer): Promise<string> {
  const tmp = path.join(os.tmpdir(), `wpo-font-script-${Date.now()}.docx`);
  try {
    fs.writeFileSync(tmp, buf);
    return execSync(`unzip -p "${tmp}" "word/document.xml"`).toString();
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  }
}

function thaiRunsWithFont(xml: string): string[] {
  const runRe = /<w:r\b[^>]*>([\s\S]*?)<\/w:r>/g;
  const found: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = runRe.exec(xml)) !== null) {
    if (/[฀-๿]/.test(m[0])) found.push(m[0]);
  }
  return found;
}

function arabicRunsWithFont(xml: string): string[] {
  const runRe = /<w:r\b[^>]*>([\s\S]*?)<\/w:r>/g;
  const found: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = runRe.exec(xml)) !== null) {
    if (/[؀-ۿ]/.test(m[0])) found.push(m[0]);
  }
  return found;
}

function cjkRunsWithEastAsia(xml: string, fontSubstr: string): string[] {
  const runRe = /<w:r\b[^>]*>([\s\S]*?)<\/w:r>/g;
  const found: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = runRe.exec(xml)) !== null) {
    if (/[　-鿿가-힯]/.test(m[0]) && m[0].includes(fontSubstr)) found.push(m[0]);
  }
  return found;
}

const BASE_META: DocxMeta = {
  sourceLang: 'ru',
  targetLang: 'en',
  documentType: 'other',
  translatedAt: '2026-06-18',
  filename: 'test.pdf',
  serviceLevel: 'electronic',
};

// ── unicode-script unit tests ──────────────────────────────────────────────────

describe('detectUnicodeScript', () => {
  it('classifies Latin A–Z and extended (de/fr/es/it)', () => {
    expect(detectUnicodeScript(0x0041)).toBe('latin'); // A
    expect(detectUnicodeScript(0x007A)).toBe('latin'); // z
    expect(detectUnicodeScript(0x00C9)).toBe('latin'); // É (French)
    expect(detectUnicodeScript(0x00FC)).toBe('latin'); // ü (German)
    expect(detectUnicodeScript(0x00F1)).toBe('latin'); // ñ (Spanish)
  });

  it('classifies Cyrillic (ru/kk/uz)', () => {
    expect(detectUnicodeScript(0x0410)).toBe('cyrillic'); // А
    expect(detectUnicodeScript(0x044F)).toBe('cyrillic'); // я
    expect(detectUnicodeScript(0x04D9)).toBe('cyrillic'); // ə (Kazakh)
  });

  it('classifies Thai block', () => {
    expect(detectUnicodeScript(0x0E01)).toBe('thai');
    expect(detectUnicodeScript(0x0E40)).toBe('thai');
    expect(detectUnicodeScript(0x0E44)).toBe('thai');
  });

  it('classifies Arabic', () => {
    expect(detectUnicodeScript(0x0627)).toBe('arabic'); // ا
    expect(detectUnicodeScript(0x0644)).toBe('arabic'); // ل
  });

  it('classifies CJK (Han, Hiragana, Hangul)', () => {
    expect(detectUnicodeScript(0x4E2D)).toBe('cjk'); // 中
    expect(detectUnicodeScript(0x3042)).toBe('cjk'); // あ (Hiragana)
    expect(detectUnicodeScript(0xAC00)).toBe('cjk'); // 가 (Hangul)
  });

  it('classifies digits and common punctuation as common', () => {
    expect(detectUnicodeScript(0x0020)).toBe('common'); // space
    expect(detectUnicodeScript(0x0028)).toBe('common'); // (
    expect(detectUnicodeScript(0x0029)).toBe('common'); // )
    expect(detectUnicodeScript(0x0031)).toBe('common'); // 1
    expect(detectUnicodeScript(0x002C)).toBe('common'); // ,
  });
});

describe('splitTextByScript', () => {
  it('pure Latin → one segment', () => {
    const segs = splitTextByScript('Hello World');
    expect(segs).toHaveLength(1);
    expect(segs[0]!.script).toBe('latin');
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

  it('mixed Cyrillic+Thai: open paren attaches to Cyrillic, close paren absorbed into Thai', () => {
    const segs = splitTextByScript('Мыанг Войлеб (เมืองวอยเล็บ)');
    expect(segs).toHaveLength(2);
    expect(segs[0]!.script).toBe('cyrillic');
    expect(segs[0]!.text).toBe('Мыанг Войлеб (');
    expect(segs[1]!.script).toBe('thai');
    expect(segs[1]!.text).toBe('เมืองวอยเล็บ)');
  });

  it('mixed Latin+Thai with parens', () => {
    const segs = splitTextByScript('Bangkok (กรุงเทพมหานคร)');
    expect(segs[0]!.script).toBe('latin');
    expect(segs[0]!.text).toContain('Bangkok');
    expect(segs[1]!.script).toBe('thai');
  });

  it('identifier with letter+digits stays in one run: N14720583', () => {
    const segs = splitTextByScript('N14720583');
    expect(segs).toHaveLength(1);
    expect(segs[0]!.text).toBe('N14720583');
  });

  it('IBAN KZ55... stays in one run', () => {
    const segs = splitTextByScript('KZ559876543210123456');
    expect(segs).toHaveLength(1);
    expect(segs[0]!.text).toBe('KZ559876543210123456');
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

  it('Kazakh/Uzbek Cyrillic text stays in one run', () => {
    const segs = splitTextByScript('Қазақша мәтін');
    expect(segs).toHaveLength(1);
    expect(segs[0]!.script).toBe('cyrillic');
  });
});

describe('hasDominantRtlScript', () => {
  it('Arabic-only text is RTL-dominant', () => {
    expect(hasDominantRtlScript('النص العربي')).toBe(true);
  });

  it('Latin-only text is not RTL-dominant', () => {
    expect(hasDominantRtlScript('Hello World')).toBe(false);
  });

  it('Cyrillic-only text is not RTL-dominant', () => {
    expect(hasDominantRtlScript('Русский текст')).toBe(false);
  });

  it('mixed Arabic+Latin where Arabic dominates → RTL', () => {
    expect(hasDominantRtlScript('النص العربي ABC')).toBe(true);
  });

  it('mixed Latin+Arabic where Latin dominates → LTR', () => {
    expect(hasDominantRtlScript('Hello world النص')).toBe(false);
  });

  it('empty string is not RTL-dominant', () => {
    expect(hasDominantRtlScript('')).toBe(false);
  });

  it('digits-only is not RTL-dominant', () => {
    expect(hasDominantRtlScript('12345')).toBe(false);
  });
});

// ── DOCX XML integration tests ─────────────────────────────────────────────────

describe('DOCX: Thai font (th target)', () => {
  let xml: string;
  beforeAll(async () => {
    const md = '# ผลการตรวจเลือด\n\nMыанг Войлеб (เมืองวอยเล็บ)';
    xml = await getDocxXml(await renderToDocx(md, { ...BASE_META, targetLang: 'th' }));
  }, 30000);

  it('Thai characters present in XML', () => { expect(xml).toContain('เมืองวอยเล็บ'); });

  it('Thai runs have w:cs="Noto Sans Thai"', () => {
    const runs = thaiRunsWithFont(xml);
    expect(runs.length).toBeGreaterThan(0);
    for (const r of runs) expect(r).toMatch(/w:cs="Noto Sans Thai"/);
  });

  it('Cyrillic runs do NOT get Thai font', () => {
    const runRe = /<w:r\b[^>]*>([\s\S]*?)<\/w:r>/g;
    let m: RegExpExecArray | null;
    while ((m = runRe.exec(xml)) !== null) {
      if (/[А-яЁё]/.test(m[0])) {
        expect(m[0]).not.toContain('Noto Sans Thai');
        break;
      }
    }
  });
});

describe('DOCX: Arabic RTL (ar target)', () => {
  let xml: string;
  beforeAll(async () => {
    const md = [
      '# النص العربي',
      '',
      '## معلومات المستند',
      '',
      '| الحقل | القيمة |',
      '|---|---|',
      '| الاسم | أحمد محمد |',
      '| الرقم | IBAN KZ559876543210123456 |',
      '',
      'هذا نص عربي مع رقم IBAN KZ559876543210123456 مضمّن.',
    ].join('\n');
    xml = await getDocxXml(await renderToDocx(md, { ...BASE_META, targetLang: 'ar' }));
  }, 30000);

  it('Arabic characters present in XML', () => {
    expect(xml).toMatch(/[؀-ۿ]/);
  });

  it('Arabic runs have w:cs="Noto Sans Arabic"', () => {
    const runs = arabicRunsWithFont(xml);
    expect(runs.length).toBeGreaterThan(0);
    for (const r of runs) expect(r).toMatch(/w:cs="Noto Sans Arabic"/);
  });

  it('Arabic runs have <w:rtl/>', () => {
    const runs = arabicRunsWithFont(xml);
    for (const r of runs) expect(r).toContain('<w:rtl/>');
  });

  it('Arabic-dominant paragraphs have <w:bidi/>', () => {
    expect(xml).toContain('<w:bidi/>');
  });

  it('IBAN stays intact in XML (not fragmented)', () => {
    expect(xml).toContain('KZ559876543210123456');
  });
});

describe('DOCX: CJK — Simplified Chinese (zh target)', () => {
  let xml: string;
  beforeAll(async () => {
    const md = '# 简体中文\n\n这是一段简体中文文本。\n\n| 字段 | 值 |\n|---|---|\n| 姓名 | 张伟 |\n| 编号 | CN-2026-001 |';
    xml = await getDocxXml(await renderToDocx(md, { ...BASE_META, targetLang: 'zh' }));
  }, 30000);

  it('Chinese characters present', () => { expect(xml).toContain('简体中文'); });

  it('CJK runs use Noto Sans CJK SC for zh', () => {
    const runs = cjkRunsWithEastAsia(xml, 'Noto Sans CJK SC');
    expect(runs.length).toBeGreaterThan(0);
  });

  it('does not use JP or KR font for zh', () => {
    expect(xml).not.toContain('Noto Sans CJK JP');
    expect(xml).not.toContain('Noto Sans CJK KR');
  });
});

describe('DOCX: CJK — Japanese (ja target)', () => {
  let xml: string;
  beforeAll(async () => {
    const md = '# 日本語テキスト\n\nこれは日本語のテキストです。漢字とひらがな。';
    xml = await getDocxXml(await renderToDocx(md, { ...BASE_META, targetLang: 'ja' }));
  }, 30000);

  it('Japanese characters present', () => { expect(xml).toContain('日本語'); });

  it('CJK runs use Noto Sans CJK JP for ja', () => {
    const runs = cjkRunsWithEastAsia(xml, 'Noto Sans CJK JP');
    expect(runs.length).toBeGreaterThan(0);
  });

  it('does not use SC or KR font for ja', () => {
    expect(xml).not.toContain('Noto Sans CJK SC');
    expect(xml).not.toContain('Noto Sans CJK KR');
  });
});

describe('DOCX: CJK — Korean (ko target)', () => {
  let xml: string;
  beforeAll(async () => {
    const md = '# 한국어 텍스트\n\n이것은 한국어 텍스트입니다.';
    xml = await getDocxXml(await renderToDocx(md, { ...BASE_META, targetLang: 'ko' }));
  }, 30000);

  it('Korean characters present', () => { expect(xml).toContain('한국어'); });

  it('CJK runs use Noto Sans CJK KR for ko', () => {
    const runs = cjkRunsWithEastAsia(xml, 'Noto Sans CJK KR');
    expect(runs.length).toBeGreaterThan(0);
  });

  it('does not use SC or JP font for ko', () => {
    expect(xml).not.toContain('Noto Sans CJK SC');
    expect(xml).not.toContain('Noto Sans CJK JP');
  });
});

describe('DOCX: Latin/Cyrillic explicit Noto Sans (no regression)', () => {
  let xml: string;
  beforeAll(async () => {
    const md = [
      '# CERTIFICATE OF EMPLOYMENT',
      '',
      '## Employer',
      '| Field | Value |',
      '|---|---|',
      '| Full Name | YUDENOV GLEB ALEXANDROVICH |',
      '| IIN | 201240012345 |',
      '| Passport | N14720583 |',
      '',
      'Русский текст — проверка шрифта.',
    ].join('\n');
    xml = await getDocxXml(await renderToDocx(md, { ...BASE_META, targetLang: 'ru' }));
  }, 30000);

  it('Latin/Cyrillic text uses Noto Sans', () => {
    expect(xml).toContain('Noto Sans');
  });

  it('no Thai/Arabic/CJK font in Latin+Cyrillic document', () => {
    expect(xml).not.toContain('Noto Sans Thai');
    expect(xml).not.toContain('Noto Sans Arabic');
    expect(xml).not.toContain('Noto Sans CJK');
  });

  it('identifiers preserved intact', () => {
    expect(xml).toContain('201240012345');
    expect(xml).toContain('N14720583');
  });
});

describe('DOCX: multi-script regression fixture', () => {
  const ALL_SCRIPTS_MD = [
    '# Multi-Script Document',
    '',
    'Русский текст',
    '',
    'English text',
    '',
    'ข้อความภาษาไทย',
    '',
    '简体中文',
    '',
    '日本語テキスト',
    '',
    '한국어 텍스트',
    '',
    'النص العربي',
    '',
    'Қазақша мәтін',
    '',
    "O'zbekcha matn",
    '',
    'Türkçe metin',
    '',
    'Français',
    '',
    'Español',
    '',
    'Deutsch',
    '',
    'Italiano',
  ].join('\n');

  it('all script paragraphs render without errors', async () => {
    // Use zh as targetLang so we exercise SC CJK selection
    await expect(
      renderToDocx(ALL_SCRIPTS_MD, { ...BASE_META, targetLang: 'zh' }),
    ).resolves.toBeInstanceOf(Buffer);
  }, 30000);

  it('DOCX contains all script characters', async () => {
    const buf = await renderToDocx(ALL_SCRIPTS_MD, { ...BASE_META, targetLang: 'zh' });
    const xml = await getDocxXml(buf);
    // Cyrillic
    expect(xml).toMatch(/[А-яЁё]/);
    // Latin extended (Kazakh, French, German, Spanish, Turkish…)
    expect(xml).toContain('Français');
    expect(xml).toContain('Español');
    // Thai
    expect(xml).toContain('ข้อความภาษาไทย');
    // CJK
    expect(xml).toContain('简体中文');
    expect(xml).toContain('日本語');
    expect(xml).toContain('한국어');
    // Arabic
    expect(xml).toContain('النص');
  }, 30000);
});
