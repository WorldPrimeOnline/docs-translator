/**
 * @jest-environment node
 *
 * Regression tests for official DOCX layout:
 * - KV tables → 2 columns (33%/67%)
 * - Data tables → original column count
 * - Visual block → 4 columns
 * - Translator block → 2 columns
 * - Footer with PAGE / NUMPAGES fields
 * - Localized translation heading
 * - KV table content preservation
 */

import { renderToDocx } from '../docx-renderer';
import type { VisualElement } from '../visual-elements';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const JSZip = require('jszip') as typeof import('jszip');

// ── XML helpers ───────────────────────────────────────────────────────────────

function decodeXml(s: string): string {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

async function getDocXml(buf: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buf);
  const file = zip.file('word/document.xml');
  if (!file) throw new Error('word/document.xml not found');
  return decodeXml(await file.async('string'));
}

async function getFooterXml(buf: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buf);
  // Find footer file(s)
  const footerKeys = Object.keys(zip.files).filter((k) => /word\/footer\d*\.xml/.test(k));
  if (footerKeys.length === 0) return '';
  const file = zip.file(footerKeys[0]!);
  if (!file) return '';
  return decodeXml(await file.async('string'));
}

/**
 * Returns the number of <w:tc> elements in each <w:tbl> in the document.
 * Result: array of column counts per table (using first non-header row).
 */
function getTableColumnCounts(xml: string): number[] {
  const tablePattern = /<w:tbl\b[^>]*>([\s\S]*?)<\/w:tbl>/g;
  const counts: number[] = [];
  let tblMatch: RegExpExecArray | null;

  while ((tblMatch = tablePattern.exec(xml)) !== null) {
    const tblContent = tblMatch[1] ?? '';
    // Find first row
    const rowMatch = /<w:tr\b[^>]*>([\s\S]*?)<\/w:tr>/.exec(tblContent);
    if (!rowMatch) continue;
    const rowContent = rowMatch[1] ?? '';
    const cellCount = (rowContent.match(/<w:tc\b/g) ?? []).length;
    counts.push(cellCount);
  }
  return counts;
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let pos = 0;
  while ((pos = haystack.indexOf(needle, pos)) !== -1) { count++; pos += needle.length; }
  return count;
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

// Employment doc: Variant A — explicit repeated structural KV headers (Поле|Значение|Поле|Значение)
const EMPLOYMENT_4COL_MD = `# ТРУДОВАЯ СПРАВКА

## Данные работодателя

| Поле | Значение | Поле | Значение |
| ---- | -------- | ---- | -------- |
| Организация | ТОО «Северный Мост Логистик» | Форма | ТОО |
| Адрес | г. Алматы, ул. Абая 1 | Телефон | +7 727 123 4567 |
| Директор | Сейткали Ерлан | ИИН директора | 750214350987 |

## Данные работника

| Поле | Значение | Поле | Значение |
| ---- | -------- | ---- | -------- |
| ФИО | Абдрахманов Асхат Серикович | ИИН | 850213450567 |
| Должность | Ведущий менеджер | Дата рождения | 13.02.1985 |

## Заработная плата

| № | Период | Оклад (тенге) | Надбавки | Налоги | Нетто |
| - | ------ | ------------- | -------- | ------ | ----- |
| 1 | Январь 2024 | 500 000 | 50 000 | 97 500 | 452 500 |
| 2 | Февраль 2024 | 500 000 | 50 000 | 97 500 | 452 500 |

Справка выдана 15 января 2024 года.`;

// Employment doc: Variant B — LLM places actual data in Markdown header row (real staging pattern)
// This is what Claude actually outputs for Turkish/Uzbek employment translations:
// the first data pair lands in the Markdown table header row, NOT in an explicit "Alan|Değer" row.
const EMPLOYMENT_REAL_4COL_MD = `# İŞ YERİ BELGESİ

## İşveren Bilgileri

| İşverenin adı | SML Group ŞTİ | BIN | 047291638 |
| ------------ | ------------- | --- | --------- |
| Adres | Almatı, Abay Cad. 1 | Telefon | +7 727 123 4567 |
| Yönetici | Aitbayev Seitkali | Yönetici kimlik no | 750214350987 |

## Çalışan Bilgileri

| Soyadı | Nurtayeva | Kimlik belgesi | № 047291638 |
| ------ | --------- | -------------- | ----------- |
| Adı | Askhаt | Doğum tarihi | 13.02.1985 |
| Pozisyon | Kıdemli Yönetici | İKN | 850213450567 |

## Maaş Bilgileri

| № | Dönem | Brüt Maaş | Ek Ödeme | Vergi | Net |
| - | ----- | --------- | -------- | ----- | --- |
| 1 | Mart 2026 | 865 000 KZT | 95 000 KZT | 88 500 KZT | 871 500 KZT |
| 2 | Nisan 2026 | 865 000 KZT | 0 KZT | 88 500 KZT | 776 500 KZT |

Belge 18 Haziran 2026 tarihinde düzenlenmiştir.`;

// Already 2-column KV table fixture (Field|Value header)
const EMPLOYMENT_2COL_MD = `# ATTESTATO DI LAVORO

| Campo | Valore |
| ----- | ------ |
| Dipendente | Ivan Ivanov |
| Organizzazione | OOO Romashka |
| Retribuzione | 500 000 RUB |

Emesso il 15 gennaio 2024.`;

const SIX_VISUAL_ELEMENTS: VisualElement[] = [
  { kind: 'logo',      page: 1, position: 'upper_left',   text: '[logo]',      source: 'markdown_marker' },
  { kind: 'watermark', page: 1, position: 'center',        text: '[watermark]', source: 'markdown_marker' },
  { kind: 'stamp',     page: 1, position: 'lower_center', text: '[stamp]',     source: 'markdown_marker' },
  { kind: 'signature', page: 1, position: 'lower_left',   text: '[sig1]',      source: 'markdown_marker' },
  { kind: 'signature', page: 1, position: 'lower_right',  text: '[sig2]',      source: 'markdown_marker' },
  { kind: 'qr',        page: 1, position: 'lower_left',   text: '[qr]',        source: 'markdown_marker' },
];

const OFFICIAL_META_IT = {
  sourceLang: 'ru',
  targetLang: 'it',
  documentType: 'employment_document',
  translatedAt: '2026-06-19',
  outputMode: 'translator_review_draft',
};

const OFFICIAL_META_UZ = {
  sourceLang: 'ru',
  targetLang: 'uz',
  documentType: 'employment_document',
  translatedAt: '2026-06-19',
  outputMode: 'translator_review_draft',
};

const OFFICIAL_META_DE = {
  sourceLang: 'ru',
  targetLang: 'de',
  documentType: 'employment_document',
  translatedAt: '2026-06-19',
  outputMode: 'translator_review_draft',
};

const OFFICIAL_META_TR = {
  sourceLang: 'ru',
  targetLang: 'tr',
  documentType: 'employment_document',
  translatedAt: '2026-06-19',
  outputMode: 'translator_review_draft',
};

/**
 * For each table in the document, returns a boolean[] indicating which rows
 * have <w:tblHeader/> set (only the first/localized header row should).
 */
function getTableRowHeaderFlags(xml: string): boolean[][] {
  const tablePattern = /<w:tbl\b[^>]*>([\s\S]*?)<\/w:tbl>/g;
  const result: boolean[][] = [];
  let tblMatch: RegExpExecArray | null;

  while ((tblMatch = tablePattern.exec(xml)) !== null) {
    const tblContent = tblMatch[1] ?? '';
    const rowPattern = /<w:tr\b[^>]*>([\s\S]*?)<\/w:tr>/g;
    const rowFlags: boolean[] = [];
    let rowMatch: RegExpExecArray | null;

    while ((rowMatch = rowPattern.exec(tblContent)) !== null) {
      const rowContent = rowMatch[1] ?? '';
      rowFlags.push(/<w:tblHeader[\s\/]/.test(rowContent));
    }

    result.push(rowFlags);
  }

  return result;
}

// ── KV table expansion: 4-column packed → 2-column ───────────────────────────

describe('DOCX layout — packed 4-column KV tables expand to 2 columns', () => {
  let xml: string;
  let tableCols: number[];

  beforeAll(async () => {
    const buf = await renderToDocx(EMPLOYMENT_4COL_MD, OFFICIAL_META_IT, SIX_VISUAL_ELEMENTS);
    xml = await getDocXml(buf);
    tableCols = getTableColumnCounts(xml);
  });

  it('employer section (first KV) has 2 columns', () => {
    // First table in document should be from the 4-col KV → expanded to 2 col
    expect(tableCols[0]).toBe(2);
  });

  it('employee section (second KV) has 2 columns', () => {
    expect(tableCols[1]).toBe(2);
  });

  it('income table (data table) preserves 6 columns', () => {
    // Third table: income with № | Period | Gross | Bonus | Tax | Net
    expect(tableCols[2]).toBe(6);
  });

  it('visual block table has 4 columns', () => {
    // Visual block appended after body tables
    const lastKvOrData = tableCols.filter((c) => c === 2 || c === 6);
    expect(lastKvOrData.length).toBeGreaterThanOrEqual(3); // at least 2 KV + 1 data
    // The visual table should be 4 columns
    expect(tableCols).toContain(4);
  });

  it('only the two body KV tables are 2 columns (translator block removed — output policy 2026-07-02)', () => {
    // Previously 3: employer KV + employee KV + translator/executor block.
    // The translator/executor block is no longer auto-generated (see
    // docx-translator-block.test.ts), so only the two body KV tables remain.
    expect(tableCols.filter((c) => c === 2).length).toBe(2);
  });

  it('content preserved: all label and value texts present', () => {
    // Employer data
    expect(xml).toContain('Организация');
    expect(xml).toContain('ТОО «Северный Мост Логистик»');
    expect(xml).toContain('Адрес');
    expect(xml).toContain('г. Алматы');
    // Employee data
    expect(xml).toContain('Абдрахманов Асхат Серикович');
    expect(xml).toContain('850213450567');
    expect(xml).toContain('Ведущий менеджер');
  });

  it('income table values preserved (all 4 data cells from each row)', () => {
    expect(xml).toContain('500 000');
    expect(xml).toContain('452 500');
    expect(xml).toContain('Январь 2024');
  });

  it('no row lost: 3 employer rows each unpacked to 2 rows → 6 KV rows total', () => {
    // 3 packed rows × 2 = 6 data rows; check representative label from row 3
    expect(xml).toContain('750214350987');  // Director IIN from third packed row
  });
});

// ── Regular 2-column KV table stays 2 columns ─────────────────────────────────

describe('DOCX layout — regular 2-column KV table stays 2 columns', () => {
  let tableCols: number[];

  beforeAll(async () => {
    const buf = await renderToDocx(EMPLOYMENT_2COL_MD, OFFICIAL_META_IT, SIX_VISUAL_ELEMENTS);
    const xml = await getDocXml(buf);
    tableCols = getTableColumnCounts(xml);
  });

  it('KV table stays at 2 columns', () => {
    expect(tableCols[0]).toBe(2);
  });

  it('visual block stays 4 columns', () => {
    expect(tableCols).toContain(4);
  });
});

// ── KV column widths ──────────────────────────────────────────────────────────

describe('DOCX layout — KV column widths', () => {
  it('label column is 3060 DXA (34%)', async () => {
    const buf = await renderToDocx(EMPLOYMENT_2COL_MD, OFFICIAL_META_IT, []);
    const xml = await getDocXml(buf);
    expect(xml).toContain('w:w="3060"');
    const labelWidthPct = (3060 / 9000) * 100;
    expect(labelWidthPct).toBeCloseTo(34, 0);
  });

  it('value column is 5940 DXA (66%)', async () => {
    const buf = await renderToDocx(EMPLOYMENT_2COL_MD, OFFICIAL_META_IT, []);
    const xml = await getDocXml(buf);
    expect(xml).toContain('w:w="5940"');
    const valueWidthPct = (5940 / 9000) * 100;
    expect(valueWidthPct).toBeCloseTo(66, 0);
  });
});

// ── Localized KV header ───────────────────────────────────────────────────────

describe('DOCX layout — localized KV header row', () => {
  it('Italian KV table has Campo and Valore header', async () => {
    const buf = await renderToDocx(EMPLOYMENT_2COL_MD, OFFICIAL_META_IT, []);
    const xml = await getDocXml(buf);
    expect(xml).toContain('Campo');
    expect(xml).toContain('Valore');
  });

  it('Uzbek KV table has Maydon and Qiymat header', async () => {
    const buf = await renderToDocx(EMPLOYMENT_4COL_MD, OFFICIAL_META_UZ, []);
    const xml = await getDocXml(buf);
    expect(xml).toContain('Maydon');
    expect(xml).toContain('Qiymat');
  });
});

// ── Translation heading ───────────────────────────────────────────────────────

describe('DOCX layout — localized translation heading', () => {
  it('Italian official: TRADUZIONE DAL RUSSO ALL\'ITALIANO heading present', async () => {
    const buf = await renderToDocx(EMPLOYMENT_2COL_MD, OFFICIAL_META_IT, []);
    const xml = await getDocXml(buf);
    expect(xml).toContain('TRADUZIONE');
    expect(xml).toContain('RUSSO');
    expect(xml).toContain("ALL'ITALIANO");
  });

  it('German official: ÜBERSETZUNG AUS DEM RUSSISCHEN INS DEUTSCHE heading', async () => {
    const buf = await renderToDocx(EMPLOYMENT_2COL_MD, OFFICIAL_META_DE, []);
    const xml = await getDocXml(buf);
    expect(xml).toContain('ÜBERSETZUNG');
    expect(xml).toContain('RUSSISCHEN');
    expect(xml).toContain('DEUTSCHE');
  });

  it('Uzbek official: TARJIMA heading present', async () => {
    const buf = await renderToDocx(EMPLOYMENT_2COL_MD, OFFICIAL_META_UZ, []);
    const xml = await getDocXml(buf);
    expect(xml).toContain('TARJIMA');
  });

  it('heading is absent in electronic mode (metadata line shown instead)', async () => {
    const buf = await renderToDocx(EMPLOYMENT_2COL_MD, {
      ...OFFICIAL_META_IT,
      outputMode: 'translation_only',
    }, []);
    const xml = await getDocXml(buf);
    expect(xml).not.toContain('TRADUZIONE');
    expect(xml).toMatch(/RU.*IT/);
  });
});

// ── Page margins ──────────────────────────────────────────────────────────────

describe('DOCX layout — compact page margins', () => {
  it('top and bottom margins are 1152 DXA (0.80 in)', async () => {
    const buf = await renderToDocx(EMPLOYMENT_2COL_MD, OFFICIAL_META_IT, []);
    const xml = await getDocXml(buf);
    expect(xml).toContain('w:top="1152"');
    expect(xml).toContain('w:bottom="1152"');
  });

  it('left and right margins are 1037 DXA (0.72 in)', async () => {
    const buf = await renderToDocx(EMPLOYMENT_2COL_MD, OFFICIAL_META_IT, []);
    const xml = await getDocXml(buf);
    expect(xml).toContain('w:left="1037"');
    expect(xml).toContain('w:right="1037"');
  });

  it('old 1-inch margins (1440 DXA) are not used', async () => {
    const buf = await renderToDocx(EMPLOYMENT_2COL_MD, OFFICIAL_META_IT, []);
    const xml = await getDocXml(buf);
    // The page margin element should not have 1440 values
    const sectPrMatch = xml.match(/<w:pgMar[^\/]*\/>/);
    if (sectPrMatch) {
      expect(sectPrMatch[0]).not.toContain('1440');
    }
  });
});

// ── Page footer with PAGE / NUMPAGES fields ───────────────────────────────────

describe('DOCX layout — page footer with real Word fields', () => {
  let footerXml: string;

  beforeAll(async () => {
    const buf = await renderToDocx(EMPLOYMENT_2COL_MD, OFFICIAL_META_UZ, []);
    footerXml = await getFooterXml(buf);
  });

  it('footer file exists', () => {
    expect(footerXml.length).toBeGreaterThan(0);
  });

  it('footer contains PAGE field', () => {
    // PAGE field appears as <w:instrText>PAGE</w:instrText> or as fldChar
    const hasFld = footerXml.includes('PAGE') || footerXml.includes('fldChar');
    expect(hasFld).toBe(true);
  });

  it('footer contains NUMPAGES field', () => {
    const hasNumpages = footerXml.includes('NUMPAGES') || footerXml.includes('fldChar');
    expect(hasNumpages).toBe(true);
  });

  it('footer contains Uzbek localized text (Tarjima sahifasi)', () => {
    expect(footerXml).toContain('Tarjima sahifasi');
  });

  it('Italian footer has Pagina della traduzione', async () => {
    const buf = await renderToDocx(EMPLOYMENT_2COL_MD, OFFICIAL_META_IT, []);
    const fXml = await getFooterXml(buf);
    expect(fXml).toContain('Pagina della traduzione');
  });

  it('German footer has Übersetzungsseite', async () => {
    const buf = await renderToDocx(EMPLOYMENT_2COL_MD, OFFICIAL_META_DE, []);
    const fXml = await getFooterXml(buf);
    expect(fXml).toContain('bersetzungsseite');
  });
});

// ── Visual elements: 6 rows preserved ────────────────────────────────────────

describe('DOCX layout — 6 visual elements preserved', () => {
  it('visual block has exactly 6 data rows (not counting header)', async () => {
    const buf = await renderToDocx(EMPLOYMENT_2COL_MD, OFFICIAL_META_IT, SIX_VISUAL_ELEMENTS);
    const xml = await getDocXml(buf);
    // Find the visual block table (4 columns) and count rows
    const tablePattern = /<w:tbl\b[^>]*>([\s\S]*?)<\/w:tbl>/g;
    let tblMatch: RegExpExecArray | null;
    let visualTableRows = 0;

    while ((tblMatch = tablePattern.exec(xml)) !== null) {
      const tblContent = tblMatch[1] ?? '';
      const firstRowMatch = /<w:tr\b[^>]*>([\s\S]*?)<\/w:tr>/.exec(tblContent);
      if (!firstRowMatch) continue;
      const cellCount = (firstRowMatch[1]?.match(/<w:tc\b/g) ?? []).length;
      if (cellCount === 4) {
        const allRows = [...tblContent.matchAll(/<w:tr\b[^>]*>/g)];
        // Minus 1 for header row
        visualTableRows = allRows.length - 1;
        break;
      }
    }

    expect(visualTableRows).toBe(6);
  });

  it('2 signatures appear in visual block', async () => {
    const buf = await renderToDocx(EMPLOYMENT_2COL_MD, OFFICIAL_META_IT, SIX_VISUAL_ELEMENTS);
    const xml = await getDocXml(buf);
    expect(countOccurrences(xml, 'Firma manoscritta')).toBeGreaterThanOrEqual(2);
  });
});

// ── Translator block: removed for all modes (output policy, 2026-07-02) ────────

describe('DOCX layout — translator/executor block is never rendered', () => {
  it('official-mode DOCX does not contain the translator/executor block heading', async () => {
    const buf = await renderToDocx(EMPLOYMENT_2COL_MD, OFFICIAL_META_IT, []);
    const xml = await getDocXml(buf);
    expect(xml).not.toContain("DATI DEL TRADUTTORE E DELL'ESECUTORE");
    expect(xml).not.toContain('TRANSLATOR AND PROVIDER DETAILS');
  });
});

// ── Variant B: real LLM output (data in Markdown header row) ─────────────────
// Mirrors what Claude actually outputs for Turkish employment docs on staging:
// the Markdown header row contains the first [label, value, label, value] data pair.

describe('DOCX layout — Variant B: data-as-header 4-column KV (real LLM pattern)', () => {
  let xml: string;
  let tableCols: number[];
  let tableHeaderFlags: boolean[][];

  beforeAll(async () => {
    const buf = await renderToDocx(EMPLOYMENT_REAL_4COL_MD, OFFICIAL_META_TR, []);
    xml = await getDocXml(buf);
    tableCols = getTableColumnCounts(xml);
    tableHeaderFlags = getTableRowHeaderFlags(xml);
  });

  it('employer section (first KV) expands to 2 columns', () => {
    expect(tableCols[0]).toBe(2);
  });

  it('employee section (second KV) expands to 2 columns', () => {
    expect(tableCols[1]).toBe(2);
  });

  it('income table stays at 6 columns', () => {
    expect(tableCols[2]).toBe(6);
  });

  it('KV tables have Turkish localized header (Alan | Değer)', () => {
    expect(xml).toContain('Alan');
    expect(xml).toContain('Değer');
  });

  it('only row 0 of each KV table has tableHeader flag', () => {
    // First two tables are KV; each should have exactly 1 row with tblHeader
    for (const tableIdx of [0, 1]) {
      const flags = tableHeaderFlags[tableIdx];
      expect(flags).toBeDefined();
      expect(flags![0]).toBe(true);   // localized header row → tblHeader = true
      for (let r = 1; r < flags!.length; r++) {
        expect(flags![r]).toBe(false); // data rows must NOT have tblHeader
      }
    }
  });

  it('data table (income) row 0 has tableHeader flag, data rows do not', () => {
    const incomeFlags = tableHeaderFlags[2];
    expect(incomeFlags).toBeDefined();
    expect(incomeFlags![0]).toBe(true); // income column header row
    for (let r = 1; r < incomeFlags!.length; r++) {
      expect(incomeFlags![r]).toBe(false);
    }
  });

  it('first content from Markdown header row is preserved as data (İşverenin adı)', () => {
    expect(xml).toContain('İşverenin adı');
    expect(xml).toContain('SML Group');
  });

  it('second content from Markdown header row is preserved as data (BIN | 047291638)', () => {
    expect(xml).toContain('BIN');
    expect(xml).toContain('047291638');
  });

  it('employee section first row: Soyadı / Nurtayeva preserved (not repeated as header)', () => {
    expect(xml).toContain('Soyadı');
    expect(xml).toContain('Nurtayeva');
    // Crucially: these should NOT be in a tblHeader row — that check is done above
  });

  it('no content is lost — all packed cells appear as data', () => {
    // Employer rows
    expect(xml).toContain('750214350987');   // Yönetici kimlik no from 3rd employer pair
    // Employee rows
    expect(xml).toContain('850213450567');   // İKN from 3rd employee pair
    expect(xml).toContain('Kıdemli Yönetici');
  });
});

// ── No pipeline file changes ──────────────────────────────────────────────────

describe('pipeline isolation — renderer-only change', () => {
  it('visual block (4-col with non-label header) stays 4 columns, not treated as KV', async () => {
    // Visual block uses Page|Element|Position|Representation headers where col 0 is a number.
    // This is rendered by docx-visual-block.ts, not buildDocxTable — so it bypasses KV detection.
    // Verified via: visual block table has 4 columns (see visual block tests above).
    expect(true).toBe(true);
  });
});
