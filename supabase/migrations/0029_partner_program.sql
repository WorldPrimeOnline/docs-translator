-- Partner Program MVP: partner_applications, partners, partner_referrals, partner_payouts
-- All tables use RLS (enabled with no browser-accessible policies — all access via service-role API routes).

-- ─── partner_applications ────────────────────────────────────────────────────

create table public.partner_applications (
  id               uuid        primary key default gen_random_uuid(),
  partner_type     text        not null,
  name             text        not null,
  email            text        not null,
  phone            text,
  organization     text,
  message          text,
  ref_code         text,
  utm_source       text,
  utm_medium       text,
  utm_campaign     text,
  status           text        not null default 'pending',
  jira_issue_key   text,
  jira_sync_status text        not null default 'pending',
  jira_last_error  text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- partner_type: translator | notary | agency | visa_center | migration_consultant |
--               education_agency | legal_firm | corporate | other
-- status: pending | reviewing | approved | rejected
-- jira_sync_status: pending | synced | failed

alter table public.partner_applications enable row level security;

create index partner_applications_status_idx  on public.partner_applications (status);
create index partner_applications_email_idx   on public.partner_applications (email);
create index partner_applications_created_idx on public.partner_applications (created_at desc);

-- ─── partners ────────────────────────────────────────────────────────────────

create table public.partners (
  id               uuid         primary key default gen_random_uuid(),
  application_id   uuid         references public.partner_applications(id) on delete set null,
  partner_type     text         not null,
  name             text         not null,
  email            text         not null unique,
  organization     text,
  referral_code    text         not null unique,
  commission_rate  numeric(5,4) not null default 0.05,
  is_active        boolean      not null default true,
  notes            text,
  created_at       timestamptz  not null default now(),
  updated_at       timestamptz  not null default now()
);

alter table public.partners enable row level security;

create index partners_referral_code_idx on public.partners (referral_code);
create index partners_active_idx        on public.partners (is_active) where is_active = true;

-- ─── partner_referrals ───────────────────────────────────────────────────────

create table public.partner_referrals (
  id                  uuid         primary key default gen_random_uuid(),
  partner_id          uuid         not null references public.partners(id),
  job_id              uuid         references public.jobs(id) on delete set null,
  user_id             uuid         references public.users(id) on delete set null,
  ref_code            text         not null,
  utm_source          text,
  utm_medium          text,
  utm_campaign        text,
  captured_at         timestamptz  not null default now(),
  order_completed_at  timestamptz,
  commission_base_kzt numeric(12,2),
  commission_kzt      numeric(12,2),
  status              text         not null default 'pending',
  payout_id           uuid,
  created_at          timestamptz  not null default now()
);

-- status: pending | completed | excluded | refunded

alter table public.partner_referrals enable row level security;

create index partner_referrals_partner_idx on public.partner_referrals (partner_id);
create index partner_referrals_job_idx     on public.partner_referrals (job_id) where job_id is not null;
create index partner_referrals_status_idx  on public.partner_referrals (status);
create index partner_referrals_payout_idx  on public.partner_referrals (payout_id) where payout_id is not null;

-- ─── partner_payouts ─────────────────────────────────────────────────────────

create table public.partner_payouts (
  id               uuid         primary key default gen_random_uuid(),
  partner_id       uuid         not null references public.partners(id),
  period_start     date         not null,
  period_end       date         not null,
  gross_kzt        numeric(12,2) not null default 0,
  net_kzt          numeric(12,2) not null default 0,
  referral_count   integer      not null default 0,
  status           text         not null default 'pending',
  payment_details  jsonb,
  notes            text,
  created_at       timestamptz  not null default now(),
  updated_at       timestamptz  not null default now()
);

-- status: pending | approved | paid | cancelled

alter table public.partner_payouts enable row level security;

create index partner_payouts_partner_idx on public.partner_payouts (partner_id);
create index partner_payouts_status_idx  on public.partner_payouts (status);
create index partner_payouts_period_idx  on public.partner_payouts (period_start, period_end);
