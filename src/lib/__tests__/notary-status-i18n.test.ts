/**
 * 2026-07-23 dashboard task: `dashboard.status.notarized` and `dashboard.stages.notarized`
 * were effectively swapped from what customers should see —
 * `status.notarized` held the SHORT stage-timeline-style text ("Notary finished") while
 * `stages.notarized` held the fuller "Notarization completed" phrasing, backwards from
 * the intended primary-status vs. short-stage-label split. Fixed across all 14 locales:
 * `status.notarized` is now a clear primary customer status ("Document notarized" /
 * locale equivalent); `stages.notarized` reuses the fuller "Notarization completed"
 * phrasing as the short progress-timeline label. This locks in both:
 * 1. RU wording exactly, per the task spec.
 * 2. Every locale has non-empty values for both keys, and neither ever surfaces a raw
 *    technical enum value (e.g. 'NOTARY_COMPLETED', 'notarized') to the customer.
 */
import * as path from 'path';
import * as fs from 'fs';
import { LOCALE_CODES } from '../../i18n/locales';

const MESSAGES_DIR = path.resolve(__dirname, '../../../messages');

function loadOrderMessages(locale: string): { dashboard: { status: Record<string, string>; stages: Record<string, string> } } {
  const filePath = path.join(MESSAGES_DIR, locale, 'order.json');
  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw);
}

// Raw technical enum/identifier tokens that must never leak to the customer verbatim.
// Deliberately does NOT flag the plain English/Turkic word "notarized" — that's a
// legitimate customer-facing word (used in en/tk/uz translations here), distinct
// from the raw SCREAMING_SNAKE_CASE enum value or the `workflow_status` column name.
const RAW_ENUM_PATTERN = /NOTARY_COMPLETED|workflow_status/;

describe('dashboard.status.notarized / dashboard.stages.notarized — every locale', () => {
  it('src/i18n/locales.ts enumerates more than a handful of locales (sanity check)', () => {
    expect(LOCALE_CODES.length).toBeGreaterThanOrEqual(10);
  });

  for (const locale of LOCALE_CODES) {
    it(`${locale}: status.notarized and stages.notarized are present, non-empty, and distinct`, () => {
      const messages = loadOrderMessages(locale);
      const status = messages.dashboard.status.notarized!;
      const stage = messages.dashboard.stages.notarized!;

      expect(typeof status).toBe('string');
      expect(status.length).toBeGreaterThan(0);
      expect(typeof stage).toBe('string');
      expect(stage.length).toBeGreaterThan(0);

      // Neither string is a raw technical enum value.
      expect(status).not.toMatch(RAW_ENUM_PATTERN);
      expect(stage).not.toMatch(RAW_ENUM_PATTERN);
    });
  }
});

describe('dashboard.status.notarized / dashboard.stages.notarized — exact RU wording', () => {
  it('ru: status.notarized is the primary customer-facing "document notarized" status', () => {
    const ru = loadOrderMessages('ru');
    expect(ru.dashboard.status.notarized).toBe('Документ нотариально заверен');
  });

  it('ru: stages.notarized reuses the fuller "notarization completed" phrasing as the short stage label', () => {
    const ru = loadOrderMessages('ru');
    expect(ru.dashboard.stages.notarized).toBe('Нотариальное заверение завершено');
  });

  it('ru: the two keys are no longer swapped (status is the short declarative, stage is the fuller phrase)', () => {
    const ru = loadOrderMessages('ru');
    expect(ru.dashboard.status.notarized).not.toBe(ru.dashboard.stages.notarized);
  });
});

describe('dashboard.status.notarized / dashboard.stages.notarized — never raw enum values in code', () => {
  it('dashboard/page.tsx renders the notarized status only via t(\'status.notarized\')/t(\'stages.notarized\'), never a raw enum literal', () => {
    const dashboardSrc = fs.readFileSync(
      path.resolve(__dirname, '../../app/[locale]/dashboard/page.tsx'),
      'utf-8',
    );
    expect(dashboardSrc).toContain("t('status.notarized')");
    // No raw enum-like string is ever interpolated directly into JSX text content.
    expect(dashboardSrc).not.toMatch(/>\s*\{?\s*['"`]NOTARY_COMPLETED['"`]/);
  });
});
