/**
 * Explicit, predictable env loading — this CLI runs locally via tsx, so Vercel's env is never
 * available; nothing here can be left implicit. Must run BEFORE any Supabase client is
 * constructed (i.e. before resolvePricingVersion's --from-staging branch dynamically imports
 * @/lib/pricing/service).
 *
 * Priority (highest wins): already-set process.env > --env-file > ./.env.local > this tool's
 * own .env.staging.local (only loaded when --from-staging is used).
 *
 * Implemented by calling dotenv.config() in priority order, HIGHEST first — dotenv's default
 * ({ override: false }) never replaces a var already present in process.env, so loading
 * highest-priority-first and letting each subsequent call fill in only what's still missing
 * reproduces the chain exactly.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import dotenv from 'dotenv';
import { InvalidConfigError } from './config';

export interface EnvLoadResult {
  /** Files actually loaded, in priority order — for a safe startup log (paths only, no values). */
  loadedFiles: string[];
}

export interface LoadEnvChainOptions {
  fromStaging: boolean;
  /** Whether OCR might run this invocation (i.e. --no-ocr was NOT passed). */
  ocrEnabled: boolean;
}

export function loadEnvChain(envFilePath: string | undefined, opts: LoadEnvChainOptions): EnvLoadResult {
  const loadedFiles: string[] = [];

  if (envFilePath) {
    if (!fs.existsSync(envFilePath)) {
      throw new InvalidConfigError(`--env-file '${envFilePath}' does not exist.`);
    }
    dotenv.config({ path: envFilePath });
    loadedFiles.push(envFilePath);
  }

  const dotEnvLocal = path.resolve('.env.local');
  if (fs.existsSync(dotEnvLocal)) {
    dotenv.config({ path: dotEnvLocal });
    loadedFiles.push(dotEnvLocal);
  }

  // Only loaded when it could plausibly be needed (staging fetch or real OCR) — never touched
  // for a pure local/--no-ocr run.
  if (opts.fromStaging || opts.ocrEnabled) {
    const stagingLocal = path.join(__dirname, '..', '.env.staging.local');
    if (fs.existsSync(stagingLocal)) {
      dotenv.config({ path: stagingLocal });
      loadedFiles.push(stagingLocal);
    }
  }

  return { loadedFiles };
}

/**
 * Read-only pricing_versions/pricing_language_rates fetch needs exactly these two — both
 * pricing_versions and pricing_language_rates have RLS enabled with ZERO policies (see
 * supabase/migrations/0019, 0050): "no user can read pricing internals; service_role bypasses".
 * There is no narrower/anon-key-readable path available for these tables — this matches
 * src/lib/pricing/service.ts's own access pattern exactly, not an over-privileged choice.
 */
export const REQUIRED_STAGING_ENV_VARS = ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'] as const;

export class MissingStagingEnvError extends Error {
  constructor(public readonly missingVars: string[]) {
    super(`Missing environment variables required for --from-staging: ${missingVars.join(', ')}`);
  }
}

/** Names only — never logs or includes a value, even when a var IS set. */
export function checkStagingEnvOrThrow(): void {
  const missing = REQUIRED_STAGING_ENV_VARS.filter((name) => !process.env[name] || process.env[name]!.trim() === '');
  if (missing.length > 0) throw new MissingStagingEnvError(missing);
}

/**
 * Real OCR (a scanned PDF/image, without --no-ocr) needs exactly ONE var — MISTRAL_API_KEY —
 * injected directly into extractTextFromPdf() (@/lib/ocr/mistral.ts's `mistralApiKey` option),
 * never through @/lib/env. This CLI must never require NODE_ENV, R2_*, ANTHROPIC_API_KEY, or
 * NEXT_PUBLIC_SUPABASE_ANON_KEY for OCR — those belong to the web app's/worker's own env
 * schemas, not to a standalone local OCR call.
 */
export const REQUIRED_OCR_ENV_VARS = ['MISTRAL_API_KEY'] as const;

export class MissingOcrEnvError extends Error {
  constructor(public readonly missingVars: string[]) {
    super(`Missing environment variables required for OCR: ${missingVars.join(', ')}`);
  }
}

/** Names only — never logs or includes a value, even when the var IS set. */
export function checkOcrEnvOrThrow(): void {
  const missing = REQUIRED_OCR_ENV_VARS.filter((name) => !process.env[name] || process.env[name]!.trim() === '');
  if (missing.length > 0) throw new MissingOcrEnvError(missing);
}
