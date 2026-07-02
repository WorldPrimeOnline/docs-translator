/**
 * Output policy (2026-07-02) — electronic translation disclaimer i18n.
 *
 * Verifies:
 * 1. The electronicOutput.formats.{title,body} keys exist (non-empty) for
 *    every locale actually enumerated in src/i18n/locales.ts (source of
 *    truth — not a hardcoded list, to avoid silently drifting out of sync
 *    if a locale is added/removed later).
 * 2. The EN and RU wording matches exactly what was specified for this
 *    disclaimer (docs/ai-context/40_TRANSLATION_PIPELINE.md).
 * 3. The disclaimer text is not hardcoded anywhere in the dashboard
 *    component — it must only ever be read via useTranslations('electronicOutput').
 */
import * as path from 'path';
import * as fs from 'fs';
import { LOCALE_CODES } from '../../i18n/locales';

const MESSAGES_DIR = path.resolve(__dirname, '../../../messages');

function loadOrderMessages(locale: string): Record<string, unknown> {
  const filePath = path.join(MESSAGES_DIR, locale, 'order.json');
  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw) as Record<string, unknown>;
}

describe('electronicOutput i18n — key presence across every supported locale', () => {
  it('src/i18n/locales.ts enumerates more than a handful of locales (sanity check the source of truth)', () => {
    expect(LOCALE_CODES.length).toBeGreaterThanOrEqual(10);
  });

  for (const locale of LOCALE_CODES) {
    it(`${locale}: electronicOutput.formats.title and .body are present and non-empty`, () => {
      const messages = loadOrderMessages(locale) as {
        electronicOutput?: { formats?: { title?: string; body?: string } };
      };
      const title = messages.electronicOutput?.formats?.title;
      const body = messages.electronicOutput?.formats?.body;
      expect(typeof title).toBe('string');
      expect(title!.length).toBeGreaterThan(0);
      expect(typeof body).toBe('string');
      expect(body!.length).toBeGreaterThan(0);
    });
  }
});

describe('electronicOutput i18n — exact EN/RU wording', () => {
  it('en matches the specified wording exactly', () => {
    const en = loadOrderMessages('en') as { electronicOutput: { formats: { title: string; body: string } } };
    expect(en.electronicOutput.formats.title).toBe('Electronic translation formats');
    expect(en.electronicOutput.formats.body).toBe(
      'Electronic translation is provided in editable DOCX and HTML formats. For documents with complex tables, scans, or non-standard layout, manual adjustment of column widths, line breaks, or formatting may be required.',
    );
  });

  it('ru matches the specified wording exactly', () => {
    const ru = loadOrderMessages('ru') as { electronicOutput: { formats: { title: string; body: string } } };
    expect(ru.electronicOutput.formats.title).toBe('Форматы электронного перевода');
    expect(ru.electronicOutput.formats.body).toBe(
      'Электронный перевод предоставляется в редактируемых форматах DOCX и HTML. Для документов со сложными таблицами, сканами или нестандартной разметкой может потребоваться ручная корректировка ширины колонок, переносов и оформления.',
    );
  });
});

describe('electronicOutput disclaimer — not hardcoded in the dashboard component', () => {
  it('dashboard/page.tsx never inlines the RU or EN disclaimer body text as a string literal', () => {
    const dashboardSrc = fs.readFileSync(
      path.resolve(__dirname, '../../app/[locale]/dashboard/page.tsx'),
      'utf-8',
    );
    expect(dashboardSrc).not.toContain('предоставляется в редактируемых форматах');
    expect(dashboardSrc).not.toContain('is provided in editable DOCX and HTML formats');
  });

  it('dashboard/page.tsx reads the disclaimer only via useTranslations(\'electronicOutput\')', () => {
    const dashboardSrc = fs.readFileSync(
      path.resolve(__dirname, '../../app/[locale]/dashboard/page.tsx'),
      'utf-8',
    );
    expect(dashboardSrc).toContain("useTranslations('electronicOutput')");
    expect(dashboardSrc).toContain("tElectronic('formats.title')");
    expect(dashboardSrc).toContain("tElectronic('formats.body')");
  });
});
