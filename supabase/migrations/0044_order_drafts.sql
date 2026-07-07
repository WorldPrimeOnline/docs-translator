-- Migration 0044: Public pre-checkout order drafts
-- Backs the anonymous "/[locale]/start" wizard: lets a visitor pick options, upload a
-- file, and see a price BEFORE creating an account. Draft rows never feed the worker
-- pipeline directly — they are converted into real documents/jobs/price_quotes rows
-- (via the existing upload-card code path) only at checkout time, after login, still
-- before payment. See docs/ai-context/50_PAYMENTS_FINANCE_FISCALIZATION.md.
--
-- RLS: enabled with ZERO policies, same as cost_reservations (migration 0022) —
-- service-role only. All reads/writes go through Next.js API routes using
-- supabaseServer; there is no anon-key client access to these tables.

CREATE TABLE IF NOT EXISTS public.order_drafts (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 uuid REFERENCES public.users(id) ON DELETE SET NULL,
  anonymous_session_id    text NOT NULL,
  status                  text NOT NULL DEFAULT 'draft_created'
                          CHECK (status IN ('draft_created','price_calculated','checkout_started','expired','converted')),

  source_language         text,
  target_language         text,
  document_type           text,
  output_format           text,
  service_level           text,
  applicant_type          text,
  notary_urgency_level    text,
  notary_city             text,
  fulfillment_method      text,
  delivery_phone          text,
  delivery_address        text,
  delivery_zone           text,
  customer_comment        text,

  file_keys               jsonb NOT NULL DEFAULT '[]'::jsonb,
  pricing_snapshot        jsonb,

  ref_code                text,
  utm_source              text,
  utm_medium              text,
  utm_campaign            text,
  utm_content             text,
  utm_term                text,

  converted_job_id        uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  converted_document_id   uuid REFERENCES public.documents(id) ON DELETE SET NULL,
  converted_quote_id      uuid REFERENCES public.price_quotes(id) ON DELETE SET NULL,
  converted_price_kzt     numeric(12,2),

  ip_address              text,
  expires_at              timestamptz NOT NULL DEFAULT (now() + interval '48 hours'),
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.order_drafts IS
  'Anonymous/authenticated pre-checkout wizard drafts. Never queued for the worker directly — converted into documents/jobs/price_quotes at checkout time via the same path upload-card already uses.';
COMMENT ON COLUMN public.order_drafts.pricing_snapshot IS
  'Read-only computeQuoteForJob() result cached for display — NOT a price_quotes row. The real quote is created at conversion time.';
COMMENT ON COLUMN public.order_drafts.converted_job_id IS
  'Set once at conversion time. Idempotency guard: if already set, /convert returns the existing job instead of creating a duplicate.';

CREATE INDEX IF NOT EXISTS idx_order_drafts_anonymous_session_id ON public.order_drafts (anonymous_session_id);
CREATE INDEX IF NOT EXISTS idx_order_drafts_user_id ON public.order_drafts (user_id);
CREATE INDEX IF NOT EXISTS idx_order_drafts_expires_at ON public.order_drafts (expires_at) WHERE status <> 'converted';

ALTER TABLE public.order_drafts ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.anonymous_rate_limit_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_token text NOT NULL,
  ip_address    text NOT NULL,
  event_type    text NOT NULL DEFAULT 'price_calculation',
  created_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.anonymous_rate_limit_events IS
  'Durable rate-limit log for anonymous wizard actions (e.g. price_calculation) — keyed by session cookie token, with IP as a fallback key. Service-role only.';

CREATE INDEX IF NOT EXISTS idx_anon_rate_limit_session_created ON public.anonymous_rate_limit_events (session_token, created_at);
CREATE INDEX IF NOT EXISTS idx_anon_rate_limit_ip_created ON public.anonymous_rate_limit_events (ip_address, created_at);

ALTER TABLE public.anonymous_rate_limit_events ENABLE ROW LEVEL SECURITY;
