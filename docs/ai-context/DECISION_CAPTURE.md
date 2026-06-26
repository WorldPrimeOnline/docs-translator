---
name: decision-capture
description: When and how to record permanent decisions in DECISIONS.md
type: context-tooling
---

# Decision Capture

## Purpose

`docs/ai-context/DECISIONS.md` records permanent architectural, product, and operational decisions with enough context that a future engineer (or Claude) can understand why things are the way they are. The file is authoritative — stale or messy entries erode trust in the whole context system.

Use `scripts/context/add-decision.ts` to append entries. It enforces the required template, checks for secrets, and prevents trivial formatting mistakes.

## Command

```bash
npx tsx scripts/context/add-decision.ts \
  --title "Decision title" \
  --decision "Decision text" \
  --rationale "Rationale text" \
  --impacted "CLAUDE.md, docs/ai-context/INDEX.md" \
  --risks "Risks or caveats"
```

All flags accept a single quoted string. `--impacted` and `--risks` are optional. `--date` is optional and defaults to today (`YYYY-MM-DD`).

## When to record a decision

Record when the decision:

- **Would surprise a future engineer** who reads the code without knowing the history.
- **Cannot be inferred from the code itself** — the code shows the *what*, not the *why*.
- **Has a blast radius** — undoing it or misunderstanding it would cost significant time or money.
- **Closes off alternatives** that seemed reasonable at the time.

### Domains that almost always warrant a decision entry

| Domain | Examples |
|---|---|
| Payment architecture | Switching to quote-based flow, gating card payments, adding a new provider |
| Fiscalization mode | Choosing manual vs Webkassa, enabling/disabling FISCALIZATION_ENABLED |
| Production/staging process | Adding a new approval step, changing Railway/Vercel config policy |
| Official translation pipeline | Freezing OCR prompts, changing output format, adding a new model |
| Notarization workflow | Adding/removing notary cities, changing notarization eligibility |
| Legal / compliance | Any change driven by legal requirement, KazTax, GDPR, or compliance audit |
| Security invariants | New invariant added to 90_SECURITY_INVARIANTS.md or CLAUDE.md |
| Context system architecture | New script added, routing table changed, budget rule changed |
| Major pricing model changes | New price tiers, changed cost formula, new quote fields |
| Partner / operator workflow | New staff role, changed Jira flow, new Telegram notification type |

## When NOT to record a decision

Do not record:

- **Small UI copy edits** — changing button text, tweaking error messages.
- **CSS / layout tweaks** — padding, colour adjustments, responsive breakpoints.
- **One-off bug fixes** — unless the fix reveals a systemic invariant that must be preserved.
- **Temporary debugging notes** — these belong in the PR description, not DECISIONS.md.
- **Routine refactors without architectural consequence** — renaming a variable, extracting a helper, splitting a file for readability.
- **Implementation details obvious from code** — if a reader can immediately understand why from the code and its names, no entry is needed.
- **Meeting notes / discussions** — summarise the *outcome* only. Do not dump raw notes.

## Examples of good decisions

```
### 2026-06-25 — Context freshness is checked with deterministic repo-local audits

**Decision:**
Use deterministic file/regex checks for the freshness audit, not vector search or external APIs.

**Rationale:**
WPO's high-risk claims are narrow and concrete (cardPaymentsActive value, route existence,
fiscal provider files). Deterministic checks are faster, offline-capable, and produce zero
false positives from semantic drift.

**Impacted files/docs:**
scripts/context/freshness-audit.ts, docs/ai-context/FRESHNESS_AUDIT.md

**Risks / caveats:**
Does not catch prose inaccuracies — only symbol/file presence. Human review still needed.
```

```
### 2026-06-19 — DOCX/official translation pipeline frozen

**Decision:**
Freeze OCR prompts, translation parameters, table-classification logic, and visual-element
detection. No changes without explicit written approval.

**Rationale:**
After end-to-end testing, output quality reached acceptable level for official translation
submission. Uncontrolled changes risk breaking accepted output format.

**Impacted files/docs:**
docs/OFFICIAL_DOCX_PIPELINE_FREEZE.md, docs/ai-context/40_TRANSLATION_PIPELINE.md

**Risks / caveats:**
Must be explicitly unfrozen with a new decision entry if pipeline changes are needed.
```

## Examples of bad / noisy decisions

```
❌ ### 2026-06-25 — Changed button text
Changed "Submit" to "Send" on the upload form. Looked better.
```
*(Too trivial. No architectural consequence.)*

```
❌ ### 2026-06-25 — Fixed Jira webhook crash
Added try/catch around Jira API call so it doesn't crash the whole request.
```
*(Bug fix. Belongs in the PR description and git log, not DECISIONS.md — unless it reveals
a systemic invariant like "Jira calls must always be fire-and-forget.")*

```
❌ ### 2026-06-25 — Meeting notes
Discussed whether to use Webkassa or manual fiscal. Gleb said Webkassa is too expensive
right now. Maybe revisit Q3. Also talked about mobile app, not decided yet.
```
*(Raw meeting notes. Record the outcome once decided, not the discussion.)*

## Safety rules enforced by the script

The script refuses to write if any field contains:

- `sk-` (likely an API key)
- `Bearer ` (auth header)
- `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `MISTRAL_API_KEY`, `JIRA_API_TOKEN`, `GOOGLE_REFRESH_TOKEN`, `TELEGRAM_BOT_TOKEN`
- `HALYK` combined with `secret`, `password`, `token`, `key`, or `credential`

It also refuses if:

- `--title` exceeds 160 characters
- `--decision` or `--rationale` is empty
- `docs/ai-context/DECISIONS.md` does not exist

It warns (but does not refuse) if the title already appears in DECISIONS.md.
