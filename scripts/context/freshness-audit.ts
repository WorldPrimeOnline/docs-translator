#!/usr/bin/env npx tsx
/**
 * AI Context Freshness Audit
 * Usage: npx tsx scripts/context/freshness-audit.ts
 *
 * Checks whether high-risk context claims still match the current codebase.
 * Uses deterministic file/regex checks only. No external APIs. No env files.
 */

import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(process.cwd());

// ── colour helpers ────────────────────────────────────────────────────────────

const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

// ── file helpers ──────────────────────────────────────────────────────────────

function exists(rel: string): boolean {
  return fs.existsSync(path.join(ROOT, rel));
}

function read(rel: string): string {
  try {
    return fs.readFileSync(path.join(ROOT, rel), "utf8");
  } catch {
    return "";
  }
}

function dirEmpty(rel: string): boolean {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) return true;
  try {
    const entries = fs.readdirSync(abs).filter(
      (e) => !e.startsWith(".") && e !== "__tests__"
    );
    return entries.length === 0;
  } catch {
    return true;
  }
}

function grepContext(pattern: RegExp): Array<{ file: string; line: number; text: string }> {
  const targets = [
    "CLAUDE.md",
    "PROJECT_CONTEXT.md",
    ...fs.existsSync(path.join(ROOT, "docs/ai-context"))
      ? fs
          .readdirSync(path.join(ROOT, "docs/ai-context"))
          .filter((f) => f.endsWith(".md"))
          .map((f) => `docs/ai-context/${f}`)
      : [],
  ];
  const results: Array<{ file: string; line: number; text: string }> = [];
  for (const rel of targets) {
    const content = read(rel);
    if (!content) continue;
    content.split("\n").forEach((line, i) => {
      if (pattern.test(line)) {
        results.push({ file: rel, line: i + 1, text: line.trim() });
      }
    });
  }
  return results;
}

// ── result accumulator ────────────────────────────────────────────────────────

const warnings: string[] = [];
const hardFailures: string[] = [];

function warn(msg: string): void {
  warnings.push(msg);
}
function fail(msg: string): void {
  hardFailures.push(msg);
}

// ── 1. CLAUDE.md size ─────────────────────────────────────────────────────────

interface SizeResult {
  chars: number;
  status: "ok" | "warn" | "fail";
  message: string;
}

function checkClaudeSize(): SizeResult {
  const content = read("CLAUDE.md");
  const chars = Buffer.byteLength(content, "utf8");
  if (chars > 15_000) {
    fail(`CLAUDE.md exceeds hard ceiling: ${chars} > 15,000`);
    return { chars, status: "fail", message: `ABOVE HARD CEILING (${chars})` };
  }
  if (chars > 10_000) {
    return { chars, status: "warn", message: `above 10,000 target (${chars})` };
  }
  return { chars, status: "ok", message: `ok (${chars})` };
}

// ── 2. Halyk card payment activation state ────────────────────────────────────

interface CardActiveResult {
  codeValue: string;
  contextLines: Array<{ file: string; line: number; text: string }>;
  contradiction: boolean;
}

function checkCardActive(): CardActiveResult {
  const profileContent = read("src/lib/business-profile.ts");
  let codeValue = "unknown";
  if (/cardPaymentsActive\s*:\s*true/.test(profileContent)) codeValue = "true";
  else if (/cardPaymentsActive\s*:\s*false/.test(profileContent)) codeValue = "false";

  const contextLines = grepContext(
    /cardPaymentsActive|card payments active|card payments inactive|no active card payment gateway|subscription-only/i
  );

  let contradiction = false;
  // Only check for object-literal colon assignment (matches `cardPaymentsActive: true/false`)
  // Ignores instructional prose like "Never set cardPaymentsActive = true" or "set to `true` only after"
  if (codeValue === "true") {
    const claimsInactive = contextLines.some((l) =>
      /cardPaymentsActive\s*:\s*false/i.test(l.text)
    );
    if (claimsInactive) {
      warn(
        "cardPaymentsActive is true in code but context docs show `cardPaymentsActive: false`. Update context docs."
      );
      contradiction = true;
    }
  } else if (codeValue === "false") {
    const claimsActive = contextLines.some((l) =>
      /cardPaymentsActive\s*:\s*true/i.test(l.text)
    );
    if (claimsActive) {
      warn(
        "cardPaymentsActive is false in code but context docs show `cardPaymentsActive: true`. Update context docs."
      );
      contradiction = true;
    }
  }

  return { codeValue, contextLines, contradiction };
}

// ── 3. Halyk route existence ──────────────────────────────────────────────────

const HALYK_ROUTES = [
  "src/app/api/payments/halyk/initiate",
  "src/app/api/payments/halyk/callback",
  "src/app/api/documents/upload-card",
  "src/app/api/cron/reconcile-payments",
];

interface RouteCheck {
  path: string;
  exists: boolean;
}

function checkHalykRoutes(): RouteCheck[] {
  return HALYK_ROUTES.map((r) => ({ path: r, exists: exists(r) }));
}

// ── 4. Quote-based pricing integrity ─────────────────────────────────────────

const PRICING_SYMBOLS = ["verifyQuotePayable", "markQuotePaid", "price_quotes"];

function checkPricing(): Record<string, boolean> {
  const content = read("src/lib/pricing/service.ts");
  return Object.fromEntries(PRICING_SYMBOLS.map((s) => [s, content.includes(s)]));
}

// ── 5. Payment transaction table references ───────────────────────────────────

const PAYMENT_TX_TERMS = [
  "payment_transactions",
  "provider_transaction_id",
  "provider_environment",
];

function checkPaymentTxTable(): Record<string, boolean> {
  const typesContent = read("src/types/supabase.ts");
  return Object.fromEntries(
    PAYMENT_TX_TERMS.map((t) => [t, typesContent.includes(t)])
  );
}

// ── 6. Subscription create placeholder ───────────────────────────────────────

interface SubCreateResult {
  routeExists: boolean;
  state: "placeholder" | "active" | "unknown";
  contextLines: Array<{ file: string; line: number; text: string }>;
}

function checkSubCreate(): SubCreateResult {
  const routeDir = "src/app/api/subscriptions/create";
  const routeFile = "src/app/api/subscriptions/create/route.ts";
  const routeExists = exists(routeDir) || exists(routeFile);
  let state: "placeholder" | "active" | "unknown" = "unknown";

  if (routeExists) {
    const content = read(routeFile);
    if (/503|temporarily unavailable/i.test(content)) {
      state = "placeholder";
    } else if (content.length > 50) {
      state = "active";
    }
  }

  const contextLines = grepContext(/POST.*\/api\/subscriptions\/create|subscriptions\/create/i);

  if (state === "active") {
    const claimsPlaceholder = contextLines.some((l) =>
      /503|placeholder|temporarily unavailable|not yet active/i.test(l.text)
    );
    if (claimsPlaceholder) {
      warn(
        "Subscription create route appears active in code but context docs call it a 503 placeholder."
      );
    }
  }

  return { routeExists, state, contextLines };
}

// ── 7. Stripe/Polar placeholder state ────────────────────────────────────────

interface PlaceholderResult {
  stripe: { exists: boolean; empty: boolean };
  polar: { exists: boolean; empty: boolean };
}

function checkStripePolar(): PlaceholderResult {
  const stripeExists = exists("src/lib/stripe");
  const polarExists = exists("src/lib/polar");
  const stripeEmpty = dirEmpty("src/lib/stripe");
  const polarEmpty = dirEmpty("src/lib/polar");

  if (stripeExists && !stripeEmpty) {
    warn(
      "src/lib/stripe/ is not empty — context docs say it is an empty placeholder. Review 50_PAYMENTS_FINANCE_FISCALIZATION.md."
    );
  }
  if (polarExists && !polarEmpty) {
    warn(
      "src/lib/polar/ is not empty — context docs say it is an empty placeholder. Review 50_PAYMENTS_FINANCE_FISCALIZATION.md."
    );
  }

  return {
    stripe: { exists: stripeExists, empty: stripeEmpty },
    polar: { exists: polarExists, empty: polarEmpty },
  };
}

// ── 8. Fiscalization state ────────────────────────────────────────────────────

const FISCAL_EXPECTED_FILES = [
  "src/lib/fiscal/manual-provider.ts",
  "src/lib/fiscal/webkassa-provider.ts",
  "src/lib/fiscal/service.ts",
  "src/lib/fiscal/types.ts",
];

const FISCAL_TERMS = ["FISCAL_PROVIDER", "FISCALIZATION_ENABLED"];

function checkFiscalization(): { files: Record<string, boolean>; terms: Record<string, boolean> } {
  const files = Object.fromEntries(
    FISCAL_EXPECTED_FILES.map((f) => [path.basename(f), exists(f)])
  );
  const allContent =
    read("src/lib/fiscal/service.ts") +
    read("src/lib/fiscal/config.ts") +
    read("src/lib/fiscal/provider.ts");
  const terms = Object.fromEntries(FISCAL_TERMS.map((t) => [t, allContent.includes(t)]));

  const missing = Object.entries(files)
    .filter(([, ok]) => !ok)
    .map(([f]) => f);
  if (missing.length > 0) {
    warn(`Fiscalization files missing: ${missing.join(", ")} — context may be stale.`);
  }

  return { files, terms };
}

// ── 9. Refunds state ──────────────────────────────────────────────────────────

const REFUND_TERMS = ["initiateRefund", "refund_transactions", "pending_manual"];

function checkRefunds(): Record<string, boolean> {
  const content =
    read("src/lib/refunds/service.ts") +
    read("src/types/supabase.ts");
  const found = Object.fromEntries(REFUND_TERMS.map((t) => [t, content.includes(t)]));

  const missing = Object.entries(found)
    .filter(([, ok]) => !ok)
    .map(([t]) => t);
  if (missing.length > 0) {
    warn(`Refund identifiers missing from codebase: ${missing.join(", ")} — context may be stale.`);
  }

  return found;
}

// ── 10. DOCX pipeline freeze ──────────────────────────────────────────────────

interface FreezeResult {
  freezeDocExists: boolean;
  claudeMentionsFreeeze: boolean;
  pipelineDocMentionsFreeze: boolean;
}

function checkPipelineFreeze(): FreezeResult {
  const freezeDocExists = exists("docs/OFFICIAL_DOCX_PIPELINE_FREEZE.md");
  const claudeContent = read("CLAUDE.md");
  const pipelineContent = read("docs/ai-context/40_TRANSLATION_PIPELINE.md");

  const claudeMentionsFreeeze = /pipeline.*freeze|freeze|OFFICIAL_DOCX_PIPELINE_FREEZE/i.test(claudeContent);
  const pipelineDocMentionsFreeze = /freeze|OFFICIAL_DOCX_PIPELINE_FREEZE/i.test(pipelineContent);

  if (!freezeDocExists) {
    warn("docs/OFFICIAL_DOCX_PIPELINE_FREEZE.md missing — pipeline freeze state is undocumented.");
  }
  if (!claudeMentionsFreeeze) {
    warn("CLAUDE.md does not mention the DOCX pipeline freeze — high-risk omission.");
  }

  return { freezeDocExists, claudeMentionsFreeeze, pipelineDocMentionsFreeze };
}

// ── 11. Worker payment eligibility gate ──────────────────────────────────────

const WORKER_GATE_TERMS = [
  "isEligible",
  "payment_transactions",
  "card_payment",
  "subscription",
];

function checkWorkerGate(): Record<string, boolean> {
  const content = read("worker/src/index.ts");
  const found = Object.fromEntries(WORKER_GATE_TERMS.map((t) => [t, content.includes(t)]));

  const missing = Object.entries(found)
    .filter(([, ok]) => !ok)
    .map(([t]) => t);
  if (missing.length > 0) {
    warn(
      `Worker eligibility gate terms missing from worker/src/index.ts: ${missing.join(", ")} — gate may have moved.`
    );
  }

  return found;
}

// ── 12. Jira/Telegram integration files ──────────────────────────────────────

const INTEGRATION_FILES = [
  "src/app/api/webhooks/jira/route.ts",
  "src/lib/notifications/assignee.ts",
  "worker/src/lib/integrations.ts",
];

function checkIntegrations(): Record<string, boolean> {
  const found = Object.fromEntries(INTEGRATION_FILES.map((f) => [f, exists(f)]));

  const missing = Object.entries(found)
    .filter(([, ok]) => !ok)
    .map(([f]) => f);
  if (missing.length > 0) {
    warn(
      `Integration files missing: ${missing.join(", ")} — context docs may describe functionality that no longer exists.`
    );
  }

  return found;
}

// ── ok/warn/fail helpers ──────────────────────────────────────────────────────

function okMark(v: boolean): string {
  return v ? green("✓") : red("✗");
}

function allOk(record: Record<string, boolean>): boolean {
  return Object.values(record).every(Boolean);
}

// ── main ──────────────────────────────────────────────────────────────────────

function main(): void {
  console.log(bold("\nAI Context Freshness Audit\n") + "=".repeat(40));

  // Run all checks
  const size = checkClaudeSize();
  const cardActive = checkCardActive();
  const halykRoutes = checkHalykRoutes();
  const pricing = checkPricing();
  const paymentTx = checkPaymentTxTable();
  const subCreate = checkSubCreate();
  const stripePolar = checkStripePolar();
  const fiscal = checkFiscalization();
  const refunds = checkRefunds();
  const freeze = checkPipelineFreeze();
  const workerGate = checkWorkerGate();
  const integrations = checkIntegrations();

  // ── CLAUDE.md size
  console.log(bold("\nCLAUDE.md:"));
  const sizeColour = size.status === "fail" ? red : size.status === "warn" ? yellow : green;
  console.log(`  chars:       ${size.chars}`);
  console.log(`  size status: ${sizeColour(size.message)}`);

  // ── Payments
  console.log(bold("\nPayments:"));
  console.log(`  cardPaymentsActive code value: ${bold(cardActive.codeValue)}`);
  console.log(`  context mentions: ${cardActive.contextLines.length} line(s)`);
  cardActive.contextLines.slice(0, 4).forEach((l) =>
    console.log(`    ${dim(l.file + ":" + l.line)} ${l.text.slice(0, 100)}`)
  );
  console.log(`  contradiction: ${cardActive.contradiction ? yellow("yes — review") : green("none")}`);

  // ── Halyk routes
  console.log(bold("\nHalyk:"));
  halykRoutes.forEach((r) =>
    console.log(`  ${okMark(r.exists)} ${r.path}`)
  );
  const allHalykOk = halykRoutes.every((r) => r.exists);
  console.log(`  warnings: ${allHalykOk ? green("none") : red("missing routes — review context")}`);

  // ── Pricing
  console.log(bold("\nPricing:"));
  Object.entries(pricing).forEach(([k, v]) =>
    console.log(`  ${okMark(v)} ${k}`)
  );
  console.log(`  warnings: ${allOk(pricing) ? green("none") : yellow("missing pricing symbols — review 50_PAYMENTS_FINANCE_FISCALIZATION.md")}`);

  // ── Payment transaction table
  console.log(bold("\nPayment transaction table (generated types):"));
  Object.entries(paymentTx).forEach(([k, v]) =>
    console.log(`  ${okMark(v)} ${k}`)
  );
  console.log(`  warnings: ${allOk(paymentTx) ? green("none") : yellow("terms missing from generated types")}`);

  // ── Subscriptions
  console.log(bold("\nSubscriptions:"));
  console.log(`  route exists: ${subCreate.routeExists ? green("yes") : red("no")}`);
  console.log(`  detected state: ${subCreate.state}`);
  console.log(`  context mentions: ${subCreate.contextLines.length} line(s)`);

  // ── Stripe/Polar
  console.log(bold("\nStripe/Polar:"));
  console.log(
    `  stripe: ${stripePolar.stripe.exists ? "exists" : "missing"}, ${
      stripePolar.stripe.empty ? green("empty (expected)") : yellow("NON-EMPTY — review")
    }`
  );
  console.log(
    `  polar:  ${stripePolar.polar.exists ? "exists" : "missing"}, ${
      stripePolar.polar.empty ? green("empty (expected)") : yellow("NON-EMPTY — review")
    }`
  );

  // ── Fiscalization
  console.log(bold("\nFiscalization:"));
  Object.entries(fiscal.files).forEach(([f, v]) =>
    console.log(`  ${okMark(v)} ${f}`)
  );
  Object.entries(fiscal.terms).forEach(([t, v]) =>
    console.log(`  ${okMark(v)} ${t} (in fiscal config/provider/service)`)
  );
  console.log(
    `  warnings: ${allOk(fiscal.files) && allOk(fiscal.terms) ? green("none") : yellow("missing fiscal files or terms")}`
  );

  // ── Refunds
  console.log(bold("\nRefunds:"));
  Object.entries(refunds).forEach(([t, v]) =>
    console.log(`  ${okMark(v)} ${t}`)
  );
  console.log(`  warnings: ${allOk(refunds) ? green("none") : yellow("missing refund terms")}`);

  // ── Translation pipeline freeze
  console.log(bold("\nTranslation pipeline:"));
  console.log(`  ${okMark(freeze.freezeDocExists)} docs/OFFICIAL_DOCX_PIPELINE_FREEZE.md`);
  console.log(`  ${okMark(freeze.claudeMentionsFreeeze)} CLAUDE.md mentions freeze`);
  console.log(`  ${okMark(freeze.pipelineDocMentionsFreeze)} 40_TRANSLATION_PIPELINE.md mentions freeze`);
  console.log(
    `  warnings: ${
      freeze.freezeDocExists && freeze.claudeMentionsFreeeze
        ? green("none")
        : yellow("freeze reference missing — high-risk if pipeline was unfrozen without context update")
    }`
  );

  // ── Worker eligibility gate
  console.log(bold("\nWorker:"));
  Object.entries(workerGate).forEach(([t, v]) =>
    console.log(`  ${okMark(v)} ${t} (in worker/src/index.ts)`)
  );
  console.log(`  warnings: ${allOk(workerGate) ? green("none") : yellow("gate terms missing — worker logic may have changed")}`);

  // ── Integrations
  console.log(bold("\nIntegrations:"));
  Object.entries(integrations).forEach(([f, v]) =>
    console.log(`  ${okMark(v)} ${f}`)
  );
  console.log(`  warnings: ${allOk(integrations) ? green("none") : yellow("integration files missing")}`);

  // ── Collected warnings
  console.log(bold("\nAll warnings:"));
  if (warnings.length === 0) {
    console.log(`  ${green("none")}`);
  } else {
    warnings.forEach((w, i) => console.log(`  ${yellow((i + 1) + ". " + w)}`));
  }

  // ── Hard failures
  if (hardFailures.length > 0) {
    console.log(bold("\nHard failures:"));
    hardFailures.forEach((f) => console.log(`  ${red(f)}`));
  }

  // ── Result
  const result = hardFailures.length > 0 ? "FAIL" : warnings.length > 0 ? "WARN" : "PASS";
  const resultColour = result === "FAIL" ? red : result === "WARN" ? yellow : green;

  console.log(bold("\nResult:"));
  console.log(`  ${resultColour(result)}`);
  console.log("");

  process.exit(hardFailures.length > 0 ? 1 : 0);
}

main();
