# Decisions

Permanent architectural, product, and operations decisions for WPO.

This file records decisions that should survive across sessions and explain why the project works this way.

## Format

Each decision uses:

### YYYY-MM-DD — Decision title

**Decision:**
...

**Rationale:**
...

**Impacted files/docs:**
...

**Risks / caveats:**
...

---

## Decisions

### 2026-06-25 — AI context routing uses lightweight repo-local scripts, not a vector database

**Decision:**
The AI context retrieval system uses three lightweight `npx tsx` scripts (`check-context.ts`, `suggest-context.ts`, `search-context.ts`) in `scripts/context/`. No vector database, embedding store, or external service is used for context retrieval.

**Rationale:**
Deterministic keyword routing is sufficient for a focused codebase with stable, well-named domains. Vector search adds infrastructure complexity, requires embeddings to stay current, and introduces an external dependency that could fail silently. Repo-local scripts have zero cold-start cost, run without network access, and are auditable in version control.

**Impacted files/docs:**
- `scripts/context/check-context.ts`
- `scripts/context/suggest-context.ts`
- `scripts/context/search-context.ts`
- `docs/ai-context/CONTEXT_ROUTER.md`
- `docs/ai-context/20_COMMANDS_AND_TESTS.md`

**Risks / caveats:**
Keyword matching can miss novel task descriptions that don't use expected vocabulary. Mitigation: `suggest-context.ts` defaults to the `general_code` domain when no keywords match, and always includes the bootloader docs. The routing table in `CONTEXT_ROUTER.md` should be expanded as new domains emerge.

---

### 2026-06-25 — CLAUDE.md is a compact bootloader, not the full project knowledge base

**Decision:**
`CLAUDE.md` must stay compact and contain only global operating rules, critical safety constraints, mandatory read-first instructions, and the context map. Detailed knowledge lives in `PROJECT_CONTEXT.md` and `docs/ai-context/*.md`.

**Rationale:**
The previous `CLAUDE.md` exceeded 40,000 characters and mixed operational rules with detailed architecture documentation. Splitting the context into routed markdown files keeps startup context small while preserving detailed knowledge in version-controlled docs.

**Impacted files/docs:**
- `CLAUDE.md`
- `PROJECT_CONTEXT.md`
- `docs/ai-context/INDEX.md`
- `docs/ai-context/*.md`

**Risks / caveats:**
Claude must actually read `INDEX.md` and the relevant context files before risky work. The end-of-task context maintenance check (see `docs/ai-context/96_CONTEXT_MAINTENANCE_RULES.md`) is required to prevent the docs from becoming stale.
