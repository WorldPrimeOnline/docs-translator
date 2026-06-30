-- Migration 0038: Aggressive marketing defaults for partner program (2026-06-30)
--
-- Business decision: partner codes must give a strong client incentive.
-- New default: 10% discount on any order (no minimum, no cap).
-- Organization partners (agency, visa_center, etc.) earn 10% commission.
-- Translator/notary/other earn 5% commission (unchanged).
--
-- Update targets only partners with the previous weak defaults (5%, min=2500)
-- or attribution-only partners (discount disabled). Does not overwrite custom configs.

-- 1. Update discount: old weak defaults → new aggressive defaults
UPDATE partners
SET
  client_discount_enabled          = true,
  client_discount_type             = 'percent',
  client_discount_value            = 10,
  client_discount_min_order_amount = 0,
  client_discount_max_amount       = null
WHERE
  is_active = true
  AND (
    -- Came from migration 0037 (old 5%/2500/2500 defaults)
    (client_discount_enabled = true AND client_discount_type = 'percent' AND client_discount_value = 5 AND client_discount_min_order_amount = 2500)
    OR
    -- Came from migration 0036 (attribution-only, discount disabled)
    (client_discount_enabled = false)
  );

-- 2. Update commission rate for organization-type partners that still have old 5% default
UPDATE partners
SET commission_rate = 0.10
WHERE
  is_active = true
  AND commission_rate = 0.05
  AND partner_type IN ('agency', 'visa_center', 'migration_consultant', 'education_agency', 'legal_firm', 'corporate');
