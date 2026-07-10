-- Migration 0046: jobs.applicant_type
--
-- The customer's applicant type (individual vs legal entity) is selected on the
-- order form for notarized service and directly determines the notary official
-- fee (NOTARY_APPLICANT_MRP_COEFFICIENT — src/lib/pricing/config.ts). It was
-- already captured in order_drafts.applicant_type (migration 0044) and used as
-- a pricing input (src/lib/pricing/calculator.ts), but was never copied into
-- jobs — so it never reached the worker's Jira issue creation, and operators
-- could not see which notary tariff applied. Found while auditing job
-- 16a6e84d-6d3d-4728-9938-83ca93970001 (Jira WO-75), 2026-07-10.
--
-- Nullable, no default: existing jobs genuinely have no recorded value (the
-- form/pricing input was never persisted for them) — NULL means "not recorded",
-- not "individual". Application code must never fabricate a value for NULL.

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS applicant_type TEXT;

COMMENT ON COLUMN public.jobs.applicant_type IS
  'individual | legal_entity | unknown — customer-selected applicant type for notarized orders, determines the notary official fee tier. NULL for jobs created before this column existed; never infer from price.';
