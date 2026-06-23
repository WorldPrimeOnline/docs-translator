-- Migration 0021: Price quote line items
-- Detailed breakdown of each quote. Client-visible items shown in UI;
-- cost items (is_cost=true) are internal only.

CREATE TABLE IF NOT EXISTS public.price_quote_items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id          uuid NOT NULL REFERENCES public.price_quotes(id) ON DELETE CASCADE,
  item_type         text NOT NULL,
  label             text NOT NULL,
  quantity          numeric(12,3) NOT NULL DEFAULT 1,
  unit_price_kzt    numeric(12,2),
  amount_kzt        numeric(12,2) NOT NULL,
  is_client_visible boolean NOT NULL DEFAULT true,
  is_cost           boolean NOT NULL DEFAULT false,
  sort_order        integer NOT NULL DEFAULT 0,
  metadata_json     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.price_quote_items IS
  'Line items for price quotes. is_cost=true items are internal only (reserves, commissions).';
COMMENT ON COLUMN public.price_quote_items.item_type IS
  'e.g. minimum_check, extra_words, additional_pages, document_type_coefficient, urgency_fee, notary_official_fee, delivery_fee, tax_reserve, acquiring_reserve, etc.';

CREATE INDEX IF NOT EXISTS idx_price_quote_items_quote_id
  ON public.price_quote_items (quote_id, sort_order);

ALTER TABLE public.price_quote_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "price_quote_items_select_via_quote"
  ON public.price_quote_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.price_quotes q
      WHERE q.id = quote_id AND q.user_id = auth.uid()
    )
  );
