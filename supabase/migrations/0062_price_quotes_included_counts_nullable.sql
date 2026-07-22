-- Migration 0062: price_quotes.included_word_count / included_page_count -> nullable
--
-- 2026-07-27 incident: saveQuote() failed on a real Official (new-model) quote with
-- "null value in column "included_word_count" of relation "price_quotes" violates not-null
-- constraint". Root cause: both columns were declared NOT NULL DEFAULT ... in migration 0020,
-- back when price_quotes only backed the legacy electronic formula (which always computes a
-- real includedWordCount/includedPageCount baseline). saveQuote() has always passed
-- `result.context.includedWordCount ?? null` / `result.context.includedPageCount ?? null` —
-- for the new official/notarization_through_partners formula (2026-07-17), which bills by
-- character/physical page count and has no "included words/pages before surcharge" concept at
-- all, result.context never sets these fields, so the code passed an EXPLICIT null. Postgres
-- only applies a column DEFAULT when the column is omitted from the INSERT list entirely — an
-- explicit NULL always overrides the DEFAULT — so every new-model quote violated NOT NULL.
--
-- Fix: these two columns have no equivalent meaning under the new formula. Rather than
-- fabricate a placeholder number (which the new formula never actually uses for anything),
-- make both columns nullable. NULL now means exactly what it says: not applicable to this
-- quote's formula. The legacy electronic formula is completely unaffected — it still always
-- provides a real value via result.context.includedWordCount/includedPageCount, so existing
-- electronic quotes keep getting real, non-null values. The DEFAULT is left in place for any
-- other caller that omits these columns outright.

ALTER TABLE public.price_quotes
  ALTER COLUMN included_word_count DROP NOT NULL,
  ALTER COLUMN included_page_count DROP NOT NULL;

COMMENT ON COLUMN public.price_quotes.included_word_count IS
  'Legacy electronic-formula-only: words included in the base price before per-extra-word billing. NULL for official/notarization_through_partners (new-model) quotes, which bill by character/page count and have no equivalent concept — never fabricated.';
COMMENT ON COLUMN public.price_quotes.included_page_count IS
  'Legacy electronic-formula-only: pages included in the base price before per-extra-page billing. NULL for official/notarization_through_partners (new-model) quotes — see included_word_count comment; same reasoning.';
