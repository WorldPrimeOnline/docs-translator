#!/usr/bin/env npx tsx
/**
 * Read-only: lists the Jira issue security levels available for the project
 * (JIRA_PROJECT_KEY, default "WO"), so the real numeric ID of the "Admin" level can
 * be found and hardcoded rather than guessed (2026-07-22 staging-security-level fix).
 *
 * Makes exactly one GET request. Never creates/updates/deletes anything.
 *
 * Usage:
 *   npx tsx scripts/staging/find-jira-security-levels.ts
 *
 * Required env vars (loaded from .env.staging.local / .env.local):
 *   JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN, JIRA_PROJECT_KEY (optional, default "WO")
 */
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

const ROOT = path.resolve(process.cwd());

function loadEnvFile(filename: string): boolean {
  const filepath = path.join(ROOT, filename);
  if (fs.existsSync(filepath)) {
    dotenv.config({ path: filepath });
    return true;
  }
  return false;
}

const stagingLoaded = loadEnvFile('.env.staging.local');
const localLoaded = loadEnvFile('.env.local');
console.log('[find-jira-security-levels] Env files:',
  [stagingLoaded && '.env.staging.local', localLoaded && '.env.local'].filter(Boolean).join(', ') || '(none)');

async function main(): Promise<void> {
  const { JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN } = process.env;
  if (!JIRA_BASE_URL || !JIRA_EMAIL || !JIRA_API_TOKEN) {
    console.error('[find-jira-security-levels] Missing JIRA_BASE_URL / JIRA_EMAIL / JIRA_API_TOKEN');
    process.exit(1);
  }

  const projectKey = process.env.JIRA_PROJECT_KEY ?? 'WO';
  const baseUrl = JIRA_BASE_URL.replace(/\/$/, '');
  const authHeader = 'Basic ' + Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString('base64');

  const res = await fetch(`${baseUrl}/rest/api/3/project/${projectKey}/securitylevel`, {
    headers: { Authorization: authHeader, Accept: 'application/json' },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.error(`[find-jira-security-levels] Request failed: ${res.status} ${text.slice(0, 500)}`);
    process.exit(1);
  }

  const data = (await res.json()) as { levels: Array<{ id: string; name: string; description?: string }> };

  console.log(`\n[find-jira-security-levels] Project "${projectKey}" issue security levels:\n`);
  for (const level of data.levels) {
    console.log(`  id=${level.id}  name="${level.name}"${level.description ? `  description="${level.description}"` : ''}`);
  }
  if (data.levels.length === 0) {
    console.log('  (none — this project may not have an issue security scheme configured)');
  }
  console.log('');
}

void main();
