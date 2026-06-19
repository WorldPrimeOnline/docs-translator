/**
 * @jest-environment node
 */

import { renderToDocx, TRANSLATOR_BLOCK_I18N } from '../docx-renderer';
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

const OFFICIAL_META = {
  sourceLang: 'ru',
  targetLang: 'it',
  documentType: 'employment_document',
  translatedAt: '2026-06-19',
  outputMode: 'translator_review_draft',
};

const ELECTRONIC_META = {
  sourceLang: 'ru',
  targetLang: 'it',
  documentType: 'employment_document',
  translatedAt: '2026-06-19',
  outputMode: 'translation_only',
};

const EMPLOYMENT_MD = `# ATTESTATO DI LAVORO

| Campo | Valore |
| ----- | ------ |
| Dipendente | Ivan Ivanov |
| Organizzazione | OOO Romashka |
| Retribuzione | 500 000 RUB |

Emesso il 15 gennaio 2024.`;

// ── i18n dictionary sanity ─────────────────────────────────────────────────────

describe('TRANSLATOR_BLOCK_I18N dictionary', () => {
  const REQUIRED_LANGS = ['ru', 'en', 'it', 'de', 'fr', 'es', 'zh', 'ko', 'ja', 'th', 'ar', 'kk', 'uz', 'tr'];

  it('contains all required languages', () => {
    for (const lang of REQUIRED_LANGS) {
      expect(TRANSLATOR_BLOCK_I18N).toHaveProperty(lang);
    }
  });

  it('every locale has all required fields', () => {
    const FIELDS = ['heading', 'declarationTpl', 'translator', 'qualification', 'signature', 'provider', 'iin', 'stamp', 'date', 'providerName'] as const;
    for (const lang of REQUIRED_LANGS) {
      const loc = TRANSLATOR_BLOCK_I18N[lang]!;
      for (const field of FIELDS) {
        expect(loc[field]).toBeTruthy();
      }
    }
  });

  it('every locale providerName contains World Prime Online', () => {
    for (const lang of REQUIRED_LANGS) {
      expect(TRANSLATOR_BLOCK_I18N[lang]!.providerName).toContain('World Prime Online');
    }
  });

  it('Italian srcName for ru is dal russo', () => {
    expect(TRANSLATOR_BLOCK_I18N['it']!.srcNames['ru']).toBe('dal russo');
  });

  it('Italian tgtName for it is all\'italiano', () => {
    expect(TRANSLATOR_BLOCK_I18N['it']!.tgtNames['it']).toBe("all'italiano");
  });
});

// ── Official RU → IT block tests ───────────────────────────────────────────────

describe('renderToDocx official RU → IT translator block', () => {
  it('contains Italian heading (not English fallback)', async () => {
    const buf = await renderToDocx(EMPLOYMENT_MD, OFFICIAL_META, []);
    const xml = await getDocumentText(buf);
    expect(xml).toContain("DATI DEL TRADUTTORE E DELL'ESECUTORE");
    expect(xml).not.toContain('TRANSLATOR AND PROVIDER DETAILS');
  });

  it('contains localized declaration with dal russo all\'italiano', async () => {
    const buf = await renderToDocx(EMPLOYMENT_MD, OFFICIAL_META, []);
    const xml = await getDocumentText(buf);
    expect(xml).toContain('dal russo');
    expect(xml).toContain("all'italiano");
  });

  it('contains World Prime Online', async () => {
    const buf = await renderToDocx(EMPLOYMENT_MD, OFFICIAL_META, []);
    const xml = await getDocumentText(buf);
    expect(xml).toContain('World Prime Online');
  });

  it('contains IIN 840324300155', async () => {
    const buf = await renderToDocx(EMPLOYMENT_MD, OFFICIAL_META, []);
    const xml = await getDocumentText(buf);
    expect(xml).toContain('840324300155');
  });

  it('contains Italian field labels (not English)', async () => {
    const buf = await renderToDocx(EMPLOYMENT_MD, OFFICIAL_META, []);
    const xml = await getDocumentText(buf);
    expect(xml).toContain('Traduttore');
    expect(xml).toContain('Qualifica del traduttore');
    expect(xml).toContain('Firma del traduttore');
    expect(xml).toContain('Esecutore');
    expect(xml).not.toContain('Translator:');
    expect(xml).not.toContain('Provider:');
  });

  it('contains exactly one translator block heading', async () => {
    const buf = await renderToDocx(EMPLOYMENT_MD, OFFICIAL_META, []);
    const xml = await getDocumentText(buf);
    expect(countOccurrences(xml, "DATI DEL TRADUTTORE E DELL'ESECUTORE")).toBe(1);
  });

  it('does not contain legally dangerous claims', async () => {
    const buf = await renderToDocx(EMPLOYMENT_MD, OFFICIAL_META, []);
    const xml = await getDocumentText(buf);
    expect(xml).not.toMatch(/AI certified/i);
    expect(xml).not.toMatch(/guaranteed accepted/i);
    expect(xml).not.toMatch(/automatic notar/i);
    expect(xml).not.toMatch(/already notariz/i);
  });

  it('main translation content is preserved', async () => {
    const buf = await renderToDocx(EMPLOYMENT_MD, OFFICIAL_META, []);
    const xml = await getDocumentText(buf);
    expect(xml).toContain('ATTESTATO DI LAVORO');
    expect(xml).toContain('Ivan Ivanov');
    expect(xml).toContain('OOO Romashka');
    expect(xml).toContain('500 000 RUB');
  });
});

// ── Electronic mode: no block ──────────────────────────────────────────────────

describe('renderToDocx electronic mode (translation_only)', () => {
  it('does not contain translator block heading', async () => {
    const buf = await renderToDocx(EMPLOYMENT_MD, ELECTRONIC_META, []);
    const xml = await getDocumentText(buf);
    expect(xml).not.toContain("DATI DEL TRADUTTORE E DELL'ESECUTORE");
    expect(xml).not.toContain('TRANSLATOR AND PROVIDER DETAILS');
  });

  it('does not contain IIN 840324300155', async () => {
    const buf = await renderToDocx(EMPLOYMENT_MD, ELECTRONIC_META, []);
    const xml = await getDocumentText(buf);
    expect(xml).not.toContain('840324300155');
  });

  it('main translation content still present', async () => {
    const buf = await renderToDocx(EMPLOYMENT_MD, ELECTRONIC_META, []);
    const xml = await getDocumentText(buf);
    expect(xml).toContain('ATTESTATO DI LAVORO');
    expect(xml).toContain('Ivan Ivanov');
  });
});

// ── Notarization mode also gets the block ─────────────────────────────────────

describe('renderToDocx notarization_package mode', () => {
  it('contains translator block in notarization mode', async () => {
    const buf = await renderToDocx(EMPLOYMENT_MD, {
      ...OFFICIAL_META,
      outputMode: 'notarization_package',
    }, []);
    const xml = await getDocumentText(buf);
    expect(xml).toContain("DATI DEL TRADUTTORE E DELL'ESECUTORE");
    expect(xml).toContain('840324300155');
  });
});

// ── Missing outputMode: no block ───────────────────────────────────────────────

describe('renderToDocx with no outputMode', () => {
  it('does not add translator block when outputMode is absent', async () => {
    const buf = await renderToDocx(EMPLOYMENT_MD, {
      sourceLang: 'ru',
      targetLang: 'it',
      documentType: 'other',
      translatedAt: '2026-06-19',
    }, []);
    const xml = await getDocumentText(buf);
    expect(xml).not.toContain('840324300155');
  });
});

// ── Russian target language ───────────────────────────────────────────────────

describe('renderToDocx official EN → RU translator block', () => {
  it('uses Russian labels, not English', async () => {
    const buf = await renderToDocx('# Документ\n\nТекст.', {
      sourceLang: 'en',
      targetLang: 'ru',
      documentType: 'other',
      translatedAt: '2026-06-19',
      outputMode: 'translator_review_draft',
    }, []);
    const xml = await getDocumentText(buf);
    expect(xml).toContain('ПЕРЕВОДЧИК И ИСПОЛНИТЕЛЬ');
    expect(xml).toContain('Переводчик');
    expect(xml).toContain('Исполнитель');
    expect(xml).toContain('ИП World Prime Online');
    expect(xml).not.toContain('TRANSLATOR AND PROVIDER DETAILS');
  });
});

// ── German Leistungserbringer ─────────────────────────────────────────────────

describe('renderToDocx German official translator block', () => {
  const DE_META = {
    sourceLang: 'ru',
    targetLang: 'de',
    documentType: 'employment_document',
    translatedAt: '2026-06-19',
    outputMode: 'translator_review_draft',
  };

  it('contains correct German heading', async () => {
    const buf = await renderToDocx(EMPLOYMENT_MD, DE_META, []);
    const xml = await getDocumentText(buf);
    expect(xml).toContain('ANGABEN ZUM ÜBERSETZER UND LEISTUNGSERBRINGER');
    expect(xml).not.toContain('ÜBERSETZER UND AUFTRAGGEBER');
  });

  it('uses Leistungserbringer not Auftraggeber', async () => {
    const buf = await renderToDocx(EMPLOYMENT_MD, DE_META, []);
    const xml = await getDocumentText(buf);
    expect(xml).toContain('Leistungserbringer:');
    expect(xml).not.toContain('Auftraggeber:');
  });

  it('uses correct German stamp label', async () => {
    const buf = await renderToDocx(EMPLOYMENT_MD, DE_META, []);
    const xml = await getDocumentText(buf);
    expect(xml).toContain('Stempel des Leistungserbringers:');
    expect(xml).not.toContain('Stempel des Auftraggebers:');
  });

  it('contains World Prime Online with German style', async () => {
    const buf = await renderToDocx(EMPLOYMENT_MD, DE_META, []);
    const xml = await getDocumentText(buf);
    expect(xml).toContain('Einzelunternehmer World Prime Online');
  });

  it('i18n dictionary heading matches expected value', () => {
    const de = TRANSLATOR_BLOCK_I18N['de']!;
    expect(de.heading).toBe('ANGABEN ZUM ÜBERSETZER UND LEISTUNGSERBRINGER');
    expect(de.provider).toBe('Leistungserbringer');
    expect(de.stamp).toBe('Stempel des Leistungserbringers');
  });
});

// ── Fallback for unknown language ─────────────────────────────────────────────

describe('renderToDocx unknown target language falls back to English', () => {
  it('uses English when target language is not in dictionary', async () => {
    const buf = await renderToDocx('# Doc\n\nText.', {
      sourceLang: 'ru',
      targetLang: 'xx',
      documentType: 'other',
      translatedAt: '2026-06-19',
      outputMode: 'translator_review_draft',
    }, []);
    const xml = await getDocumentText(buf);
    expect(xml).toContain('TRANSLATOR AND PROVIDER DETAILS');
    expect(xml).toContain('Individual Entrepreneur World Prime Online');
    expect(xml).toContain('840324300155');
  });
});
