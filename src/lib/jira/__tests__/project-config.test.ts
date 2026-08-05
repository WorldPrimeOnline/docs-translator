/**
 * Tests for JIRA_ADMIN_SECURITY_LEVEL_ID / isStagingJiraEnvironment / stagingSecurityField
 * (2026-08-01) — the web-app-side copy of worker/src/lib/jira/order-fields.ts's identical
 * constant/helpers (worker cannot import from src/, kept in sync manually).
 */
import { JIRA_ADMIN_SECURITY_LEVEL_ID, isStagingJiraEnvironment, stagingSecurityField } from '../project-config';

describe('staging Jira Admin security level (2026-08-01)', () => {
  const ORIGINAL = process.env.NEXT_PUBLIC_APP_ENV;

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.NEXT_PUBLIC_APP_ENV;
    else process.env.NEXT_PUBLIC_APP_ENV = ORIGINAL;
  });

  it('JIRA_ADMIN_SECURITY_LEVEL_ID is the real Admin level ID for project WO, found via the Jira metadata API (never guessed)', () => {
    expect(JIRA_ADMIN_SECURITY_LEVEL_ID).toBe('10000');
  });

  it('isStagingJiraEnvironment reads NEXT_PUBLIC_APP_ENV — the existing convention, no new env var', () => {
    process.env.NEXT_PUBLIC_APP_ENV = 'staging';
    expect(isStagingJiraEnvironment()).toBe(true);

    process.env.NEXT_PUBLIC_APP_ENV = 'production';
    expect(isStagingJiraEnvironment()).toBe(false);

    delete process.env.NEXT_PUBLIC_APP_ENV;
    expect(isStagingJiraEnvironment()).toBe(false); // defaults production-safe
  });

  it('stagingSecurityField: staging → Admin level object', () => {
    process.env.NEXT_PUBLIC_APP_ENV = 'staging';
    expect(stagingSecurityField()).toEqual({ security: { id: '10000' } });
  });

  it('stagingSecurityField: production → empty object, security key fully absent', () => {
    process.env.NEXT_PUBLIC_APP_ENV = 'production';
    const result = stagingSecurityField();
    expect(result).toEqual({});
    expect('security' in result).toBe(false);
  });
});
