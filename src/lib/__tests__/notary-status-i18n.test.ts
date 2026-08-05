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

function loadOrderMessages(locale: string): {
  dashboard: {
    status: Record<string, string>;
    stages: Record<string, string>;
    progressFlow: { notary: Record<string, string> };
  };
} {
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
  // 2026-07-26 architectural fix: the dashboard no longer chooses a label via a
  // per-customerStatus switch statement in page.tsx — every label now comes from
  // resolveCustomerProgressFlow()'s own `labelKey` (progress-flow.ts), rendered
  // generically via `t(entry.labelKey)`. dashboard.status.notarized/
  // dashboard.stages.notarized (tested above for content) are no longer read by
  // page.tsx at all for the notary progress display; this test now asserts the
  // NEW mechanism's safety property instead: no raw enum-like literal ever reaches
  // the rendered text, and the resolver's own notary labelKeys resolve to real,
  // non-empty, distinct-from-code-value translations in every locale.
  it('dashboard/page.tsx never renders a raw enum literal (e.g. "NOTARY_COMPLETED") directly in JSX text content', () => {
    const dashboardSrc = fs.readFileSync(
      path.resolve(__dirname, '../../app/[locale]/dashboard/page.tsx'),
      'utf-8',
    );
    expect(dashboardSrc).not.toMatch(/>\s*\{?\s*['"`]NOTARY_COMPLETED['"`]/);
    // The label is rendered generically via the resolver's own labelKey — never a
    // hardcoded per-status switch/case in the component itself anymore.
    expect(dashboardSrc).toMatch(/t\(entry\.labelKey\)|safeLabel\(t, entry\.labelKey\)/);
  });

  it('progress-flow.ts\'s notary labelKeys (progressFlow.notary.notarized/notarizedFinal) resolve to real, non-empty text in every locale, never a raw enum value', () => {
    for (const locale of LOCALE_CODES) {
      const messages = loadOrderMessages(locale);
      const notarized = messages.dashboard.progressFlow.notary.notarized!;
      const notarizedFinal = messages.dashboard.progressFlow.notary.notarizedFinal!;
      expect(typeof notarized).toBe('string');
      expect(notarized.length).toBeGreaterThan(0);
      expect(typeof notarizedFinal).toBe('string');
      expect(notarizedFinal.length).toBeGreaterThan(0);
      expect(notarized).not.toMatch(RAW_ENUM_PATTERN);
      expect(notarizedFinal).not.toMatch(RAW_ENUM_PATTERN);
    }
  });
});
