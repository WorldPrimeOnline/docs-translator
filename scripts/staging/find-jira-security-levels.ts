#!/usr/bin/env npx tsx
/**
 * Read-only: thorough verification of Jira issue security for the WO (main orders)
 * and WPO (partner applications) projects, using the SAME credentials
 * (JIRA_BASE_URL/JIRA_EMAIL/JIRA_API_TOKEN) the application itself uses to create
 * issues (src/lib/jira/config.ts's getJiraCredentials(), worker/src/lib/env.ts).
 *
 * For each project, checks FOUR independent things — never concludes "no security"
 * from a single endpoint:
 *   1. GET /rest/api/3/project/{key}                          — real project id/key/name
 *   2. GET /rest/api/3/project/{key}/securitylevel             — security levels visible to this user
 *   3. GET /rest/api/3/project/{projectId}/issuesecuritylevelscheme — the scheme actually attached to the project
 *   4. GET /rest/api/3/issue/createmeta?projectKeys=...&issuetypeNames=...&expand=projects.issuetypes.fields
 *                                                               — whether the `security` field is even offered
 *                                                                 for that project's specific issue type, and
 *                                                                 which level IDs it allows
 *
 * Makes GET requests only. Never creates/updates/deletes anything.
 *
 * Usage:
 *   npx tsx scripts/staging/find-jira-security-levels.ts
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

interface ProjectTarget {
  key: string;
  issueTypeName: string;
}

const TARGETS: ProjectTarget[] = [
  { key: 'WO', issueTypeName: 'Заказ' },
  { key: 'WPO', issueTypeName: 'Partnership' },
];

async function main(): Promise<void> {
  const { JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN } = process.env;
  if (!JIRA_BASE_URL || !JIRA_EMAIL || !JIRA_API_TOKEN) {
    console.error('[find-jira-security-levels] Missing JIRA_BASE_URL / JIRA_EMAIL / JIRA_API_TOKEN');
    process.exit(1);
  }

  const baseUrl = JIRA_BASE_URL.replace(/\/$/, '');
  const authHeader = 'Basic ' + Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString('base64');
  console.log(`[find-jira-security-levels] Using Jira user: ${JIRA_EMAIL} (same credentials as src/lib/jira/config.ts / worker/src/lib/env.ts)\n`);

  async function get(url: string): Promise<{ ok: boolean; status: number; body: unknown; text: string }> {
    const res = await fetch(url, { headers: { Authorization: authHeader, Accept: 'application/json' } });
    const text = await res.text();
    let body: unknown = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    return { ok: res.ok, status: res.status, body, text };
  }

  for (const target of TARGETS) {
    console.log(`\n${'='.repeat(70)}`);
    console.log(`PROJECT ${target.key}`);
    console.log('='.repeat(70));

    // ── 1. Real project id/key/name ──────────────────────────────────────────
    const projRes = await get(`${baseUrl}/rest/api/3/project/${target.key}`);
    let projectId: string | null = null;
    if (projRes.ok) {
      const p = projRes.body as { id: string; key: string; name: string };
      projectId = p.id;
      console.log(`\n[1] GET /project/${target.key} -> 200`);
      console.log(`    id=${p.id}  key=${p.key}  name="${p.name}"`);
    } else {
      console.log(`\n[1] GET /project/${target.key} -> ${projRes.status} FAILED`);
      console.log(`    ${projRes.text.slice(0, 300)}`);
    }

    // ── 2. Security levels visible via the project securitylevel endpoint ──
    const secRes = await get(`${baseUrl}/rest/api/3/project/${target.key}/securitylevel`);
    console.log(`\n[2] GET /project/${target.key}/securitylevel -> ${secRes.status}`);
    if (secRes.ok) {
      const data = secRes.body as { levels: Array<{ id: string; name: string; description?: string }> };
      if (data.levels.length === 0) {
        console.log('    (empty array returned)');
      } else {
        for (const level of data.levels) {
          console.log(`    id=${level.id}  name="${level.name}"${level.description ? `  description="${level.description}"` : ''}`);
        }
      }
    } else {
      console.log(`    ${secRes.text.slice(0, 300)}`);
    }

    // ── 3. The issue security LEVEL SCHEME actually attached to the project ──
    if (projectId) {
      const schemeRes = await get(`${baseUrl}/rest/api/3/project/${projectId}/issuesecuritylevelscheme`);
      console.log(`\n[3] GET /project/${projectId}/issuesecuritylevelscheme -> ${schemeRes.status}`);
      if (schemeRes.ok) {
        console.log(`    ${JSON.stringify(schemeRes.body, null, 2).split('\n').join('\n    ')}`);
      } else {
        console.log(`    ${schemeRes.text.slice(0, 500)}`);
      }
    }

    // ── 4. createmeta for the exact issue type — does it offer `security` at all? ──
    const createMetaUrl = `${baseUrl}/rest/api/3/issue/createmeta?projectKeys=${target.key}&issuetypeNames=${encodeURIComponent(target.issueTypeName)}&expand=projects.issuetypes.fields`;
    const metaRes = await get(createMetaUrl);
    console.log(`\n[4] GET /issue/createmeta?projectKeys=${target.key}&issuetypeNames=${target.issueTypeName} -> ${metaRes.status}`);
    if (metaRes.ok) {
      const data = metaRes.body as {
        projects: Array<{
          key: string;
          issuetypes: Array<{
            name: string;
            fields?: Record<string, { name: string; allowedValues?: Array<{ id: string; name?: string }> }>;
          }>;
        }>;
      };
      const proj = data.projects.find((pr) => pr.key === target.key);
      if (!proj) {
        console.log(`    Project ${target.key} not present in createmeta response (issue type "${target.issueTypeName}" may not be enabled for this project, or this user lacks create permission)`);
      } else {
        const itype = proj.issuetypes.find((it) => it.name === target.issueTypeName);
        if (!itype) {
          console.log(`    Issue type "${target.issueTypeName}" not found for project ${target.key}. Available: ${proj.issuetypes.map((it) => it.name).join(', ')}`);
        } else if (!itype.fields?.security) {
          console.log(`    Issue type "${target.issueTypeName}": NO "security" field offered in createmeta for this user/issue type.`);
          console.log(`    Available fields: ${Object.keys(itype.fields ?? {}).join(', ')}`);
        } else {
          const sec = itype.fields.security;
          console.log(`    Issue type "${target.issueTypeName}": "security" field IS offered — allowedValues:`);
          for (const v of sec.allowedValues ?? []) {
            console.log(`      id=${v.id}  name="${v.name ?? '(unnamed)'}"`);
          }
        }
      }
    } else {
      console.log(`    ${metaRes.text.slice(0, 500)}`);
    }
  }

  console.log(`\n${'='.repeat(70)}\nDone.\n`);
}

void main();
