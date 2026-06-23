/**
 * One-time migration: split flat messages/{locale}.json into
 * messages/{locale}/{namespace}.json namespace files.
 *
 * Run: node scripts/i18n/migrate-to-namespaces.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const MESSAGES_DIR = path.join(ROOT, 'messages');

const LOCALES = ['ru', 'en', 'kk', 'zh', 'ko', 'tj', 'uz', 'tk', 'mn', 'ky', 'es'];

// Which top-level keys go into which namespace file
const NAMESPACE_MAP = {
  'navigation':    ['nav'],
  'home':          ['hero', 'howItWorks', 'documents', 'trust', 'faq', 'stats', 'cta', 'landing', 'pain', 'security', 'useCases'],
  'pricing':       ['pricing'],
  'landing-pages': ['kazakhstan', 'kazakhstanNotarized', 'kazakhstanUniversity', 'kazakhstanCertified',
                    'documentsHub', 'passportTranslation', 'diplomaTranslation', 'bankStatementTranslation'],
  'footer':        ['footer'],
  'auth':          ['auth'],
  'order':         ['dashboard'],
  'checkout':      ['payment', 'subscription', 'paymentCompliance', 'serviceTerms'],
  'legal':         ['legal', 'tos', 'privacyPage'],
  'common':        ['contactsPage', 'disclaimer'],
  'errors':        ['errors'],
};

// Reverse map: key → namespace file name
const KEY_TO_NS = {};
for (const [ns, keys] of Object.entries(NAMESPACE_MAP)) {
  for (const k of keys) KEY_TO_NS[k] = ns;
}

for (const locale of LOCALES) {
  const srcPath = path.join(MESSAGES_DIR, `${locale}.json`);
  if (!fs.existsSync(srcPath)) {
    console.warn(`⚠  ${srcPath} not found, skipping`);
    continue;
  }

  const flat = JSON.parse(fs.readFileSync(srcPath, 'utf-8'));
  const nsDir = path.join(MESSAGES_DIR, locale);
  fs.mkdirSync(nsDir, { recursive: true });

  const nsAccumulator = {};

  for (const [key, value] of Object.entries(flat)) {
    const ns = KEY_TO_NS[key];
    if (!ns) {
      console.warn(`  [${locale}] unknown key '${key}' → placed in common.json`);
      if (!nsAccumulator['common']) nsAccumulator['common'] = {};
      nsAccumulator['common'][key] = value;
      continue;
    }
    if (!nsAccumulator[ns]) nsAccumulator[ns] = {};
    nsAccumulator[ns][key] = value;
  }

  // Write namespace files
  for (const [ns, content] of Object.entries(nsAccumulator)) {
    const outPath = path.join(nsDir, `${ns}.json`);
    fs.writeFileSync(outPath, JSON.stringify(content, null, 2) + '\n', 'utf-8');
  }

  // Ensure all expected namespace files exist (even if empty for this locale)
  for (const ns of Object.keys(NAMESPACE_MAP)) {
    const outPath = path.join(nsDir, `${ns}.json`);
    if (!fs.existsSync(outPath)) {
      fs.writeFileSync(outPath, '{}\n', 'utf-8');
    }
  }

  const written = Object.keys(nsAccumulator).length;
  console.log(`✓  ${locale}: wrote ${written} namespace files → messages/${locale}/`);
}

console.log('\nMigration complete.');
