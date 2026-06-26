#!/usr/bin/env npx tsx
/**
 * AI Context Pre-Commit Check
 * Usage: npx tsx scripts/context/pre-commit-context-check.ts
 *
 * Detects context-system changes and high-risk code changes, runs check-context.ts
 * when needed, and warns when high-risk areas changed without context doc updates.
 */

import * as fs from "fs";
import * as path from "path";
import { execSync, spawnSync } from "child_process";

const ROOT = path.resolve(process.cwd());

// ── colour helpers ────────────────────────────────────────────────────────────

const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;

// ── git helpers ───────────────────────────────────────────────────────────────

function gitLines(cmd: string): string[] {
  try {
    return execSync(cmd, { cwd: ROOT, encoding: "utf8" })
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function getChangedFiles(): { staged: string[]; unstaged: string[]; untracked: string[] } {
  return {
    staged: gitLines("git diff --cached --name-only"),
    unstaged: gitLines("git diff --name-only"),
    untracked: gitLines("git ls-files --others --exclude-standard"),
  };
}

// ── matchers ──────────────────────────────────────────────────────────────────

function matchesAny(file: string, patterns: string[]): boolean {
  return patterns.some((p) => {
    if (p.endsWith("/**")) {
      return file.startsWith(p.slice(0, -3));
    }
    if (p.includes("*")) {
      // simple glob: prefix match up to the *
      const prefix = p.split("*")[0];
      return file.startsWith(prefix);
    }
    return file === p || file.startsWith(p + "/");
  });
}

// ── context system patterns ───────────────────────────────────────────────────

const CONTEXT_PATTERNS = [
  "CLAUDE.md",
  "PROJECT_CONTEXT.md",
  "docs/ai-context/",
  "scripts/context/",
];

function isContextFile(f: string): boolean {
  return CONTEXT_PATTERNS.some((p) => f === p || f.startsWith(p));
}

// ── high-risk patterns ────────────────────────────────────────────────────────

const HIGH_RISK: Record<string, string[]> = {
  payments: [
    "src/lib/payments/",
    "src/lib/pricing/",
    "src/lib/fiscal/",
    "src/lib/refunds/",
    "src/app/api/payments/",
    "src/app/api/admin/payments/",
  ],
  translation_pipeline: [
    "worker/src/processor.ts",
    "worker/src/lib/docx-renderer.ts",
    "worker/src/lib/page-vision.ts",
    "worker/src/lib/protected-values.ts",
    "worker/src/lib/qa.ts",
    "worker/src/lib/visual-elements.ts",
    "worker/src/lib/docx-visual-block.ts",
    "src/lib/translation-workflow/",
    "src/lib/pdf/",
    "src/lib/translation/",
    "src/lib/translation-prompts/",
  ],
  integrations: [
    "src/lib/jira/",
    "worker/src/lib/jira/",
    "src/lib/google-drive/",
    "worker/src/lib/google-drive.ts",
    "src/lib/telegram/",
    "src/lib/notifications/",
    "worker/src/lib/integrations.ts",
    "src/app/api/webhooks/jira/",
  ],
  "deployment/env/security": [
    ".github/",
    "vercel.json",
    "railway",
    "worker/Dockerfile",
    "src/lib/env.ts",
    "worker/src/lib/env.ts",
    "src/middleware.ts",
  ],
  "legal/i18n/public content": [
    "messages/",
    "src/lib/legal/",
    "src/components/payment/PaymentComplianceBlock.tsx",
    "src/components/landing/",
    "src/lib/landing-pages/",
  ],
};

// Context doc relevance by area — which docs should be updated when that area changes
const AREA_CONTEXT_DOCS: Record<string, string[]> = {
  payments: [
    "docs/ai-context/50_PAYMENTS_FINANCE_FISCALIZATION.md",
    "docs/ai-context/70_DATABASE_AND_API_SURFACE.md",
    "docs/ai-context/90_SECURITY_INVARIANTS.md",
    "docs/ai-context/DECISIONS.md",
  ],
  translation_pipeline: [
    "docs/ai-context/40_TRANSLATION_PIPELINE.md",
    "docs/ai-context/30_ARCHITECTURE_OVERVIEW.md",
    "docs/ai-context/DECISIONS.md",
  ],
  integrations: [
    "docs/ai-context/60_INTEGRATIONS_JIRA_DRIVE_TELEGRAM.md",
    "docs/ai-context/70_DATABASE_AND_API_SURFACE.md",
    "docs/ai-context/DECISIONS.md",
  ],
  "deployment/env/security": [
    "docs/ai-context/10_BRANCH_DEPLOYMENT_RULES.md",
    "docs/ai-context/90_SECURITY_INVARIANTS.md",
    "docs/ai-context/DECISIONS.md",
  ],
  "legal/i18n/public content": [
    "docs/ai-context/80_I18N_LEGAL_PUBLIC_CONTENT.md",
    "docs/ai-context/30_ARCHITECTURE_OVERVIEW.md",
  ],
};

// Keywords in filenames/content that also indicate payment-area changes
const PAYMENT_KEYWORDS = [
  "payment_transactions",
  "price_quotes",
  "cost_reservations",
  "refund_transactions",
  "fiscal_receipts",
];

function containsPaymentKeyword(file: string): boolean {
  // Only keyword-scan application source files, not docs or scripts
  if (!file.startsWith("src/") && !file.startsWith("worker/")) return false;
  const abs = path.join(ROOT, file);
  if (!fs.existsSync(abs)) return false;
  try {
    const content = fs.readFileSync(abs, "utf8");
    return PAYMENT_KEYWORDS.some((kw) => content.includes(kw));
  } catch {
    return false;
  }
}

// ── classify changed files ────────────────────────────────────────────────────

interface Classification {
  contextChanged: boolean;
  contextFiles: string[];
  highRisk: Record<string, boolean>;
  allFiles: string[];
}

function classify(changed: { staged: string[]; unstaged: string[]; untracked: string[] }): Classification {
  const allFiles = [
    ...new Set([...changed.staged, ...changed.unstaged, ...changed.untracked]),
  ];

  const contextFiles = allFiles.filter(isContextFile);
  const contextChanged = contextFiles.length > 0;

  const highRisk: Record<string, boolean> = {};
  for (const [area, patterns] of Object.entries(HIGH_RISK)) {
    const pathMatch = allFiles.some((f) => matchesAny(f, patterns));
    // Extra check: payment keyword scanning for files not caught by path
    const keywordMatch =
      area === "payments" &&
      allFiles.some((f) => !matchesAny(f, patterns) && containsPaymentKeyword(f));
    highRisk[area] = pathMatch || keywordMatch;
  }

  return { contextChanged, contextFiles, highRisk, allFiles };
}

// ── run check-context.ts ──────────────────────────────────────────────────────

function runCheckContext(): { passed: boolean; output: string } {
  const result = spawnSync(
    "npx",
    ["tsx", "scripts/context/check-context.ts"],
    { cwd: ROOT, encoding: "utf8" }
  );
  const output = (result.stdout ?? "") + (result.stderr ?? "");
  return { passed: result.status === 0, output };
}

// ── CLAUDE.md size ────────────────────────────────────────────────────────────

function checkClaudeSize(): { chars: number; warn: boolean; fail: boolean } | null {
  const p = path.join(ROOT, "CLAUDE.md");
  if (!fs.existsSync(p)) return null;
  const chars = Buffer.byteLength(fs.readFileSync(p, "utf8"), "utf8");
  return {
    chars,
    warn: chars > 10_000 && chars <= 15_000,
    fail: chars > 15_000,
  };
}

// ── warnings ──────────────────────────────────────────────────────────────────

function buildWarnings(
  classification: Classification,
  changed: { staged: string[]; unstaged: string[]; untracked: string[] }
): string[] {
  const warnings: string[] = [];
  const allContextChanged = new Set([
    ...changed.staged.filter(isContextFile),
    ...changed.unstaged.filter(isContextFile),
  ]);

  for (const [area, affected] of Object.entries(classification.highRisk)) {
    if (!affected) continue;
    const expectedDocs = AREA_CONTEXT_DOCS[area] ?? [];
    const relevantDocUpdated = expectedDocs.some((doc) => allContextChanged.has(doc));
    if (!relevantDocUpdated) {
      const areaLabel = area.charAt(0).toUpperCase() + area.slice(1);
      const docList = expectedDocs.map((d) => path.basename(d)).join(", ");
      warnings.push(
        `WARNING: High-risk ${areaLabel} files changed, but no relevant context docs were updated.\n` +
        `  Review whether ${docList} should be updated.`
      );
    }
  }

  return warnings;
}

// ── main ──────────────────────────────────────────────────────────────────────

function main(): void {
  console.log(bold("\nAI Context Pre-Commit Check\n") + "=".repeat(40));

  const changed = getChangedFiles();
  const cls = classify(changed);
  const warnings = buildWarnings(cls, changed);

  // ── changed files
  console.log(bold("\nChanged files:"));
  console.log(`  staged:    ${changed.staged.length ? changed.staged.join(", ") : "(none)"}`);
  console.log(`  unstaged:  ${changed.unstaged.length ? changed.unstaged.join(", ") : "(none)"}`);
  console.log(`  untracked: ${changed.untracked.length ? changed.untracked.join(", ") : "(none)"}`);

  // ── context system
  console.log(bold("\nContext system:"));
  console.log(`  changed: ${cls.contextChanged ? yellow("yes") : "no"}`);

  let checkPassed: boolean | null = null;
  if (cls.contextChanged) {
    console.log("  running check-context.ts...");
    const { passed, output } = runCheckContext();
    checkPassed = passed;
    // Print check-context output indented
    output.split("\n").forEach((line) => {
      if (line.trim()) console.log("  " + line);
    });
    console.log(`  check-context result: ${passed ? green("PASS") : red("FAIL")}`);
  } else {
    console.log("  check-context result: not needed");
  }

  // ── CLAUDE.md size (when it changed)
  const claudeChanged = cls.allFiles.includes("CLAUDE.md");
  if (claudeChanged) {
    const size = checkClaudeSize();
    if (size) {
      const sizeStr = `${size.chars} chars`;
      if (size.fail) {
        console.log(`  CLAUDE.md: ${red(sizeStr + " — EXCEEDS HARD CEILING (15,000)")}`);
      } else if (size.warn) {
        console.log(`  CLAUDE.md: ${yellow(sizeStr + " — above 10,000 target")}`);
      } else {
        console.log(`  CLAUDE.md: ${green(sizeStr + " — ok")}`);
      }
    }
  }

  // ── high-risk areas
  console.log(bold("\nHigh-risk areas:"));
  for (const [area, hit] of Object.entries(cls.highRisk)) {
    const label = `  ${area}:`;
    console.log(`${label.padEnd(38)}${hit ? yellow("yes") : "no"}`);
  }

  // ── warnings
  console.log(bold("\nContext maintenance warnings:"));
  if (warnings.length === 0) {
    console.log(`  ${green("none")}`);
  } else {
    warnings.forEach((w) => console.log(`  ${yellow(w)}`));
  }

  // ── result
  const claudeSize = claudeChanged ? checkClaudeSize() : null;
  const hardFail =
    (checkPassed === false) ||
    (claudeSize?.fail === true);

  console.log(bold("\nResult:"));
  if (hardFail) {
    console.log(`  ${red("FAIL")}`);
  } else if (warnings.length > 0) {
    console.log(`  ${yellow("PASS with warnings — review context maintenance notes above")}`);
  } else {
    console.log(`  ${green("PASS")}`);
  }
  console.log("");

  process.exit(hardFail ? 1 : 0);
}

main();
