/**
 * i18n:language — Detect wrong language / stale content in enabled locale message files.
 *
 * Checks:
 * - messages/en/**\/*.json: ERROR if Cyrillic (3+ chars) found
 * - messages/kk/**\/*.json: ERROR if specific Russian-only phrases found
 * - All enabled locales: ERROR if TODO_I18N present
 * - All enabled locales pricing/checkout/order/landing-pages/home: ERROR if old prices found
 * - All enabled locales: ERROR if banned AI/certified terminology found
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const ENABLED_LOCALES = ['ru', 'en', 'kk'];

// Russian phrases that are NOT legitimate Kazakh Cyrillic — they're Russian words
const KK_FORBIDDEN_RUSSIAN_PHRASES = [
  'Поддерживаемые документы',
  'Свидетельство о рождении',
  'Банковская выписка',
  'Справка об отсутствии судимости',
  'Трудовой договор',
  'Паспорт и удостоверение личности',
  'Перевести сейчас',
  'Нотариальное удостоверение',
  'Простая цена',
];

// Old prices that must not appear in pricing-related namespaces
const OLD_PRICE_PATTERNS = ['2 290', '2290', '2 590', '2590', '4 990', '4990', '12 990', '12990'];
const PRICE_SENSITIVE_NAMESPACES = new Set(['pricing', 'order', 'checkout', 'landing-pages', 'home']);

// Subscription/monthly plan labels banned from public UI message files
// Checked in price-sensitive namespaces only (to avoid false positives in serviceTerms etc.)
const SUBSCRIPTION_BANNED_IN_PRICING = [
  '/ месяц',
  'в месяц',
  'документов / месяц',
  'документов/месяц',
  '/ month',
  'documents / month',
  'documents/month',
  '/mo',
  '/ ай',
  'документов / ай',
  'құжат / ай',
];

// Terms banned everywhere in enabled locale message files
const BANNED_TERMS = [
  'Translation by Claude Sonnet',
  'Translation by Claude',
  'Claude Sonnet AI',
  'Claude Sonnet translates',
  'Claude Sonnet аударады',
  'Claude Sonnet переводит',
  'Перевод с помощью ИИ Claude',
  'Перевод ИИ через Claude',
  'Перевод с помощью Claude',
];

let errors = 0;
let warnings = 0;

function fail(file: string, line: number, msg: string): void {
  console.error(`  ERROR  ${file}:${line}  ${msg}`);
  errors++;
}

function warn(file: string, line: number, msg: string): void {
  console.warn(`  WARN   ${file}:${line}  ${msg}`);
  warnings++;
}

function checkFile(filePath: string, locale: string, ns: string): void {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const rel = path.relative(ROOT, filePath);

  lines.forEach((line, i) => {
    const ln = i + 1;

    // TODO_I18N in enabled locales → ERROR
    if (line.includes('TODO_I18N')) {
      fail(rel, ln, `TODO_I18N in enabled locale ${locale}`);
    }

    // EN: Cyrillic (3+ chars) = error (Cyrillic in brand names like WPO is short so this catches actual prose)
    if (locale === 'en') {
      const cyrMatches = line.match(/[А-Яа-яЁёҒғҚқҢңҮүҰұҺһӘәІі]{3,}/g);
      if (cyrMatches) {
        for (const m of cyrMatches) {
          fail(rel, ln, `Cyrillic in EN locale: "${m}"`);
        }
      }
    }

    // KK: forbidden Russian-only phrases
    if (locale === 'kk') {
      for (const phrase of KK_FORBIDDEN_RUSSIAN_PHRASES) {
        if (line.includes(phrase)) {
          fail(rel, ln, `Russian phrase in KK locale: "${phrase}"`);
        }
      }
    }

    // Old prices in price-sensitive namespaces
    if (PRICE_SENSITIVE_NAMESPACES.has(ns)) {
      for (const oldPrice of OLD_PRICE_PATTERNS) {
        if (line.includes(oldPrice)) {
          fail(rel, ln, `Old price "${oldPrice}" found in ${ns} namespace`);
        }
      }
      // Subscription/monthly labels in pricing namespaces
      for (const term of SUBSCRIPTION_BANNED_IN_PRICING) {
        if (line.includes(term)) {
          fail(rel, ln, `Subscription/monthly label in pricing namespace: "${term}"`);
        }
      }
    }

    // Banned AI/certified terminology (everywhere)
    for (const term of BANNED_TERMS) {
      if (line.toLowerCase().includes(term.toLowerCase())) {
        fail(rel, ln, `Banned term: "${term}"`);
      }
    }
  });
}

console.log('\n=== i18n:language — wrong language / stale content detector ===\n');

const NAMESPACES = [
  'navigation', 'home', 'pricing', 'landing-pages', 'footer',
  'auth', 'order', 'checkout', 'legal', 'common', 'errors',
];

for (const locale of ENABLED_LOCALES) {
  for (const ns of NAMESPACES) {
    const p = path.join(ROOT, 'messages', locale, `${ns}.json`);
    if (fs.existsSync(p)) checkFile(p, locale, ns);
  }
}

console.log(`\n=== Summary ===`);
console.log(`  ERRORs:   ${errors}`);
console.log(`  WARNINGs: ${warnings}`);
if (errors > 0) {
  console.error(`\n✗ i18n:language failed\n`);
  process.exit(1);
} else {
  console.log(`\n✓ i18n:language passed\n`);
}
