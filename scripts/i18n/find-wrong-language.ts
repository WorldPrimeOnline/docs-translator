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
const ENABLED_LOCALES = ['ru', 'en', 'kk', 'uz', 'ky', 'th'];

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

// Old electronic-level prices that must not appear as electronic-tier UI labels
// Pattern: these exact strings represent the old "from 2500" electronic price in public UI
const OLD_ELECTRONIC_PRICE_PATTERNS_RU = ['от 2 500 ₸', 'от 2500 ₸'];
const OLD_ELECTRONIC_PRICE_PATTERNS_EN = ['from ₸2,500', '₸2,500 per'];
const OLD_ELECTRONIC_PRICE_PATTERNS_KK = ['2 500 ₸ бастап', '2500 ₸ бастап'];

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

// Raw i18n key patterns — if these appear as values they were never resolved
const RAW_KEY_PATTERNS = [
  /pricingElectronic[A-Z]/,
  /pricingAgentStamp[A-Z]/,
  /pricingNotarizat/,
  /pricingFeature[A-Z]/,
  /landingPricing[A-Z]/,
  /commonPricing[A-Z]/,
  /servicePricing[A-Z]/,
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

    // UZ: forbidden Russian fallback phrases
    if (locale === 'uz') {
      const UZ_FORBIDDEN_RUSSIAN = [
        'Цены', 'Документы', 'Начать перевод', 'Электронный перевод',
        'Нотариальное', 'Поддерживаемые', 'Банковская выписка',
        'Стоимость перевода', 'Почему это важно', 'Финансовые документы',
        'Академические документы',
      ];
      const UZ_FORBIDDEN_ENGLISH = [
        'Simple pricing', 'per document', 'How it works', 'Use cases',
        'Supported document types', 'WHY WPO', 'HOW IT WORKS',
        'PRIVACY AND SECURITY', 'SUPPORTED DOCUMENTS', 'FINANCIAL DOCUMENTS',
        'ACADEMIC DOCUMENTS', 'DOCUMENTS FOR NOTARY PROCESS',
        'Upload document', 'Awaiting payment', 'Payment is being verified',
        'Card payments are processed', 'Accepted payment methods',
        'Cancellation & Refund', 'Reprocessing & Correction',
        'Pay {amount}', 'Payment successful', 'Payment not completed',
        'Go to Dashboard', 'Translation Service Levels',
        'When you use WPO Translations, we collect',
      ];
      for (const phrase of UZ_FORBIDDEN_RUSSIAN) {
        if (line.includes(phrase)) {
          fail(rel, ln, `Russian fallback in UZ locale: "${phrase}"`);
        }
      }
      for (const phrase of UZ_FORBIDDEN_ENGLISH) {
        if (line.includes(phrase)) {
          fail(rel, ln, `English fallback in UZ locale: "${phrase}"`);
        }
      }
    }

    // KY: forbidden Russian/English fallback phrases
    if (locale === 'ky') {
      const KY_FORBIDDEN_RUSSIAN = [
        'Цены', 'Документы', 'Начать перевод', 'Электронный перевод',
        'Нотариальное', 'Поддерживаемые', 'Банковская выписка',
        'Стоимость перевода', 'Почему это важно', 'Финансовые документы',
        'Академические документы',
      ];
      const KY_FORBIDDEN_ENGLISH = [
        'Simple pricing', 'per document', 'How it works', 'Use cases',
        'Supported document types', 'WHY WPO', 'HOW IT WORKS',
        'PRIVACY AND SECURITY', 'SUPPORTED DOCUMENTS', 'FINANCIAL DOCUMENTS',
        'ACADEMIC DOCUMENTS', 'DOCUMENTS FOR NOTARY PROCESS',
        'Upload document', 'Awaiting payment', 'Payment is being verified',
        'Card payments are processed', 'Accepted payment methods',
        'Cancellation & Refund', 'Reprocessing & Correction',
        'Pay {amount}', 'Payment successful', 'Payment not completed',
        'Go to Dashboard', 'Translation Service Levels',
        'When you use WPO Translations, we collect',
      ];
      const OLD_KY_PRICES = ['2 290 ₸', '2 590 ₸', '4 990 ₸', '12 990 ₸'];
      for (const phrase of KY_FORBIDDEN_RUSSIAN) {
        if (line.includes(phrase)) {
          fail(rel, ln, `Russian fallback in KY locale: "${phrase}"`);
        }
      }
      for (const phrase of KY_FORBIDDEN_ENGLISH) {
        if (line.includes(phrase)) {
          fail(rel, ln, `English fallback in KY locale: "${phrase}"`);
        }
      }
      if (PRICE_SENSITIVE_NAMESPACES.has(ns)) {
        for (const p of OLD_KY_PRICES) {
          if (line.includes(p)) fail(rel, ln, `Old price "${p}" in KY locale — update to 1 000 ₸ баштап`);
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
      // Old electronic-level prices (updated from 2500 → 1000)
      if (locale === 'ru') {
        for (const p of OLD_ELECTRONIC_PRICE_PATTERNS_RU) {
          if (line.includes(p)) fail(rel, ln, `Old electronic price "${p}" — update to 1 000 ₸`);
        }
      } else if (locale === 'en') {
        for (const p of OLD_ELECTRONIC_PRICE_PATTERNS_EN) {
          if (line.includes(p)) fail(rel, ln, `Old electronic price "${p}" — update to ₸1,000`);
        }
      } else if (locale === 'kk') {
        for (const p of OLD_ELECTRONIC_PRICE_PATTERNS_KK) {
          if (line.includes(p)) fail(rel, ln, `Old electronic price "${p}" — update to 1 000 ₸ бастап`);
        }
      } else if (locale === 'uz') {
        const OLD_UZ_PRICES = ['2 290 ₸', '2 590 ₸', '4 990 ₸', '12 990 ₸'];
        for (const p of OLD_UZ_PRICES) {
          if (line.includes(p)) fail(rel, ln, `Old price "${p}" in UZ locale — update to 1 000 ₸ dan`);
        }
      }
      // Subscription/monthly labels in pricing namespaces
      for (const term of SUBSCRIPTION_BANNED_IN_PRICING) {
        if (line.includes(term)) {
          fail(rel, ln, `Subscription/monthly label in pricing namespace: "${term}"`);
        }
      }
    }

    // Raw i18n key patterns: only flag when pattern appears as a JSON VALUE (after ": ")
    // This catches unresolved keys leaked into i18n values; not JSON key names themselves.
    const valueMatch = line.match(/:\s*"([^"]+)"/);
    if (valueMatch) {
      const value = valueMatch[1]!;
      for (const pattern of RAW_KEY_PATTERNS) {
        if (pattern.test(value)) {
          fail(rel, ln, `Raw i18n key pattern "${pattern}" appears as a VALUE — key was never resolved`);
        }
      }
    }

    // TH: forbidden Russian/English fallback phrases and dangerous Thai legal claims
    if (locale === 'th') {
      const TH_FORBIDDEN_RUSSIAN = [
        'Цены', 'Документы', 'Поддерживаемые', 'Начать перевод',
        'за документ', 'Электронный перевод', 'Перевод с печатью исполнителя',
        'Перевод с нотариальным заверением', 'Как это работает', 'Четыре шага',
        'Стоимость', 'Простая цена', 'Загрузите документ', 'Проверьте цену',
        'ИП WorldPrimeOnline', 'г. Алматы',
      ];
      // Check only the value portion to avoid false positives from JSON key names like "simplePricing"
      const TH_FORBIDDEN_ENGLISH = [
        'Simple pricing', ': "Pricing"', 'Supported documents', 'How it works',
        'Start translation', 'per document', 'Electronic translation',
        'Translation with provider stamp', 'Translation with notarization',
        'WPO solves this', 'Professional Document Translation',
        'THE PROBLEM', 'PROCESSING PIPELINE',
      ];
      const TH_DANGEROUS_PHRASES = [
        'รับรองโดยหน่วยงานรัฐ', 'รับรองอย่างเป็นทางการโดยรัฐบาล',
        'รับประกันผ่าน',
        'แปลรับรองโดย AI', 'การแปลที่ได้รับการรับรองโดย AI',
        'รับรองเอกสารอัตโนมัติ', 'โนตารี่อัตโนมัติ',
        'แปลโดยนักแปลสาบานตน',
      ];
      // Dangerous positive acceptance guarantee — only flag if NOT a negated disclaimer
      // Thai negation forms: ไม่รับประกัน / ไม่ได้รับประกัน / ไม่มีการรับประกัน
      const thHasNegatedAcceptance = line.includes('ไม่รับประกัน') ||
        line.includes('ไม่ได้รับประกัน') || line.includes('ไม่มีการรับประกัน');
      if (line.includes('รับประกันการยอมรับ') && !thHasNegatedAcceptance) {
        fail(rel, ln, `Dangerous Thai legal claim in TH locale: "รับประกันการยอมรับ" (without negation)`);
      }
      for (const phrase of TH_FORBIDDEN_RUSSIAN) {
        if (line.includes(phrase)) {
          fail(rel, ln, `Russian fallback in TH locale: "${phrase}"`);
        }
      }
      for (const phrase of TH_FORBIDDEN_ENGLISH) {
        if (line.includes(phrase)) {
          fail(rel, ln, `English fallback in TH locale: "${phrase}"`);
        }
      }
      for (const phrase of TH_DANGEROUS_PHRASES) {
        if (line.includes(phrase)) {
          fail(rel, ln, `Dangerous Thai legal claim in TH locale: "${phrase}"`);
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
