import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  R2_ACCOUNT_ID: z.string().min(1),
  R2_ACCESS_KEY_ID: z.string().min(1),
  R2_SECRET_ACCESS_KEY: z.string().min(1),
  R2_BUCKET_NAME: z.string().min(1),
  ANTHROPIC_API_KEY: z.string().min(1),
  MISTRAL_API_KEY: z.string().min(1),
  TONCENTER_API_KEY: z.string().optional(),
});

type Env = z.infer<typeof envSchema>;

// Validate lazily on first property access so the Vercel build phase can collect
// page metadata without requiring runtime env vars to be present in the build container.
let _validated: Env | null = null;
function validated(): Env {
  if (!_validated) _validated = envSchema.parse(process.env);
  return _validated;
}

export const env = new Proxy({} as Env, {
  get(_target, prop: string) {
    return validated()[prop as keyof Env];
  },
});
