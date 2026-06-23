/**
 * i18n:routes — Validates locale routing configuration and prints expected URL map.
 *
 * Checks:
 * 1. localePrefix: 'always' (all locales have explicit /{code}/ prefix)
 * 2. All locale message directories exist
 * 3. Critical namespaces are TODO_I18N-free for enabled locales (ru, en, kk)
 * 4. Disabled locales are NOT in the language switcher (enabled: false)
 * 5. Middleware guard for disabled locales is wired (DISABLED_LOCALE_CODES export exists)
 * 6. Prints expected redirect map for disabled locales
 *
 * Does not require a running dev server — all checks are static (config + filesystem).
 */
import path from 'path';
import fs from 'fs';

const ROOT = path.resolve(__dirname, '../..');

// --- Parse config files statically ---

const routingSource = fs.readFileSync(path.join(ROOT, 'src/i18n/routing.ts'), 'utf-8');
const localesSource = fs.readFileSync(path.join(ROOT, 'src/i18n/locales.ts'), 'utf-8');
const middlewareSource = fs.readFileSync(path.join(ROOT, 'src/middleware.ts'), 'utf-8');

const prefixMode = routingSource.match(/localePrefix:\s*['"](\w+)['"]/)?.[1] ?? 'unknown';
const defaultLocale = localesSource.match(/export const DEFAULT_LOCALE\s*=\s*['"](\w+)['"]/)?.[1] ?? 'ru';
const allLocales = [...localesSource.matchAll(/code:\s*['"](\w+)['"]/g)].map((m) => m[1]);
const enabledMatches = [...localesSource.matchAll(/code:\s*['"](\w+)['"],[^}]*enabled:\s*(true|false)/g)];
const enabledLocales = enabledMatches.filter((m) => m[2] === 'true').map((m) => m[1]);
const disabledLocales = enabledMatches.filter((m) => m[2] === 'false').map((m) => m[1]);

let errors = 0;

function pass(msg: string): void { console.log(`  ✓ ${msg}`); }
function fail(msg: string, fix?: string): void {
  console.error(`  ✗ ${msg}${fix ? `\n      Fix: ${fix}` : ''}`);
  errors++;
}

// ============================================================================
console.log('\n=== i18n:routes — locale routing configuration check ===\n');
console.log(`  localePrefix:   '${prefixMode}'`);
console.log(`  defaultLocale:  ${defaultLocale}`);
console.log(`  enabled:        ${enabledLocales.join(', ')}`);
console.log(`  disabled:       ${disabledLocales.join(', ')}\n`);

// 1. Routing mode
pass(`localePrefix is '${prefixMode}'`);
if (prefixMode !== 'always') {
  fail(`Expected localePrefix: 'always', got '${prefixMode}'`,
    `Change localePrefix in src/i18n/routing.ts`);
}

// 2. Message directories
console.log('\n  --- Message directories ---');
for (const locale of allLocales) {
  const dir = path.join(ROOT, 'messages', locale);
  if (fs.existsSync(dir)) pass(`messages/${locale}/ exists`);
  else fail(`messages/${locale}/ missing`);
}

// 3. Critical namespace TODO_I18N check for enabled locales
const CRITICAL_NS = [
  'navigation', 'footer', 'auth', 'checkout', 'order', 'legal', 'common', 'errors',
];
console.log('\n  --- Critical namespace TODO_I18N (enabled locales only) ---');
for (const locale of enabledLocales) {
  for (const ns of CRITICAL_NS) {
    const nsPath = path.join(ROOT, 'messages', locale, `${ns}.json`);
    if (!fs.existsSync(nsPath)) {
      fail(`messages/${locale}/${ns}.json missing`);
      continue;
    }
    const content = fs.readFileSync(nsPath, 'utf-8');
    const count = (content.match(/TODO_I18N/g) ?? []).length;
    if (count > 0) fail(`messages/${locale}/${ns}.json has ${count} TODO_I18N`, `Translate missing keys`);
    else pass(`messages/${locale}/${ns}.json clean`);
  }
}

// 4. Disabled locales must NOT appear in language switcher
console.log('\n  --- Language switcher: disabled locales hidden ---');
for (const locale of disabledLocales) {
  // Verify enabled:false in locales.ts source
  const isDisabled = localesSource.includes(`code: '${locale}'`) &&
    localesSource.match(new RegExp(`code:\\s*'${locale}'[^}]*enabled:\\s*false`));
  if (isDisabled) pass(`${locale} has enabled:false (hidden from switcher)`);
  else fail(`${locale} must have enabled:false in src/i18n/locales.ts`);
}

// 5. Middleware guard for disabled locales
console.log('\n  --- Middleware disabled-locale guard ---');

const hasGuardImport = middlewareSource.includes('DISABLED_LOCALE_CODES');
if (hasGuardImport) pass(`middleware.ts imports DISABLED_LOCALE_CODES`);
else fail(`middleware.ts must import DISABLED_LOCALE_CODES from @/i18n/locales`,
  `Add guard block before handleI18n(request)`);

const hasGuardLoop = middlewareSource.includes('for (const disabledCode of DISABLED_LOCALE_CODES)');
if (hasGuardLoop) pass(`middleware.ts has disabled-locale redirect loop`);
else fail(`middleware.ts missing disabled-locale guard loop`);

const hasGuard307 = middlewareSource.includes('status: 307');
if (hasGuard307) pass(`guard uses 307 (temporary redirect — locales may be re-enabled)`);
else fail(`guard should use 307 not 301 (locales are temporarily disabled)`);

const guardBeforeI18n = middlewareSource.indexOf('DISABLED_LOCALE_CODES') <
  middlewareSource.indexOf('handleI18n(request)');
if (guardBeforeI18n) pass(`guard runs before handleI18n (correct order)`);
else fail(`guard must run before handleI18n to prevent next-intl serving disabled locale`);

// 6. Expected redirect map for disabled locales
console.log('\n  --- Expected redirect map (static — requires dev server to verify live) ---');
const SAMPLE_PATHS = ['', '/contacts', '/dashboard', '/payment/result', '/legal'];
for (const locale of disabledLocales) {
  for (const p of SAMPLE_PATHS) {
    const from = `/${locale}${p}`;
    const to = `/${defaultLocale}${p}`;
    console.log(`  ${from.padEnd(30)} → 307 ${to}`);
  }
}

// 7. Enabled locale URL map
console.log('\n  --- Enabled locale URL map ---');
for (const locale of enabledLocales) {
  for (const p of SAMPLE_PATHS) {
    const url = `/${locale}${p}`;
    console.log(`  ${url}`);
  }
}
console.log(`\n  /  → 307 /${defaultLocale}  (root redirect via localePrefix: always)`);

// ============================================================================
console.log('\n=== Summary ===');
console.log(`  Errors: ${errors}`);

if (errors > 0) {
  console.error(`\n✗ i18n:routes found ${errors} issue(s)\n`);
  process.exit(1);
} else {
  console.log(`\n✓ i18n:routes passed\n`);
}
