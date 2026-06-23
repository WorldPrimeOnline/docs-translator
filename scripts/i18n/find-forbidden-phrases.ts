/**
 * i18n:forbidden — Scans all message files, pages, and components for forbidden phrases.
 *
 * Forbidden phrases imply false guarantees or legally problematic claims about translation services.
 * See CLAUDE.md §9 for context.
 *
 * Exit code 1 when any forbidden phrase is found.
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../..');

const SCAN_DIRS = [
  // Scan namespace subdirectories only (messages/{locale}/*.json), not the orphaned flat files
  ...['ru', 'en', 'kk', 'zh', 'ko', 'tj', 'uz', 'tk', 'mn', 'ky', 'es'].map(
    (l) => path.join(ROOT, 'messages', l),
  ),
  path.join(ROOT, 'src/app'),
  path.join(ROOT, 'src/components'),
  path.join(ROOT, 'src/lib/legal'),
];

const SCAN_EXTENSIONS = new Set(['.json', '.tsx', '.ts', '.mdx', '.md']);

// Each entry: [display label, RegExp]
const FORBIDDEN: Array<[string, RegExp]> = [
  ['guaranteed accepted',              /guaranteed\s+accepted/i],
  ['guaranteed approval',              /guaranteed\s+approval/i],
  ['AI certified translation',         /ai[\s-]certified\s+translation/i],
  ['AI certified',                     /ai[\s-]certified(?!\s+translat)/i],
  ['automatic notarization',           /automatic\s+notarizati/i],
  ['automatic certified translation',  /automatic\s+certified\s+translat/i],
  ['автоматическое нотариальное заверение', /автоматическое\s+нотариальное\s+завер/i],
  ['гарантированное принятие',         /гарантированное\s+принятие/i],
  ['гарантированное одобрение',        /гарантированное\s+одобрение/i],
  ['сертифицированный AI-перевод',     /сертифицированный\s+ai[\s-]перевод/i],
  ['нотариальное заверение автоматически', /нотариальное\s+завер\w+\s+автоматически/i],
  // Extra defensive patterns
  ['гарантируем принятие',             /гарантируем\s+принятие/i],
  ['guaranteed to be accepted',        /guaranteed\s+to\s+be\s+accepted/i],
  ['notarization automatically',       /notarizati\w+\s+automatically/i],
];

let found = 0;

function scanFile(filePath: string): void {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const rel = path.relative(ROOT, filePath);

  for (const [label, pattern] of FORBIDDEN) {
    lines.forEach((line, i) => {
      if (pattern.test(line)) {
        console.error(`  ✗ [${label}]  ${rel}:${i + 1}`);
        console.error(`      → ${line.trim()}`);
        found++;
      }
    });
  }
}

function walkDir(dir: string): void {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      if (['node_modules', '.next', 'dist'].includes(entry)) continue;
      walkDir(full);
    } else if (SCAN_EXTENSIONS.has(path.extname(entry))) {
      scanFile(full);
    }
  }
}

console.log('\n=== i18n:forbidden — scanning for forbidden phrases ===\n');

for (const dir of SCAN_DIRS) {
  walkDir(dir);
}

console.log(`\n=== Summary ===`);
if (found > 0) {
  console.error(`\n✗ Found ${found} forbidden phrase(s). Remove them before shipping.\n`);
  process.exit(1);
} else {
  console.log(`\n✓ No forbidden phrases found\n`);
}
