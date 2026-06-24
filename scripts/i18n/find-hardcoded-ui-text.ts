/**
 * i18n:hardcoded — Scans src/ for suspicious hardcoded UI strings in TSX/TS files.
 *
 * Catches:
 *   - Cyrillic text in JSX render output not wrapped in {t()}
 *   - English UI copy in JSX text nodes (>Word word word<)
 *   - Hardcoded title=, alt=, placeholder=, aria-label= with user-facing text
 *   - Toast/validation/error messages in string literals
 *
 * Ignores:
 *   - className, CSS classes, route paths, IDs, URLs
 *   - Imports/exports, type declarations
 *   - Technical constants (ALL_CAPS, camelCase short)
 *   - Brand names: WPO, Halyk ePay, Visa, Mastercard, Supabase, etc.
 *   - console.log/debug strings
 *
 * Severity:
 *   - ERROR: Cyrillic text in JSX render, clear UI copy
 *   - WARNING: English text that might be UI copy (manual review needed)
 *
 * i18n:validate fails on ERRORs only.
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../..');

const SCAN_DIRS = [
  path.join(ROOT, 'src/app'),
  path.join(ROOT, 'src/components'),
];

const BRAND_EXACT = new Set([
  'WPO', 'WPO Translations', 'World Prime Online', 'WorldPrime Online',
  'Halyk ePay', 'Halyk', 'Visa', 'Mastercard', '3D Secure',
  'Supabase', 'Cloudflare R2', 'Mistral AI', 'Anthropic',
  'Resend', 'Sentry', 'Vercel', 'Claude', 'Google', 'Next.js',
  'TypeScript', 'JavaScript', 'OCR', 'PDF', 'DOCX', 'HTML',
  'IIN', 'BIN', 'KZT', 'USD', 'ТОО', 'ИП', 'OK',
]);

const SKIP_PATTERNS = [
  /^[A-Z_][A-Z0-9_]{2,}$/,     // ALL_CAPS constants
  /^[a-z][a-zA-Z]+$/,           // camelCase identifier
  /^[a-z-]+$/,                  // kebab-case identifier
  /^\d[\d.,\s%₸$€£¥]*$/,       // numbers / prices
  /^[a-f0-9]{6,}$/i,            // hex
  /^\/[a-zA-Z/[\]{}]+$/,        // route pattern
  /^\[.*\]$/,                    // dynamic segment
  /^[A-Z][a-zA-Z]+[A-Z][a-zA-Z]+$/, // PascalCase component names
  /^https?:/,
];

const IGNORE_CONTAINS = [
  '/api/', 'http://', 'https://', 'mailto:', 'tel:', 'sms:',
  'className', 'data-', 'key=', 'id=', 'type=',
  'console.', 'import ', 'export ',
  '#', 'rgba(', 'rgb(', 'hsl(',
  '.json', '.ts', '.tsx', '.js', '.css', '.png', '.jpg', '.svg', '.pdf',
  'supabase', 'railway', 'vercel', 'cloudflare',
  'TODO', 'FIXME',
];

let errors = 0;
let warnings = 0;

function shouldSkip(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 4) return true;
  if (BRAND_EXACT.has(trimmed)) return true;
  for (const p of SKIP_PATTERNS) { if (p.test(trimmed)) return true; }
  for (const tok of IGNORE_CONTAINS) {
    if (trimmed.toLowerCase().includes(tok.toLowerCase())) return true;
  }
  return false;
}

const CYRILLIC_IN_JSX = />([А-Яа-яЁёҚқҒғЎўҲҳҮүҺһ][^<{]{3,})</g;

// English text in JSX text nodes: >Two or more words<
// Catches: ">Submit document<", ">Download translation<", etc.
const ENGLISH_IN_JSX = />([A-Z][a-z][a-zA-Z\s]{5,})</g;

// Hardcoded attribute values that should be i18n
// title="...", alt="...", placeholder="...", aria-label="..."
const HARDCODED_ATTR = /(?:title|alt|placeholder|aria-label)=\{?"([А-Яа-яЁёA-Za-z][^"]{5,})"\}?/g;

// String literals that look like toast / validation / error messages
// Heuristic: has 3+ words, starts with capital, is in a JS/TS expression context
const TOAST_LIKE = /(?:toast|notify|alert|setError|addToast)\s*\(\s*["']([А-Яа-яA-Za-z][^"']{10,})["']/g;

function scanFile(filePath: string): void {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const rel = path.relative(ROOT, filePath);

  lines.forEach((line, i) => {
    const trimLine = line.trim();

    // Skip obvious non-UI lines
    if (
      trimLine.startsWith('//') ||
      trimLine.startsWith('*') ||
      trimLine.startsWith('/*') ||
      trimLine.startsWith('import ') ||
      trimLine.startsWith('export type') ||
      trimLine.startsWith('export interface') ||
      trimLine.startsWith('interface ') ||
      trimLine.startsWith('type ') ||
      trimLine.includes('className=') ||
      trimLine.includes('console.')
    ) return;

    // --- ERROR: Cyrillic text in JSX text node ---
    CYRILLIC_IN_JSX.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = CYRILLIC_IN_JSX.exec(line)) !== null) {
      const text = m[1].trim();
      if (!shouldSkip(text)) {
        console.error(`  ERROR  ${rel}:${i + 1}  →  "${text.slice(0, 80)}"`);
        errors++;
      }
    }

    // --- WARNING: English text in JSX text node ---
    ENGLISH_IN_JSX.lastIndex = 0;
    while ((m = ENGLISH_IN_JSX.exec(line)) !== null) {
      const text = m[1].trim();
      // Must look like a sentence (has a space) and not be a component name
      if (text.includes(' ') && !shouldSkip(text)) {
        console.warn(`  WARN   ${rel}:${i + 1}  →  "${text.slice(0, 80)}"`);
        warnings++;
      }
    }

    // --- ERROR: Hardcoded title/alt/placeholder/aria-label ---
    HARDCODED_ATTR.lastIndex = 0;
    while ((m = HARDCODED_ATTR.exec(line)) !== null) {
      const text = m[1].trim();
      if (!shouldSkip(text)) {
        console.error(`  ERROR  ${rel}:${i + 1}  →  attribute "${text.slice(0, 80)}"`);
        errors++;
      }
    }

    // --- WARNING: Toast/error messages ---
    TOAST_LIKE.lastIndex = 0;
    while ((m = TOAST_LIKE.exec(line)) !== null) {
      const text = m[1].trim();
      if (!shouldSkip(text)) {
        console.warn(`  WARN   ${rel}:${i + 1}  →  toast/error: "${text.slice(0, 80)}"`);
        warnings++;
      }
    }
  });
}

function walkDir(dir: string): void {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      if (['node_modules', '.next', 'dist', '__tests__'].includes(entry)) continue;
      walkDir(full);
    } else if (entry.endsWith('.tsx') || entry.endsWith('.ts')) {
      scanFile(full);
    }
  }
}

console.log('\n=== i18n:hardcoded — scanning for hardcoded UI text ===\n');
console.log('  Scanning: src/app, src/components\n');

for (const dir of SCAN_DIRS) {
  walkDir(dir);
}

console.log(`\n=== Summary ===`);
console.log(`  ERRORs (must fix):    ${errors}`);
console.log(`  WARNINGs (review):    ${warnings}`);

if (errors > 0) {
  console.error(`\n✗ Found ${errors} hardcoded string(s) that must be moved to i18n\n`);
  process.exit(1);
} else if (warnings > 0) {
  console.warn(`\n⚠ Found ${warnings} warning(s) — review manually, may be intentional\n`);
} else {
  console.log(`\n✓ No obvious hardcoded UI text found\n`);
}
