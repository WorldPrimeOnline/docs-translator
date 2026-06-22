-- Migration 0020: Price quotes table
-- Immutable price snapshot created at upload time. Payment amount must match quote.
-- Lifecycle: draft → quoted → payment_pending → paid | expired | canceled | refunded

CREATE TABLE IF NOT EXISTS public.price_quotes (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id                uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  document_id           uuid REFERENCES public.documents(id) ON DELETE SET NULL,
  user_id               uuid REFERENCES public.users(id) ON DELETE SET NULL,
  pricing_version_id    uuid REFERENCES public.pricing_versions(id),

  -- Lifecycle
  status                text NOT NULL CHECK (status IN (
    'draft','quoted','expired','payment_pending','paid',
    'canceled','refunded','requires_operator_review'
  )),
  amount_kzt            numeric(12,2) NOT NULL CHECK (amount_kzt >= 0),
  currency              text NOT NULL DEFAULT 'KZT',

  -- Timestamps
  quoted_at             timestamptz NOT NULL DEFAULT now(),
  expires_at            timestamptz NOT NULL,
  accepted_at           timestamptz,
  price_locked_at       timestamptz,
  paid_at               timestamptz,

  -- Pricing inputs (snapshot for auditability)
  source_word_count     integer,
  physical_page_count   integer,
  included_word_count   integer NOT NULL DEFAULT 250,
  included_page_count   integer NOT NULL DEFAULT 1,
  source_language       text,
  target_language       text,
  language_pair         text,
  document_type         text,
  service_level         text,
  urgency_level         text NOT NULL DEFAULT 'standard',
  fulfillment_method    text,
  notary_city           text,
  delivery_required     boolean NOT NULL DEFAULT false,
  partner_id            uuid,
  sales_channel         text NOT NULL DEFAULT 'direct',

  -- Calculation results (JSON blobs for full audit trail)
  pricing_context_json  jsonb NOT NULL DEFAULT '{}'::jsonb,
  breakdown_json        jsonb NOT NULL DEFAULT '{}'::jsonb,
  internal_cost_json    jsonb NOT NULL DEFAULT '{}'::jsonb,
  margin_json           jsonb NOT NULL DEFAULT '{}'::jsonb,

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.price_quotes IS
  'Immutable price snapshots. Payment amount must equal quote amount_kzt. Never recalculate after payment_pending.';
COMMENT ON COLUMN public.price_quotes.expires_at IS
  'B2C quotes expire after 24h. B2B quotes after 7 days.';
COMMENT ON COLUMN public.price_quotes.price_locked_at IS
  'Set when payment is confirmed paid. After this, amount_kzt is permanently locked.';

-- Indexes
CREATE INDEX IF NOT EXISTS idx_price_quotes_job_id
  ON public.price_quotes (job_id);
CREATE INDEX IF NOT EXISTS idx_price_quotes_document_id
  ON public.price_quotes (document_id);
CREATE INDEX IF NOT EXISTS idx_price_quotes_user_id
  ON public.price_quotes (user_id);
CREATE INDEX IF NOT EXISTS idx_price_quotes_status
  ON public.price_quotes (status, expires_at);
CREATE INDEX IF NOT EXISTS idx_price_quotes_pricing_version
  ON public.price_quotes (pricing_version_id);

-- RLS: users can only read their own quotes
ALTER TABLE public.price_quotes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "price_quotes_select_own"
  ON public.price_quotes FOR SELECT
  USING (auth.uid() = user_id);
