import { z } from 'zod';

const schema = z.object({
  APP_ENV: z.enum(['production', 'staging', 'development']).default('production'),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  R2_ACCOUNT_ID: z.string().min(1),
  R2_ACCESS_KEY_ID: z.string().min(1),
  R2_SECRET_ACCESS_KEY: z.string().min(1),
  R2_BUCKET_NAME: z.string().min(1),
  ANTHROPIC_API_KEY: z.string().min(1),
  MISTRAL_API_KEY: z.string().min(1),
  POLL_INTERVAL_MS: z.coerce.number().default(10_000),
  WORKER_CONCURRENCY: z.coerce.number().default(1),
  RESEND_API_KEY: z.string().optional(),
  SITE_URL: z.string().url().default('https://wpotranslations.org'),
  // Email safety
  EMAILS_ENABLED: z
    .string()
    .default('true')
    .transform((v) => v.toLowerCase() !== 'false'),
  EMAIL_REDIRECT_ALL_TO: z.string().email().optional(),
  // Payment safety
  PAYMENTS_MODE: z.enum(['live', 'test']).default('live'),
  // Feature flags
  OFFICIAL_WORKFLOW_ENABLED: z
    .string()
    .default('true')
    .transform((v) => v.toLowerCase() !== 'false'),
  // Jira integration (all optional — integrations gracefully skip if absent)
  JIRA_BASE_URL: z.string().url().optional(),
  JIRA_EMAIL: z.string().email().optional(),
  JIRA_API_TOKEN: z.string().optional(),
  JIRA_WEBHOOK_SECRET: z.string().optional(),
  // Transition name (not ID) — must match Jira workflow transition name exactly
  JIRA_TRANSITION_TO_TRANSLATOR: z.string().default('In Progress'),
  // User queries (email or display name) — used to look up accountId via Jira API
  JIRA_TRANSLATOR_QUERY: z.string().optional(),
  // Security level names (not IDs) — looked up via Jira API
  JIRA_SECURITY_LEVEL_TRANSLATOR_NAME: z.string().optional(),
  // Google Drive integration (optional)
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REFRESH_TOKEN: z.string().optional(),
  GOOGLE_DRIVE_ROOT_FOLDER_ID: z.string().optional(),
  // Telegram notifications (optional)
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_OPERATOR_CHAT_ID: z.string().optional(),
  TELEGRAM_TRANSLATOR_CHAT_ID: z.string().optional(),
  TELEGRAM_NOTARY_CHAT_ID: z.string().optional(),
});

function load() {
  const result = schema.safeParse(process.env);
  if (!result.success) {
    console.error('[env] missing or invalid environment variables:');
    for (const issue of result.error.issues) {
      console.error(`  ${issue.path.join('.')}: ${issue.message}`);
    }
    process.exit(1);
  }
  return result.data;
}

export const env = load();
