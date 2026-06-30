-- Add client-facing discount support to partners table.
-- All discount configuration is data-driven and admin-set; no client input trusted.

alter table public.partners
  add column if not exists client_discount_enabled    boolean      not null default false,
  add column if not exists client_discount_type       text         check (client_discount_type in ('percent', 'fixed')),
  add column if not exists client_discount_value      numeric(12,2),
  add column if not exists client_discount_min_order_amount numeric(12,2),
  add column if not exists client_discount_max_amount numeric(12,2);

-- Track actual discount applied per referral (for commission base deduction).
alter table public.partner_referrals
  add column if not exists client_discount_applied_kzt numeric(12,2);

comment on column public.partners.client_discount_enabled    is 'Whether this partner offers a client-facing discount';
comment on column public.partners.client_discount_type       is 'percent or fixed';
comment on column public.partners.client_discount_value      is 'Percent (0-100) or fixed KZT amount';
comment on column public.partners.client_discount_min_order_amount is 'Minimum order KZT for discount to apply';
comment on column public.partners.client_discount_max_amount is 'Cap on fixed/computed discount in KZT';
comment on column public.partner_referrals.client_discount_applied_kzt is 'Actual KZT discount subtracted from order at creation; deducted from commission base';
