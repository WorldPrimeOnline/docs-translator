-- Migration 0065: atomic pricing_versions activation/rollback functions
-- (WO-98 progressive coordination, 2026-08-05 activation-safety corrective fix)
--
-- PREPARED, NOT APPLIED. Requires migration 0064 to already be applied (creates the
-- '2026-Q3-KZ-NEWMODEL-COORD-TIERS' draft row this pair of functions operates on).
--
-- Why a function, not two separate application-side UPDATE calls: supabase-js has no
-- multi-statement transaction support, so two sequential .update() calls from a script
-- can never be atomic — a crash/network failure between them could leave ZERO active
-- pricing versions (every quote then fails with "no active pricing version"). A single
-- plpgsql function is one transaction: either both status flips happen, or neither does.
-- Matches this codebase's existing convention for atomic multi-row operations (see
-- finalize_halyk_payment(), migration 0015).
--
-- activate_pricing_version(): the ONLY correct way to switch the active pricing_versions
-- row going forward. Row-locks both versions (FOR UPDATE) to prevent a concurrent
-- activation race, verifies the new version exists and is not already active, verifies
-- there is at most one active version BEFORE acting (a pre-existing "2 active versions"
-- data problem must never be silently compounded), performs both status flips, then
-- verifies EXACTLY one active version afterward — raising (and therefore rolling back
-- the whole transaction) on any violation.
CREATE OR REPLACE FUNCTION public.activate_pricing_version(
  p_new_code TEXT,
  p_old_code TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_id     UUID;
  v_new_status TEXT;
  v_old_id     UUID;
  v_old_status TEXT;
  v_active_count INT;
BEGIN
  SELECT id, status INTO v_new_id, v_new_status
    FROM public.pricing_versions WHERE code = p_new_code FOR UPDATE;
  IF v_new_id IS NULL THEN
    RAISE EXCEPTION 'activate_pricing_version: new version % not found', p_new_code;
  END IF;
  IF v_new_status = 'active' THEN
    RAISE EXCEPTION 'activate_pricing_version: new version % is already active', p_new_code;
  END IF;

  SELECT id, status INTO v_old_id, v_old_status
    FROM public.pricing_versions WHERE code = p_old_code FOR UPDATE;

  SELECT count(*) INTO v_active_count FROM public.pricing_versions WHERE status = 'active';
  IF v_active_count > 1 THEN
    RAISE EXCEPTION 'activate_pricing_version: % active versions found before activation (expected 0 or 1) — refusing to compound a pre-existing data problem', v_active_count;
  END IF;

  IF v_old_id IS NOT NULL AND v_old_status = 'active' THEN
    UPDATE public.pricing_versions SET status = 'archived', valid_to = now() WHERE id = v_old_id;
  END IF;

  UPDATE public.pricing_versions SET status = 'active', valid_from = now(), valid_to = NULL WHERE id = v_new_id;

  SELECT count(*) INTO v_active_count FROM public.pricing_versions WHERE status = 'active';
  IF v_active_count <> 1 THEN
    RAISE EXCEPTION 'activate_pricing_version: % active versions after activation (expected exactly 1) — transaction rolled back', v_active_count;
  END IF;

  RETURN jsonb_build_object('ok', true, 'active_code', p_new_code, 'active_version_id', v_new_id);
END;
$$;

COMMENT ON FUNCTION public.activate_pricing_version IS
  'Atomically archives p_old_code (if currently active) and activates p_new_code. Raises (full rollback) if p_new_code is missing/already active, if more than one version is active beforehand, or if the post-condition (exactly one active version) fails afterward.';

-- rollback_pricing_version(): the atomic undo for activate_pricing_version(). Restores
-- p_restore_code to active and sets p_deactivate_code back to 'draft' (never 'archived'
-- — an activated-then-rolled-back version must remain eligible for a future retry, and
-- never deleted: price_quotes/quote history referencing it must stay intact). A plain
-- DELETE of the new version row is ONLY ever safe BEFORE it was ever activated (see
-- migration 0064's own rollback note) — after activation, deleting it would orphan any
-- price_quotes.pricing_version_id that was written while it was active, which this
-- function is specifically designed to avoid ever needing.
CREATE OR REPLACE FUNCTION public.rollback_pricing_version(
  p_restore_code TEXT,
  p_deactivate_code TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_restore_id UUID;
  v_deactivate_id UUID;
  v_deactivate_status TEXT;
  v_active_count INT;
BEGIN
  SELECT id INTO v_restore_id FROM public.pricing_versions WHERE code = p_restore_code FOR UPDATE;
  IF v_restore_id IS NULL THEN
    RAISE EXCEPTION 'rollback_pricing_version: version to restore % not found', p_restore_code;
  END IF;

  SELECT id, status INTO v_deactivate_id, v_deactivate_status
    FROM public.pricing_versions WHERE code = p_deactivate_code FOR UPDATE;

  IF v_deactivate_id IS NOT NULL AND v_deactivate_status = 'active' THEN
    UPDATE public.pricing_versions SET status = 'draft', valid_to = now() WHERE id = v_deactivate_id;
  END IF;

  UPDATE public.pricing_versions SET status = 'active', valid_from = now(), valid_to = NULL WHERE id = v_restore_id;

  SELECT count(*) INTO v_active_count FROM public.pricing_versions WHERE status = 'active';
  IF v_active_count <> 1 THEN
    RAISE EXCEPTION 'rollback_pricing_version: % active versions after rollback (expected exactly 1) — transaction rolled back', v_active_count;
  END IF;

  RETURN jsonb_build_object('ok', true, 'active_code', p_restore_code, 'active_version_id', v_restore_id);
END;
$$;

COMMENT ON FUNCTION public.rollback_pricing_version IS
  'Atomically restores p_restore_code to active and sets p_deactivate_code to draft (never deleted, never archived — history/quotes referencing it must remain valid and it must stay eligible for a future retry). Raises (full rollback) if p_restore_code is missing or the post-condition (exactly one active version) fails.';
