-- Migration 0037: Apply new default partner discount to existing active partners
--
-- Business decision 2026-06-30: partner codes must provide a small client incentive
-- so clients have motivation to enter the code manually.
-- New default: 5% discount, capped at 500 KZT, for orders ≥ 2500 KZT.
--
-- Targets only active partners currently set to attribution-only (client_discount_enabled=false).
-- Partners that already have explicit discount configuration are untouched.

UPDATE partners
SET
  client_discount_enabled         = true,
  client_discount_type            = 'percent',
  client_discount_value           = 5,
  client_discount_min_order_amount = 2500,
  client_discount_max_amount      = 500
WHERE
  is_active = true
  AND client_discount_enabled = false;
