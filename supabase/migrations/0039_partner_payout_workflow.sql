-- Partner payout workflow: extend partner_referrals and partner_payouts
-- for monthly batch generation, Jira issue tracking, and manual payment marking.
--
-- partner_referrals new status values (text column; no enum/check constraint):
--   in_payout — referral is included in a pending payout batch
--   paid      — payout to partner has been completed
--   (existing: pending | confirmed | refunded | canceled | excluded)
--
-- partner_payouts new status values:
--   pending_approval — payout batch created, awaiting accounting review
--   rejected         — payout batch rejected (must not be paid)
--   (existing: pending | approved | paid | cancelled)
--   New rows should use pending_approval.

-- ── partner_referrals extensions ──────────────────────────────────────────────

-- FK: payout_id → partner_payouts(id). Previously unkeyed.
-- on delete set null: referral is not deleted if payout row is deleted.
alter table public.partner_referrals
  add constraint partner_referrals_payout_fk
  foreign key (payout_id) references public.partner_payouts(id) on delete set null;

-- confirmed_at: explicit timestamp when referral moved to 'confirmed' status.
-- Set by confirmReferral() alongside order_completed_at.
-- Backfilled here for existing confirmed rows from order_completed_at.
alter table public.partner_referrals
  add column if not exists confirmed_at timestamptz;

update public.partner_referrals
  set confirmed_at = order_completed_at
  where status = 'confirmed'
    and order_completed_at is not null
    and confirmed_at is null;

-- included_in_payout_at: when the referral was batched into a payout.
-- paid_at: when the payout to the partner was completed.
alter table public.partner_referrals
  add column if not exists included_in_payout_at timestamptz,
  add column if not exists paid_at               timestamptz;

-- ── partner_payouts extensions ────────────────────────────────────────────────

-- Detailed commission breakdown columns (more specific than legacy gross_kzt/net_kzt).
-- gross_kzt and net_kzt are kept for backward compat; new code uses the named columns.
alter table public.partner_payouts
  add column if not exists gross_order_amount_kzt    numeric(12,2) not null default 0,
  add column if not exists total_client_discount_kzt numeric(12,2) not null default 0,
  add column if not exists total_commission_base_kzt numeric(12,2) not null default 0,
  add column if not exists total_commission_amount_kzt numeric(12,2) not null default 0,
  add column if not exists currency                  text          not null default 'KZT',
  add column if not exists jira_issue_key            text,
  add column if not exists jira_issue_url            text,
  add column if not exists jira_error                text,
  add column if not exists generated_at              timestamptz,
  add column if not exists approved_at               timestamptz,
  add column if not exists paid_at                   timestamptz,
  add column if not exists payment_reference         text;

-- ── Indexes ───────────────────────────────────────────────────────────────────

-- Period filtering for payout generation
create index if not exists partner_referrals_confirmed_at_idx
  on public.partner_referrals (confirmed_at)
  where confirmed_at is not null;

-- Composite index for payout grouping query (partner + status + payout_id)
create index if not exists partner_referrals_partner_status_idx
  on public.partner_referrals (partner_id, status);

-- Payout lookup by period
create index if not exists partner_payouts_period_start_idx
  on public.partner_payouts (period_start);

-- Payout lookup by generated_at for audit queries
create index if not exists partner_payouts_generated_at_idx
  on public.partner_payouts (generated_at)
  where generated_at is not null;

comment on column public.partner_referrals.confirmed_at        is 'When referral moved to confirmed status (payment received). Used for payout period filtering.';
comment on column public.partner_referrals.included_in_payout_at is 'When referral was batched into a partner_payouts row.';
comment on column public.partner_referrals.paid_at             is 'When the payout to the partner was completed.';
comment on column public.partner_payouts.gross_order_amount_kzt   is 'Sum of order_amount_kzt for included referrals.';
comment on column public.partner_payouts.total_client_discount_kzt is 'Sum of client_discount_applied_kzt for included referrals.';
comment on column public.partner_payouts.total_commission_base_kzt is 'Sum of commission_base_kzt for included referrals.';
comment on column public.partner_payouts.total_commission_amount_kzt is 'Sum of commission_kzt for included referrals — amount owed to partner.';
comment on column public.partner_payouts.jira_issue_key        is 'WPO Jira Payout issue key created for this batch.';
comment on column public.partner_payouts.jira_error            is 'Sanitized Jira error if issue creation failed. Payout row is retained.';
comment on column public.partner_payouts.generated_at          is 'When this payout batch was generated by the operator script.';
comment on column public.partner_payouts.payment_reference     is 'Bank transfer reference or other payment identifier set when marked paid.';
