-- Migration 0060: price_quotes — enforce immutability of a paid quote's price snapshot
--
-- price_quotes' own table comment (migration 0020) and price_locked_at's column comment both
-- already ASSERT "never recalculate after payment_pending" / "amount_kzt is permanently locked"
-- — but nothing in SQL or application code actually enforced it. markQuotePaid()
-- (src/lib/pricing/service.ts) had no status guard on its own UPDATE either (fixed in the same
-- change that introduced this migration). This trigger is the real enforcement: once a quote's
-- status is 'paid', its price snapshot columns can never change again, from any code path,
-- present or future — not just a documentation convention anymore.
--
-- Deliberately does NOT block the transition INTO 'paid' itself (that UPDATE's OLD.status is
-- still 'quoted'/'payment_pending'/'requires_operator_review', never already 'paid'), and does
-- NOT block status/paid_at/price_locked_at/updated_at from changing — only the actual price
-- snapshot fields. Refunds are recorded in refund_transactions/cost_reservations, never by
-- mutating price_quotes, so this trigger does not need a refund-specific carve-out.

CREATE OR REPLACE FUNCTION public.prevent_paid_price_quote_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.status = 'paid' THEN
    IF NEW.amount_kzt IS DISTINCT FROM OLD.amount_kzt
       OR NEW.wpo_financial_breakdown_json IS DISTINCT FROM OLD.wpo_financial_breakdown_json
       OR NEW.pricing_context_json IS DISTINCT FROM OLD.pricing_context_json
       OR NEW.breakdown_json IS DISTINCT FROM OLD.breakdown_json
       OR NEW.internal_cost_json IS DISTINCT FROM OLD.internal_cost_json
       OR NEW.margin_json IS DISTINCT FROM OLD.margin_json
       OR NEW.formula_version IS DISTINCT FROM OLD.formula_version
       OR NEW.pricing_version_id IS DISTINCT FROM OLD.pricing_version_id
    THEN
      RAISE EXCEPTION
        'price_quotes % is paid (price_locked_at=%) — its price snapshot can never change after payment. Refunds go through refund_transactions/cost_reservations, never a price_quotes update.',
        OLD.id, OLD.price_locked_at;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.prevent_paid_price_quote_mutation() IS
  'BEFORE UPDATE trigger on price_quotes: once status=paid, blocks any change to amount_kzt/wpo_financial_breakdown_json/pricing_context_json/breakdown_json/internal_cost_json/margin_json/formula_version/pricing_version_id. See migration 0060.';

DROP TRIGGER IF EXISTS trg_prevent_paid_price_quote_mutation ON public.price_quotes;
CREATE TRIGGER trg_prevent_paid_price_quote_mutation
  BEFORE UPDATE ON public.price_quotes
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_paid_price_quote_mutation();
