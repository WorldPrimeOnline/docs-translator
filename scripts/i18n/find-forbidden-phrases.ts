/**
 * i18n:forbidden — Scans all message files, pages, and components for forbidden phrases.
 *
 * Forbidden phrases imply false guarantees or legally problematic claims about translation services.
 * See CLAUDE.md §9 for context.
 *
 * Two independent rule sets:
 *  - FORBIDDEN: false-promise / legally risky claims. Applies everywhere, including legal
 *    content — a legal document is not exempt from "guaranteed accepted" either.
 *  - AI_MARKETING_FORBIDDEN: AI-translator-style brand positioning (2026-07-13 cleanup —
 *    WPO must not read as an AI translator/GPT-wrapper). Applies to marketing/UI/metadata
 *    only. Plain, honest infrastructure disclosure ("uses OCR and AI to prepare a draft";
 *    Official requires human review) is legitimate and deliberately NOT forbidden anywhere —
 *    see docs/ai-context/DECISIONS.md. Excluded from this rule set via AI_MARKETING_ALLOWLIST:
 *    legal/consent/privacy/terms content (required by law to name subprocessors — Mistral AI,
 *    Anthropic — and disclose AI/OCR processing in full) and server-only API route handlers
 *    (src/app/api/**, which never render marketing copy).
 *
 * Exit code 1 when any forbidden phrase is found.
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../..');

const LOCALES = ['ru', 'en', 'kk', 'zh', 'ko', 'tj', 'uz', 'tk', 'mn', 'ky', 'es', 'th', 'de', 'tr'];

const SCAN_DIRS = [
  // Scan namespace subdirectories only (messages/{locale}/*.json), not the orphaned flat files
  ...LOCALES.map((l) => path.join(ROOT, 'messages', l)),
  path.join(ROOT, 'src/app'),
  path.join(ROOT, 'src/components'),
  path.join(ROOT, 'src/lib/legal'),
  path.join(ROOT, 'src/lib/landing-pages'),
  path.join(ROOT, 'src/lib/seo'),
];

// Legal/consent/privacy/terms content is required to name subprocessors and disclose
// AI/OCR processing — exempt (only) from AI_MARKETING_FORBIDDEN, not from FORBIDDEN.
// Server-only API route handlers (src/app/api/**) never render marketing copy — internal
// error messages / vendor names there are infrastructure, not public positioning.
// Both are explicit, narrow allowlists rather than excluding entire directories.
const AI_MARKETING_ALLOWLIST = new Set([
  path.join(ROOT, 'src/lib/legal'),
  ...LOCALES.map((l) => path.join(ROOT, 'messages', l, 'legal.json')),
  path.join(ROOT, 'src/app/api'),
]);

function isAiMarketingAllowlisted(filePath: string): boolean {
  return [...AI_MARKETING_ALLOWLIST].some(
    (allowed) => filePath === allowed || filePath.startsWith(allowed + path.sep),
  );
}

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

  // ── NEW: phrases that falsely describe ALL WPO translations as not certified/notarized ──
  // English patterns
  ['not certified or notarized',              /not certified or notarized/i],
  ['not certified, notarized, sworn',         /not certified,\s*notarized,\s*sworn/i],
  ['all translations are unofficial',         /all translations are unofficial/i],
  ['WPO provides unofficial translations',    /WPO provides unofficial translations/i],
  ['our translations are unofficial',         /our translations are unofficial/i],
  ['translations are unofficial and for info',/translations are unofficial and for informational/i],
  ['WPO translations are unofficial',         /WPO translations are unofficial/i],
  ['not an official translation',             /not an official translation/i],

  // Russian patterns
  ['не является нотариально',   /не является нотариально/i],
  ['не является нотариальным',  /не является нотариальным/i],
  ['не нотариальн',             /не нотариальн/i],
  ['не является заверенным',    /не является заверенным/i],
  ['не сертифицировано',        /не сертифицировано/i],
  ['не заверенный перевод',     /не заверенный перевод/i],

  // Kazakh patterns
  ['барлық аудармалар бейресми', /[Бб]арлық аудармалар бейресми/],
  ['аудармаларымыз бейресми',    /[Аа]удармаларымыз бейресми/],
  ['куәландырылмаған және нотариалды расталмаған', /куәландырылмаған және нотариалды расталмаған/],
];

// AI-translator-style brand positioning — forbidden in marketing/UI/metadata, allowlisted
// for legal/backend content (see AI_MARKETING_ALLOWLIST above). These target BRANDING
// artifacts, not the word "AI"/"ИИ" in general — plain informational disclosure ("uses OCR
// and AI to prepare a draft") is intentionally not matched by any of these patterns.
const AI_MARKETING_FORBIDDEN: Array<[string, RegExp]> = [
  ['AI Document Translation branding', /AI\s+Document\s+Translation/i],
  ['AI-powered branding',        /AI[\s-]powered/i],
  ['powered by AI branding',     /powered\s+by\s+AI/i],
  ['AI translator branding',     /\bAI\s+translator\b/i],
  ['AI/OCR feature-label branding', /AI\/OCR/i],
  // Cyrillic word-final "-ии" (e.g. "наличии переводчика") must not false-positive as
  // "ИИ-переводчик" — require ИИ not be preceded by a Cyrillic letter.
  ['ИИ-переводчик branding',     /(?<![а-яёА-ЯЁ])ИИ[\s-]переводчик/i],
  ['ИИ-перевод branding',        /(?<![а-яёА-ЯЁ])ИИ[\s-]перевод\b/i],
  ['на базе ИИ branding',        /на\s+базе\s+(?<![а-яёА-ЯЁ])ИИ\b/i],
  ['neural network branding',    /\bneural\s+network\b/i],
  ['нейросеть branding',         /нейросет/i],
  ['machine translation branding', /\bmachine\s+translation\b/i],
  ['машинный перевод branding',  /машинн\w*\s+перевод/i],
  ['Mistral vendor name in marketing', /\bMistral\b/],
  ['Claude vendor name in marketing',  /\bClaude\b/],
  ['GPT vendor name in marketing',     /\bGPT\b/],
];

let found = 0;

function scanFile(filePath: string): void {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const rel = path.relative(ROOT, filePath);

  const rules = isAiMarketingAllowlisted(filePath)
    ? FORBIDDEN
    : [...FORBIDDEN, ...AI_MARKETING_FORBIDDEN];

  for (const [label, pattern] of rules) {
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
