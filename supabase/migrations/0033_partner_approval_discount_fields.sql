-- Discount audit trail on jobs (links what customer paid to pre-discount price)
alter table public.jobs
  add column if not exists price_before_discount_kzt numeric(12,2),
  add column if not exists discount_applied_kzt       numeric(12,2),
  add column if not exists discount_code              text;

comment on column public.jobs.price_before_discount_kzt is 'Original price before partner client discount; null when no discount applied';
comment on column public.jobs.discount_applied_kzt       is 'KZT amount discounted at order creation; null when no discount applied';
comment on column public.jobs.discount_code              is 'Partner referral code that generated the discount';

-- Partner application approval trail
alter table public.partner_applications
  add column if not exists approved_partner_id uuid references public.partners(id) on delete set null,
  add column if not exists approved_at         timestamptz,
  add column if not exists approved_by         text;

comment on column public.partner_applications.approved_partner_id is 'FK to partners row created on approval';
comment on column public.partner_applications.approved_at         is 'Timestamp when operator approved the application';
comment on column public.partner_applications.approved_by         is 'Operator identifier who approved (email or staff id)';
