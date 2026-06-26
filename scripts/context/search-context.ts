#!/usr/bin/env npx tsx
/**
 * Context Search — fast search through context docs and optionally code
 * Usage:
 *   npx tsx scripts/context/search-context.ts "cardPaymentsActive"
 *   npx tsx scripts/context/search-context.ts "verifyQuotePayable" --code
 */

import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

const args = process.argv.slice(2);
const includeCode = args.includes("--code");
const terms = args.filter((a) => !a.startsWith("--"));
const query = terms.join(" ").trim();

if (!query) {
  console.error('Usage: npx tsx scripts/context/search-context.ts "<query>" [--code]');
  process.exit(1);
}

const ROOT = path.resolve(process.cwd());

// ── safe search targets ───────────────────────────────────────────────────────

const CONTEXT_TARGETS = ["CLAUDE.md", "PROJECT_CONTEXT.md", "docs/ai-context"];
// When --code is added, "docs" supersedes the narrower "docs/ai-context" target
const CODE_TARGETS = ["src", "worker", "docs"];

// Directories that must never be searched
const EXCLUDED_DIRS = [
  "node_modules",
  ".next",
  ".git",
  ".vercel",
  ".codebase-memory",
  "dist",
  ".turbo",
  "out",
  "coverage",
  "build",
];

const EXCLUDED_PATTERNS = EXCLUDED_DIRS.map((d) => `--glob '!**/${d}/**'`).join(" ");
const EXCLUDED_GLOB_JS = new RegExp(
  `(${EXCLUDED_DIRS.map((d) => d.replace(".", "\\.")).join("|")})`
);

// Never search .env files
function isEnvFile(p: string): boolean {
  const base = path.basename(p);
  return base.startsWith(".env") || base === ".env";
}

// ── rg check ──────────────────────────────────────────────────────────────────

function hasRg(): boolean {
  try {
    execSync("rg --version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// ── rg search ────────────────────────────────────────────────────────────────

function searchWithRg(query: string, targets: string[]): void {
  const existingTargets = targets.filter((t) =>
    fs.existsSync(path.join(ROOT, t))
  );
  if (existingTargets.length === 0) return;

  const cmd = [
    "rg",
    "--line-number",
    "--color=never",
    "--no-heading",
    EXCLUDED_PATTERNS,
    "--glob '!.env*'",
    `'${query.replace(/'/g, "'\\''")}'`,
    ...existingTargets,
  ].join(" ");

  try {
    const out = execSync(cmd, { cwd: ROOT, encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] });
    if (out.trim()) process.stdout.write(out);
  } catch (e: unknown) {
    // rg exits 1 when no matches — that's fine
    if (e && typeof e === "object" && "status" in e && (e as { status: number }).status === 1) return;
    // real error
    throw e;
  }
}

// ── fallback: recursive text search ──────────────────────────────────────────

function walkFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (EXCLUDED_GLOB_JS.test(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkFiles(full));
    } else if (entry.isFile()) {
      if (isEnvFile(entry.name)) continue;
      results.push(full);
    }
  }
  return results;
}

function searchFallback(query: string, targets: string[]): void {
  const lower = query.toLowerCase();
  let totalMatches = 0;

  for (const target of targets) {
    const absTarget = path.join(ROOT, target);
    const files = fs.statSync(absTarget).isDirectory()
      ? walkFiles(absTarget)
      : [absTarget];

    for (const file of files) {
      if (isEnvFile(file)) continue;
      let content: string;
      try {
        content = fs.readFileSync(file, "utf8");
      } catch {
        continue;
      }
      const lines = content.split("\n");
      lines.forEach((line, idx) => {
        if (line.toLowerCase().includes(lower)) {
          const rel = path.relative(ROOT, file);
          console.log(`${rel}:${idx + 1}:${line}`);
          totalMatches++;
        }
      });
    }
  }

  if (totalMatches === 0) {
    console.log("(no matches)");
  }
}

// ── main ──────────────────────────────────────────────────────────────────────

function deduplicateTargets(targets: string[]): string[] {
  // Remove targets that are subdirectories of another target in the list
  const abs = targets.map((t) => path.resolve(ROOT, t));
  return targets.filter((_, i) =>
    !abs.some((other, j) => j !== i && abs[i].startsWith(other + path.sep))
  );
}

function main(): void {
  const combined = includeCode
    ? [...CONTEXT_TARGETS, ...CODE_TARGETS]
    : CONTEXT_TARGETS;
  const targets = deduplicateTargets(combined);

  const useRg = hasRg();
  const mode = useRg ? "rg" : "fallback text search";
  const scope = includeCode ? "context + code" : "context docs";

  console.log(`\x1b[1mContext Search\x1b[0m — "${query}" [${scope}] [${mode}]`);
  console.log("─".repeat(60));

  if (useRg) {
    searchWithRg(query, targets);
  } else {
    searchFallback(query, targets);
  }
}

main();
