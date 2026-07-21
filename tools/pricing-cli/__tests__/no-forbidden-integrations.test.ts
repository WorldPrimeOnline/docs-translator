/**
 * Static safeguard: proves (by source inspection, not just intent-in-comments) that this CLI
 * never references the modules or functions that would create a payment, fiscal receipt, Jira
 * issue, order, or a real Supabase write — mirrors the existing precedent in
 * tools/internal-ai-test-lab/__tests__/no-forbidden-integrations.test.ts.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const TOOL_DIR = path.join(__dirname, '..');

function readAllToolSources(): { file: string; content: string }[] {
  const out: { file: string; content: string }[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith('.ts')) {
        out.push({ file: path.relative(TOOL_DIR, full), content: fs.readFileSync(full, 'utf-8') });
      }
    }
  };
  walk(TOOL_DIR);
  return out;
}

function stripComments(src: string): string {
  const noBlockComments = src.replace(/\/\*[\s\S]*?\*\//g, '');
  return noBlockComments
    .split('\n')
    .map((line) => line.replace(/(?<!:)\/\/.*$/, ''))
    .join('\n');
}

const FORBIDDEN_IMPORT_RE =
  /\b(?:from|require|import)\s*\(?['"][^'"]*\b(halyk|webkassa|jira|resend|google-drive|telegram|ofd-|fiscal-processor|fiscal-z-report|integrations)\b[^'"]*['"]/i;

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
];

const FORBIDDEN_TABLE_WRITES = [
  ".from('jobs')",
  ".from('documents')",
  ".from('translations')",
  ".from('orders')",
  ".from('price_quotes')",
  ".from('price_quote_items')",
  ".from('cost_reservations')",
  ".from('payment_transactions')",
  ".from('fiscal_receipts')",
  ".from('refund_transactions')",
  // pricing_versions/pricing_language_rates: reads are allowed (getPricingVersionByCode /
  // getLanguageRate), but this tool must never .update()/.insert()/.upsert() them.
  ".update({",
  ".insert({",
  ".upsert({",
];

describe('no-forbidden-integrations', () => {
  const sources = readAllToolSources();

  it('found at least the main entry points + lib files (sanity check the scan itself works)', () => {
    expect(sources.some((s) => s.file === 'index.ts')).toBe(true);
    expect(sources.some((s) => s.file === 'fixtures.ts')).toBe(true);
    expect(sources.length).toBeGreaterThan(10);
  });

  for (const { file, content } of sources) {
    const code = stripComments(content);
    const lower = code.toLowerCase();

    it(`${file} does not import Halyk/Webkassa/Jira/Resend/Drive/Telegram/fiscal modules`, () => {
      expect(FORBIDDEN_IMPORT_RE.test(code)).toBe(false);
    });

    it(`${file} does not call any payment/fiscal/Jira/order writer function`, () => {
      const hits = FORBIDDEN_CALL_SITES.filter((needle) => lower.includes(needle));
      expect(hits).toEqual([]);
    });

    it(`${file} does not write to a customer/payment/fiscal table, nor update/insert/upsert anything`, () => {
      const hits = FORBIDDEN_TABLE_WRITES.filter((needle) => lower.includes(needle.toLowerCase()));
      expect(hits).toEqual([]);
    });
  }

  it('no file statically imports @/lib/pricing/service, @/lib/supabase/server, @supabase/ssr, or @supabase/supabase-js', () => {
    // Those pull in a live Supabase client at module load time — this CLI must only reach
    // them via a dynamic import(), gated behind --from-staging, so local/offline mode never
    // requires credentials. See lib/version-source.ts docblock.
    for (const { file, content } of sources) {
      expect(content).not.toMatch(/^import .* from ['"]@\/lib\/pricing\/service['"]/m);
      expect(content).not.toMatch(/^import .* from ['"]@\/lib\/supabase\/server['"]/m);
      expect(content).not.toMatch(/^import .* from ['"]@supabase\/ssr['"]/m);
      expect(content).not.toMatch(/^import .* from ['"]@supabase\/supabase-js['"]/m);
      // lib/env-loader.ts's docblock explains (in prose) why it must run before
      // lib/version-source.ts's dynamic import — mentioning the path in a comment is fine.
      const codeOnly = stripComments(content);
      if (/@\/lib\/pricing\/service|@\/lib\/supabase\/server|@supabase\/(ssr|supabase-js)/.test(codeOnly)) {
        expect(['lib/version-source.ts', 'lib/env-loader.ts']).toContain(file);
      }
    }
  });

  it('lib/version-source.ts only reaches @/lib/pricing/service via dynamic import()', () => {
    const versionSource = sources.find((s) => s.file === 'lib/version-source.ts')!;
    expect(versionSource.content).toMatch(/await import\(['"]@\/lib\/pricing\/service['"]\)/);
  });

  it('calculatePrice is imported from the real calculator module, never redefined', () => {
    const pricingRun = sources.find((s) => s.file === 'lib/pricing-run.ts')!;
    expect(pricingRun.content).toMatch(/import\s*\{\s*calculatePrice\s*\}\s*from\s*['"]@\/lib\/pricing\/calculator['"]/);
    for (const { file, content } of sources) {
      if (file === 'lib/pricing-run.ts' || file === 'fixtures.ts') continue;
      expect(content).not.toMatch(/function\s+calculatePrice\s*\(/);
    }
  });

  it('analysis is reused from @/lib/document-analysis, not re-implemented', () => {
    const analyzeFile = sources.find((s) => s.file === 'lib/analyze-file.ts')!;
    expect(analyzeFile.content).toMatch(/from ['"]@\/lib\/document-analysis\/analyze['"]/);
    expect(analyzeFile.content).toMatch(/from ['"]@\/lib\/document-analysis\/pdf-text-layer['"]/);
  });
});
