# Codebase Memory MCP Rules

## When to use

Use codebase-memory-mcp as the **first step** before non-trivial analysis or code changes.

**Always use before touching:**
- Pricing calculation (quote engine: `src/lib/pricing/`, `price_quotes`, `cost_reservations`)
- Checkout and Halyk/ePay payment flow
- `payment_transactions` and order status updates
- Jira issue creation, custom fields, and workflow status mapping
- Google Drive folder/file creation
- Supabase order/payment/document logic
- PDF/DOCX generation and official translation rendering
- i18n, legal, public, footer, checkout, refund, privacy, consent, disclaimer texts
- Staging/production environment separation
- Worker/background processing
- File storage, Cloudflare R2, upload/download flows
- Client document handling and deletion logic

## Available tools

| Tool | Use for |
|---|---|
| `search_graph(name_pattern/label/qn_pattern)` | Find functions, classes, routes |
| `trace_path(function_name, mode=calls\|data_flow\|cross_service)` | Call chains, data flow |
| `get_code_snippet(qualified_name)` | Exact symbol source (precise ranges) |
| `query_graph(query)` | Complex Cypher patterns |
| `get_architecture(aspects)` | Project structure |
| `search_code(pattern)` | Text search (graph-augmented grep) |

If the project is not indexed yet, run `index_repository` first.

## Required workflow

1. Use codebase-memory-mcp to find affected files, symbols, routes, functions, imports, and call chains.
2. Explain the blast radius and risks before editing.
3. Read the exact affected files.
4. Propose the patch.
5. Do not edit until the affected flow and risk points are clear.
6. After edits, use codebase-memory-mcp or git diff analysis to identify impacted flows and required QA checks.

## Rules

- Do not rely only on graph results. Always read exact files before editing.
- Do not expose or print secrets from `.env` files.
- Do not index or inspect real client documents.
- Do not commit `.codebase-memory/`.
- Do not make broad refactors unless explicitly requested.
- For payment, legal, pricing, tax, refund, notarization, and official translation logic, be conservative and explain risks first.
- For WPO, do not change the tech stack without explicit approval.
- Do not hardcode RU-only public/legal/payment texts; use i18n.
- Do not make claims like "guaranteed accepted", "AI certified translation", or "automatic notarization".

## Default prompt behavior

When the user asks to fix, inspect, refactor, or debug WPO code:
1. First say which codebase-memory-mcp query/tooling you will use.
2. Inspect the graph.
3. Continue with file reads and edits only if needed.
