# Staging Setup — Manual Steps

Complete this guide top-to-bottom before running any staging tests.
Every step that requires a dashboard or secret is documented with exact menu paths.

---

## A. GitHub — Create the `staging` branch

```bash
git checkout main
git pull origin main
git checkout -b staging
git push origin staging
```

Production remains `main`. Never merge staging back to main without a proper PR review.

---

## B. Supabase — Create a staging project

### B.1 Create the project

1. Open [supabase.com/dashboard](https://supabase.com/dashboard)
2. Click **New project**
3. Name: `WorldPrimeOnline Staging`
4. Database password: generate a strong password and save it in your password manager
5. Region: same region as production (e.g. `eu-central-1`)
6. Click **Create new project** and wait ~2 min

### B.2 Copy credentials

Go to: **Project → Settings → API**

| Variable | Where to find it |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | "Project URL" field |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | "anon / public" key |
| `SUPABASE_SERVICE_ROLE_KEY` | "service_role / secret" key (expand) |

### B.3 Apply migrations

Open: **Project → SQL Editor**

Run each file in order by copying its contents and clicking **Run**:

```
supabase/migrations/0001_initial_schema.sql
supabase/migrations/0002_auth_user_trigger.sql
supabase/migrations/0003_ton_payments.sql
supabase/migrations/0004_wallet_links.sql
supabase/migrations/0005_subscriptions.sql
supabase/migrations/0006_jobs_notarized.sql
supabase/migrations/0007_documents_detected_source_language.sql
supabase/migrations/0008_rename_payments.sql
supabase/migrations/0009_add_ip_capture.sql
supabase/migrations/0010_users_terms_accepted_at.sql
supabase/migrations/0011_official_workflow_fields.sql
```

Then apply the consolidated payment migration (only if migrations 0008+ were not yet applied):
```
supabase/APPLY_TO_SUPABASE.sql
```

> **Note:** `0011_official_workflow_fields.sql` is idempotent (uses `IF NOT EXISTS`).
> Safe to run even if the fields were added manually before.

### B.4 Create a test user

Go to: **Project → Authentication → Users → Add user**

- Email: any test email (e.g. `staging-test@yourteam.com`)
- Password: any strong password
- Click **Create user**

### B.5 Rule: never use production Supabase for staging

Production and staging must have completely separate Supabase projects.
The staging project must not contain real customer documents.

---

## C. Cloudflare R2 — Create a staging bucket

### C.1 Create the bucket

1. Open [dash.cloudflare.com](https://dash.cloudflare.com)
2. Go to: **R2 Object Storage → Create bucket**
3. Bucket name: `wpo-staging-documents`
4. Location: same region as production bucket
5. Click **Create bucket**

### C.2 Create or reuse an API token

Go to: **R2 Object Storage → Manage R2 API tokens → Create API token**

- Token name: `wpo-staging-worker`
- Permissions: **Object Read & Write**
- Bucket scope: `wpo-staging-documents` only (do NOT grant access to the production bucket)
- Click **Create API token**

Copy:
- **Account ID** (shown on the R2 overview page)
- **Access Key ID**
- **Secret Access Key**

> Do NOT make the bucket public. Downloads use presigned URLs generated server-side.

### C.3 Rule: production bucket must remain separate

The production bucket name does NOT contain "staging".
The worker startup check will fail fast if `R2_BUCKET_NAME` does not contain "staging" when `APP_ENV=staging`.

---

## D. Railway — Create a staging environment for the worker

### D.1 Create the environment

1. Open [railway.app](https://railway.app) → your WPO project
2. Go to: **Environments** (top navigation)
3. Click **New environment**
4. Name: `staging`
5. Select **Duplicate from `production`** (copies the service structure, NOT the env vars)

### D.2 Set the deploy branch

1. In the `staging` environment, click on the **worker** service
2. Go to: **Settings → Source → Branch**
3. Change branch to `staging`
4. Click **Save**

### D.3 Set staging environment variables

In the `staging` environment → worker service → **Variables**, set:

```
APP_ENV=staging
NEXT_PUBLIC_SUPABASE_URL=<staging-supabase-url>
SUPABASE_SERVICE_ROLE_KEY=<staging-service-role-key>
R2_ACCOUNT_ID=<r2-account-id>
R2_ACCESS_KEY_ID=<staging-r2-access-key>
R2_SECRET_ACCESS_KEY=<staging-r2-secret-key>
R2_BUCKET_NAME=wpo-staging-documents
ANTHROPIC_API_KEY=<your-key>
MISTRAL_API_KEY=<your-key>
EMAILS_ENABLED=false
RESEND_API_KEY=<your-key>
SITE_URL=https://<vercel-preview-url>.vercel.app
PAYMENTS_MODE=test
OFFICIAL_WORKFLOW_ENABLED=true
POLL_INTERVAL_MS=10000
WORKER_CONCURRENCY=1
```

> Set `EMAILS_ENABLED=false` to suppress all customer emails during testing.
> Or set `EMAILS_ENABLED=true` + `EMAIL_REDIRECT_ALL_TO=your-internal@email.com` to redirect.

### D.4 Redeploy

Click **Deploy** in the staging environment. Wait for the build to complete.

### D.5 Verify worker logs

In the staging worker service → **Logs**, look for:

```
[worker:env] APP_ENV              = staging
[worker:env] R2_BUCKET_NAME       = wpo-staging-documents
[worker:env] EMAILS_ENABLED       = false
[worker:env] PAYMENTS_MODE        = test
[worker] started — poll every 10000ms, concurrency 1
```

If you see `FATAL: APP_ENV=staging but PAYMENTS_MODE is not "test"` — fix `PAYMENTS_MODE`.
If you see `FATAL: ... R2_BUCKET_NAME ... does not look like a staging bucket` — fix `R2_BUCKET_NAME`.

---

## E. Vercel — Configure Preview deployments for `staging`

### E.1 Enable Preview deployments

1. Open [vercel.com](https://vercel.com) → your WPO project
2. Go to: **Settings → Git**
3. Ensure **Preview Deployments** is enabled (default: on)
4. The `staging` branch will automatically get a Preview deployment when you push

### E.2 Set Preview environment variables

Go to: **Settings → Environment Variables**

For each variable below, set **Environment = Preview** (not Production):

```
NEXT_PUBLIC_APP_ENV=staging
NEXT_PUBLIC_SITE_URL=https://<vercel-preview-url>.vercel.app
NEXT_PUBLIC_SUPABASE_URL=<staging-supabase-url>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<staging-anon-key>
SUPABASE_SERVICE_ROLE_KEY=<staging-service-role-key>
R2_ACCOUNT_ID=<r2-account-id>
R2_ACCESS_KEY_ID=<staging-r2-access-key>
R2_SECRET_ACCESS_KEY=<staging-r2-secret-key>
R2_BUCKET_NAME=wpo-staging-documents
ANTHROPIC_API_KEY=<your-key>
MISTRAL_API_KEY=<your-key>
EMAILS_ENABLED=false
RESEND_API_KEY=<your-key>
PAYMENTS_MODE=test
OFFICIAL_WORKFLOW_ENABLED=true
CRON_SECRET=<random-staging-secret>
```

> If you want to also scope them to the `staging` branch only: after adding each variable,
> click the **branch** scope and enter `staging`.

### E.3 Push to trigger a build

```bash
git push origin staging
```

Open the Vercel dashboard → Deployments → find the Preview for `staging` branch → copy the URL.

### E.4 Verify staging banner

Open the Preview URL in a browser. You should see an amber bar at the top:
```
STAGING MODE — test environment
```
This banner only appears when `NEXT_PUBLIC_APP_ENV=staging`.

---

## F. Resend — Email safety

### Option 1 (recommended): Disable all emails

Set `EMAILS_ENABLED=false` in both Vercel Preview and Railway staging vars.
No emails will be sent. The worker logs the intended recipient for debugging.

### Option 2: Redirect all emails to an internal address

Set:
```
EMAILS_ENABLED=true
EMAIL_REDIRECT_ALL_TO=staging-test@yourteam.com
```

All emails will go to `staging-test@yourteam.com` with a `[STAGING]` subject prefix.
The original intended recipient is logged but not exposed.

> Never use `EMAILS_ENABLED=true` without `EMAIL_REDIRECT_ALL_TO` in staging.

---

## G. Payments — Halyk/ePay test credentials

1. Contact Halyk Bank ePay support and request test/sandbox credentials:
   - Test terminal ID
   - Test client ID
   - Test client secret

2. Set in Vercel Preview and Railway staging:
   ```
   PAYMENTS_MODE=test
   HALYK_TERMINAL_ID=<test-terminal-id>
   HALYK_CLIENT_ID=<test-client-id>
   HALYK_CLIENT_SECRET=<test-client-secret>
   ```

3. **NEVER** use production Halyk credentials in staging.
   The worker startup check verifies `PAYMENTS_MODE=test` when `APP_ENV=staging` and fails fast if not.

---

## H. First staging test run

After everything is deployed, run through this sequence:

### H.1 Normal PDF translation

1. Log in with the staging test user
2. Upload a simple PDF (any document)
3. Select source language, target language, document type
4. Do NOT check the "Official/Notary" option
5. Submit (subscription path)

**Expected:**
- Job status: `queued → ocr_in_progress → ... → completed`
- `jobs.workflow_status = 'completed'`
- R2 contains a `.pdf` or `.html` file in `wpo-staging-documents`
- Download works from dashboard
- No email sent (if `EMAILS_ENABLED=false`) or redirected email (if redirect configured)

### H.2 Official/notary translation

1. Upload a PDF
2. Check the "Official/Notary translation" option
3. Submit

**Expected:**
- `jobs.workflow_status = 'awaiting_translator_review'`
- R2 contains a `.docx` (draft) and a preview `.pdf` in `wpo-staging-documents`
- Download from dashboard returns HTTP 403 ("awaiting translator review")
- `translations.translated_docx_key` is set
- `translations.translated_preview_pdf_key` is set
- `translations.qa_report` is a non-null JSON

### H.3 Verify DB rows in Supabase

Go to: **Supabase → staging project → Table Editor → jobs**
Check that `workflow_status` is correct for each test job.

Go to: **Table Editor → translations**
Check that `translated_pdf_key`, `translated_docx_key`, `qa_report` are populated correctly.

### H.4 Verify R2 artifacts

Go to: **Cloudflare → R2 → wpo-staging-documents**
You should see the generated files. You should NOT see any files from the production bucket.

---

## Checklist summary

- [ ] `staging` branch pushed to GitHub
- [ ] Supabase staging project created and all migrations applied
- [ ] R2 `wpo-staging-documents` bucket created
- [ ] Railway staging environment created with correct env vars
- [ ] Worker deploys from `staging` branch
- [ ] Worker logs show `APP_ENV=staging`, `PAYMENTS_MODE=test`, `EMAILS_ENABLED=false`
- [ ] Vercel Preview env vars set for `staging` branch
- [ ] Staging banner visible in browser
- [ ] Normal translation test passed
- [ ] Official/notary translation test passed
- [ ] No customer emails sent or verified as redirected
