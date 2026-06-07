# Staging Environment Variables

Complete reference for all environment variables needed in the staging environment.

Legend:
- **R** = Required (service will not start without this)
- **O** = Optional
- **FE** = Frontend only (NEXT_PUBLIC_* — safe to expose in browser)
- **BE** = Server/backend only (never expose to browser)
- **W** = Worker only (Railway)
- **S** = Secret (rotate if exposed)

---

## 1. Vercel Preview — Web App Variables

Set scope to **Preview** only. Never set on Production scope.

| Variable | Value in staging | R/O | FE/BE | S | Notes |
|---|---|---|---|---|---|
| `NEXT_PUBLIC_APP_ENV` | `staging` | R | FE | — | Enables staging banner |
| `NEXT_PUBLIC_SITE_URL` | Vercel Preview URL | R | FE | — | No trailing slash |
| `NEXT_PUBLIC_SUPABASE_URL` | Staging Supabase URL | R | FE | — | From staging Supabase project |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Staging anon key | R | FE | — | From staging Supabase project |
| `SUPABASE_SERVICE_ROLE_KEY` | Staging service role key | R | BE | S | Never expose to client |
| `R2_ACCOUNT_ID` | Your Cloudflare account ID | R | BE | — | Same account, different bucket |
| `R2_ACCESS_KEY_ID` | Staging R2 access key | R | BE | S | Scoped to staging bucket only |
| `R2_SECRET_ACCESS_KEY` | Staging R2 secret key | R | BE | S | Scoped to staging bucket only |
| `R2_BUCKET_NAME` | `wpo-staging-documents` | R | BE | — | Must contain "staging" |
| `ANTHROPIC_API_KEY` | Your Anthropic key | R | BE | S | Can share with production |
| `MISTRAL_API_KEY` | Your Mistral key | R | BE | S | Can share with production |
| `RESEND_API_KEY` | Your Resend key | O | BE | S | Required if EMAILS_ENABLED=true |
| `EMAILS_ENABLED` | `false` | R | BE | — | Suppress all emails in staging |
| `EMAIL_REDIRECT_ALL_TO` | Internal test email | O | BE | — | Used if EMAILS_ENABLED=true |
| `PAYMENTS_MODE` | `test` | R | BE | — | Must be "test" in staging |
| `HALYK_TERMINAL_ID` | Halyk test terminal ID | O | BE | S | Required when payments active |
| `HALYK_CLIENT_ID` | Halyk test client ID | O | BE | S | Required when payments active |
| `HALYK_CLIENT_SECRET` | Halyk test client secret | O | BE | S | Required when payments active |
| `OFFICIAL_WORKFLOW_ENABLED` | `true` | O | BE | — | Enables notary workflow testing |
| `CRON_SECRET` | Any random string | O | BE | S | Different from production |

---

## 2. Railway Staging — Worker Variables

Set these in Railway → Project → `staging` environment → worker service → Variables.

| Variable | Value in staging | R/O | W | S | Notes |
|---|---|---|---|---|---|
| `APP_ENV` | `staging` | R | W | — | Worker startup safety checks use this |
| `NEXT_PUBLIC_SUPABASE_URL` | Staging Supabase URL | R | W | — | Same project as Vercel Preview |
| `SUPABASE_SERVICE_ROLE_KEY` | Staging service role key | R | W | S | Same key as Vercel Preview |
| `R2_ACCOUNT_ID` | Your Cloudflare account ID | R | W | — | |
| `R2_ACCESS_KEY_ID` | Staging R2 access key | R | W | S | |
| `R2_SECRET_ACCESS_KEY` | Staging R2 secret key | R | W | S | |
| `R2_BUCKET_NAME` | `wpo-staging-documents` | R | W | — | Worker will fail if not "staging" bucket |
| `ANTHROPIC_API_KEY` | Your Anthropic key | R | W | S | |
| `MISTRAL_API_KEY` | Your Mistral key | R | W | S | |
| `RESEND_API_KEY` | Your Resend key | O | W | S | Required if EMAILS_ENABLED=true |
| `EMAILS_ENABLED` | `false` | R | W | — | Suppress customer emails |
| `EMAIL_REDIRECT_ALL_TO` | Internal test email | O | W | — | Used if EMAILS_ENABLED=true |
| `SITE_URL` | Vercel Preview URL | O | W | — | Used in email download links |
| `PAYMENTS_MODE` | `test` | R | W | — | Worker fails fast if not "test" in staging |
| `OFFICIAL_WORKFLOW_ENABLED` | `true` | O | W | — | |
| `POLL_INTERVAL_MS` | `10000` | O | W | — | 10 seconds, same as production |
| `WORKER_CONCURRENCY` | `1` | O | W | — | |

---

## 3. Supabase — Values to Copy

After creating the staging Supabase project:

**Go to: Project → Settings → API**

| What to copy | Variable name | Used by |
|---|---|---|
| Project URL | `NEXT_PUBLIC_SUPABASE_URL` | Vercel + Railway |
| anon / public key | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Vercel only |
| service_role / secret key | `SUPABASE_SERVICE_ROLE_KEY` | Vercel + Railway |

> The `service_role` key has full database access. Keep it secret.

---

## 4. Cloudflare R2 — Values to Copy

**Go to: Cloudflare → R2 → Manage R2 API Tokens → Create API Token**

| What to copy | Variable name | Notes |
|---|---|---|
| Account ID (R2 overview page) | `R2_ACCOUNT_ID` | Same for all buckets in your account |
| Access Key ID | `R2_ACCESS_KEY_ID` | From the staging-scoped token |
| Secret Access Key | `R2_SECRET_ACCESS_KEY` | Only shown once — copy immediately |
| Bucket name | `R2_BUCKET_NAME` | Always `wpo-staging-documents` |

---

## 5. Resend — Email Config

| Variable | Staging value | Notes |
|---|---|---|
| `RESEND_API_KEY` | Same as production | Safe to share — emails are suppressed or redirected |
| `EMAILS_ENABLED` | `false` | Recommended: disable all emails in staging |
| `EMAIL_REDIRECT_ALL_TO` | `staging-test@yourteam.com` | Alternative: redirect instead of disable |

When `EMAILS_ENABLED=false`: no email is sent, intended recipient is logged.
When `EMAIL_REDIRECT_ALL_TO` is set: all emails go to that address with `[STAGING]` subject prefix.

---

## 6. Halyk/ePay — Test Credentials

Contact Halyk Bank ePay (epay.halykbank.kz) to obtain sandbox credentials.

| Variable | Notes |
|---|---|
| `PAYMENTS_MODE` | Always `test` in staging |
| `HALYK_TERMINAL_ID` | Sandbox terminal ID from Halyk |
| `HALYK_CLIENT_ID` | Sandbox OAuth client ID |
| `HALYK_CLIENT_SECRET` | Sandbox OAuth client secret |

> If Halyk integration is not yet implemented, set `PAYMENTS_MODE=test` and leave
> `HALYK_*` vars unset. The system will return 503 for payment creation (expected behavior).

---

## Variable audit — what should NOT be shared between staging and production

| Variable | Shared? | Reason |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | ❌ Must differ | Different Supabase project |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ❌ Must differ | Different Supabase project |
| `SUPABASE_SERVICE_ROLE_KEY` | ❌ Must differ | Different Supabase project |
| `R2_ACCESS_KEY_ID` | ❌ Should differ | Scoped to staging bucket only |
| `R2_SECRET_ACCESS_KEY` | ❌ Should differ | Scoped to staging bucket only |
| `R2_BUCKET_NAME` | ❌ Must differ | `wpo-staging-documents` vs production |
| `ANTHROPIC_API_KEY` | ✅ Can share | No data isolation concern |
| `MISTRAL_API_KEY` | ✅ Can share | No data isolation concern |
| `RESEND_API_KEY` | ✅ Can share | Emails suppressed/redirected in staging |
| `HALYK_TERMINAL_ID` | ❌ Must differ | Test credentials only in staging |
| `HALYK_CLIENT_SECRET` | ❌ Must differ | Test credentials only in staging |
