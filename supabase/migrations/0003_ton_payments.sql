CREATE TABLE IF NOT EXISTS public.ton_payments (
  id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID          NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  document_id      UUID          NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  job_id           UUID          NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  amount_nanoton   BIGINT        NOT NULL,
  amount_usd       NUMERIC(10,4) NOT NULL,
  ton_price_usd    NUMERIC(10,4) NOT NULL,
  status           TEXT          NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'completed', 'expired', 'failed')),
  tx_hash          TEXT,
  expires_at       TIMESTAMPTZ   NOT NULL,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ton_payments_job_id ON public.ton_payments (job_id);
CREATE INDEX IF NOT EXISTS idx_ton_payments_user_id ON public.ton_payments (user_id);

ALTER TABLE public.ton_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ton_payments_select_own"
  ON public.ton_payments FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "ton_payments_insert_own"
  ON public.ton_payments FOR INSERT
  WITH CHECK (auth.uid() = user_id);
