/**
 * @jest-environment node
 *
 * Output policy (2026-07-02): the auto-generated translator/executor
 * certification block must never appear in renderToHtml() output, for any
 * service level — see docx-translator-block.test.ts for the DOCX-renderer
 * equivalent. This file covers the HTML renderer path (renderer.ts showCert),
 * which previously rendered the block for official/notarization modes.
 *
 * The visual/non-text elements block (a separate, untouched feature — see
 * docs/ai-context/40_TRANSLATION_PIPELINE.md "Do NOT touch visual elements
 * block") must remain present and unaffected.
 */
// 'marked' ships ESM-only and isn't transformed by the CommonJS ts-jest
// config used elsewhere in this suite (see renderer.test.ts's comment: it
// tests renderer-helpers.ts directly for this exact reason). A minimal
// passthrough mock is enough here — these tests only assert substring
// presence/absence, not real HTML structure from markdown parsing.
jest.mock('marked', () => ({
  marked: { parse: (md: string) => Promise.resolve(md) },
}));

import { renderToHtml } from '../renderer';
import type { VisualElement } from '../visual-elements';

const EMPLOYMENT_MD = `# ATTESTATO DI LAVORO

| Campo | Valore |
| ----- | ------ |
| Dipendente | Ivan Ivanov |
| Organizzazione | OOO Romashka |

Emesso il 15 gennaio 2024.`;

const VISUAL_ELEMENTS: VisualElement[] = [
  { kind: 'stamp', page: 1, position: 'lower_center', text: '[stamp]', source: 'markdown_marker' },
];

const OFFICIAL_META = {
  sourceLang: 'ru',
  targetLang: 'en',
  documentType: 'employment_document',
  translatedAt: '2026-07-02',
  serviceLevel: 'official_with_translator_signature_and_provider_stamp' as const,
  outputMode: 'translator_review_draft' as const,
};

const NOTARIZATION_META = {
  ...OFFICIAL_META,
  serviceLevel: 'notarization_through_partners' as const,
  outputMode: 'notarization_package' as const,
};

const ELECTRONIC_META = {
  sourceLang: 'ru',
  targetLang: 'en',
  documentType: 'employment_document',
  translatedAt: '2026-07-02',
  serviceLevel: 'electronic' as const,
  outputMode: 'translation_only' as const,
};

const RU_OFFICIAL_META = {
  sourceLang: 'en',
  targetLang: 'ru',
  documentType: 'employment_document',
  translatedAt: '2026-07-02',
  serviceLevel: 'official_with_translator_signature_and_provider_stamp' as const,
  outputMode: 'translator_review_draft' as const,
};

describe('renderToHtml — translator/executor certification block is never rendered', () => {
  it('official mode: no certification block, no provider IIN placeholder row', async () => {
    const html = await renderToHtml(EMPLOYMENT_MD, OFFICIAL_META, VISUAL_ELEMENTS);
    expect(html).not.toContain('TRANSLATOR AND PROVIDER DETAILS');
    expect(html).not.toContain('<div class="certification-block">');
    expect(html).not.toContain('cert-title">');
  });

  it('notarization_package mode: no certification block', async () => {
    const html = await renderToHtml(EMPLOYMENT_MD, NOTARIZATION_META, VISUAL_ELEMENTS);
    expect(html).not.toContain('TRANSLATOR AND PROVIDER DETAILS');
    expect(html).not.toContain('<div class="certification-block">');
  });

  it('electronic mode: no certification block (unchanged — was already absent)', async () => {
    const html = await renderToHtml(EMPLOYMENT_MD, ELECTRONIC_META, VISUAL_ELEMENTS);
    expect(html).not.toContain('TRANSLATOR AND PROVIDER DETAILS');
    expect(html).not.toContain('<div class="certification-block">');
  });

  it('Russian official mode: no Russian certification heading', async () => {
    const html = await renderToHtml('# Документ\n\nТекст.', RU_OFFICIAL_META, VISUAL_ELEMENTS);
    expect(html).not.toContain('СВЕДЕНИЯ О ПЕРЕВОДЧИКЕ И ИСПОЛНИТЕЛЕ');
    expect(html).not.toContain('<div class="certification-block">');
  });

  it('the general notarization-process note is unrelated and still renders in notarization_package mode', async () => {
    // notarizationNote() is a separate, unaffected disclaimer — not the
    // translator/executor identity block this policy removes.
    const html = await renderToHtml(EMPLOYMENT_MD, NOTARIZATION_META, VISUAL_ELEMENTS);
    expect(html).toContain('notarization-note');
  });
});

describe('renderToHtml — visual/non-text elements block is untouched by the output-policy change', () => {
  it('official mode still renders the visual elements block', async () => {
    const html = await renderToHtml(EMPLOYMENT_MD, OFFICIAL_META, VISUAL_ELEMENTS);
    expect(html).toContain('Description of non-text elements in the original');
  });

  it('electronic mode still renders the visual elements block', async () => {
    const html = await renderToHtml(EMPLOYMENT_MD, ELECTRONIC_META, VISUAL_ELEMENTS);
    expect(html).toContain('Description of non-text elements in the original');
  });

  it('main translation content is preserved alongside the visual elements block', async () => {
    const html = await renderToHtml(EMPLOYMENT_MD, OFFICIAL_META, VISUAL_ELEMENTS);
    expect(html).toContain('Ivan Ivanov');
    expect(html).toContain('OOO Romashka');
  });
});
