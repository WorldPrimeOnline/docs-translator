# Deployment Workflow — WorldPrimeOnline

## Branch map

```
main        → Vercel Production  + Railway production worker
staging     → Vercel Preview     + Railway staging worker
feature/*   → local dev only
hotfix/*    → local dev only
```

`feature/*` branches are based on `staging`.
`hotfix/*` branches are based on `main`.

---

## Feature workflow

```bash
git checkout staging && git pull origin staging
git checkout -b feature/<name>

# develop, then verify:
npm run typecheck
npm run lint
npm test
npm run build          # or cd worker && npm run build

git push origin feature/<name>
# open PR → staging
```

Merge target: **`staging`**. Never target `main` for feature branches.

---

## Staging deployment

Merging into `staging` triggers an automatic Vercel Preview deployment and redeploys the Railway staging worker via its `staging` branch watch.

Staging must use:
- Staging Supabase project (separate from production)
- Staging R2 bucket (separate from production)
- Railway staging worker environment

A green build on staging is not approval for production. Explicit user sign-off is required.

---

## Production promotion

**Trigger phrase required:** `Разрешаю продвигать staging в production`

Steps:
1. Run pre-promotion report:
   ```bash
   git log main..staging --oneline          # commits being promoted
   git diff main..staging --name-only       # changed files
   ```
2. Identify any new database migrations and flag destructive operations.
3. List new or changed environment variable **names** (never values).
4. State risks and rollback plan.
5. Open PR: `staging` → `main`.
6. After merge, verify Vercel Production deployment and Railway production worker.

---

## Hotfix workflow

```bash
git checkout main && git pull origin main
git checkout -b hotfix/<name>

# apply minimal fix, test
git push origin hotfix/<name>
# open PR → main (requires explicit approval)

# after main merge, back-port to staging:
git checkout staging
git cherry-pick <commit-hash>
git push origin staging
```

Back-porting keeps `staging` ahead of `main` and prevents divergence.

---

## Database migrations

| Stage | Rule |
|---|---|
| Development | Write migration in `supabase/migrations/` |
| Staging | Apply via Supabase CLI against staging project; test before promoting |
| Production | Apply only during an approved promotion; never edit an applied migration |

Flag before executing: `DROP TABLE`, `DROP COLUMN`, `DELETE`, column type changes, `NOT NULL` additions on populated columns.

---

## Environment variable discipline

- Never commit secret values. Report names only.
- Each variable belongs to exactly one target: Vercel Preview, Vercel Production, Railway staging, or Railway production.
- Staging must not reference production Supabase URLs or production R2 bucket names.
- Production must not reference staging resources.
- Run `npm run staging:check` (web) or `npm run staging:check` from repo root with `--worker` flag to validate env completeness before deploying.

---

## Related docs

- `docs/STAGING_SETUP.md` — initial staging infrastructure setup
- `docs/STAGING_ENV_VARS.md` — environment variable reference by target
- `docs/STAGING_QA_CHECKLIST.md` — manual QA steps before promotion
- `docs/MIGRATION_AUDIT.md` — migration history and status
