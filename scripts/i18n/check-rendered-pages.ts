#!/usr/bin/env tsx
/**
 * Rendered-page i18n audit.
 *
 * Fetches public pages from a running server and checks for language mismatches
 * (English text on RU/KK pages, Russian text on EN pages, raw i18n keys on any page).
 *
 * Usage:
 *   BASE_URL=http://localhost:3000 npm run i18n:rendered
 *   BASE_URL=https://staging.example.com npm run i18n:rendered
 *
 * If BASE_URL is not set, defaults to http://localhost:3000.
 */

const BASE_URL = process.env.BASE_URL?.replace(/\/$/, '') ?? 'http://localhost:3000';

// Public routes to check per locale
const PUBLIC_ROUTES = [
  '/',
  '/documents',
  '/documents/passport-translation',
  '/documents/diploma-translation',
  '/documents/bank-statement-translation',
  '/kazakhstan',
  '/kazakhstan/certified-translation',
  '/kazakhstan/notarized-translation',
  '/kazakhstan/university-document-translation',
];

// English UI phrases that should NOT appear on RU or KK pages
const EN_PHRASES_BANNED_ON_RU_KK = [
  'Simple pricing',
  'Supported Documents',
  'WPO solves this',
  'Why passport translation is needed',
  'Passport and ID document types supported',
  'Created for people',
  'Diploma translation pricing',
  'Bank statement translation pricing',
  'Pricing for academic document translation',
  'Four steps',
  'Upload your document',
  'Choose language',
  'Check the price',
  'Get your translation',
  'Biometric Passport',
  'National ID Card',
  'Travel Document',
  "Driver's License",
  'Residence Permit',
  // Generic English UI section labels (not proper nouns)
  'How it works',
  'Academic document types supported',
  'Bank and financial document types supported',
  // pricing section in English on RU/KK pages
  'per document',
  'from ₸',
  'Start translation',
];

// Russian UI phrases that should NOT appear on EN pages
const RU_PHRASES_BANNED_ON_EN = [
  'Стоимость',
  'Поддерживаемые',
  'Как это работает',
  'Загрузите документ',
  'Выберите язык',
  'Проверьте цену',
  'Начать перевод',
  'за документ',
  'Электронный перевод',
  'Нотариально заверенный',
  'нотариально',
  'нотариал',
  'заверен',
  // raw Russian section labels
  'ПОЧЕМУ ЭТО ВАЖНО',
  'ДОКУМЕНТЫ',
];

// Raw i18n key patterns — should never appear in rendered output
const RAW_KEY_PATTERNS = [
  /pricingElectronic[A-Za-z]/,
  /pricingAgentStamp[A-Za-z]/,
  /pricingNotariza/,
  /pricingFeature[A-Za-z]/,
  /TODO_I18N/,
  /MISSING_MESSAGE/,
  /MISSING_TRANSLATION/,
];

// Allowlist — these English words are OK even on RU/KK pages
const ALLOWLIST_ON_RU_KK = new Set([
  'WPO',
  'WPO Translations',
  'World Prime Online',
  'PDF',
  'DOCX',
  'AI/OCR',
  'Halyk ePay',
  'Visa',
  'Mastercard',
  '3D Secure',
  'Supabase',
  'Cloudflare R2',
  'Mistral AI',
  'Anthropic',
  'Vercel',
  'Resend',
  'Sentry',
  'OCR',
]);

interface PageResult {
  url: string;
  locale: string;
  route: string;
  errors: string[];
  status: number;
  fetchError?: string;
}

function extractTextContent(html: string): string {
  // Remove script, style, noscript, and metadata tags
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<head[\s\S]*?<\/head>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return stripped;
}

function isAllowlisted(phrase: string): boolean {
  for (const word of ALLOWLIST_ON_RU_KK) {
    if (phrase.includes(word)) return true;
  }
  return false;
}

async function checkPage(locale: string, route: string): Promise<PageResult> {
  // EN has no prefix; others have /{locale}
  const path = locale === 'en' ? route : `/${locale}${route}`;
  const url = `${BASE_URL}${path}`;
  const result: PageResult = { url, locale, route, errors: [], status: 0 };

  let html: string;
  try {
    const res = await fetch(url, {
      headers: { 'Accept': 'text/html', 'User-Agent': 'WPO-i18n-auditor/1.0' },
      signal: AbortSignal.timeout(15000),
    });
    result.status = res.status;
    if (!res.ok) {
      result.fetchError = `HTTP ${res.status}`;
      return result;
    }
    html = await res.text();
  } catch (err) {
    result.fetchError = String(err);
    return result;
  }

  const text = extractTextContent(html);

  // Check raw key patterns on all locales
  for (const pattern of RAW_KEY_PATTERNS) {
    if (pattern.test(text)) {
      result.errors.push(`RAW KEY: pattern ${pattern} found in rendered output`);
    }
  }

  if (locale === 'ru' || locale === 'kk') {
    for (const phrase of EN_PHRASES_BANNED_ON_RU_KK) {
      if (!isAllowlisted(phrase) && text.includes(phrase)) {
        result.errors.push(`ENGLISH ON ${locale.toUpperCase()}: "${phrase}"`);
      }
    }
  }

  if (locale === 'en') {
    for (const phrase of RU_PHRASES_BANNED_ON_EN) {
      if (text.includes(phrase)) {
        result.errors.push(`RUSSIAN ON EN: "${phrase}"`);
      }
    }
  }

  return result;
}

async function main() {
  const locales = ['ru', 'en', 'kk'];
  const allResults: PageResult[] = [];

  console.log(`\nWPO i18n Rendered-Page Audit`);
  console.log(`BASE_URL: ${BASE_URL}`);
  console.log(`Checking ${locales.length} locales × ${PUBLIC_ROUTES.length} routes = ${locales.length * PUBLIC_ROUTES.length} pages\n`);

  // Check all pages concurrently (batched to avoid overwhelming the server)
  const tasks: Array<() => Promise<PageResult>> = [];
  for (const locale of locales) {
    for (const route of PUBLIC_ROUTES) {
      tasks.push(() => checkPage(locale, route));
    }
  }

  // Run in batches of 5
  const BATCH = 5;
  for (let i = 0; i < tasks.length; i += BATCH) {
    const batch = tasks.slice(i, i + BATCH).map(fn => fn());
    const results = await Promise.all(batch);
    allResults.push(...results);
    for (const r of results) {
      const icon = r.fetchError ? '⚠' : r.errors.length > 0 ? '✗' : '✓';
      const detail = r.fetchError ?? (r.errors.length > 0 ? `${r.errors.length} error(s)` : 'ok');
      console.log(`  ${icon} [${r.locale}] ${r.route.padEnd(50)} ${detail}`);
    }
  }

  const errors = allResults.filter(r => r.errors.length > 0);
  const fetachErrors = allResults.filter(r => r.fetchError);

  console.log('\n=== Summary ===');
  console.log(`  Pages checked:  ${allResults.length}`);
  console.log(`  Fetch errors:   ${fetachErrors.length}`);
  console.log(`  Pages with i18n errors: ${errors.length}`);

  if (errors.length > 0) {
    console.log('\n=== i18n Errors ===');
    for (const r of errors) {
      console.log(`\n  [${r.locale}] ${r.url}`);
      for (const e of r.errors) {
        console.log(`    ✗ ${e}`);
      }
    }
    console.log('\n✗ i18n:rendered FAILED');
    process.exit(1);
  } else {
    console.log('\n✓ i18n:rendered passed');
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
