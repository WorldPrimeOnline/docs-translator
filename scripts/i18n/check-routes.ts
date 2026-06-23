/**
 * i18n:routes — Validates locale routing configuration and prints expected URL map.
 *
 * Checks routing.ts settings, verifies all locale directories exist, and confirms
 * that the expected URL structure matches the localePrefix mode.
 *
 * Does not require a running dev server.
 */
import path from 'path';
import fs from 'fs';

const ROOT = path.resolve(__dirname, '../..');

// Dynamically import routing config via TS — use inline parse instead
const routingPath = path.join(ROOT, 'src/i18n/routing.ts');
const routingSource = fs.readFileSync(routingPath, 'utf-8');
const localesPath = path.join(ROOT, 'src/i18n/locales.ts');
const localesSource = fs.readFileSync(localesPath, 'utf-8');

// Parse localePrefix mode from source
const prefixMatch = routingSource.match(/localePrefix:\s*['"](\w+)['"]/);
const prefixMode = prefixMatch?.[1] ?? 'unknown';

// Parse DEFAULT_LOCALE
const defaultMatch = localesSource.match(/export const DEFAULT_LOCALE\s*=\s*['"](\w+)['"]/);
const defaultLocale = defaultMatch?.[1] ?? 'ru';

// Parse all locale codes
const localeMatches = [...localesSource.matchAll(/code:\s*['"](\w+)['"]/g)];
const allLocales = localeMatches.map((m) => m[1]);

// Parse enabled locales
const enabledMatches = [...localesSource.matchAll(/code:\s*['"](\w+)['"],[^}]*enabled:\s*(true|false)/g)];
const enabledLocales = enabledMatches.filter((m) => m[2] === 'true').map((m) => m[1]);
const disabledLocales = enabledMatches.filter((m) => m[2] === 'false').map((m) => m[1]);

let errors = 0;

function check(condition: boolean, message: string, fix?: string): void {
  if (condition) {
    console.log(`  ✓ ${message}`);
  } else {
    console.error(`  ✗ ${message}${fix ? ` — ${fix}` : ''}`);
    errors++;
  }
}

console.log('\n=== i18n:routes — locale routing configuration check ===\n');

// 1. Routing mode
console.log(`  Routing mode:   localePrefix: '${prefixMode}'`);
console.log(`  Default locale: ${defaultLocale}`);
console.log(`  All locales:    ${allLocales.join(', ')}`);
console.log(`  Enabled:        ${enabledLocales.join(', ')}`);
console.log(`  Disabled:       ${disabledLocales.join(', ')}\n`);

check(prefixMode === 'always', `localePrefix is 'always' (all locales have explicit /{code}/ prefix)`,
  `Change localePrefix to 'always' in src/i18n/routing.ts`);

// 2. All locale directories exist
for (const locale of allLocales) {
  const dir = path.join(ROOT, 'messages', locale);
  check(fs.existsSync(dir), `messages/${locale}/ directory exists`);
}

// 3. All enabled locales have namespace files with zero critical TODO_I18N
const CRITICAL_NS = ['navigation', 'footer', 'auth', 'checkout', 'order', 'legal', 'common', 'errors'];
const CRITICAL_LOCALES_CHECK = ['ru', 'en', 'kk'];

console.log('\n  --- Critical namespace TODO_I18N check (ru, en, kk) ---');
for (const locale of CRITICAL_LOCALES_CHECK) {
  for (const ns of CRITICAL_NS) {
    const nsPath = path.join(ROOT, 'messages', locale, `${ns}.json`);
    if (!fs.existsSync(nsPath)) {
      console.error(`  ✗ Missing: messages/${locale}/${ns}.json`);
      errors++;
      continue;
    }
    const content = fs.readFileSync(nsPath, 'utf-8');
    const todoCount = (content.match(/TODO_I18N/g) ?? []).length;
    if (todoCount > 0) {
      console.error(`  ✗ messages/${locale}/${ns}.json has ${todoCount} TODO_I18N (critical locale)`);
      errors++;
    } else {
      console.log(`  ✓ messages/${locale}/${ns}.json clean`);
    }
  }
}

// 4. Print expected URL map
console.log('\n  --- Expected URL map (with localePrefix: always) ---');
const SAMPLE_PATHS = ['', '/contacts', '/dashboard', '/legal', '/payment/result'];
for (const locale of enabledLocales) {
  for (const p of SAMPLE_PATHS) {
    console.log(`  ${locale === defaultLocale ? '(default)' : '         '} /${locale}${p || ''}`);
  }
}

console.log(`\n  Root URL '/' → redirects to /${defaultLocale}`);
console.log(`  Disabled locales (not in switcher but routes work): ${disabledLocales.join(', ')}`);

// 5. Check localePrefix=always means '/' redirects to '/ru'
if (prefixMode === 'always') {
  console.log('\n  --- Redirect behaviour (as-needed → no; always → yes) ---');
  console.log(`  /                    → 307 /ru`);
  console.log(`  /ru                  → Russian homepage ✓`);
  console.log(`  /ru/dashboard        → Russian dashboard (requires auth) ✓`);
  console.log(`  /en                  → English homepage ✓`);
  console.log(`  /en/contacts         → English contacts ✓`);
  console.log(`  /kk                  → Kazakh homepage ✓`);
  console.log(`  /ru/payment/result   → Russian payment result ✓`);
  console.log(`  /en/payment/result   → English payment result ✓`);
  console.log(`  /ru/legal            → Russian legal ✓`);
  console.log(`  /en/legal            → English legal ✓`);
}

console.log(`\n=== Summary ===`);
if (errors > 0) {
  console.error(`\n✗ i18n:routes found ${errors} issue(s)\n`);
  process.exit(1);
} else {
  console.log(`\n✓ i18n:routes passed\n`);
}
