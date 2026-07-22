-- Migration 0050: pricing_language_rates
--
-- Versioned, per-direction (source_language -> target_language) translation page rate,
-- backing the new flat pricing formula's T component (2026-07-17 decision). Today there is
-- no per-language-pair rate anywhere in this schema — only per-language-GROUP base minimums
-- (BASE_MINIMUM_KZT in src/lib/pricing/config.ts), which the new formula does not use for
-- official/notarization_through_partners. Independent per direction (ru->en is a different
-- row from en->ru, never assumed symmetric). Scoped to a specific pricing_version_id so a
-- rate change never affects an already-created quote (quotes snapshot language_rate_id).
--
-- RLS: enabled with ZERO policies, same as pricing_versions (migration 0019) and
-- cost_reservations (migration 0022) — service-role only.

CREATE TABLE IF NOT EXISTS public.pricing_language_rates (
  id                             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pricing_version_id             uuid NOT NULL REFERENCES public.pricing_versions(id) ON DELETE CASCADE,
  source_language                text NOT NULL,
  target_language                text NOT NULL,
  rate_kzt_per_translation_page  numeric(12,2) NOT NULL CHECK (rate_kzt_per_translation_page >= 0),
  active                         boolean NOT NULL DEFAULT true,
  requires_operator_review       boolean NOT NULL DEFAULT false,
  created_at                     timestamptz NOT NULL DEFAULT now(),
  updated_at                     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pricing_version_id, source_language, target_language)
);

COMMENT ON TABLE public.pricing_language_rates IS
  'Per-direction translation page rate, versioned per pricing_versions row. Snapshotted into price_quotes.language_rate_id at quote time — a later rate change never affects an existing quote.';
COMMENT ON COLUMN public.pricing_language_rates.requires_operator_review IS
  'true for a language pair not yet priced/confirmed by the business — the calculator must route the order to operator_review rather than fabricate a rate or silently fall back to a default.';
COMMENT ON COLUMN public.pricing_language_rates.active IS
  'Inactive rows are excluded from lookup (calculator treats them as if absent -> operator_review) and from the public-minimum-price computation (cheapest ACTIVE rate only).';

CREATE INDEX IF NOT EXISTS idx_pricing_language_rates_lookup
  ON public.pricing_language_rates (pricing_version_id, source_language, target_language)
  WHERE active = true;

ALTER TABLE public.pricing_language_rates ENABLE ROW LEVEL SECURITY;
-- Service-role only — no user-facing policy. All reads go through Next.js API routes /
-- the worker using the service-role client, matching pricing_versions/cost_reservations.
