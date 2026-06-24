/**
 * i18n:check — Validates all locale namespace files against the Russian master.
 *
 * Checks:
 * 1. All locales have the same keys as `ru` (missing keys reported)
 * 2. No extra keys in non-master locales
 * 3. No empty string values
 * 4. Interpolation variables {name}, {price}, {count}, {date}, etc. are preserved
 * 5. TODO_I18N markers are reported as warnings (not hard errors)
 *
 * Exit code 1 on structural errors. TODO_I18N markers are warnings only.
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const MESSAGES_DIR = path.join(ROOT, 'messages');
const MASTER_LOCALE = 'ru';
const LOCALES = ['ru', 'en', 'kk', 'zh', 'ko', 'tj', 'uz', 'tk', 'mn', 'ky', 'es'];
const NAMESPACES = [
  'navigation', 'home', 'pricing', 'landing-pages',
  'footer', 'auth', 'order', 'checkout', 'legal', 'common', 'errors',
];

// strict mode: TODO_I18N in these namespaces for critical locales is an error
const STRICT_MODE = process.argv.includes('--strict');
const CRITICAL_NAMESPACES = new Set([
  'navigation', 'home', 'pricing', 'footer', 'auth',
  'order', 'checkout', 'legal', 'common', 'errors',
]);
const CRITICAL_LOCALES = new Set(['ru', 'en', 'kk']);

const VAR_PATTERN = /\{[a-zA-Z_][a-zA-Z0-9_]*\}/g;

let errors = 0;
let warnings = 0;

function err(msg: string) { console.error(`  ✗ ERROR: ${msg}`); errors++; }
function warn(msg: string) { console.warn(`  ⚠ WARN:  ${msg}`); warnings++; }
function ok(msg: string)   { console.log(`  ✓ ${msg}`); }

function flatten(obj: unknown, prefix = ''): Record<string, string> {
  const result: Record<string, string> = {};
  if (typeof obj !== 'object' || obj === null) {
    if (prefix) result[prefix] = String(obj);
    return result;
  }
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const fullKey = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
      Object.assign(result, flatten(v, fullKey));
    } else if (Array.isArray(v)) {
      // Arrays of objects (FAQ items, etc.) — flatten each element
      (v as unknown[]).forEach((item, i) => {
        Object.assign(result, flatten(item, `${fullKey}[${i}]`));
      });
    } else {
      result[fullKey] = String(v ?? '');
    }
  }
  return result;
}

function loadNamespace(locale: string, ns: string): Record<string, string> | null {
  const p = path.join(MESSAGES_DIR, locale, `${ns}.json`);
  if (!fs.existsSync(p)) return null;
  try {
    return flatten(JSON.parse(fs.readFileSync(p, 'utf-8')));
  } catch {
    err(`Cannot parse ${locale}/${ns}.json`);
    return null;
  }
}

console.log(`\n=== i18n:check${STRICT_MODE ? ':strict' : ''} — master: ${MASTER_LOCALE} ===\n`);
if (STRICT_MODE) {
  console.log(`  Strict mode: TODO_I18N in [${[...CRITICAL_LOCALES].join(',')}] × [${[...CRITICAL_NAMESPACES].join(',')}] → ERROR\n`);
}

// Load master
const master: Record<string, Record<string, string>> = {};
for (const ns of NAMESPACES) {
  const data = loadNamespace(MASTER_LOCALE, ns);
  if (!data) { err(`Missing master namespace: ${MASTER_LOCALE}/${ns}.json`); continue; }
  master[ns] = data;
}

// Check each non-master locale
for (const locale of LOCALES.filter((l) => l !== MASTER_LOCALE)) {
  console.log(`--- ${locale} ---`);
  let nsErrors = 0;
  for (const ns of NAMESPACES) {
    const masterKeys = master[ns] ?? {};
    const localeKeys = loadNamespace(locale, ns);
    if (!localeKeys) {
      err(`Missing ${locale}/${ns}.json`);
      nsErrors++;
      continue;
    }

    const masterKeySet = new Set(Object.keys(masterKeys));
    const localeKeySet = new Set(Object.keys(localeKeys));

    // Missing keys
    for (const k of masterKeySet) {
      if (!localeKeySet.has(k)) {
        err(`[${locale}/${ns}] missing key: ${k}`);
        nsErrors++;
      }
    }

    // Extra keys
    for (const k of localeKeySet) {
      if (!masterKeySet.has(k)) {
        warn(`[${locale}/${ns}] extra key not in master: ${k}`);
      }
    }

    // Value checks
    for (const [k, v] of Object.entries(localeKeys)) {
      if (!masterKeySet.has(k)) continue;

      if (v === '' || v === null || v === undefined) {
        err(`[${locale}/${ns}] empty value for key: ${k}`);
        nsErrors++;
        continue;
      }

      if (v.includes('TODO_I18N')) {
        const isStrictViolation = STRICT_MODE && CRITICAL_LOCALES.has(locale) && CRITICAL_NAMESPACES.has(ns);
        if (isStrictViolation) {
          err(`[${locale}/${ns}] TODO_I18N in critical locale+namespace: ${k}`);
          nsErrors++;
        } else {
          warn(`[${locale}/${ns}] TODO_I18N: ${k}`);
        }
      }

      // Check interpolation variables match master
      const masterVal = masterKeys[k] ?? '';
      const masterVars = new Set(masterVal.match(VAR_PATTERN) ?? []);
      const localeVars = new Set(v.match(VAR_PATTERN) ?? []);

      for (const mv of masterVars) {
        if (!localeVars.has(mv)) {
          err(`[${locale}/${ns}] key "${k}" missing variable ${mv} (master has it)`);
          nsErrors++;
        }
      }
    }
  }

  if (nsErrors === 0) ok(`${locale}: no structural errors`);
}

console.log(`\n=== Summary ===`);
console.log(`Errors:   ${errors}`);
console.log(`Warnings: ${warnings} (TODO_I18N + extra keys)`);

const label = STRICT_MODE ? 'i18n:check:strict' : 'i18n:check';
if (errors > 0) {
  console.error(`\n✗ ${label} FAILED with ${errors} error(s)\n`);
  process.exit(1);
} else {
  console.log(`\n✓ ${label} passed\n`);
}
