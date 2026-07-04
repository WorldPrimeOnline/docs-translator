/**
 * Env loading + production safety guard for the Internal AI Translation Test Lab.
 *
 * loadEnvFile() is side-effecting and MUST run before any pipeline module is
 * imported — worker/src/lib/env.ts (and other worker/web modules) read
 * process.env at import time, some of them via `process.exit(1)` on failure.
 * See run-ai-translation-test.ts: dotenv loads first, pipeline modules are
 * brought in via dynamic `import()` afterward.
 */
import * as fs from 'node:fs';
import * as dotenv from 'dotenv';
import type { Environment } from './types';

export class EnvGuardError extends Error {}

export function loadEnvFile(envFilePath: string): void {
  if (!fs.existsSync(envFilePath)) {
    throw new EnvGuardError(`--env-file not found: ${envFilePath}`);
  }
  const result = dotenv.config({ path: envFilePath, override: true });
  if (result.error) {
    throw new EnvGuardError(`Failed to load --env-file ${envFilePath}: ${result.error.message}`);
  }
}

/** Decoupled from NodeJS.ProcessEnv on purpose — keeps these functions testable with plain objects. */
export type EnvRecord = Record<string, string | undefined>;

function isTrue(v: string | undefined): boolean {
  return (v ?? '').trim().toLowerCase() === 'true';
}

export function resolveEnvironment(env: EnvRecord): Environment {
  if (env.APP_ENV === 'production' || env.NEXT_PUBLIC_APP_ENV === 'production') return 'production';
  if (env.APP_ENV === 'staging' || env.NEXT_PUBLIC_APP_ENV === 'staging') return 'staging';
  return 'local';
}

export interface SafetyCheckResult {
  ok: boolean;
  environment: Environment;
  reasons: string[];
}

/**
 * Pure guard logic — takes an env record + whether --confirm-production was
 * passed, and returns whether it's safe to proceed. No process.exit here;
 * the caller decides how to fail.
 */
export function checkProductionSafety(env: EnvRecord, confirmProduction: boolean): SafetyCheckResult {
  const environment = resolveEnvironment(env);
  const reasons: string[] = [];

  if (!isTrue(env.AI_TRANSLATION_TEST_LAB_ENABLED)) {
    reasons.push('AI_TRANSLATION_TEST_LAB_ENABLED must be set to "true" in the env file to run this tool.');
  }

  if (environment === 'production') {
    // This variable must never be enabled in production, regardless of anything else.
    if (isTrue(env.ALLOW_STAGING_PAYMENT_OVERRIDE)) {
      reasons.push(
        'ALLOW_STAGING_PAYMENT_OVERRIDE=true is set — this must NEVER be enabled in production. Refusing to run.',
      );
    }
    if (!isTrue(env.AI_TRANSLATION_TEST_LAB_ALLOW_PRODUCTION)) {
      reasons.push('AI_TRANSLATION_TEST_LAB_ALLOW_PRODUCTION must be set to "true" to run against production.');
    }
    if (!confirmProduction) {
      reasons.push('--confirm-production flag is required to run against production.');
    }
  }

  return { ok: reasons.length === 0, environment, reasons };
}

export interface SafetySummaryInput {
  environment: Environment;
  runId: string;
  outputDir: string;
  saveToR2: boolean;
}

export function buildSafetySummary(input: SafetySummaryInput): string {
  return [
    'WPO AI Translation Test Lab',
    `Environment: ${input.environment}`,
    'Payment bypass: disabled',
    'Halyk: disabled',
    'Jira: disabled',
    'Fiscalization: disabled',
    'Normal order creation: disabled',
    `Output dir: ${input.outputDir}/${input.runId}`,
    `R2 save: ${input.saveToR2}`,
  ].join('\n');
}

export interface BatchSafetySummaryInput {
  environment: Environment;
  batchId: string;
  outputDir: string;
  fileCount: number;
  concurrency: number;
}

export function buildBatchSafetySummary(input: BatchSafetySummaryInput): string {
  return [
    'WPO AI Translation Test Lab — Batch Mode',
    `Environment: ${input.environment}`,
    `Files to process: ${input.fileCount}`,
    `Concurrency: ${input.concurrency}`,
    'Payment: disabled',
    'Halyk: disabled',
    'Jira: disabled',
    'Fiscalization: disabled',
    'Normal customer workflow: disabled',
    `Output dir: ${input.outputDir}/${input.batchId}`,
    '',
    'Cost warning: batch mode will spend real OCR/LLM API credits for every document in the manifest.',
  ].join('\n');
}
