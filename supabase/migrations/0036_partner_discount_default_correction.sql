-- Migration 0036: Correct partner economics — partners are attribution codes by default.
--
-- The previous activation webhook (commits before 2026-06-30) incorrectly set
-- client_discount_enabled = true with fixed 1000 KZT, min_order 5000 KZT for all
-- newly activated partners. This was a product error: partner commission is already
-- part of the commercial price model; automatic client discounts are not the default.
--
-- This migration resets all partners that still carry exactly the old default values.
-- Partners with any deviation (different type/value/cap, or discount_max_amount set)
-- are preserved and must be reviewed manually.
--
-- After this migration, the new default activation behavior creates partners with
-- client_discount_enabled = false and all discount fields = null.

UPDATE public.partners
SET
  client_discount_enabled       = false,
  client_discount_type          = null,
  client_discount_value         = null,
  client_discount_min_order_amount = null,
  client_discount_max_amount    = null,
  updated_at                    = now()
WHERE
  client_discount_enabled       = true
  AND client_discount_type      = 'fixed'
  AND client_discount_value     = 1000
  AND client_discount_min_order_amount = 5000
  AND client_discount_max_amount IS NULL;

-- Any partner NOT matched by the above query had custom discount config
-- and must be reviewed by an operator before going live.
