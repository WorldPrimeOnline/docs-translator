/**
 * i18n:hardcoded — Scans src/ for suspicious hardcoded UI strings in TSX/TS files.
 *
 * Ignores:
 *   - className, aria-*, data-* attributes
 *   - import/export statements
 *   - type/interface/enum names
 *   - console.log/warn/error
 *   - Technical strings: URLs, route paths, IDs, regex, hex colours
 *   - Brand names that should NOT be translated (WPO, Halyk, etc.)
 *   - Short strings (≤ 3 chars), pure numbers
 *
 * Reports strings likely to be user-facing UI text not wrapped in t().
 * Exit code 1 when suspicious strings found.
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../..');

const SCAN_DIRS = [
  path.join(ROOT, 'src/app'),
  path.join(ROOT, 'src/components'),
  path.join(ROOT, 'src/lib'),
];

// Strings containing these exact tokens are not user-facing
const IGNORE_CONTAINS = [
  '/api/', 'http://', 'https://', 'mailto:', 'tel:', 'sms:',
  'className', 'aria-', 'data-', 'key=', 'id=', 'name=', 'type=',
  'console.', 'import ', 'export ', 'require(',
  'TODO', 'FIXME', 'NOTE:', 'HACK:',
  '\\n', '\\t',
  '#', 'rgba(', 'rgb(', 'hsl(',
  'px', 'rem', 'em', 'vh', 'vw',
  '.json', '.ts', '.tsx', '.js', '.css', '.png', '.jpg', '.svg', '.pdf',
  'supabase', 'railway', 'vercel', 'cloudflare', 'r2',
];

// Brand names that MUST NOT be translated — fine as hardcoded
const BRAND_EXACT = new Set([
  'WPO', 'WPO Translations', 'World Prime Online', 'WorldPrime Online',
  'WorldPrimeOnline', 'Halyk ePay', 'Halyk', 'Visa', 'Mastercard',
  '3D Secure', 'Supabase', 'Cloudflare R2', 'Mistral AI', 'Anthropic',
  'Resend', 'Sentry', 'Vercel', 'Claude', 'Google', 'Next.js',
  'TypeScript', 'JavaScript', 'OCR', 'PDF', 'DOCX', 'HTML',
  'IIN', 'BIN', 'KZT', 'USD', 'ТОО', 'ИП',
]);

// Patterns that indicate non-UI strings
const SKIP_PATTERNS = [
  /^[A-Z_][A-Z0-9_]{2,}$/,   // ALL_CAPS constants
  /^[a-z][a-zA-Z]+$/,         // camelCase identifiers (short)
  /^[a-z-]+$/,                // kebab-case identifiers
  /^\d[\d.,\s%₸$€£¥]*$/,     // numbers / prices
  /^[a-f0-9]{6,}$/i,          // hex colour / hash
  /^\/[a-zA-Z/[\]{}]+$/,      // route patterns
  /^\[.*\]$/,                  // Next.js dynamic segments
  /^[A-Z_]+$/,                 // event names / constants
  /^https?:/,
  /^[a-zA-Z]+:\/\//,
];


let found = 0;

function shouldSkip(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 4) return true;
  if (BRAND_EXACT.has(trimmed)) return true;
  for (const p of SKIP_PATTERNS) { if (p.test(trimmed)) return true; }
  for (const tok of IGNORE_CONTAINS) { if (trimmed.toLowerCase().includes(tok.toLowerCase())) return true; }
  return false;
}

function scanFile(filePath: string): void {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const rel = path.relative(ROOT, filePath);

  lines.forEach((line, i) => {
    // Skip comments and import/export lines
    const trimLine = line.trim();
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
      trimLine.includes('console.') ||
      trimLine.includes('aria-label=') ||
      trimLine.includes('placeholder=') // often contains i18n keys passed as value
    ) return;

    // Flag Cyrillic text that's NOT wrapped in {t()} or similar
    // Pattern: JSX text content like ">Войти<" or ">Начать<" not wrapped in {}
    const cyrillicLiteralInJsx = />([А-Яа-яЁёҚқҒғЎўҲҳ][^<{]{3,})</g;
    let match: RegExpExecArray | null;
    while ((match = cyrillicLiteralInJsx.exec(line)) !== null) {
      const text = match[1].trim();
      if (text && !shouldSkip(text)) {
        console.log(`  ${rel}:${i + 1}  →  "${text}"`);
        found++;
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

for (const dir of SCAN_DIRS) {
  walkDir(dir);
}

console.log(`\n=== Summary ===`);
console.log(`Suspicious hardcoded strings found: ${found}`);

if (found > 0) {
  console.warn(`\n⚠ Review the above — they may be missing i18n wrappers.\n`);
  process.exit(1);
} else {
  console.log(`\n✓ No suspicious hardcoded UI text found\n`);
}
