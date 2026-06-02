-- Migration 0009: Add IP address capture for chargeback/dispute evidence
-- IP is captured at upload/payment time for security, fraud prevention,
-- and payment provider dispute/chargeback handling.
-- Disclosed to users in Privacy Policy (section: Types of Personal Data Processed).

-- documents: capture IP at upload time
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS ip_address TEXT;

-- payment_transactions: capture IP at payment creation time
ALTER TABLE public.payment_transactions
  ADD COLUMN IF NOT EXISTS ip_address TEXT;

COMMENT ON COLUMN public.documents.ip_address IS
  'Client IP address captured at upload time. Used for fraud prevention and dispute handling only. Not exposed to users.';

COMMENT ON COLUMN public.payment_transactions.ip_address IS
  'Client IP address captured at payment creation. Used for fraud prevention and dispute handling only. Not exposed to users.';
