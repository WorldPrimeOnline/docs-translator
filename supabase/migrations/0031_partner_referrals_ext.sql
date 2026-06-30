-- Extend partner_referrals with missing UTM fields, order amount, commission rate snapshot,
-- and a unique constraint preventing duplicate referrals per order.
--
-- Status vocabulary (text column, no check constraint):
--   pending   — referral linked to created order, awaiting payment
--   confirmed — order paid; commission is now eligible
--   refunded  — order refunded; commission excluded from payout
--   canceled  — order canceled; commission excluded from payout
--   paid      — payout completed (set by payout process, not in this ticket)
--   excluded  — legacy value from MVP; kept for backward compat

alter table public.partner_referrals
  add column if not exists utm_content      text,
  add column if not exists utm_term         text,
  add column if not exists order_amount_kzt numeric(12,2),
  add column if not exists commission_rate  numeric(5,4);

-- Ensure at most one referral per order (job_id is the order anchor).
-- job_id is nullable (pre-wiring rows had null) so the partial index is safe.
create unique index if not exists partner_referrals_unique_job
  on public.partner_referrals (job_id)
  where job_id is not null;
