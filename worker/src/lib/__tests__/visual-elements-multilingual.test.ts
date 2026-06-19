/**
 * @jest-environment node
 *
 * Regression fixture: one employment-certificate page with 6 visual elements.
 * Tests bracketKind() multilingual detection and filterPrintedVerificationStrings().
 */

import {
  extractVisualElementsFromTranslated,
  mergeVisualElements,
  filterPrintedVerificationStrings,
  type VisualElement,
} from '../visual-elements';

// ── Sanitized fixture: one page of an employment certificate (no real PII) ────
//
// Simulates what Claude outputs for RU→IT translation following
// OFFICIAL_VISUAL_ELEMENT_POLICY §"For other target languages, localize naturally".

const ITALIAN_EMPLOYMENT_TRANSLATED = `
# ATTESTATO DI LAVORO

[logo: Azienda Esempio S.r.l.]

| Campo | Valore |
| ----- | ------ |
| Dipendente | Test Persona |
| Organizzazione | OOO Esempio |
| Retribuzione | 500 000 RUB |

Emesso il 15 gennaio 2024.

[filigrana: CAMPIONE DIDATTICO]

Firma del Responsabile delle Risorse Umane: [firma manoscritta]

Firma del Capo Contabile: [firma manoscritta]

[timbro rotondo dell'organizzazione]

[codice QR presente]

www.sml.kz
`;

const GERMAN_EMPLOYMENT_TRANSLATED = `
# ARBEITSZEUGNIS

[Logo: Beispiel GmbH]

| Feld | Wert |
| ----- | ------ |
| Mitarbeiter | Test Person |

[Wasserzeichen: MUSTERBEISPIEL]

Unterschrift des Personalleiters: [Handschriftliche Unterschrift]

Unterschrift des Buchhalters: [Unterschrift]

[Runder Stempel der Organisation]

[QR-Code vorhanden]
`;

const FRENCH_EMPLOYMENT_TRANSLATED = `
# ATTESTATION DE TRAVAIL

[logo: Société Exemple SARL]

[filigrane: EXEMPLE PÉDAGOGIQUE]

Signature du responsable RH : [signature manuscrite]

Signature du comptable en chef : [signature]

[cachet rond de l'organisation]

[code QR présent]
`;

const SPANISH_EMPLOYMENT_TRANSLATED = `
# CERTIFICADO LABORAL

[logo: Empresa Ejemplo S.L.]

[marca de agua: MUESTRA DIDÁCTICA]

Firma del responsable de RRHH: [firma manuscrita]

Firma del contador: [firma]

[sello redondo de la organización]

[código QR presente]
`;

// ── Helper ────────────────────────────────────────────────────────────────────

function countKind(elements: VisualElement[], kind: string): number {
  return elements.filter((e) => e.kind === kind).length;
}

// ── Italian multilingual detection ────────────────────────────────────────────

describe('extractVisualElementsFromTranslated — Italian bracket markers', () => {
  let elements: VisualElement[];

  beforeAll(() => {
    elements = extractVisualElementsFromTranslated(ITALIAN_EMPLOYMENT_TRANSLATED);
  });

  it('detects [logo:] bracket', () => {
    expect(countKind(elements, 'logo')).toBe(1);
  });

  it('detects [filigrana:] as watermark', () => {
    expect(countKind(elements, 'watermark')).toBe(1);
  });

  it('detects [firma manoscritta] as signature', () => {
    // Two separate inline [firma manoscritta] markers — dedup by kind:text collapses to 1 here
    // since both have same text. Full page+position dedup is in renderVisualBlock.
    expect(countKind(elements, 'signature')).toBeGreaterThanOrEqual(1);
  });

  it('detects [timbro rotondo] as stamp', () => {
    expect(countKind(elements, 'stamp')).toBe(1);
  });

  it('detects [codice QR presente] as qr', () => {
    expect(countKind(elements, 'qr')).toBe(1);
  });

  it('finds at least 5 distinct kinds (logo, watermark, signature, stamp, qr)', () => {
    const kinds = new Set(elements.map((e) => e.kind));
    expect(kinds.has('logo')).toBe(true);
    expect(kinds.has('watermark')).toBe(true);
    expect(kinds.has('signature')).toBe(true);
    expect(kinds.has('stamp')).toBe(true);
    expect(kinds.has('qr')).toBe(true);
  });
});

// ── German multilingual detection ─────────────────────────────────────────────

describe('extractVisualElementsFromTranslated — German bracket markers', () => {
  let elements: VisualElement[];

  beforeAll(() => {
    elements = extractVisualElementsFromTranslated(GERMAN_EMPLOYMENT_TRANSLATED);
  });

  it('detects [Logo:] as logo', () => {
    expect(countKind(elements, 'logo')).toBe(1);
  });

  it('detects [Wasserzeichen:] as watermark', () => {
    expect(countKind(elements, 'watermark')).toBe(1);
  });

  it('detects [Handschriftliche Unterschrift] as signature', () => {
    expect(countKind(elements, 'signature')).toBeGreaterThanOrEqual(1);
  });

  it('detects [Runder Stempel] as stamp', () => {
    expect(countKind(elements, 'stamp')).toBe(1);
  });

  it('detects [QR-Code vorhanden] as qr', () => {
    expect(countKind(elements, 'qr')).toBe(1);
  });
});

// ── French multilingual detection ─────────────────────────────────────────────

describe('extractVisualElementsFromTranslated — French bracket markers', () => {
  let elements: VisualElement[];

  beforeAll(() => {
    elements = extractVisualElementsFromTranslated(FRENCH_EMPLOYMENT_TRANSLATED);
  });

  it('detects [logo:] as logo', () => {
    expect(countKind(elements, 'logo')).toBe(1);
  });

  it('detects [filigrane:] as watermark', () => {
    expect(countKind(elements, 'watermark')).toBe(1);
  });

  it('detects [signature] and [signature manuscrite] as signature', () => {
    expect(countKind(elements, 'signature')).toBeGreaterThanOrEqual(1);
  });

  it('detects [cachet rond] as stamp', () => {
    expect(countKind(elements, 'stamp')).toBe(1);
  });

  it('detects [code QR présent] as qr (contains "qr")', () => {
    expect(countKind(elements, 'qr')).toBe(1);
  });
});

// ── Spanish multilingual detection ────────────────────────────────────────────

describe('extractVisualElementsFromTranslated — Spanish bracket markers', () => {
  let elements: VisualElement[];

  beforeAll(() => {
    elements = extractVisualElementsFromTranslated(SPANISH_EMPLOYMENT_TRANSLATED);
  });

  it('detects [logo:] as logo', () => {
    expect(countKind(elements, 'logo')).toBe(1);
  });

  it('detects [marca de agua:] as watermark', () => {
    expect(countKind(elements, 'watermark')).toBe(1);
  });

  it('detects [firma] as signature', () => {
    expect(countKind(elements, 'signature')).toBeGreaterThanOrEqual(1);
  });

  it('detects [sello redondo] as stamp', () => {
    expect(countKind(elements, 'stamp')).toBe(1);
  });

  it('detects [código QR presente] as qr', () => {
    expect(countKind(elements, 'qr')).toBe(1);
  });
});

// ── filterPrintedVerificationStrings ─────────────────────────────────────────

describe('filterPrintedVerificationStrings', () => {
  it('removes verification_string elements with source=regex', () => {
    const elements: VisualElement[] = [
      { kind: 'logo',                text: '[logo]',        source: 'markdown_marker' },
      { kind: 'verification_string', text: 'www.sml.kz',   source: 'regex' },
      { kind: 'verification_string', text: 'https://verify.example.com', source: 'regex' },
    ];
    const filtered = filterPrintedVerificationStrings(elements);
    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.kind).toBe('logo');
  });

  it('keeps verification_string from markdown_marker source', () => {
    const elements: VisualElement[] = [
      { kind: 'verification_string', text: '[QR: www.verify.kz]', source: 'markdown_marker' },
      { kind: 'verification_string', text: 'www.sml.kz', source: 'regex' },
    ];
    const filtered = filterPrintedVerificationStrings(elements);
    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.source).toBe('markdown_marker');
  });

  it('keeps all non-verification_string elements unchanged', () => {
    const elements: VisualElement[] = [
      { kind: 'stamp',     text: '[round stamp]', source: 'markdown_marker' },
      { kind: 'signature', text: '[signature]',   source: 'markdown_marker' },
      { kind: 'logo',      text: '[logo]',        source: 'mistral_ocr' },
    ];
    expect(filterPrintedVerificationStrings(elements)).toHaveLength(3);
  });

  it('returns empty array for all-regex verification strings', () => {
    const elements: VisualElement[] = [
      { kind: 'verification_string', text: 'www.sml.kz', source: 'regex' },
    ];
    expect(filterPrintedVerificationStrings(elements)).toHaveLength(0);
  });
});

// ── Full pipeline simulation ───────────────────────────────────────────────────
// Simulates what processor.ts does: merge OCR elements + translated elements → filter

describe('Full pipeline: mergeVisualElements + filterPrintedVerificationStrings', () => {
  it('Italian employment certificate produces logo, watermark, stamp, signature, qr — no www.sml.kz', () => {
    // OCR side: only picks up www.sml.kz from URL regex (vector graphics not extracted)
    const ocrElements: VisualElement[] = [
      { kind: 'verification_string', text: 'www.sml.kz', source: 'regex' },
    ];

    // Translation side: Claude's Italian markers
    const translatedElements = extractVisualElementsFromTranslated(ITALIAN_EMPLOYMENT_TRANSLATED);

    const merged = mergeVisualElements(ocrElements, translatedElements);
    const filtered = filterPrintedVerificationStrings(merged);

    // www.sml.kz must be gone
    expect(filtered.find((e) => e.text === 'www.sml.kz')).toBeUndefined();
    expect(filtered.find((e) => e.kind === 'verification_string')).toBeUndefined();

    // Meaningful visual elements must be present
    const kinds = new Set(filtered.map((e) => e.kind));
    expect(kinds.has('logo')).toBe(true);
    expect(kinds.has('watermark')).toBe(true);
    expect(kinds.has('stamp')).toBe(true);
    expect(kinds.has('signature')).toBe(true);
    expect(kinds.has('qr')).toBe(true);

    // At least 5 elements (logo, watermark, signature×1-or-more, stamp, qr)
    expect(filtered.length).toBeGreaterThanOrEqual(5);
  });
});

// ── English / Russian backward compatibility ──────────────────────────────────

describe('bracketKind — English and Russian still work', () => {
  it('extracts [round stamp] as stamp', () => {
    const els = extractVisualElementsFromTranslated('[round stamp]');
    expect(els.find((e) => e.kind === 'stamp')).toBeTruthy();
  });

  it('extracts [signature] as signature', () => {
    const els = extractVisualElementsFromTranslated('[signature]');
    expect(els.find((e) => e.kind === 'signature')).toBeTruthy();
  });

  it('extracts [watermark] as watermark', () => {
    const els = extractVisualElementsFromTranslated('[watermark]');
    expect(els.find((e) => e.kind === 'watermark')).toBeTruthy();
  });

  it('extracts [qr code present] as qr', () => {
    const els = extractVisualElementsFromTranslated('[qr code present]');
    expect(els.find((e) => e.kind === 'qr')).toBeTruthy();
  });

  it('extracts [logo] as logo', () => {
    const els = extractVisualElementsFromTranslated('[logo]');
    expect(els.find((e) => e.kind === 'logo')).toBeTruthy();
  });

  it('extracts Russian [печать] as stamp', () => {
    const els = extractVisualElementsFromTranslated('[печать]');
    expect(els.find((e) => e.kind === 'stamp')).toBeTruthy();
  });

  it('extracts Russian [подпись] as signature', () => {
    const els = extractVisualElementsFromTranslated('[подпись]');
    expect(els.find((e) => e.kind === 'signature')).toBeTruthy();
  });

  it('extracts Russian [водяной знак] as watermark', () => {
    const els = extractVisualElementsFromTranslated('[водяной знак]');
    expect(els.find((e) => e.kind === 'watermark')).toBeTruthy();
  });

  it('does not match arbitrary text as visual element', () => {
    const els = extractVisualElementsFromTranslated('[some random bracket text without visual keywords]');
    expect(els).toHaveLength(0);
  });
});
