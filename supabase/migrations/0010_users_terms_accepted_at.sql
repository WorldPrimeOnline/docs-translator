-- Add terms acceptance timestamp to users table.
-- Null means the user has not yet accepted the terms.
-- Set by POST /api/users/accept-terms; verified server-side in POST /api/documents/upload.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ DEFAULT NULL;
