-- Migration: staff_profiles and notification_log
-- Adds internal staff table for dynamic Telegram routing and delivery audit log.
-- Idempotent (IF NOT EXISTS) — safe to re-run.

-- ── 1. staff_profiles ─────────────────────────────────────────────────────────
-- Stores operators, translators, notary partners, and admins with their
-- Jira account ID and Telegram chat ID for dynamic notification routing.
-- This table is NEVER exposed to the browser client — service role only.
CREATE TABLE IF NOT EXISTS public.staff_profiles (
  id                              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name                    TEXT        NOT NULL,
  jira_account_id                 TEXT        NOT NULL,
  telegram_chat_id                TEXT        NOT NULL,
  telegram_username               TEXT        NULL,
  telegram_notifications_enabled  BOOLEAN     NOT NULL DEFAULT true,
  role                            TEXT        NOT NULL CHECK (role IN ('operator', 'translator', 'notary_partner', 'admin')),
  is_active                       BOOLEAN     NOT NULL DEFAULT true,
  created_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unique jira_account_id among active staff only (inactive duplicates allowed for history)
CREATE UNIQUE INDEX IF NOT EXISTS staff_profiles_active_jira_account_id_uidx
  ON public.staff_profiles (jira_account_id)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS staff_profiles_role_idx
  ON public.staff_profiles (role)
  WHERE is_active = true;

ALTER TABLE public.staff_profiles ENABLE ROW LEVEL SECURITY;

-- telegram_chat_id must never be readable by any authenticated browser client
CREATE POLICY "staff_profiles_service_role_only"
  ON public.staff_profiles
  USING (false);

-- ── 2. notification_log ────────────────────────────────────────────────────────
-- Delivery audit for every notification attempt (Telegram et al.).
-- Persists the result regardless of success or failure.
CREATE TABLE IF NOT EXISTS public.notification_log (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id              TEXT        NOT NULL,
  order_id              UUID        NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  jira_issue_key        TEXT        NULL,
  recipient_profile_id  UUID        NULL REFERENCES public.staff_profiles(id),
  channel               TEXT        NOT NULL DEFAULT 'telegram',
  template              TEXT        NOT NULL,
  status                TEXT        NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
  provider_message_id   TEXT        NULL,
  error                 TEXT        NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at               TIMESTAMPTZ NULL
);

-- Prevent double-delivery: one sent/pending record per (event_id, recipient)
CREATE UNIQUE INDEX IF NOT EXISTS notification_log_event_profile_dedup_uidx
  ON public.notification_log (event_id, recipient_profile_id)
  WHERE status IN ('sent', 'pending');

CREATE INDEX IF NOT EXISTS notification_log_order_id_idx ON public.notification_log (order_id);
CREATE INDEX IF NOT EXISTS notification_log_event_id_idx ON public.notification_log (event_id);
CREATE INDEX IF NOT EXISTS notification_log_status_idx ON public.notification_log (status);

ALTER TABLE public.notification_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notification_log_service_role_only"
  ON public.notification_log
  USING (false);
