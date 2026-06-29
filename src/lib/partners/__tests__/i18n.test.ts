/**
 * Verifies:
 * 1. All required partners.json keys are present across all 13 locales
 * 2. No forbidden marketing phrases appear in the partners page copy
 */

import * as path from 'path';
import * as fs from 'fs';

const LOCALES = ['en', 'ru', 'kk', 'zh', 'ko', 'tj', 'uz', 'tk', 'mn', 'ky', 'de', 'tr', 'es'];

const MESSAGES_DIR = path.resolve(__dirname, '../../../../messages');

function loadPartnersMessages(locale: string): Record<string, unknown> {
  const filePath = path.join(MESSAGES_DIR, locale, 'partners.json');
  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw) as Record<string, unknown>;
}

function flattenKeys(obj: unknown, prefix = ''): string[] {
  if (typeof obj !== 'object' || obj === null) return [prefix];
  const keys: string[] = [];
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const full = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'object' && v !== null) {
      keys.push(...flattenKeys(v, full));
    } else {
      keys.push(full);
    }
  }
  return keys;
}

// The canonical key set is defined by the EN locale
let enKeys: string[];

beforeAll(() => {
  const en = loadPartnersMessages('en');
  enKeys = flattenKeys(en);
});

describe('partners i18n — key presence', () => {
  for (const locale of LOCALES) {
    it(`${locale}: contains all required keys`, () => {
      const messages = loadPartnersMessages(locale);
      const localeKeys = flattenKeys(messages);
      const missing = enKeys.filter((k) => !localeKeys.includes(k));
      expect(missing).toEqual([]);
    });
  }
});

// ─── Forbidden phrase check ───────────────────────────────────────────────────

const FORBIDDEN_PHRASES = [
  /AI certified translation/i,
  /automatic notarization/i,
  /guaranteed accept/i,
  /guaranteed acceptance/i,
  /officially certified by AI/i,
];

function collectAllStrings(obj: unknown): string[] {
  if (typeof obj === 'string') return [obj];
  if (typeof obj !== 'object' || obj === null) return [];
  return Object.values(obj as Record<string, unknown>).flatMap(collectAllStrings);
}

describe('partners i18n — forbidden phrases', () => {
  for (const locale of LOCALES) {
    it(`${locale}: no forbidden marketing claims`, () => {
      const messages = loadPartnersMessages(locale);
      const strings = collectAllStrings(messages);
      for (const phrase of FORBIDDEN_PHRASES) {
        const hit = strings.find((s) => phrase.test(s));
        expect(hit).toBeUndefined();
      }
    });
  }
});
