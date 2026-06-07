-- ═══════════════════════════════════════════════════════════════════════════════
-- WPO Translations — Clean staging initialisation
-- Apply via: Supabase Dashboard → SQL Editor → paste entire file → Run
--
-- Run this ONCE on a fresh Supabase project.
-- This file represents the TARGET schema for the current MVP.
-- It has NO TON/crypto/wallet/Stripe legacy dependencies.
--
-- Schema version: equivalent to migrations 0001–0002, 0005–0012
-- (skips 0003, 0004 which are archived; combines 0005/0008 into clean tables)
-- ═══════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- USERS
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.users (
  id               UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email            TEXT        NOT NULL UNIQUE,
  terms_accepted_at TIMESTAMPTZ DEFAULT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_select_own" ON public.users FOR SELECT USING (auth.uid() = id);
CREATE POLICY "users_insert_own" ON public.users FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "users_update_own" ON public.users FOR UPDATE USING (auth.uid() = id);

-- Auto-create public.users row when auth.users row is inserted
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.users (id, email) VALUES (NEW.id, NEW.email);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ─────────────────────────────────────────────────────────────────────────────
-- DOCUMENTS
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.documents (
  id                       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  filename                 TEXT        NOT NULL,
  original_file_size       INT         NOT NULL,
  file_key                 TEXT        NOT NULL UNIQUE,
  source_language          TEXT        NOT NULL,
  target_language          TEXT        NOT NULL,
  document_type            TEXT        NOT NULL,
  status                   TEXT        NOT NULL CHECK (status IN ('uploading', 'processing', 'completed', 'failed')),
  detected_source_language TEXT,
  -- Client IP at upload time — fraud prevention and chargeback evidence only
  ip_address               TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_documents_user_id ON public.documents (user_id);

ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "documents_select_own" ON public.documents FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "documents_insert_own" ON public.documents FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "documents_update_own" ON public.documents FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "documents_delete_own" ON public.documents FOR DELETE USING (auth.uid() = user_id);

-- updated_at auto-update trigger
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER documents_set_updated_at
  BEFORE UPDATE ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- JOBS
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.jobs (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id      UUID        NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  status           TEXT        NOT NULL CHECK (status IN (
                                 'queued', 'ocr_in_progress', 'ocr_completed',
                                 'translation_in_progress', 'pdf_rendering',
                                 'completed', 'failed'
                               )),
  error_message    TEXT,
  progress_percent INT         NOT NULL DEFAULT 0,
  priority         INT         NOT NULL DEFAULT 0,
  -- 'subscription' = covered by active plan; 'card_payment' = covered by Halyk/ePay
  payment_source   TEXT        CHECK (payment_source IN ('card_payment', 'subscription')),
  notarized        BOOLEAN     NOT NULL DEFAULT false,
  -- 'completed' = released to customer; 'awaiting_translator_review' = official workflow
  workflow_status  TEXT        DEFAULT 'completed',
  started_at       TIMESTAMPTZ,
  completed_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_jobs_document_id ON public.jobs (document_id);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON public.jobs (status);
CREATE INDEX IF NOT EXISTS idx_jobs_workflow_status ON public.jobs (workflow_status);

ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;

-- Customers can read their own jobs; all writes go via service role (worker/API routes)
CREATE POLICY "jobs_select_own" ON public.jobs FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.documents d
    WHERE d.id = jobs.document_id AND d.user_id = auth.uid()
  )
);

-- ─────────────────────────────────────────────────────────────────────────────
-- OCR RESULTS
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ocr_results (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id            UUID        NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  markdown          TEXT        NOT NULL,
  page_count        INT         NOT NULL,
  detected_language TEXT,
  provider          TEXT        NOT NULL CHECK (provider IN ('mistral', 'google_docai')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.ocr_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ocr_results_select_own" ON public.ocr_results FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.jobs j
    JOIN public.documents d ON d.id = j.document_id
    WHERE j.id = ocr_results.job_id AND d.user_id = auth.uid()
  )
);

-- ─────────────────────────────────────────────────────────────────────────────
-- TRANSLATIONS
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.translations (
  id                       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id                   UUID        NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  translated_markdown      TEXT        NOT NULL,
  -- Main artifact key in R2 (PDF or HTML for standard jobs)
  translated_pdf_key       TEXT        NOT NULL,
  -- Official workflow: DOCX draft for translator review
  translated_docx_key      TEXT,
  -- Official workflow: preview PDF before human review
  translated_preview_pdf_key TEXT,
  -- QA report produced by runQaChecks()
  qa_report                JSONB,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.translations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "translations_select_own" ON public.translations FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.jobs j
    JOIN public.documents d ON d.id = j.document_id
    WHERE j.id = translations.job_id AND d.user_id = auth.uid()
  )
);

-- ─────────────────────────────────────────────────────────────────────────────
-- PAYMENT TRANSACTIONS (provider-neutral; Halyk/ePay in production)
-- No TON/crypto columns. Replaces legacy ton_payments table.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.payment_transactions (
  id                     UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                UUID          NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  document_id            UUID          NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  job_id                 UUID          NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  -- Payment amount in the specified currency (e.g. KZT for Halyk/ePay)
  amount                 NUMERIC(12,2) NOT NULL,
  currency               TEXT          NOT NULL DEFAULT 'KZT',
  payment_provider       TEXT          NOT NULL DEFAULT 'halyk_epay',
  status                 TEXT          NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending', 'completed', 'expired', 'failed')),
  -- Provider's transaction ID (order ID, receipt number, etc.)
  provider_transaction_id TEXT,
  -- Raw webhook payload for audit/dispute handling
  raw_payload            JSONB,
  -- Client IP at payment creation — fraud prevention and dispute handling only
  ip_address             TEXT,
  expires_at             TIMESTAMPTZ   NOT NULL,
  created_at             TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_transactions_job_id ON public.payment_transactions (job_id);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_user_id ON public.payment_transactions (user_id);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_status ON public.payment_transactions (status);

ALTER TABLE public.payment_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "payment_transactions_select_own" ON public.payment_transactions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "payment_transactions_insert_own" ON public.payment_transactions FOR INSERT WITH CHECK (auth.uid() = user_id);

COMMENT ON COLUMN public.payment_transactions.ip_address IS
  'Client IP address captured at payment creation. Used for fraud prevention and dispute/chargeback handling only. Not exposed to users.';
COMMENT ON COLUMN public.payment_transactions.raw_payload IS
  'Raw JSON payload from payment provider webhook. For audit and dispute handling only.';

-- ─────────────────────────────────────────────────────────────────────────────
-- SUBSCRIPTIONS (provider-neutral; no TON columns)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  plan                   TEXT        NOT NULL CHECK (plan IN ('basic', 'pro')),
  status                 TEXT        NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending', 'active', 'expired', 'cancelled')),
  documents_limit        INT         NOT NULL,
  documents_used         INT         NOT NULL DEFAULT 0,
  -- Payment amount when the subscription was purchased
  amount                 NUMERIC(12,2),
  -- Provider's transaction reference (Halyk order ID, etc.)
  provider_transaction_id TEXT,
  started_at             TIMESTAMPTZ,
  expires_at             TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "subscriptions_select_own" ON public.subscriptions FOR ALL USING (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- VERIFICATION QUERIES (paste in a separate SQL Editor tab after init)
-- ─────────────────────────────────────────────────────────────────────────────
-- SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;
-- Expected: documents, jobs, ocr_results, payment_transactions, subscriptions, translations, users
-- NOT expected: payments, ton_payments, wallet_links

COMMIT;
