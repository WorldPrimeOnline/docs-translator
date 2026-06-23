-- Migration 0019: Pricing versions table
-- Stores versioned pricing configuration. Only one row may be 'active' at a time.
-- All rate fields are fractions (e.g. 0.03 = 3%). KZT amounts are numeric(12,2).

CREATE TABLE IF NOT EXISTS public.pricing_versions (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                        text NOT NULL UNIQUE,
  status                      text NOT NULL CHECK (status IN ('draft','active','archived')),
  currency                    text NOT NULL DEFAULT 'KZT',
  internal_fx_rate            numeric(12,4),
  mrp_value                   numeric(12,2),
  tax_rate                    numeric(8,4) NOT NULL DEFAULT 0.03,
  acquiring_rate              numeric(8,4) NOT NULL DEFAULT 0.025,
  risk_reserve_rate           numeric(8,4) NOT NULL DEFAULT 0.05,
  owner_reserve_rate          numeric(8,4) NOT NULL DEFAULT 0.07,
  marketing_rate_direct       numeric(8,4) NOT NULL DEFAULT 0.10,
  partner_commission_rate     numeric(8,4) NOT NULL DEFAULT 0.10,
  target_profit_rate          numeric(8,4) NOT NULL DEFAULT 0.25,
  ai_it_reserve_per_page_kzt  numeric(12,2) NOT NULL DEFAULT 100,
  valid_from                  timestamptz NOT NULL DEFAULT now(),
  valid_to                    timestamptz,
  metadata                    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.pricing_versions IS
  'Versioned pricing configuration. One active row drives all dynamic quotes.';
COMMENT ON COLUMN public.pricing_versions.mrp_value IS
  'MRP (месячный расчётный показатель) in KZT. TODO: confirm with accountant/notary before notarized production launch.';
COMMENT ON COLUMN public.pricing_versions.tax_rate IS
  'Tax/VAT reserve rate (fraction). TODO: confirm with accountant before production.';

-- Index for finding current active version
CREATE INDEX IF NOT EXISTS idx_pricing_versions_active
  ON public.pricing_versions (status, valid_from)
  WHERE status = 'active';

-- RLS: no user can read pricing internals; service_role bypasses
ALTER TABLE public.pricing_versions ENABLE ROW LEVEL SECURITY;

-- Seed the initial MVP pricing version
-- NOTE: All rates are preliminary estimates. Accountant/notary confirmation required before production.
INSERT INTO public.pricing_versions (
  code, status, currency,
  internal_fx_rate,
  mrp_value,
  tax_rate, acquiring_rate, risk_reserve_rate, owner_reserve_rate,
  marketing_rate_direct, partner_commission_rate, target_profit_rate,
  ai_it_reserve_per_page_kzt,
  valid_from,
  metadata
) VALUES (
  '2026-Q3-KZ-MVP',
  'active',
  'KZT',
  510.0000,
  3.69,
  0.03, 0.025, 0.05, 0.07,
  0.10, 0.10, 0.25,
  100.00,
  now(),
  jsonb_build_object(
    'note', 'Initial MVP pricing version. All rates are preliminary estimates.',
    'confirmations_required', jsonb_build_array(
      'Accountant to confirm tax/VAT rate (currently 3% placeholder)',
      'Accountant to confirm acquiring rate with Halyk Bank contract',
      'Notary to confirm MRP value and coefficient before notarized production orders',
      'Legal to confirm refund policy cases',
      'Translators to confirm purchase prices before official/notarized launch'
    )
  )
) ON CONFLICT (code) DO NOTHING;
