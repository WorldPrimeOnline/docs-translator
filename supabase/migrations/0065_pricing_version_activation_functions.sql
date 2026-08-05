-- Migration 0065: atomic pricing_versions activation/rollback functions
-- (WO-98 progressive coordination, 2026-08-05 activation-safety corrective fix;
-- 2026-08-06 security/concurrency audit corrective fix)
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
-- 2026-08-06 audit findings (this revision fixes all of them):
--   1. SECURITY DEFINER + the default PostgreSQL behavior (EXECUTE granted to PUBLIC on
--      every newly created function) meant this function was reachable by ANY anon/
--      authenticated Supabase client via PostgREST's automatic RPC exposure
--      (POST /rest/v1/rpc/activate_pricing_version) — a real privilege-escalation gap:
--      any logged-in user could have flipped which pricing version prices every quote.
--      Fixed with explicit REVOKE/GRANT below.
--   2. No serialization beyond per-row FOR UPDATE locks on the two named codes — a
--      third concurrent caller touching a different code, or a genuinely-racing retry,
--      was not provably excluded. Fixed with a session-wide pg_advisory_xact_lock() so
--      only one activation/rollback call (of either function) can be mid-flight at once.
--   3. Preconditions were generic ("some new code", "some old code") rather than
--      specific to the one WO-98 transition this migration exists for — a typo'd or
--      malicious pair of codes could have been swapped in by any caller with EXECUTE.
--      Fixed by hardcoding the expected codes inside the function body (the p_* params
--      are now asserted equal to the one known-good pair, not treated as free-form
--      input) and requiring the pricing_language_rates row count for the new version to
--      match the active version's (all 14 supported languages carried over).
--
-- These functions are intentionally single-purpose (hardcoded to the one WO-98
-- transition) rather than a generic "swap any two pricing versions" utility — a
-- generic tool reachable only by service_role is still safer to keep narrowly scoped,
-- since the operator script is the only intended caller and there is no legitimate
-- reason to activate/rollback any OTHER pair of codes with this migration's functions.

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
  v_new_id       UUID;
  v_new_status   TEXT;
  v_old_id       UUID;
  v_old_status   TEXT;
  v_active_count INT;
  v_active_code  TEXT;
  v_old_rate_count INT;
  v_new_rate_count INT;
  v_expected_old_code CONSTANT TEXT := '2026-Q3-KZ-NEWMODEL';
  v_expected_new_code CONSTANT TEXT := '2026-Q3-KZ-NEWMODEL-COORD-TIERS';
  v_expected_language_count CONSTANT INT := 14;
BEGIN
  -- Session-wide serialization: only one activate/rollback call (either function) can
  -- be mid-transaction at a time, regardless of which codes it names. Held for the
  -- duration of this transaction (xact-scoped — released automatically on COMMIT or
  -- ROLLBACK, never needs an explicit unlock call).
  PERFORM pg_advisory_xact_lock(hashtext('wpo_pricing_version_activation'));

  -- Hardcoded-pair guard: this function is scoped to the ONE known WO-98 transition,
  -- not a generic "activate any version" tool, even though only service_role can call
  -- it at all (see REVOKE/GRANT below) — defense in depth against a typo'd argument.
  IF p_new_code IS DISTINCT FROM v_expected_new_code OR p_old_code IS DISTINCT FROM v_expected_old_code THEN
    RAISE EXCEPTION 'activate_pricing_version: unexpected code pair (new=%, old=%) — this function only activates % over %', p_new_code, p_old_code, v_expected_new_code, v_expected_old_code;
  END IF;

  SELECT id, status INTO v_new_id, v_new_status
    FROM public.pricing_versions WHERE code = p_new_code FOR UPDATE;
  IF v_new_id IS NULL THEN
    RAISE EXCEPTION 'activate_pricing_version: new version % not found', p_new_code;
  END IF;
  IF v_new_status <> 'draft' THEN
    RAISE EXCEPTION 'activate_pricing_version: new version % has status % (expected draft)', p_new_code, v_new_status;
  END IF;

  SELECT id, status INTO v_old_id, v_old_status
    FROM public.pricing_versions WHERE code = p_old_code FOR UPDATE;
  IF v_old_id IS NULL THEN
    RAISE EXCEPTION 'activate_pricing_version: old version % not found', p_old_code;
  END IF;

  -- Exactly one active version must exist beforehand, and it must be p_old_code —
  -- never "0 or 1", never "some other version happens to be active".
  SELECT count(*) INTO v_active_count FROM public.pricing_versions WHERE status = 'active';
  IF v_active_count <> 1 THEN
    RAISE EXCEPTION 'activate_pricing_version: % active pricing versions found (expected exactly 1) — refusing to act on an unexpected data state', v_active_count;
  END IF;
  SELECT code INTO v_active_code FROM public.pricing_versions WHERE status = 'active';
  IF v_active_code IS DISTINCT FROM p_old_code THEN
    RAISE EXCEPTION 'activate_pricing_version: the currently active version is % , not % — refusing', v_active_code, p_old_code;
  END IF;
  IF v_old_status <> 'active' THEN
    RAISE EXCEPTION 'activate_pricing_version: old version % has status % (expected active)', p_old_code, v_old_status;
  END IF;

  -- The new version must carry an active language rate for every language the current
  -- active version prices — never activate a version that would silently route every
  -- quote for a missing language pair into operator_review.
  SELECT count(*) INTO v_old_rate_count FROM public.pricing_language_rates WHERE pricing_version_id = v_old_id AND active = true;
  SELECT count(*) INTO v_new_rate_count FROM public.pricing_language_rates WHERE pricing_version_id = v_new_id AND active = true;
  IF v_old_rate_count <> v_expected_language_count THEN
    RAISE EXCEPTION 'activate_pricing_version: active version % has % active language rates (expected %) — pre-existing data problem, refusing to proceed', p_old_code, v_old_rate_count, v_expected_language_count;
  END IF;
  IF v_new_rate_count <> v_old_rate_count THEN
    RAISE EXCEPTION 'activate_pricing_version: new version % has % active language rates, active version % has % — refusing (every supported language must carry over)', p_new_code, v_new_rate_count, p_old_code, v_old_rate_count;
  END IF;

  UPDATE public.pricing_versions SET status = 'archived', valid_to = now() WHERE id = v_old_id;
  UPDATE public.pricing_versions SET status = 'active', valid_from = now(), valid_to = NULL WHERE id = v_new_id;

  SELECT count(*) INTO v_active_count FROM public.pricing_versions WHERE status = 'active';
  IF v_active_count <> 1 THEN
    RAISE EXCEPTION 'activate_pricing_version: % active versions after activation (expected exactly 1) — transaction rolled back', v_active_count;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'before_active_code', p_old_code,
    'after_active_code', p_new_code,
    'active_version_id', v_new_id
  );
END;
$$;

COMMENT ON FUNCTION public.activate_pricing_version(TEXT, TEXT) IS
  'Atomically archives the one known old pricing version and activates the one known new version (hardcoded pair — see function body). service_role only, never reachable via the client Supabase API. Raises (full transaction rollback) on any precondition/postcondition violation.';

-- Callable ONLY by the service role — never by anon/authenticated Supabase API clients.
-- PostgreSQL grants EXECUTE to PUBLIC by default on every newly created function; a
-- SECURITY DEFINER function left at that default is reachable by any anon/authenticated
-- JWT through PostgREST's automatic RPC exposure (POST /rest/v1/rpc/<function_name>).
REVOKE ALL ON FUNCTION public.activate_pricing_version(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.activate_pricing_version(TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.activate_pricing_version(TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.activate_pricing_version(TEXT, TEXT) TO service_role;

-- rollback_pricing_version(): the atomic undo for activate_pricing_version(). Restores
-- p_restore_code to active and sets p_deactivate_code back to 'draft' (never 'archived'
-- — an activated-then-rolled-back version must remain eligible for a future retry, and
-- never deleted: price_quotes/quote history referencing it must stay intact). A plain
-- DELETE of the new version row is ONLY ever safe BEFORE it was ever activated (see
-- migration 0064's own rollback note) — after activation, deleting it would orphan any
-- price_quotes.pricing_version_id that was written while it was active, which this
-- function is specifically designed to avoid ever needing. Same hardcoded-pair scoping,
-- advisory lock, and service_role-only exposure as activate_pricing_version() above.
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
  v_restore_id     UUID;
  v_restore_status TEXT;
  v_deactivate_id     UUID;
  v_deactivate_status TEXT;
  v_active_count INT;
  v_active_code  TEXT;
  v_expected_restore_code CONSTANT TEXT := '2026-Q3-KZ-NEWMODEL';
  v_expected_deactivate_code CONSTANT TEXT := '2026-Q3-KZ-NEWMODEL-COORD-TIERS';
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('wpo_pricing_version_activation'));

  IF p_restore_code IS DISTINCT FROM v_expected_restore_code OR p_deactivate_code IS DISTINCT FROM v_expected_deactivate_code THEN
    RAISE EXCEPTION 'rollback_pricing_version: unexpected code pair (restore=%, deactivate=%) — this function only restores % over %', p_restore_code, p_deactivate_code, v_expected_restore_code, v_expected_deactivate_code;
  END IF;

  SELECT id, status INTO v_restore_id, v_restore_status
    FROM public.pricing_versions WHERE code = p_restore_code FOR UPDATE;
  IF v_restore_id IS NULL THEN
    RAISE EXCEPTION 'rollback_pricing_version: version to restore % not found', p_restore_code;
  END IF;
  IF v_restore_status = 'active' THEN
    RAISE EXCEPTION 'rollback_pricing_version: % is already active — nothing to roll back', p_restore_code;
  END IF;

  SELECT id, status INTO v_deactivate_id, v_deactivate_status
    FROM public.pricing_versions WHERE code = p_deactivate_code FOR UPDATE;
  IF v_deactivate_id IS NULL THEN
    RAISE EXCEPTION 'rollback_pricing_version: version to deactivate % not found', p_deactivate_code;
  END IF;

  -- Exactly one active version must exist beforehand, and it must be p_deactivate_code.
  SELECT count(*) INTO v_active_count FROM public.pricing_versions WHERE status = 'active';
  IF v_active_count <> 1 THEN
    RAISE EXCEPTION 'rollback_pricing_version: % active pricing versions found (expected exactly 1) — refusing to act on an unexpected data state', v_active_count;
  END IF;
  SELECT code INTO v_active_code FROM public.pricing_versions WHERE status = 'active';
  IF v_active_code IS DISTINCT FROM p_deactivate_code THEN
    RAISE EXCEPTION 'rollback_pricing_version: the currently active version is %, not % — refusing', v_active_code, p_deactivate_code;
  END IF;

  UPDATE public.pricing_versions SET status = 'draft', valid_to = now() WHERE id = v_deactivate_id;
  UPDATE public.pricing_versions SET status = 'active', valid_from = now(), valid_to = NULL WHERE id = v_restore_id;

  SELECT count(*) INTO v_active_count FROM public.pricing_versions WHERE status = 'active';
  IF v_active_count <> 1 THEN
    RAISE EXCEPTION 'rollback_pricing_version: % active versions after rollback (expected exactly 1) — transaction rolled back', v_active_count;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'before_active_code', p_deactivate_code,
    'after_active_code', p_restore_code,
    'active_version_id', v_restore_id
  );
END;
$$;

COMMENT ON FUNCTION public.rollback_pricing_version(TEXT, TEXT) IS
  'Atomically restores the one known old pricing version to active and sets the one known COORD-TIERS version back to draft (never deleted, never archived — history/quotes referencing it must remain valid). service_role only, never reachable via the client Supabase API. Raises (full transaction rollback) on any precondition/postcondition violation.';

REVOKE ALL ON FUNCTION public.rollback_pricing_version(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rollback_pricing_version(TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.rollback_pricing_version(TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.rollback_pricing_version(TEXT, TEXT) TO service_role;
