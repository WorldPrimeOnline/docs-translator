import { z } from 'zod';

const schema = z.object({
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
