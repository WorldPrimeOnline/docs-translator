# _legacy

These are the original flat `messages/{locale}.json` files from before the namespace migration (2026-06-24).

They are **no longer loaded** — `src/i18n/request.ts` now loads from `messages/{locale}/{namespace}.json`.

Do not edit these files. They are kept for reference only and will be deleted after staging QA confirms the namespace structure works correctly.

See: `scripts/i18n/migrate-to-namespaces.mjs` for the migration script that produced the namespace files from these.
