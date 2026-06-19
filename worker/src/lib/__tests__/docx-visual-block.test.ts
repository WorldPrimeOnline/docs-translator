/**
 * @jest-environment node
 */

import { renderToDocx, removeVisualOnlyTranslatorNotes } from '../docx-renderer';
import { VISUAL_BLOCK_I18N, stripVisualBlockFromMarkdown } from '../docx-visual-block';
import type { VisualElement } from '../visual-elements';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const JSZip = require('jszip') as typeof import('jszip');

function decodeXml(s: string): string {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

async function getDocumentText(buf: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buf);
  const file = zip.file('word/document.xml');
  if (!file) throw new Error('word/document.xml not found');
  const raw = await file.async('string');
  return decodeXml(raw);
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let pos = 0;
  while ((pos = haystack.indexOf(needle, pos)) !== -1) {
    count++;
    pos += needle.length;
  }
  return count;
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const EMPLOYMENT_MD = `# ATTESTATO DI LAVORO

| Campo | Valore |
| ----- | ------ |
| Dipendente | Ivan Ivanov |
| Organizzazione | Severny Most Logistik |

Emesso il 15 gennaio 2024.`;

const OFFICIAL_META_IT = {
  sourceLang: 'ru',
  targetLang: 'it',
  documentType: 'employment_document',
  translatedAt: '2026-06-19',
  outputMode: 'translator_review_draft',
};

const ELECTRONIC_META_IT = {
  sourceLang: 'ru',
  targetLang: 'it',
  documentType: 'employment_document',
  translatedAt: '2026-06-19',
  outputMode: 'translation_only',
};

// Employment certificate fixture with 6 visual elements
const EMPLOYMENT_ELEMENTS: VisualElement[] = [
  { kind: 'logo',      page: 1, position: 'upper_left',    text: '[logo]',          source: 'markdown_marker' },
  { kind: 'watermark', page: 1, position: 'center',         text: '[watermark: УЧЕБНЫЙ ОБРАЗЕЦ]', source: 'markdown_marker' },
  { kind: 'stamp',     page: 1, position: 'lower_center',  text: '[round stamp]',   source: 'markdown_marker' },
  { kind: 'signature', page: 1, position: 'lower_left',    text: '[signature]',     source: 'markdown_marker' },
  { kind: 'signature', page: 1, position: 'lower_right',   text: '[signature]',     source: 'markdown_marker' },
  { kind: 'qr',        page: 1, position: 'lower_left',    text: '[qr code present]', source: 'markdown_marker' },
];

// ── i18n dictionary sanity ────────────────────────────────────────────────────

describe('VISUAL_BLOCK_I18N dictionary', () => {
  const REQUIRED_LANGS = ['ru', 'en', 'it', 'de', 'fr', 'es', 'zh', 'ko', 'ja', 'th', 'ar', 'kk', 'uz', 'tr'];
  const REQUIRED_KINDS = [
    'logo', 'emblem', 'photo', 'qr', 'barcode', 'stamp', 'signature', 'watermark',
    'verification_string', 'mrz', 'handwritten_note', 'electronic_approval',
    'accreditation_mark', 'certification_mark', 'label', 'unknown_image',
  ] as const;
  const REQUIRED_POSITIONS = [
    'upper_left', 'upper_center', 'upper_right',
    'center_left', 'center', 'center_right',
    'lower_left', 'lower_center', 'lower_right',
    'full_page',
  ] as const;

  it('contains all 14 required languages', () => {
    for (const lang of REQUIRED_LANGS) {
      expect(VISUAL_BLOCK_I18N).toHaveProperty(lang);
    }
  });

  it('every locale has all required fields', () => {
    const FIELDS = ['heading', 'colPage', 'colElement', 'colPosition', 'colRepresentation', 'noElements'] as const;
    for (const lang of REQUIRED_LANGS) {
      const loc = VISUAL_BLOCK_I18N[lang]!;
      for (const field of FIELDS) {
        expect(loc[field]).toBeTruthy();
      }
    }
  });

  it('every locale has all kind labels', () => {
    for (const lang of REQUIRED_LANGS) {
      const loc = VISUAL_BLOCK_I18N[lang]!;
      for (const kind of REQUIRED_KINDS) {
        expect(loc.kindLabels[kind]).toBeTruthy();
      }
    }
  });

  it('every locale has all position labels', () => {
    for (const lang of REQUIRED_LANGS) {
      const loc = VISUAL_BLOCK_I18N[lang]!;
      for (const pos of REQUIRED_POSITIONS) {
        expect(loc.positionLabels[pos]).toBeTruthy();
      }
    }
  });

  it('Italian kind labels match expected values', () => {
    const it = VISUAL_BLOCK_I18N['it']!;
    expect(it.kindLabels.logo).toBe('Logo');
    expect(it.kindLabels.watermark).toBe('Filigrana');
    expect(it.kindLabels.stamp).toBe('Timbro');
    expect(it.kindLabels.signature).toBe('Firma manoscritta');
    expect(it.kindLabels.qr).toBe('Codice QR');
    expect(it.kindLabels.unknown_image).toBe('Elemento grafico');
  });

  it('Italian position labels match expected values', () => {
    const it = VISUAL_BLOCK_I18N['it']!;
    expect(it.positionLabels['upper_left']).toBe('in alto a sinistra');
    expect(it.positionLabels['center']).toBe('al centro');
    expect(it.positionLabels['lower_center']).toBe('in basso al centro');
    expect(it.positionLabels['lower_left']).toBe('in basso a sinistra');
    expect(it.positionLabels['lower_right']).toBe('in basso a destra');
  });

  it('heading does not contain raw enum values', () => {
    for (const lang of REQUIRED_LANGS) {
      const loc = VISUAL_BLOCK_I18N[lang]!;
      expect(loc.heading).not.toMatch(/upper_left|lower_center|unknown_image/);
    }
  });
});

// ── stripVisualBlockFromMarkdown ──────────────────────────────────────────────

describe('stripVisualBlockFromMarkdown', () => {
  it('strips English visual elements heading and content', () => {
    const md = 'Main content.\n\n## Description of non-text elements in the original\n\n| Page | Element |\n| 1 | Stamp |';
    const result = stripVisualBlockFromMarkdown(md);
    expect(result).toBe('Main content.');
  });

  it('strips Russian visual elements heading', () => {
    const md = 'Основной текст.\n\n## Описание нетекстовых элементов оригинала\n\nПечать.';
    const result = stripVisualBlockFromMarkdown(md);
    expect(result).toBe('Основной текст.');
  });

  it('strips Document visual elements heading', () => {
    const md = 'Content here.\n\n## Document visual elements:\n\n- logo\n- stamp';
    const result = stripVisualBlockFromMarkdown(md);
    expect(result).toBe('Content here.');
  });

  it('strips Italian visual elements heading', () => {
    const md = 'Testo principale.\n\n## Elementi visivi del documento originale\n\n| Pagina | Elemento |';
    const result = stripVisualBlockFromMarkdown(md);
    expect(result).toBe('Testo principale.');
  });

  it('leaves document unchanged when no visual section', () => {
    const md = 'This document has no visual elements section.';
    expect(stripVisualBlockFromMarkdown(md)).toBe(md);
  });

  it('strips only the LAST matching heading (not earlier content)', () => {
    const md = 'Section about visual elements in general.\n\n## Normal heading\n\nContent.\n\n## Description of non-text elements in the original\n\nStamp.';
    const result = stripVisualBlockFromMarkdown(md);
    expect(result).toContain('Normal heading');
    expect(result).not.toContain('Description of non-text elements');
  });
});

// ── Visual block DOCX rendering ───────────────────────────────────────────────

describe('renderToDocx visual block — Italian 6-element employment fixture', () => {
  let xml: string;

  beforeAll(async () => {
    const buf = await renderToDocx(EMPLOYMENT_MD, OFFICIAL_META_IT, EMPLOYMENT_ELEMENTS);
    xml = await getDocumentText(buf);
  });

  it('contains Italian visual block heading', () => {
    expect(xml).toContain('ELEMENTI VISIVI DEL DOCUMENTO ORIGINALE');
  });

  it('does not contain English fallback heading', () => {
    expect(xml).not.toContain('VISUAL ELEMENTS OF THE ORIGINAL DOCUMENT');
    expect(xml).not.toContain('Description of non-text elements');
  });

  it('contains Italian column headers', () => {
    expect(xml).toContain('Pagina');
    expect(xml).toContain('Elemento');
    expect(xml).toContain('Posizione');
    expect(xml).toContain('Rappresentazione nella traduzione');
  });

  it('contains all 6 Italian kind labels', () => {
    expect(xml).toContain('Logo');
    expect(xml).toContain('Filigrana');
    expect(xml).toContain('Timbro');
    expect(xml).toContain('Codice QR');
    // Firma manoscritta appears twice (2 signatures)
    expect(countOccurrences(xml, 'Firma manoscritta')).toBeGreaterThanOrEqual(2);
  });

  it('contains Italian position labels, not raw enum values', () => {
    expect(xml).toContain('in alto a sinistra');
    expect(xml).toContain('al centro');
    expect(xml).toContain('in basso al centro');
    expect(xml).toContain('in basso a sinistra');
    expect(xml).toContain('in basso a destra');
    expect(xml).not.toContain('upper_left');
    expect(xml).not.toContain('lower_center');
    expect(xml).not.toContain('lower_left');
    expect(xml).not.toContain('lower_right');
  });

  it('does not contain raw internal tokens', () => {
    expect(xml).not.toContain('kind=');
    expect(xml).not.toContain('position=');
    expect(xml).not.toContain('__WPO_VIS_');
  });

  it('two signatures both appear (deduplication by page+kind+position)', () => {
    // Each signature at a distinct position → both survive dedup
    expect(countOccurrences(xml, 'Firma manoscritta')).toBeGreaterThanOrEqual(2);
  });

  it('main translation content is preserved', () => {
    expect(xml).toContain('ATTESTATO DI LAVORO');
    expect(xml).toContain('Ivan Ivanov');
    expect(xml).toContain('Severny Most Logistik');
  });

  it('translator block also present (official mode)', () => {
    expect(xml).toContain("DATI DEL TRADUTTORE E DELL'ESECUTORE");
  });

  it('heading appears exactly once', () => {
    expect(countOccurrences(xml, 'ELEMENTI VISIVI DEL DOCUMENTO ORIGINALE')).toBe(1);
  });
});

// ── Electronic mode: visual block still present ───────────────────────────────

describe('renderToDocx visual block — electronic mode', () => {
  it('renders visual block even in electronic (translation_only) mode', async () => {
    const buf = await renderToDocx(EMPLOYMENT_MD, ELECTRONIC_META_IT, EMPLOYMENT_ELEMENTS);
    const xml = await getDocumentText(buf);
    expect(xml).toContain('ELEMENTI VISIVI DEL DOCUMENTO ORIGINALE');
  });

  it('no translator block in electronic mode', async () => {
    const buf = await renderToDocx(EMPLOYMENT_MD, ELECTRONIC_META_IT, EMPLOYMENT_ELEMENTS);
    const xml = await getDocumentText(buf);
    expect(xml).not.toContain("DATI DEL TRADUTTORE E DELL'ESECUTORE");
  });
});

// ── Empty elements array ──────────────────────────────────────────────────────

describe('renderToDocx visual block — no elements', () => {
  it('shows no-elements message when elements array is empty', async () => {
    const buf = await renderToDocx(EMPLOYMENT_MD, OFFICIAL_META_IT, []);
    const xml = await getDocumentText(buf);
    expect(xml).toContain('ELEMENTI VISIVI DEL DOCUMENTO ORIGINALE');
    expect(xml).toContain('Non sono stati identificati elementi visivi significativi');
  });
});

// ── Russian target language ───────────────────────────────────────────────────

describe('renderToDocx visual block — Russian target', () => {
  it('uses Russian heading and kind labels', async () => {
    const buf = await renderToDocx('# Документ\n\nТекст.', {
      sourceLang: 'en',
      targetLang: 'ru',
      documentType: 'other',
      translatedAt: '2026-06-19',
      outputMode: 'translator_review_draft',
    }, [
      { kind: 'stamp', page: 1, position: 'lower_center', text: '[round stamp]', source: 'markdown_marker' },
    ]);
    const xml = await getDocumentText(buf);
    expect(xml).toContain('НЕТЕКСТОВЫЕ ЭЛЕМЕНТЫ ИСХОДНОГО ДОКУМЕНТА');
    expect(xml).toContain('Печать');
    expect(xml).toContain('внизу по центру');
    expect(xml).not.toContain('VISUAL ELEMENTS OF THE ORIGINAL DOCUMENT');
  });
});

// ── Unknown target language falls back to English ─────────────────────────────

describe('renderToDocx visual block — unknown target language', () => {
  it('falls back to English heading and labels', async () => {
    const buf = await renderToDocx('# Doc\n\nText.', {
      sourceLang: 'ru',
      targetLang: 'xx',
      documentType: 'other',
      translatedAt: '2026-06-19',
      outputMode: 'translator_review_draft',
    }, [
      { kind: 'logo', page: 1, text: '[logo]', source: 'markdown_marker' },
    ]);
    const xml = await getDocumentText(buf);
    expect(xml).toContain('VISUAL ELEMENTS OF THE ORIGINAL DOCUMENT');
    expect(xml).toContain('Logo');
  });
});

// ── Strip: Markdown visual block already in translated content ────────────────

describe('renderToDocx strips injected Markdown visual block', () => {
  it('does not produce double visual block when Claude appended one', async () => {
    const mdWithBlock = `${EMPLOYMENT_MD}\n\n## Document visual elements:\n\n- [logo]\n- [stamp]`;
    const buf = await renderToDocx(mdWithBlock, OFFICIAL_META_IT, EMPLOYMENT_ELEMENTS);
    const xml = await getDocumentText(buf);
    // Heading appears exactly once (from DOCX-native block, not from Markdown)
    expect(countOccurrences(xml, 'ELEMENTI VISIVI DEL DOCUMENTO ORIGINALE')).toBe(1);
    // No English fallback heading either
    expect(xml).not.toContain('VISUAL ELEMENTS OF THE ORIGINAL DOCUMENT');
  });
});

// ── Representation column uses localized kind label as fallback ───────────────

describe('renderToDocx visual block — localized representation fallback', () => {
  it('does not contain English "Company logo" when description is absent', async () => {
    const buf = await renderToDocx(EMPLOYMENT_MD, OFFICIAL_META_IT, EMPLOYMENT_ELEMENTS);
    const xml = await getDocumentText(buf);
    expect(xml).not.toContain('Company logo');
  });

  it('does not contain English "Handwritten signature" when description is absent', async () => {
    const buf = await renderToDocx(EMPLOYMENT_MD, OFFICIAL_META_IT, EMPLOYMENT_ELEMENTS);
    const xml = await getDocumentText(buf);
    expect(xml).not.toContain('Handwritten signature');
  });

  it('shows Italian kind label as fallback for logo without description', async () => {
    const elements: VisualElement[] = [
      { kind: 'logo', page: 1, position: 'upper_left', text: '[logo]', source: 'markdown_marker' },
    ];
    const buf = await renderToDocx(EMPLOYMENT_MD, OFFICIAL_META_IT, elements);
    const xml = await getDocumentText(buf);
    // Fallback is VISUAL_BLOCK_I18N['it'].kindLabels.logo = 'Logo'
    expect(xml).toContain('Logo');
    expect(xml).not.toContain('[logo]');
  });

  it('uses Italian description when description is provided in target language', async () => {
    const elements: VisualElement[] = [
      { kind: 'logo', page: 1, position: 'upper_left', description: "Logo dell'organizzazione", text: '[logo]', source: 'pdf_image_extraction' },
    ];
    const buf = await renderToDocx(EMPLOYMENT_MD, OFFICIAL_META_IT, elements);
    const xml = await getDocumentText(buf);
    expect(xml).toContain("Logo dell'organizzazione");
  });
});

// ── Metadata header suppressed in official modes ──────────────────────────────

describe('renderToDocx — internal metadata header', () => {
  it('does not contain "RU → IT | other" in official (translator_review_draft) mode', async () => {
    const buf = await renderToDocx(EMPLOYMENT_MD, OFFICIAL_META_IT, EMPLOYMENT_ELEMENTS);
    const xml = await getDocumentText(buf);
    expect(xml).not.toContain('RU → IT');
    expect(xml).not.toContain('RU &#x2192; IT');
  });

  it('does not contain metadata line in notarization_package mode', async () => {
    const buf = await renderToDocx(EMPLOYMENT_MD, {
      ...OFFICIAL_META_IT,
      outputMode: 'notarization_package',
    }, EMPLOYMENT_ELEMENTS);
    const xml = await getDocumentText(buf);
    expect(xml).not.toContain('RU → IT');
  });

  it('contains metadata line in translation_only (electronic) mode', async () => {
    const buf = await renderToDocx(EMPLOYMENT_MD, ELECTRONIC_META_IT, EMPLOYMENT_ELEMENTS);
    const xml = await getDocumentText(buf);
    // Electronic mode: internal metadata line IS shown
    expect(xml).toMatch(/RU.*IT/);
  });
});

// ── removeVisualOnlyTranslatorNotes ──────────────────────────────────────────

describe('removeVisualOnlyTranslatorNotes', () => {
  it('removes visual-only Italian translator note', () => {
    const md = 'Testo.\n\nNota del traduttore: Il documento originale contiene firme manoscritte indicate come "(подпись)".\n\nAltro.';
    const out = removeVisualOnlyTranslatorNotes(md);
    expect(out).not.toContain('Nota del traduttore:');
    expect(out).toContain('Testo.');
    expect(out).toContain('Altro.');
  });

  it('removes visual-only English translator note', () => {
    const md = "Content.\n\nTranslator's note: The original document contains handwritten signatures marked as [signature].\n\nMore content.";
    const out = removeVisualOnlyTranslatorNotes(md);
    expect(out).not.toContain("Translator's note:");
    expect(out).toContain('Content.');
  });

  it('removes note mentioning stamps and QR codes', () => {
    const md = 'Text.\n\nNota del traduttore: Il documento contiene timbro e QR code.\n\nEnd.';
    const out = removeVisualOnlyTranslatorNotes(md);
    expect(out).not.toContain('Nota del traduttore:');
  });

  it('keeps translator note that mentions illegible content', () => {
    const md = 'Text.\n\nNota del traduttore: La firma è illeggibile e il timbro è danneggiato.\n\nEnd.';
    const out = removeVisualOnlyTranslatorNotes(md);
    expect(out).toContain('Nota del traduttore:');
  });

  it('keeps translator note with ambiguous content', () => {
    const md = 'Text.\n\nTranslator note: Some text was unclear and could not be read accurately.\n\nEnd.';
    const out = removeVisualOnlyTranslatorNotes(md);
    expect(out).toContain('Translator note:');
  });

  it('keeps non-visual translator note about missing pages', () => {
    const md = 'Text.\n\nPrimechanie perevodchika: missing page 3 in the original.\n\nEnd.';
    const out = removeVisualOnlyTranslatorNotes(md);
    expect(out).toContain('Primechanie perevodchika:');
  });

  it('handles markdown with visual-only note removed via renderToDocx', async () => {
    const mdWithNote = `${EMPLOYMENT_MD}\n\nNota del traduttore: Il documento originale contiene firme manoscritte indicate come "(подпись)".`;
    const buf = await renderToDocx(mdWithNote, OFFICIAL_META_IT, EMPLOYMENT_ELEMENTS);
    const xml = await getDocumentText(buf);
    expect(xml).not.toContain('Nota del traduttore:');
  });
});

// ── Deduplication ─────────────────────────────────────────────────────────────

describe('renderToDocx visual block deduplication', () => {
  it('deduplicates elements with same page+kind+position+description', async () => {
    const elements: VisualElement[] = [
      { kind: 'stamp', page: 1, position: 'lower_center', text: '[stamp]', source: 'markdown_marker' },
      { kind: 'stamp', page: 1, position: 'lower_center', text: '[stamp]', source: 'markdown_marker' },
    ];
    const buf = await renderToDocx(EMPLOYMENT_MD, OFFICIAL_META_IT, elements);
    const xml = await getDocumentText(buf);
    // Only one Timbro row: Elemento col + Rappresentazione col (kind fallback) + translator block "Timbro dell'Esecutore:"
    expect(countOccurrences(xml, 'Timbro')).toBe(3);
  });

  it('keeps two signatures at different positions', async () => {
    const elements: VisualElement[] = [
      { kind: 'signature', page: 1, position: 'lower_left',  text: '[signature]', source: 'markdown_marker' },
      { kind: 'signature', page: 1, position: 'lower_right', text: '[signature]', source: 'markdown_marker' },
    ];
    const buf = await renderToDocx(EMPLOYMENT_MD, OFFICIAL_META_IT, elements);
    const xml = await getDocumentText(buf);
    expect(countOccurrences(xml, 'Firma manoscritta')).toBeGreaterThanOrEqual(2);
  });
});
