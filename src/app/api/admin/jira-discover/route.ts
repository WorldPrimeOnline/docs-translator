// Jira discovery endpoint — helps populate src/lib/jira/project-config.ts.
// Secured with CRON_SECRET. Not for use in production workflows.
// GET /api/admin/jira-discover?secret=<CRON_SECRET>

import { NextRequest, NextResponse } from 'next/server';
import { getJiraCredentials, makeAuthHeader } from '@/lib/jira/config';

async function jiraGet<T>(baseUrl: string, auth: string, path: string): Promise<T | null> {
  try {
    const res = await fetch(`${baseUrl}/rest/api/3${path}`, {
      headers: { Authorization: auth, Accept: 'application/json' },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  // Auth
  const secret = process.env.CRON_SECRET;
  const provided = request.nextUrl.searchParams.get('secret');
  if (secret && provided !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const creds = getJiraCredentials();
  if (!creds) {
    return NextResponse.json({
      error: 'Jira not configured — set JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN',
    }, { status: 503 });
  }

  const auth = makeAuthHeader(creds);
  const base = creds.baseUrl;

  const [projects, allIssueTypes, currentUser] = await Promise.all([
    jiraGet<{ values: { id: string; key: string; name: string }[] }>(base, auth, '/project/search?maxResults=50'),
    jiraGet<{ id: string; name: string; scope?: { type: string } }[]>(base, auth, '/issuetype'),
    jiraGet<{ accountId: string; displayName: string; emailAddress?: string }>(base, auth, '/myself'),
  ]);

  // Per-project details (pick first project or all if small)
  const projectList = projects?.values ?? [];
  const projectDetails: Record<string, unknown>[] = [];

  for (const proj of projectList.slice(0, 5)) {
    const [secLevels, issueTypesForProject] = await Promise.all([
      jiraGet<{ levels: { id: string; name: string }[] }>(base, auth, `/project/${proj.key}/securitylevel`),
      jiraGet<{ values: { id: string; name: string }[] }>(base, auth, `/issuetype/project?projectId=${proj.id}`),
    ]);
    projectDetails.push({
      id: proj.id,
      key: proj.key,
      name: proj.name,
      issueTypes: issueTypesForProject?.values ?? allIssueTypes?.filter((t) => !t.scope || t.scope.type !== 'GLOBAL') ?? [],
      securityLevels: secLevels?.levels ?? [],
    });
  }

  // Search for current user in project members
  const usersSearch = await jiraGet<{
    users: { accountId: string; displayName: string; emailAddress?: string }[];
    total: number;
  }>(base, auth, '/user/search/query?query=&maxResults=50');

  return NextResponse.json({
    instructions: [
      '1. Pick your project from "projects" below.',
      '2. Pick an issue type from that project\'s "issueTypes".',
      '3. Pick security level names from "securityLevels" (or leave empty to skip).',
      '4. Find your operator/translator/notary users in "knownUsers".',
      '5. Paste values into src/lib/jira/project-config.ts and commit.',
      'Note: transitionNames must match your Jira workflow transition names exactly.',
    ],
    currentUser,
    projects: projectDetails,
    allIssueTypes: allIssueTypes?.map((t) => ({ id: t.id, name: t.name })),
    knownUsers: usersSearch?.users?.map((u) => ({
      accountId: u.accountId,
      displayName: u.displayName,
      email: u.emailAddress,
    })) ?? [],
    configTemplate: {
      projectKey: projectList[0]?.key ?? '',
      issueTypeName: 'Task',
      userQuery: { operator: '', translator: '', notary: '' },
      securityLevelNames: { operator: '', translator: '', notary: '' },
      transitionNames: {
        toTranslator: 'In Progress',
        toOperator: 'Done',
        toNotary: 'In Review',
      },
    },
  });
}
