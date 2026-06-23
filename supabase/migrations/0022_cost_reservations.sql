-- Migration 0022: Cost reservations
-- Internal cost tracking per order. Created alongside quote, committed when paid.
-- Provides foundation for translator/notary/partner payout tracking.

CREATE TABLE IF NOT EXISTS public.cost_reservations (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id                uuid REFERENCES public.price_quotes(id) ON DELETE CASCADE,
  job_id                  uuid REFERENCES public.jobs(id) ON DELETE CASCADE,
  payment_transaction_id  uuid REFERENCES public.payment_transactions(id) ON DELETE SET NULL,
  cost_type               text NOT NULL,
  amount_kzt              numeric(12,2) NOT NULL CHECK (amount_kzt >= 0),
  status                  text NOT NULL CHECK (status IN ('reserved','committed','paid','canceled','adjusted')),
  payable_to_type         text,
  payable_to_id           uuid,
  notes                   text,
  metadata_json           jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.cost_reservations IS
  'Internal cost reservations per order. status=reserved → committed (on payment) → paid (on actual payout).';
COMMENT ON COLUMN public.cost_reservations.cost_type IS
  'One of: translator_reserved_cost, notary_official_fee, notary_coordination_fee, courier_cost, printing_cost, ai_it_reserve, acquiring_fee_estimate, tax_reserve, marketing_reserve, risk_reserve, partner_commission, owner_reserve, target_profit';
COMMENT ON COLUMN public.cost_reservations.payable_to_type IS
  'translator | notary_partner | courier | platform | partner — who this cost is owed to';

CREATE INDEX IF NOT EXISTS idx_cost_reservations_quote_id
  ON public.cost_reservations (quote_id);
CREATE INDEX IF NOT EXISTS idx_cost_reservations_job_id
  ON public.cost_reservations (job_id);
CREATE INDEX IF NOT EXISTS idx_cost_reservations_status
  ON public.cost_reservations (status, cost_type);

-- Service role only — no user-facing access
ALTER TABLE public.cost_reservations ENABLE ROW LEVEL SECURITY;
