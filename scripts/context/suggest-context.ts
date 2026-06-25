#!/usr/bin/env npx tsx
/**
 * Context Suggester — deterministic keyword-based context routing
 * Usage: npx tsx scripts/context/suggest-context.ts "fix Halyk callback amount mismatch"
 */

const task = process.argv.slice(2).join(" ").trim();

if (!task) {
  console.error("Usage: npx tsx scripts/context/suggest-context.ts \"<task description>\"");
  process.exit(1);
}

// ── types ─────────────────────────────────────────────────────────────────────

interface DomainDef {
  name: string;
  keywords: string[];
  primary: string[];
  secondary: string[];
  checks: string[];
  rgPatterns: string[];
  highRisk: boolean;
}

// ── domain definitions ────────────────────────────────────────────────────────

const DOMAINS: DomainDef[] = [
  {
    name: "deployment",
    keywords: ["deploy", "deployment", "production", "staging", "main branch", "vercel", "railway", "hotfix", "promote", "branch", "push to"],
    primary: [
      "docs/ai-context/10_BRANCH_DEPLOYMENT_RULES.md",
      "docs/ai-context/90_SECURITY_INVARIANTS.md",
    ],
    secondary: ["docs/ai-context/20_COMMANDS_AND_TESTS.md"],
    checks: [
      "run mandatory pre-task git check",
      "production requires exact phrase: Разрешаю продвигать staging в production",
      "never work on main directly",
    ],
    rgPatterns: [
      'rg -n "staging|production|main|deploy" docs/ai-context',
    ],
    highRisk: true,
  },
  {
    name: "payments",
    keywords: ["halyk", "epay", "payment", "callback", "checkout", "cardpaymentsactive", "payment_transactions", "initiate", "payment gateway", "card payment"],
    primary: [
      "docs/ai-context/50_PAYMENTS_FINANCE_FISCALIZATION.md",
      "docs/ai-context/90_SECURITY_INVARIANTS.md",
      "docs/ai-context/95_CODEBASE_MEMORY_MCP_RULES.md",
    ],
    secondary: [
      "docs/ai-context/70_DATABASE_AND_API_SURFACE.md",
      "docs/ai-context/30_ARCHITECTURE_OVERVIEW.md",
    ],
    checks: [
      "codebase-memory-mcp first",
      "never trust client-provided payment amounts — always read from price_quotes.amount_kzt",
      "verify quote ownership/status/amount before payment",
      "never bypass verifyQuotePayable()",
    ],
    rgPatterns: [
      'rg -n "Halyk|ePay|payment_transactions|verifyQuotePayable|cardPaymentsActive" docs/ai-context src worker',
      'rg -n "price_quotes|amount_kzt|quote_id|amount_source" docs/ai-context src worker',
    ],
    highRisk: true,
  },
  {
    name: "pricing",
    keywords: ["quote", "price_quotes", "cost_reservations", "pricing", "unit economics", "amount_kzt", "computequoteforjob", "savequote", "pricingversion"],
    primary: [
      "docs/ai-context/50_PAYMENTS_FINANCE_FISCALIZATION.md",
      "docs/ai-context/95_CODEBASE_MEMORY_MCP_RULES.md",
    ],
    secondary: [
      "docs/ai-context/70_DATABASE_AND_API_SURFACE.md",
      "docs/ai-context/90_SECURITY_INVARIANTS.md",
    ],
    checks: [
      "codebase-memory-mcp first",
      "quotes are immutable once status=quoted/paid",
      "client-provided amounts are never used",
    ],
    rgPatterns: [
      'rg -n "price_quotes|computeQuoteForJob|saveQuote|amount_kzt|pricing_versions" docs/ai-context src',
      'rg -n "cost_reservations|quote_id|verifyQuotePayable|markQuotePaid" src worker',
    ],
    highRisk: true,
  },
  {
    name: "fiscalization",
    keywords: ["fiscal", "webkassa", "receipt", "refund", "refund_transactions", "fiscal_receipts", "ofd", "fiscalization", "createSaleReceipt", "createRefundReceipt"],
    primary: [
      "docs/ai-context/50_PAYMENTS_FINANCE_FISCALIZATION.md",
      "docs/ai-context/90_SECURITY_INVARIANTS.md",
    ],
    secondary: [
      "docs/ai-context/70_DATABASE_AND_API_SURFACE.md",
      "docs/ai-context/20_COMMANDS_AND_TESTS.md",
    ],
    checks: [
      "codebase-memory-mcp first",
      "fiscalization is non-blocking and idempotent",
      "unique constraint on (payment_transaction_id, operation_type) must not be removed",
    ],
    rgPatterns: [
      'rg -n "fiscal|Webkassa|fiscal_receipts|refund_transactions|createSaleReceipt" docs/ai-context src worker',
      'rg -n "FISCAL_PROVIDER|FISCALIZATION_ENABLED|pending_manual|retry_required" src worker',
    ],
    highRisk: true,
  },
  {
    name: "translation_pipeline",
    keywords: ["ocr", "docx", "pdf", "renderer", "visual elements", "protected values", "qa", "translation", "page-vision", "mistral", "page vision", "docx renderer", "html renderer", "visual block", "translate", "output plan"],
    primary: [
      "docs/ai-context/40_TRANSLATION_PIPELINE.md",
      "docs/ai-context/30_ARCHITECTURE_OVERVIEW.md",
      "docs/ai-context/95_CODEBASE_MEMORY_MCP_RULES.md",
    ],
    secondary: [
      "docs/ai-context/70_DATABASE_AND_API_SURFACE.md",
      "docs/OFFICIAL_DOCX_PIPELINE_FREEZE.md",
    ],
    checks: [
      "codebase-memory-mcp first",
      "DOCX/official pipeline is FROZEN since 2026-06-19 — check docs/OFFICIAL_DOCX_PIPELINE_FREEZE.md before any changes",
      "five MODEL constants must be updated together when changing the model",
      "synced duplicates between web and worker must be kept in sync",
    ],
    rgPatterns: [
      'rg -n "extractProtectedValues|mergeVisualElements|runQaChecks|analyzeDocumentVisuals|buildTranslationPrompt" src worker',
      'rg -n "docx-renderer|docx-visual-block|visual-elements|page-vision|output-plan" src worker',
      'rg -n "MODEL|claude-sonnet" src/lib/translation src/lib/ocr worker/src/lib',
    ],
    highRisk: true,
  },
  {
    name: "official_notary_workflow",
    keywords: ["official", "notary", "notarized", "translator review", "signature", "stamp", "bureau stamp", "notarization", "awaiting_translator_review", "notarization_package", "service_level"],
    primary: [
      "docs/ai-context/40_TRANSLATION_PIPELINE.md",
      "docs/ai-context/60_INTEGRATIONS_JIRA_DRIVE_TELEGRAM.md",
      "docs/ai-context/90_SECURITY_INVARIANTS.md",
    ],
    secondary: [
      "docs/ai-context/50_PAYMENTS_FINANCE_FISCALIZATION.md",
      "docs/ai-context/70_DATABASE_AND_API_SURFACE.md",
    ],
    checks: [
      "codebase-memory-mcp first",
      "never claim guaranteed acceptance or automatic notarization",
      "DOCX/official pipeline is FROZEN — check docs/OFFICIAL_DOCX_PIPELINE_FREEZE.md",
    ],
    rgPatterns: [
      'rg -n "computeOutputPlan|service_level|notarization_package|translator_review_draft|awaiting_translator_review" src worker',
      'rg -n "official_with_translator|notarization_through_partners|deriveBackcompatBooleans" src worker',
    ],
    highRisk: true,
  },
  {
    name: "integrations",
    keywords: ["jira", "google drive", "telegram", "staff_profiles", "notification_log", "notification", "webhook", "assignee", "chat_id"],
    primary: [
      "docs/ai-context/60_INTEGRATIONS_JIRA_DRIVE_TELEGRAM.md",
      "docs/ai-context/90_SECURITY_INVARIANTS.md",
      "docs/ai-context/95_CODEBASE_MEMORY_MCP_RULES.md",
    ],
    secondary: [
      "docs/ai-context/70_DATABASE_AND_API_SURFACE.md",
      "docs/ai-context/30_ARCHITECTURE_OVERVIEW.md",
    ],
    checks: [
      "codebase-memory-mcp first",
      "never put sensitive data (IIN/BIN, document content, payment credentials) into Jira summaries/descriptions",
      "WPO never calls Jira API for transitions — only creates issues",
      "personal Telegram routing uses staff_profiles.telegram_chat_id not env vars",
    ],
    rgPatterns: [
      'rg -n "initializeOrderIntegrations|triggerTranslatorReview|handleAssigneeChanged|sendDirectMessageWithButtons" src worker',
      'rg -n "staff_profiles|notification_log|jira_issue_key|finance_jira_issue_key" src worker',
    ],
    highRisk: true,
  },
  {
    name: "database_api",
    keywords: ["supabase", "migration", "rls", "api route", "table", "schema", "database", "sql", "query", "tables<", "tablesinsert"],
    primary: [
      "docs/ai-context/70_DATABASE_AND_API_SURFACE.md",
      "docs/ai-context/10_BRANCH_DEPLOYMENT_RULES.md",
      "docs/ai-context/90_SECURITY_INVARIANTS.md",
    ],
    secondary: [],
    checks: [
      "migration destructive-op check: flag DROP, DELETE, column type changes, NOT NULL additions",
      "never edit applied production migrations — create forward migrations only",
      "use generated Supabase types: Tables<>, TablesInsert<>, TablesUpdate<>",
    ],
    rgPatterns: [
      'rg -n "Tables<|TablesInsert<|TablesUpdate<" src worker',
      'rg -n "supabase.from\\|createClient" src worker',
    ],
    highRisk: true,
  },
  {
    name: "i18n_legal",
    keywords: ["i18n", "locale", "legal", "privacy", "refund policy", "consent", "disclaimer", "terms", "messages/", "next-intl", "usetranslations", "t("],
    primary: [
      "docs/ai-context/80_I18N_LEGAL_PUBLIC_CONTENT.md",
      "docs/ai-context/90_SECURITY_INVARIANTS.md",
    ],
    secondary: ["docs/ai-context/30_ARCHITECTURE_OVERVIEW.md"],
    checks: [
      "add new keys to en.json first, then propagate to all 11 locales",
      "run: bash scripts/check-i18n.sh to find hardcoded strings",
      "never claim guaranteed acceptance or AI certified translation",
      "legal text changes must cover all 11 locale files",
    ],
    rgPatterns: [
      'rg -n "useTranslations|getTranslations" src',
      'rg -rn "offer|privacy|personal-data-consent|refund-policy|disclaimer|terms|partners" src/lib/legal',
    ],
    highRisk: false,
  },
  {
    name: "landing_pages",
    keywords: ["landing", "kazakhstan page", "documents page", "seo", "marketing page", "landingpageconfig", "landingpage", "vertical"],
    primary: [
      "docs/ai-context/30_ARCHITECTURE_OVERVIEW.md",
      "docs/ai-context/80_I18N_LEGAL_PUBLIC_CONTENT.md",
    ],
    secondary: ["PROJECT_CONTEXT.md"],
    checks: [
      "check config-driven landing system — do not duplicate section components",
      "extend LandingPageConfig instead of adding new section components",
    ],
    rgPatterns: [
      'rg -n "LandingPageConfig|LandingPage" src',
      'rg -rn "kazakhstan|documents" src/app --include="*.tsx" -l',
    ],
    highRisk: false,
  },
  {
    name: "env_security",
    keywords: ["env", "secret", "staging resources", "production resources", "r2", "supabase url", ".env", "environment variable", "cron_secret", "api_key"],
    primary: [
      "docs/ai-context/90_SECURITY_INVARIANTS.md",
      "docs/ai-context/10_BRANCH_DEPLOYMENT_RULES.md",
      "docs/ai-context/30_ARCHITECTURE_OVERVIEW.md",
    ],
    secondary: ["docs/ai-context/20_COMMANDS_AND_TESTS.md"],
    checks: [
      "never print or commit secret values — report variable names only",
      "staging must point to staging Supabase/R2 only",
      "no new env vars beyond those in PROJECT_CONTEXT.md §15",
    ],
    rgPatterns: [
      'rg -n "process.env\\." src/lib/env.ts worker/src/lib/env.ts',
    ],
    highRisk: true,
  },
  {
    name: "general_code",
    keywords: [],
    primary: [],
    secondary: ["docs/ai-context/30_ARCHITECTURE_OVERVIEW.md"],
    checks: [
      "use rg to find exact file/function before reading large context",
      "do not over-read context for small fixes",
    ],
    rgPatterns: [],
    highRisk: false,
  },
  {
    name: "context_system",
    keywords: ["claude.md", "ai-context", "context_router", "context router", "context manifest", "context system", "memory", "context doc", "context file", "suggest-context", "check-context", "search-context"],
    primary: [
      "docs/ai-context/96_CONTEXT_MAINTENANCE_RULES.md",
      "docs/ai-context/DECISIONS.md",
      "docs/ai-context/INDEX.md",
    ],
    secondary: [],
    checks: [
      "run npx tsx scripts/context/check-context.ts before committing context-system changes",
      "keep CLAUDE.md under 10,000 characters (hard ceiling 15,000)",
    ],
    rgPatterns: [
      'rg -n "CONTEXT_ROUTER|CONTEXT_MANIFEST|96_CONTEXT_MAINTENANCE" CLAUDE.md docs/ai-context',
    ],
    highRisk: false,
  },
];

const BOOTLOADER_DOCS = [
  "CLAUDE.md",
  "PROJECT_CONTEXT.md",
  "docs/ai-context/INDEX.md",
  "docs/ai-context/CONTEXT_ROUTER.md",
];

// ── classify ──────────────────────────────────────────────────────────────────

function classify(task: string): DomainDef[] {
  const lower = task.toLowerCase();
  const matched = DOMAINS.filter((d) => {
    if (d.name === "general_code") return false;
    return d.keywords.some((kw) => lower.includes(kw.toLowerCase()));
  });
  if (matched.length === 0) {
    return [DOMAINS.find((d) => d.name === "general_code")!];
  }
  return matched;
}

// ── deduplicate lists ─────────────────────────────────────────────────────────

function unique<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

// ── format ────────────────────────────────────────────────────────────────────

function bold(s: string): string { return `\x1b[1m${s}\x1b[0m`; }
function cyan(s: string): string { return `\x1b[36m${s}\x1b[0m`; }
function yellow(s: string): string { return `\x1b[33m${s}\x1b[0m`; }
function red(s: string): string { return `\x1b[31m${s}\x1b[0m`; }
function green(s: string): string { return `\x1b[32m${s}\x1b[0m`; }

// ── main ──────────────────────────────────────────────────────────────────────

function main(): void {
  const matched = classify(task);
  const needsMcp = matched.some((d) => d.highRisk);

  const allPrimary = unique(matched.flatMap((d) => d.primary)).filter(
    (f) => !BOOTLOADER_DOCS.includes(f)
  );
  const allSecondary = unique(matched.flatMap((d) => d.secondary))
    .filter((f) => !BOOTLOADER_DOCS.includes(f) && !allPrimary.includes(f));
  const allChecks = unique(matched.flatMap((d) => d.checks));
  const allRg = unique(matched.flatMap((d) => d.rgPatterns));

  console.log(bold("\nSuggested Context\n") + "=".repeat(40));

  console.log(bold("\nTask:"));
  console.log(`  ${task}`);

  console.log(bold("\nDetected domains:"));
  matched.forEach((d) => console.log(`  - ${cyan(d.name)}${d.highRisk ? red(" [high-risk]") : ""}`));

  console.log(bold("\nBootloader docs (always load):"));
  BOOTLOADER_DOCS.forEach((f) => console.log(`  - ${f}`));

  console.log(bold("\nPrimary docs:"));
  if (allPrimary.length === 0) {
    console.log("  (none — check CONTEXT_ROUTER.md for your domain)");
  } else {
    allPrimary.slice(0, 3).forEach((f) => console.log(`  - ${green(f)}`));
    if (allPrimary.length > 3) {
      console.log(yellow(`  + ${allPrimary.length - 3} more (budget exceeded — justify before loading)`));
      allPrimary.slice(3).forEach((f) => console.log(`    - ${f}`));
    }
  }

  console.log(bold("\nSecondary docs:"));
  if (allSecondary.length === 0) {
    console.log("  (none)");
  } else {
    allSecondary.slice(0, 2).forEach((f) => console.log(`  - ${f}`));
    if (allSecondary.length > 2) {
      console.log(yellow(`  + ${allSecondary.length - 2} more (load only if task touches those areas)`));
      allSecondary.slice(2).forEach((f) => console.log(`    - ${f}`));
    }
  }

  if (needsMcp) {
    console.log(bold("\n" + red("⚠  codebase-memory-mcp required before editing.")));
  }

  console.log(bold("\nMandatory checks:"));
  allChecks.forEach((c) => console.log(`  - ${c}`));

  if (allRg.length > 0) {
    console.log(bold("\nSuggested search:"));
    allRg.forEach((r) => console.log(`  ${r}`));
  }

  console.log("");
}

main();
