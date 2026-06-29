-- Deactivation audit trail for partners (set on "ПАРТНЁРСТВО ОТМЕНЕНО" Jira transition)
alter table public.partners
  add column if not exists deactivated_at      timestamptz,
  add column if not exists deactivation_reason text;

comment on column public.partners.deactivated_at      is 'Timestamp when partner was deactivated via Jira transition';
comment on column public.partners.deactivation_reason is 'Reason or Jira status at deactivation';

-- Cancellation trail for partner_applications (mirrors partners deactivation)
alter table public.partner_applications
  add column if not exists canceled_at          timestamptz,
  add column if not exists canceled_by          text,
  add column if not exists cancellation_reason  text;

comment on column public.partner_applications.canceled_at         is 'Timestamp when application was canceled via Jira';
comment on column public.partner_applications.canceled_by         is 'Actor that canceled — usually "jira-webhook"';
comment on column public.partner_applications.cancellation_reason is 'Jira status name or free-text reason';
