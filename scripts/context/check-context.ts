#!/usr/bin/env npx tsx
/**
 * AI Context System Validator
 * Usage: npx tsx scripts/context/check-context.ts
 */

import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(process.cwd());

// ── helpers ──────────────────────────────────────────────────────────────────

function exists(rel: string): boolean {
  return fs.existsSync(path.join(ROOT, rel));
}

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function bold(s: string): string {
  return `\x1b[1m${s}\x1b[0m`;
}
function green(s: string): string {
  return `\x1b[32m${s}\x1b[0m`;
}
function yellow(s: string): string {
  return `\x1b[33m${s}\x1b[0m`;
}
function red(s: string): string {
  return `\x1b[31m${s}\x1b[0m`;
}

// ── constants ─────────────────────────────────────────────────────────────────

const CLAUDE_TARGET = 10_000;
const CLAUDE_CEILING = 15_000;

const REQUIRED_FILES = [
  "CLAUDE.md",
  "PROJECT_CONTEXT.md",
  "docs/ai-context/INDEX.md",
  "docs/ai-context/CONTEXT_ROUTER.md",
  "docs/ai-context/CONTEXT_MANIFEST.md",
  "docs/ai-context/00_CONTEXT_LOADING_RULES.md",
  "docs/ai-context/10_BRANCH_DEPLOYMENT_RULES.md",
  "docs/ai-context/20_COMMANDS_AND_TESTS.md",
  "docs/ai-context/30_ARCHITECTURE_OVERVIEW.md",
  "docs/ai-context/40_TRANSLATION_PIPELINE.md",
  "docs/ai-context/50_PAYMENTS_FINANCE_FISCALIZATION.md",
  "docs/ai-context/60_INTEGRATIONS_JIRA_DRIVE_TELEGRAM.md",
  "docs/ai-context/70_DATABASE_AND_API_SURFACE.md",
  "docs/ai-context/80_I18N_LEGAL_PUBLIC_CONTENT.md",
  "docs/ai-context/90_SECURITY_INVARIANTS.md",
  "docs/ai-context/95_CODEBASE_MEMORY_MCP_RULES.md",
  "docs/ai-context/96_CONTEXT_MAINTENANCE_RULES.md",
  "docs/ai-context/DECISIONS.md",
  "docs/ai-context/FRESHNESS_AUDIT.md",
];

const LINK_SOURCE_FILES = [
  "CLAUDE.md",
  "PROJECT_CONTEXT.md",
  ...fs
    .readdirSync(path.join(ROOT, "docs/ai-context"))
    .filter((f) => f.endsWith(".md"))
    .map((f) => `docs/ai-context/${f}`),
];

// ── 1. CLAUDE.md size ─────────────────────────────────────────────────────────

type SizeResult = {
  chars: number;
  ok: boolean;
  warn: boolean;
  message: string;
};

function checkClaudeSize(): SizeResult {
  if (!exists("CLAUDE.md")) {
    return {
      chars: 0,
      ok: false,
      warn: false,
      message: "CLAUDE.md not found",
    };
  }
  const chars = Buffer.byteLength(read("CLAUDE.md"), "utf8");
  const ok = chars <= CLAUDE_CEILING;
  const warn = chars > CLAUDE_TARGET && chars <= CLAUDE_CEILING;
  const message = !ok
    ? `ABOVE HARD CEILING (${chars} > ${CLAUDE_CEILING})`
    : warn
      ? `above target but under ceiling (${chars} > ${CLAUDE_TARGET})`
      : `ok (${chars} <= ${CLAUDE_TARGET})`;
  return { chars, ok, warn, message };
}

// ── 2. Required files ─────────────────────────────────────────────────────────

type FilesResult = { missing: string[]; ok: boolean };

function checkRequiredFiles(): FilesResult {
  const missing = REQUIRED_FILES.filter((f) => !exists(f));
  return { missing, ok: missing.length === 0 };
}

// ── 3. Link validation ────────────────────────────────────────────────────────

type BrokenLink = { source: string; target: string; raw: string };
type LinksResult = { checked: number; broken: BrokenLink[]; ok: boolean };

function extractLinks(content: string): Array<{ raw: string; href: string }> {
  const links: Array<{ raw: string; href: string }> = [];
  // Strip fenced code blocks first (``` ... ```)
  const stripped = content.replace(/```[\s\S]*?```/g, "");
  // Match markdown links: [text](href)
  const re = /\[([^\]]*)\]\(([^)]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stripped)) !== null) {
    const raw = m[2];
    // Strip anchor
    const href = raw.split("#")[0].trim();
    if (!href) continue;
    // Skip external
    if (href.startsWith("http://") || href.startsWith("https://") || href.startsWith("mailto:")) continue;
    links.push({ raw, href });
  }
  return links;
}

function resolveLink(sourceFile: string, href: string): string {
  const sourceDir = path.dirname(path.join(ROOT, sourceFile));
  return path.relative(ROOT, path.resolve(sourceDir, href));
}

function checkLinks(): LinksResult {
  const broken: BrokenLink[] = [];
  let checked = 0;

  for (const sourceFile of LINK_SOURCE_FILES) {
    if (!exists(sourceFile)) continue;
    const content = read(sourceFile);
    const links = extractLinks(content);
    for (const { raw, href } of links) {
      checked++;
      const resolved = resolveLink(sourceFile, href);
      if (!exists(resolved)) {
        broken.push({ source: sourceFile, target: resolved, raw });
      }
    }
  }

  return { checked, broken, ok: broken.length === 0 };
}

// ── 4. Index/manifest coverage ────────────────────────────────────────────────

type CoverageResult = {
  indexMissing: string[];
  manifestMissing: string[];
  routerChecks: { check: string; ok: boolean }[];
  claudeChecks: { check: string; ok: boolean }[];
  ok: boolean;
};

function checkCoverage(): CoverageResult {
  const aiContextFiles = fs.existsSync(path.join(ROOT, "docs/ai-context"))
    ? fs
        .readdirSync(path.join(ROOT, "docs/ai-context"))
        .filter((f) => f.endsWith(".md"))
    : [];

  const indexContent = exists("docs/ai-context/INDEX.md") ? read("docs/ai-context/INDEX.md") : "";
  const manifestContent = exists("docs/ai-context/CONTEXT_MANIFEST.md") ? read("docs/ai-context/CONTEXT_MANIFEST.md") : "";
  const routerContent = exists("docs/ai-context/CONTEXT_ROUTER.md") ? read("docs/ai-context/CONTEXT_ROUTER.md") : "";
  const claudeContent = exists("CLAUDE.md") ? read("CLAUDE.md") : "";

  // INDEX.md doesn't need to reference itself; CONTEXT_MANIFEST.md references itself by definition
  const indexMissing = aiContextFiles
    .filter((f) => f !== "INDEX.md")
    .filter((f) => !indexContent.includes(f));
  const manifestMissing = aiContextFiles
    .filter((f) => f !== "CONTEXT_MANIFEST.md")
    .filter((f) => !manifestContent.includes(f));

  const routerChecks = [
    { check: "contains '## Routing Table'", ok: routerContent.includes("## Routing Table") },
    { check: "mentions 95_CODEBASE_MEMORY_MCP_RULES.md", ok: routerContent.includes("95_CODEBASE_MEMORY_MCP_RULES.md") },
  ];

  const claudeChecks = [
    { check: "mentions CONTEXT_ROUTER.md", ok: claudeContent.includes("CONTEXT_ROUTER.md") },
    { check: "mentions 96_CONTEXT_MAINTENANCE_RULES.md", ok: claudeContent.includes("96_CONTEXT_MAINTENANCE_RULES.md") },
  ];

  const ok =
    indexMissing.length === 0 &&
    manifestMissing.length === 0 &&
    routerChecks.every((c) => c.ok) &&
    claudeChecks.every((c) => c.ok);

  return { indexMissing, manifestMissing, routerChecks, claudeChecks, ok };
}

// ── 5. Optional local file ────────────────────────────────────────────────────

function checkOptional(): string {
  return exists("tech-pipline")
    ? "optional local file present: tech-pipline"
    : "optional local file missing: tech-pipline";
}

// ── main ──────────────────────────────────────────────────────────────────────

function main(): void {
  console.log(bold("\nAI Context Check\n") + "=".repeat(40));

  const size = checkClaudeSize();
  const files = checkRequiredFiles();
  const links = checkLinks();
  const coverage = checkCoverage();
  const optional = checkOptional();

  // ── CLAUDE.md size
  console.log(bold("\nCLAUDE.md:"));
  const sizeColor = !size.ok ? red : size.warn ? yellow : green;
  console.log(`  chars:        ${size.chars}`);
  console.log(`  target:       ${CLAUDE_TARGET}`);
  console.log(`  hard ceiling: ${CLAUDE_CEILING}`);
  console.log(`  status:       ${sizeColor(size.message)}`);

  // ── Required files
  console.log(bold("\nFiles:"));
  if (files.ok) {
    console.log(`  ${green("all " + REQUIRED_FILES.length + " required files present")}`);
  } else {
    files.missing.forEach((f) => console.log(`  ${red("MISSING: " + f)}`));
    console.log(`  ${green("present:")} ${REQUIRED_FILES.length - files.missing.length}/${REQUIRED_FILES.length}`);
  }

  // ── Links
  console.log(bold("\nLinks:"));
  console.log(`  checked files: ${LINK_SOURCE_FILES.length}`);
  console.log(`  links checked: ${links.checked}`);
  if (links.ok) {
    console.log(`  ${green("no broken links")}`);
  } else {
    links.broken.forEach((b) =>
      console.log(`  ${red("BROKEN")} [${b.source}] → ${b.target}  (raw: ${b.raw})`)
    );
  }

  // ── Coverage
  console.log(bold("\nCoverage:"));
  if (coverage.indexMissing.length === 0) {
    console.log(`  ${green("INDEX.md: all ai-context files mentioned")}`);
  } else {
    coverage.indexMissing.forEach((f) =>
      console.log(`  ${yellow("INDEX.md missing: " + f)}`)
    );
  }
  if (coverage.manifestMissing.length === 0) {
    console.log(`  ${green("CONTEXT_MANIFEST.md: all ai-context files mentioned")}`);
  } else {
    coverage.manifestMissing.forEach((f) =>
      console.log(`  ${yellow("CONTEXT_MANIFEST.md missing: " + f)}`)
    );
  }
  console.log("  Router checks:");
  coverage.routerChecks.forEach((c) =>
    console.log(`    ${c.ok ? green("✓") : red("✗")} ${c.check}`)
  );
  console.log("  CLAUDE.md checks:");
  coverage.claudeChecks.forEach((c) =>
    console.log(`    ${c.ok ? green("✓") : red("✗")} ${c.check}`)
  );

  // ── Optional
  console.log(bold("\nOptional:"));
  console.log(`  ${optional}`);

  // ── Result
  const failures = [
    !size.ok,
    !files.ok,
    !links.ok,
    !coverage.ok,
  ];
  const warnings = [size.warn];
  const passed = !failures.some(Boolean);
  const hasWarnings = warnings.some(Boolean);

  console.log(bold("\nResult:"));
  if (passed && !hasWarnings) {
    console.log(`  ${green("PASS")}`);
  } else if (passed && hasWarnings) {
    console.log(`  ${yellow("PASS with warnings")}`);
  } else {
    console.log(`  ${red("FAIL")}`);
  }
  console.log("");

  process.exit(passed ? 0 : 1);
}

main();
