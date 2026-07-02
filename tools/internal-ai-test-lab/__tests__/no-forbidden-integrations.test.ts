/**
 * Static safeguard: proves (by source inspection, not just intent-in-comments)
 * that the Internal AI Translation Test Lab never references the modules or
 * functions that would create a payment, fiscal receipt, Jira issue, or a
 * normal customer job/order.
 *
 * This mirrors the existing convention in
 * worker/src/__tests__/index.startup.test.ts (source-text assertions), which
 * is a cheap, reliable way to catch an accidental forbidden import without
 * needing a live database or mocked SDKs.
 *
 * Checks are structural (import/require/dynamic-import specifiers, and
 * call-sites with parens) rather than bare substrings, so that this tool's
 * own safety documentation — e.g. the `createJira: false` context field, or
 * prose comments naming `saveQuote()` as a function this file deliberately
 * never calls — does not trip a false positive.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const TOOL_DIR = path.join(__dirname, '..');

function readAllToolSources(): { file: string; content: string }[] {
  const out: { file: string; content: string }[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'runs' || entry.name === 'input' || entry.name === 'node_modules') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
        out.push({ file: path.relative(TOOL_DIR, full), content: fs.readFileSync(full, 'utf-8') });
      }
    }
  };
  walk(TOOL_DIR);
  return out;
}

/** Strips /* *‍/ and // comments (best-effort; preserves `https://` inside strings). */
function stripComments(src: string): string {
  const noBlockComments = src.replace(/\/\*[\s\S]*?\*\//g, '');
  return noBlockComments
    .split('\n')
    .map((line) => line.replace(/(?<!:)\/\/.*$/, ''))
    .join('\n');
}

// Forbidden import/require/dynamic-import specifiers — matches only when one
// of these words appears in a module path being imported, not an arbitrary
// identifier or comment.
const FORBIDDEN_IMPORT_RE =
  /\b(?:from|require|import)\s*\(?['"][^'"]*\b(halyk|webkassa|jira|resend|google-drive|telegram|ofd-|fiscal-processor|fiscal-z-report|integrations)\b[^'"]*['"]/i;

// Forbidden call sites (writer functions) — matched with a trailing "(" so
// property/type-field names like `createFiscalReceipt: false` never match.
const FORBIDDEN_CALL_SITES = [
  'savequote(',
  'markquotepaid(',
  'markquotepaymentpending(',
  'verifyquotepayable(',
  'createsalereceiptforpayment(',
  'createrefundreceiptforrefund(',
  'createfiscalreceipt(',
  'createjiraissue(',
  'initializeorderintegrations(',
  'triggertranslatorreview(',
  'sendtranslationready(',
  'senddocumentreceivedforreview(',
];

// Forbidden direct table writes — specific enough that prose documentation
// (which describes tables in words, not as `.from('table')` code) won't match.
const FORBIDDEN_TABLE_WRITES = [
  ".from('jobs')",
  ".from('documents')",
  ".from('translations')",
  ".from('price_quotes')",
  ".from('price_quote_items')",
  ".from('cost_reservations')",
  ".from('payment_transactions')",
  ".from('fiscal_receipts')",
  ".from('refund_transactions')",
];

describe('no-forbidden-integrations', () => {
  const sources = readAllToolSources();

  it('found at least the main orchestrator + lib files (sanity check the scan itself works)', () => {
    expect(sources.some((s) => s.file === 'run-ai-translation-test.ts')).toBe(true);
    expect(sources.length).toBeGreaterThan(5);
  });

  for (const { file, content } of sources) {
    const code = stripComments(content);
    const lower = code.toLowerCase();

    it(`${file} does not import Halyk/Webkassa/Jira/Resend/Drive/Telegram/fiscal-processor modules`, () => {
      expect(FORBIDDEN_IMPORT_RE.test(code)).toBe(false);
    });

    it(`${file} does not call any payment/fiscal/Jira/order writer function`, () => {
      const hits = FORBIDDEN_CALL_SITES.filter((needle) => lower.includes(needle));
      expect(hits).toEqual([]);
    });

    it(`${file} does not write directly to a normal-customer/payment/fiscal table`, () => {
      const hits = FORBIDDEN_TABLE_WRITES.filter((needle) => lower.includes(needle.toLowerCase()));
      expect(hits).toEqual([]);
    });
  }

  it('the main orchestrator uses the real read-only computeQuoteForJob() pricing entrypoint', () => {
    const main = sources.find((s) => s.file === 'run-ai-translation-test.ts')!;
    expect(main.content).toContain('computeQuoteForJob');
  });

  it('the main orchestrator imports pipeline modules only via dynamic import() (not static import)', () => {
    const main = sources.find((s) => s.file === 'run-ai-translation-test.ts')!;
    // Static imports of worker/src/lib/* or @/lib/pricing/* would run before dotenv
    // loads, which is exactly the bug this tool must avoid (see env-guard.ts docblock).
    expect(main.content).not.toMatch(/^import .* from ['"]\.\.\/\.\.\/worker\/src\/lib/m);
    expect(main.content).not.toMatch(/^import .* from ['"]@\/lib\/pricing/m);
    expect(main.content).toMatch(/await import\(['"]\.\.\/\.\.\/worker\/src\/lib/);
    expect(main.content).toMatch(/await import\(['"]@\/lib\/pricing/);
  });

  it('the AiTranslationTestContext type hard-codes every integration as disabled', () => {
    const types = sources.find((s) => s.file === 'lib/types.ts')!;
    expect(types.content).toMatch(/createPayment:\s*false/);
    expect(types.content).toMatch(/createJira:\s*false/);
    expect(types.content).toMatch(/createFiscalReceipt:\s*false/);
    expect(types.content).toMatch(/sendEmail:\s*false/);
  });
});
