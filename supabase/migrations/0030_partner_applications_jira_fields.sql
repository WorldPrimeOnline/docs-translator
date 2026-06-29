-- Extend partner_applications with richer Jira tracking fields.
-- Renames jira_last_error → jira_error for consistency with spec,
-- and adds jira_issue_url + jira_created_at.

alter table public.partner_applications
  rename column jira_last_error to jira_error;

alter table public.partner_applications
  add column if not exists jira_issue_url  text,
  add column if not exists jira_created_at timestamptz;
