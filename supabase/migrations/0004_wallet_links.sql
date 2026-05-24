-- wallet_links: one wallet address per user (upsert on user_id)
CREATE TABLE IF NOT EXISTS public.wallet_links (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  address     TEXT        NOT NULL,
  address_raw TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id)
);

ALTER TABLE public.wallet_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "wallet_links_select_own"
  ON public.wallet_links FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "wallet_links_insert_own"
  ON public.wallet_links FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "wallet_links_update_own"
  ON public.wallet_links FOR UPDATE
  USING (auth.uid() = user_id);

-- Store which wallet paid for record-keeping
ALTER TABLE public.ton_payments
  ADD COLUMN IF NOT EXISTS wallet_address TEXT;
