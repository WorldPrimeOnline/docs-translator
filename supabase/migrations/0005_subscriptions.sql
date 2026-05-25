-- Subscription plans table
CREATE TABLE subscriptions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID REFERENCES users(id) NOT NULL,
  plan              TEXT NOT NULL CHECK (plan IN ('basic', 'pro')),
  status            TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'active', 'expired', 'cancelled')),
  documents_limit   INTEGER NOT NULL,
  documents_used    INTEGER NOT NULL DEFAULT 0,
  amount_nanoton    BIGINT,
  amount_usd        NUMERIC(10, 2),
  ton_price_usd     NUMERIC(10, 4),
  tx_hash           TEXT,
  started_at        TIMESTAMPTZ,
  expires_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own subscriptions"
  ON subscriptions FOR ALL
  USING (auth.uid() = user_id);

-- Add priority and payment_source columns to jobs
ALTER TABLE jobs
  ADD COLUMN priority       INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN payment_source TEXT
    CHECK (payment_source IN ('ton_payment', 'subscription'));
