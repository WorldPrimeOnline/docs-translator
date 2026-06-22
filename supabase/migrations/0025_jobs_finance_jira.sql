-- Finance report Jira issue columns for jobs table
alter table jobs
  add column if not exists finance_jira_issue_id   text,
  add column if not exists finance_jira_issue_key  text,
  add column if not exists finance_jira_issue_url  text,
  add column if not exists finance_jira_sync_status text default 'pending',
  add column if not exists finance_jira_last_error  text,
  add column if not exists finance_jira_synced_at   timestamptz;

create index if not exists jobs_finance_jira_key_idx
  on public.jobs (finance_jira_issue_key)
  where finance_jira_issue_key is not null;
