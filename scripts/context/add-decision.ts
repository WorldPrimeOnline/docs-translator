#!/usr/bin/env npx tsx
/**
 * Decision Capture Helper
 * Usage: npx tsx scripts/context/add-decision.ts --title "..." --decision "..." --rationale "..."
 *
 * Appends a structured decision entry to docs/ai-context/DECISIONS.md.
 */

import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(process.cwd());
const DECISIONS_FILE = path.join(ROOT, "docs/ai-context/DECISIONS.md");

// ── colour helpers ────────────────────────────────────────────────────────────

const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;

// ── secret detection ──────────────────────────────────────────────────────────

const HARD_SECRET_PATTERNS = [
  /sk-/,
  /Bearer /,
  /SUPABASE_SERVICE_ROLE_KEY/,
  /ANTHROPIC_API_KEY/,
  /MISTRAL_API_KEY/,
  /JIRA_API_TOKEN/,
  /GOOGLE_REFRESH_TOKEN/,
  /TELEGRAM_BOT_TOKEN/,
];

// HALYK only fails when paired with credential-like words
const HALYK_CREDENTIAL_PATTERN =
  /HALYK.{0,40}(secret|password|token|key|credential)/i;

function detectSecrets(text: string): string | null {
  for (const pat of HARD_SECRET_PATTERNS) {
    if (pat.test(text)) {
      return `Possible secret detected (pattern: ${pat.source}). Refusing to write.`;
    }
  }
  if (HALYK_CREDENTIAL_PATTERN.test(text)) {
    return "Possible HALYK credential detected. Refusing to write.";
  }
  return null;
}

function checkAllFields(fields: Record<string, string>): string | null {
  for (const [, value] of Object.entries(fields)) {
    const hit = detectSecrets(value);
    if (hit) return hit;
  }
  return null;
}

// ── arg parsing ───────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  const args = argv.slice(2);
  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        result[key] = next;
        i += 2;
      } else {
        result[key] = "";
        i += 1;
      }
    } else {
      i += 1;
    }
  }
  return result;
}

// ── date helper ───────────────────────────────────────────────────────────────

function todayISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function isValidDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

// ── usage ─────────────────────────────────────────────────────────────────────

function printUsage(): void {
  console.log(`
${bold("add-decision")} — append a structured entry to docs/ai-context/DECISIONS.md

${bold("Usage:")}
  npx tsx scripts/context/add-decision.ts \\
    --title "Decision title" \\
    --decision "Decision text" \\
    --rationale "Rationale text" \\
    [--impacted "CLAUDE.md, docs/ai-context/INDEX.md"] \\
    [--risks "Risks or caveats"] \\
    [--date 2026-06-25]

${bold("Required:")} --title, --decision, --rationale
${bold("Optional:")} --impacted, --risks, --date (defaults to today)

${bold("Title limit:")} 160 characters
`);
}

// ── build entry ───────────────────────────────────────────────────────────────

function buildEntry(opts: {
  date: string;
  title: string;
  decision: string;
  rationale: string;
  impacted: string;
  risks: string;
}): string {
  const impactedText = opts.impacted.trim() || "`Not specified`";
  const risksText = opts.risks.trim() || "`Not specified`";

  return [
    `### ${opts.date} — ${opts.title}`,
    "",
    "**Decision:**  ",
    opts.decision.trim(),
    "",
    "**Rationale:**  ",
    opts.rationale.trim(),
    "",
    "**Impacted files/docs:**  ",
    impactedText,
    "",
    "**Risks / caveats:**  ",
    risksText,
  ].join("\n");
}

// ── main ──────────────────────────────────────────────────────────────────────

function main(): void {
  const args = parseArgs(process.argv);

  // ── required fields
  const missing: string[] = [];
  if (!args["title"]) missing.push("--title");
  if (!args["decision"]) missing.push("--decision");
  if (!args["rationale"]) missing.push("--rationale");

  if (missing.length > 0) {
    console.error(red(`Missing required fields: ${missing.join(", ")}`));
    printUsage();
    process.exit(1);
  }

  const title = args["title"].trim();
  const decision = args["decision"].trim();
  const rationale = args["rationale"].trim();
  const impacted = (args["impacted"] ?? "").trim();
  const risks = (args["risks"] ?? "").trim();
  const rawDate = args["date"] ?? "";
  const date = rawDate && isValidDate(rawDate) ? rawDate : todayISO();

  // ── title length
  if (title.length > 160) {
    console.error(red(`Title too long: ${title.length} characters (max 160).`));
    process.exit(1);
  }

  // ── empty body guards (redundant with required check, but explicit)
  if (!decision) {
    console.error(red("--decision cannot be empty."));
    process.exit(1);
  }
  if (!rationale) {
    console.error(red("--rationale cannot be empty."));
    process.exit(1);
  }

  // ── secret detection
  const secretHit = checkAllFields({ title, decision, rationale, impacted, risks });
  if (secretHit) {
    console.error(red(secretHit));
    process.exit(1);
  }

  // ── DECISIONS.md must exist
  if (!fs.existsSync(DECISIONS_FILE)) {
    console.error(red(`DECISIONS.md not found at: ${DECISIONS_FILE}`));
    process.exit(1);
  }

  const existing = fs.readFileSync(DECISIONS_FILE, "utf8");

  // ── duplicate title warning
  if (existing.includes(title)) {
    console.warn(yellow(`Warning: title "${title}" already appears in DECISIONS.md. Appending anyway.`));
  }

  // ── build and append
  const entry = buildEntry({ date, title, decision, rationale, impacted, risks });

  // Ensure file ends with a newline before appending, then add separator + entry
  const separator = existing.endsWith("\n") ? "\n---\n\n" : "\n\n---\n\n";
  fs.appendFileSync(DECISIONS_FILE, separator + entry + "\n");

  // ── success report
  const relPath = path.relative(ROOT, DECISIONS_FILE);
  console.log(bold("\nDecision added:"));
  console.log(`  date:  ${green(date)}`);
  console.log(`  title: ${green(title)}`);
  console.log(`  file:  ${relPath}`);
  console.log("");
}

main();
