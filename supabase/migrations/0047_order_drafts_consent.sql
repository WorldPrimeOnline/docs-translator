-- Migration 0047: order_drafts.consent_accepted_at
--
-- The public "/[locale]/start" wizard already required the visitor to check a Terms
-- of Service / Privacy Policy consent box before submitting (OrderForm.tsx
-- consentChecked), but for anonymous visitors that acceptance was never persisted
-- anywhere — /api/users/accept-terms only fires when a session already exists. As a
-- result, /checkout had no reliable signal that consent was already given at /start,
-- so it re-asked via its own terms checkbox + a second "Confirm your order" screen —
-- a duplicate confirmation step on top of the /start price-ready panel.
--
-- This column is the durable, anonymous-safe record of that acceptance, set once at
-- /start submit time (OrderForm.tsx -> POST/PATCH order-drafts, consentAccepted=true)
-- and checked by /checkout (CheckoutClient.tsx) and convertDraftToOrder() before ever
-- creating a payable order. Nullable, no default: a draft with no accepted consent
-- must never silently proceed to payment.

ALTER TABLE public.order_drafts
  ADD COLUMN IF NOT EXISTS consent_accepted_at timestamptz;

COMMENT ON COLUMN public.order_drafts.consent_accepted_at IS
  'Set once, from the /start publicStart form submit, when the visitor had the Terms of Service/Privacy Policy consent box checked (or already had account-level terms_accepted_at). NULL means consent was never recorded — checkout must refuse to auto-convert/pay and must not silently continue.';
