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

// ── Output policy (2026-07-02): the auto-generated translator/executor block
// is never rendered, for ANY service level/output mode — including official
// and notarization drafts. It used to render for translator_review_draft and
// notarization_package (BLOCK_MODES); that set is now empty. Reason: the
// block is filled in by the human translator/operator during finalization,
// not fabricated by the AI draft renderer. TRANSLATOR_BLOCK_I18N and
// renderTranslatorProviderBlock() are kept intact (see dictionary tests
// above) — only their automatic invocation was removed. These tests replace
// the old "block IS present for official/notarization" assertions below.
// ─────────────────────────────────────────────────────────────────────────────

describe('renderToDocx never renders the translator/executor block — official mode', () => {
  it('does not contain the Italian heading or the English fallback heading', async () => {
    const buf = await renderToDocx(EMPLOYMENT_MD, OFFICIAL_META, []);
    const xml = await getDocumentText(buf);
    expect(xml).not.toContain("DATI DEL TRADUTTORE E DELL'ESECUTORE");
    expect(xml).not.toContain('TRANSLATOR AND PROVIDER DETAILS');
  });

  it('does not contain the provider IIN', async () => {
    const buf = await renderToDocx(EMPLOYMENT_MD, OFFICIAL_META, []);
    const xml = await getDocumentText(buf);
    expect(xml).not.toContain('840324300155');
  });

  it('does not contain legally dangerous claims', async () => {
    const buf = await renderToDocx(EMPLOYMENT_MD, OFFICIAL_META, []);
    const xml = await getDocumentText(buf);
    expect(xml).not.toMatch(/AI certified/i);
    expect(xml).not.toMatch(/guaranteed accepted/i);
    expect(xml).not.toMatch(/automatic notar/i);
    expect(xml).not.toMatch(/already notariz/i);
  });

  it('main translation content is still preserved (block removal did not break rendering)', async () => {
    const buf = await renderToDocx(EMPLOYMENT_MD, OFFICIAL_META, []);
    const xml = await getDocumentText(buf);
    expect(xml).toContain('ATTESTATO DI LAVORO');
    expect(xml).toContain('Ivan Ivanov');
    expect(xml).toContain('OOO Romashka');
    expect(xml).toContain('500 000 RUB');
  });
});

// ── Electronic mode: no block (unchanged contract — was already absent) ────────

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

// ── Notarization mode: block also removed (contract changed — previously present) ──

describe('renderToDocx notarization_package mode', () => {
  it('does not contain the translator block or the provider IIN', async () => {
    const buf = await renderToDocx(EMPLOYMENT_MD, {
      ...OFFICIAL_META,
      outputMode: 'notarization_package',
    }, []);
    const xml = await getDocumentText(buf);
    expect(xml).not.toContain("DATI DEL TRADUTTORE E DELL'ESECUTORE");
    expect(xml).not.toContain('840324300155');
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

// ── Russian target language: block removed (contract changed — previously present) ──

describe('renderToDocx official EN → RU', () => {
  it('does not contain the Russian translator/executor block', async () => {
    const buf = await renderToDocx('# Документ\n\nТекст.', {
      sourceLang: 'en',
      targetLang: 'ru',
      documentType: 'other',
      translatedAt: '2026-06-19',
      outputMode: 'translator_review_draft',
    }, []);
    const xml = await getDocumentText(buf);
    expect(xml).not.toContain('ПЕРЕВОДЧИК И ИСПОЛНИТЕЛЬ');
    expect(xml).not.toContain('ИП World Prime Online');
    expect(xml).not.toContain('TRANSLATOR AND PROVIDER DETAILS');
  });
});

// ── German: block removed (contract changed — previously present); i18n data intact ──

describe('renderToDocx German official mode', () => {
  const DE_META = {
    sourceLang: 'ru',
    targetLang: 'de',
    documentType: 'employment_document',
    translatedAt: '2026-06-19',
    outputMode: 'translator_review_draft',
  };

  it('does not contain the German translator/executor block', async () => {
    const buf = await renderToDocx(EMPLOYMENT_MD, DE_META, []);
    const xml = await getDocumentText(buf);
    expect(xml).not.toContain('ANGABEN ZUM ÜBERSETZER UND LEISTUNGSERBRINGER');
    expect(xml).not.toContain('Leistungserbringer:');
    expect(xml).not.toContain('Stempel des Leistungserbringers:');
  });

  it('i18n dictionary heading is still intact even though it is no longer rendered', () => {
    const de = TRANSLATOR_BLOCK_I18N['de']!;
    expect(de.heading).toBe('ANGABEN ZUM ÜBERSETZER UND LEISTUNGSERBRINGER');
    expect(de.provider).toBe('Leistungserbringer');
    expect(de.stamp).toBe('Stempel des Leistungserbringers');
  });
});

// ── Fallback language: block removed (contract changed — previously present) ───

describe('renderToDocx unknown target language', () => {
  it('does not contain the English-fallback translator/executor block', async () => {
    const buf = await renderToDocx('# Doc\n\nText.', {
      sourceLang: 'ru',
      targetLang: 'xx',
      documentType: 'other',
      translatedAt: '2026-06-19',
      outputMode: 'translator_review_draft',
    }, []);
    const xml = await getDocumentText(buf);
    expect(xml).not.toContain('TRANSLATOR AND PROVIDER DETAILS');
    expect(xml).not.toContain('840324300155');
  });
});
