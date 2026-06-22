-- Migration 0026: Atomic subscription job creation
-- Replaces three non-atomic INSERTs/UPDATEs in the upload route with a single
-- PL/pgSQL function that holds a row-level lock on the subscription row.
-- This prevents a TOCTOU race where two concurrent uploads can both pass the
-- quota check and both increment documents_used past documents_limit.

CREATE OR REPLACE FUNCTION public.create_subscription_job(
  -- Document fields
  p_document_id           UUID,
  p_user_id               UUID,
  p_filename              TEXT,
  p_original_file_size    BIGINT,
  p_file_key              TEXT,
  p_source_language       TEXT,
  p_target_language       TEXT,
  p_document_type         TEXT,
  p_ip_address            TEXT,
  -- Subscription
  p_subscription_id       UUID,
  p_documents_limit       INT,
  -- Job fields
  p_priority              INT,
  p_notarized             BOOLEAN,
  p_service_level         TEXT,
  p_notary_city           TEXT,
  p_fulfillment_method    TEXT,
  p_delivery_phone        TEXT,
  p_delivery_address      TEXT,
  -- Audit
  p_actor                 TEXT,
  p_audit_metadata        JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_used INT;
  v_job_id       UUID;
BEGIN
  -- Lock the subscription row to prevent concurrent quota bypasses.
  -- user_id = p_user_id enforces ownership: prevents cross-user quota drain
  -- even if the RPC is somehow called with another user's subscription_id.
  SELECT documents_used INTO v_current_used
  FROM public.subscriptions
  WHERE id = p_subscription_id AND user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'subscription_not_found');
  END IF;

  IF v_current_used >= p_documents_limit THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'over_quota');
  END IF;

  -- Insert document record
  INSERT INTO public.documents (
    id,
    user_id,
    filename,
    original_file_size,
    file_key,
    source_language,
    target_language,
    document_type,
    status,
    ip_address
  ) VALUES (
    p_document_id,
    p_user_id,
    p_filename,
    p_original_file_size,
    p_file_key,
    p_source_language,
    p_target_language,
    p_document_type,
    'processing',
    p_ip_address
  );

  -- Atomically increment documents_used (never SET to a concrete value to avoid
  -- overwriting concurrent increments that may have occurred within this transaction)
  UPDATE public.subscriptions
  SET
    documents_used = documents_used + 1,
    updated_at     = now()
  WHERE id = p_subscription_id;

  -- Insert job
  INSERT INTO public.jobs (
    document_id,
    status,
    progress_percent,
    priority,
    payment_source,
    notarized,
    service_level,
    notary_city,
    fulfillment_method,
    delivery_phone,
    delivery_address
  ) VALUES (
    p_document_id,
    'queued',
    0,
    p_priority,
    'subscription',
    p_notarized,
    p_service_level,
    p_notary_city,
    p_fulfillment_method,
    p_delivery_phone,
    p_delivery_address
  )
  RETURNING id INTO v_job_id;

  -- Append audit record
  INSERT INTO public.job_audit_log (
    job_id,
    actor,
    source,
    action,
    new_status,
    metadata
  ) VALUES (
    v_job_id,
    p_actor,
    'upload',
    'job_created',
    'queued',
    p_audit_metadata
  );

  RETURN jsonb_build_object(
    'ok',          true,
    'document_id', p_document_id::TEXT,
    'job_id',      v_job_id::TEXT
  );
END;
$$;

COMMENT ON FUNCTION public.create_subscription_job IS
  'Atomically creates a document record, increments the subscription quota, '
  'inserts the job, and writes an audit row — all under a FOR UPDATE lock on '
  'the subscription row to prevent concurrent quota overruns.';

-- Revoke execute from all public/user roles; only service_role may call this.
-- Mirrors the pattern used by finalize_halyk_payment in migration 0015.
REVOKE EXECUTE ON FUNCTION public.create_subscription_job FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_subscription_job FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_subscription_job FROM authenticated;
GRANT EXECUTE ON FUNCTION public.create_subscription_job TO service_role;
