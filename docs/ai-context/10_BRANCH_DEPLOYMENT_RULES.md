# Branch and Deployment Rules

## Branch map

| Branch | Environment | Deployed to |
|---|---|---|
| `main` | Production | Vercel Production + Railway production worker |
| `staging` | Staging | Vercel Preview + Railway staging worker |

`feature/*` and `hotfix/*` branches are **not used** unless the user explicitly requests one.

## Mandatory pre-task check

Before making any change, always run and report all three:

```bash
git branch --show-current
git status --short
git log -1 --oneline
```

## Normal workflow — commit directly to `staging`

```bash
git checkout staging
git pull origin staging
# make changes
npm run typecheck && npm run lint && npm test && npm run build
git commit -m "feat: ..."
git push origin staging
```

Do **not** create `feature/*` or `hotfix/*` branches unless the user explicitly asks.

## `main` is off-limits

- Never work directly on `main`.
- Never commit to `main`.
- Never push to `main`.
- Never merge anything into `main`.
- Never deploy or promote to production unless the user explicitly says:
  > `Разрешаю продвигать staging в production`
  or gives an equally explicit production approval in any language.

## Staging rules

- Code pushed to `staging` deploys to the Vercel Preview staging site and the Railway staging worker.
- Staging must point to the **staging** Supabase project and **staging** R2 bucket. Never point staging at production resources.
- A successful staging build does not constitute approval. Wait for explicit manual acceptance.

## Ambiguous instructions

If the user says "deploy", "release", "push it", or "make it live" without specifying staging or production, **ask before acting**.

## Production promotion (requires explicit approval)

Only after the user says `Разрешаю продвигать staging в production` (or equivalent). Before promoting, report:

1. Commits being promoted (`git log main..staging --oneline`)
2. Changed files (`git diff main..staging --name-only`)
3. Database migrations that will be applied
4. New or changed environment variable names (names only — never print values)
5. Identified risks
6. Rollback plan
7. Test results

Merge `staging` → `main` directly (fast-forward or merge commit). Do not include unrelated or untested changes.

## Hotfix workflow (only when explicitly requested)

```bash
git checkout main
git pull origin main
git checkout -b hotfix/<short-name>
# minimal fix, test
# open PR → main (with explicit approval)
# after merge to main, also cherry-pick into staging:
git checkout staging && git cherry-pick <commit>
```

## Database migrations

- Apply and test new migrations on staging Supabase first.
- Production migration is only allowed during an approved production promotion.
- Never edit an already-applied production migration — create a new forward migration instead.
- Before running any migration, identify and flag destructive operations: `DROP`, `DELETE`, column type changes, `NOT NULL` additions.

## Environment variables

- Never print or commit secret values — report variable names only.
- Label each variable by target:
  - **Vercel Preview** (staging web)
  - **Vercel Production** (production web)
  - **Railway staging** (staging worker)
  - **Railway production** (production worker)
- Fail or warn if staging config references production Supabase URLs or production R2 bucket names, and vice versa.
- Do not add new env vars beyond those listed in `PROJECT_CONTEXT.md § 15`.

## End-of-task report

After every task, report:

- Current branch
- Files changed
- Commands run and their results
- Test results
- Commit hash (if created)
- Where the change should be merged next
- Any required manual action in Vercel, Railway, Supabase, R2, or payment systems

## Reference docs

- `docs/DEPLOYMENT_WORKFLOW.md` — canonical workflow reference
- `docs/STAGING_SETUP.md`, `docs/STAGING_ENV_VARS.md`, `docs/STAGING_QA_CHECKLIST.md`, `docs/MIGRATION_AUDIT.md`
- `docs/operations/PRODUCTION_DEPLOY_RUNBOOK.md`
