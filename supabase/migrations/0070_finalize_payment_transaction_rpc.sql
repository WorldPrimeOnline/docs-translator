-- Migration 0070: generic, provider-neutral payment finalization RPC.
--
-- Purely additive — does NOT modify finalize_halyk_payment (migration 0015) or any
-- of its call sites. Halyk's callback/status/reconcile routes keep calling
-- finalize_halyk_payment exactly as before, byte-for-byte unchanged.
--
-- Rationale (see the Freedom Pay integration DELTA REPORT §6): finalize_halyk_payment's
-- body looks up the payment row only by provider_invoice_id and every parameter maps
-- onto already-generic payment_transactions columns — nothing in its logic is actually
-- Halyk-specific, only its name. Freedom Pay is the first consumer of this generic
-- RPC; any future third provider reuses this same function instead of spawning
-- another near-identical copy.
--
-- Same row-lock / idempotency / duplicate-charge structure as finalize_halyk_payment.

CREATE OR REPLACE FUNCTION public.finalize_payment_transaction(
  p_invoice_id           TEXT,
  p_transaction_id       TEXT,
  p_provider_status      TEXT,
  p_provider_reason      TEXT,
  p_provider_reason_code TEXT,
  p_card_mask            TEXT,
  p_card_type            TEXT,
  p_issuer               TEXT,
  p_approval_code        TEXT,
  p_reference             TEXT,
  p_secure                TEXT,
  p_provider_payload     JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment public.payment_transactions%ROWTYPE;
BEGIN
  -- Acquire row lock on the payment transaction
  SELECT * INTO v_payment
    FROM public.payment_transactions
    WHERE provider_invoice_id = p_invoice_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'payment_not_found');
  END IF;

  -- Idempotency: if already paid, return success without re-running downstream
  IF v_payment.status = 'paid' THEN
    RETURN jsonb_build_object(
      'ok', true,
      'already_paid', true,
      'payment_id', v_payment.id,
      'job_id', v_payment.job_id
    );
  END IF;

  -- Finalize payment transaction
  UPDATE public.payment_transactions SET
    status                  = 'paid',
    provider_transaction_id = p_transaction_id,
    provider_status         = p_provider_status,
    provider_reason         = p_provider_reason,
    provider_reason_code    = p_provider_reason_code,
    card_mask               = p_card_mask,
    card_type               = p_card_type,
    issuer                  = p_issuer,
    approval_code           = p_approval_code,
    reference               = p_reference,
    secure                  = p_secure,
    provider_payload        = p_provider_payload,
    paid_at                 = NOW(),
    callback_received_at    = NOW(),
    updated_at              = NOW()
  WHERE id = v_payment.id;

  -- Check whether a different payment already paid this job
  IF EXISTS (
    SELECT 1 FROM public.payment_transactions
    WHERE job_id = v_payment.job_id
      AND status = 'paid'
      AND id <> v_payment.id
  ) THEN
    -- Second charge detected: mark as duplicate
    UPDATE public.payment_transactions SET
      status     = 'duplicate_charge_review',
      updated_at = NOW()
    WHERE id = v_payment.id;

    RETURN jsonb_build_object(
      'ok', true,
      'duplicate_charge', true,
      'payment_id', v_payment.id,
      'job_id', v_payment.job_id
    );
  END IF;

  -- Move job from payment_pending to queued (start processing)
  UPDATE public.jobs SET
    status         = 'queued',
    payment_source = 'card_payment'
  WHERE id = v_payment.job_id
    AND status = 'payment_pending';

  RETURN jsonb_build_object(
    'ok', true,
    'already_paid', false,
    'duplicate_charge', false,
    'payment_id', v_payment.id,
    'job_id', v_payment.job_id
  );
END;
$$;

-- Revoke execute from all public/user roles; only service_role may call this
REVOKE EXECUTE ON FUNCTION public.finalize_payment_transaction FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.finalize_payment_transaction FROM anon;
REVOKE EXECUTE ON FUNCTION public.finalize_payment_transaction FROM authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_payment_transaction TO service_role;
