-- ─── public.users ────────────────────────────────────────────────────────────
-- Mirrors auth.users; created automatically on first sign-in via trigger.
CREATE TABLE IF NOT EXISTS public.users (
  id         UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email      TEXT        NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── public.documents ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.documents (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  filename           TEXT        NOT NULL,
  original_file_size INT         NOT NULL,
  file_key           TEXT        NOT NULL UNIQUE,
  source_language    TEXT        NOT NULL,
  target_language    TEXT        NOT NULL,
  document_type      TEXT        NOT NULL,
  status             TEXT        NOT NULL CHECK (status IN ('uploading', 'processing', 'completed', 'failed')),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_documents_user_id ON public.documents (user_id);

-- ─── public.jobs ─────────────────────────────────────────────────────────────
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
  started_at       TIMESTAMPTZ,
  completed_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_jobs_document_id ON public.jobs (document_id);

-- ─── public.ocr_results ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ocr_results (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id            UUID        NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  markdown          TEXT        NOT NULL,
  page_count        INT         NOT NULL,
  detected_language TEXT,
  provider          TEXT        NOT NULL CHECK (provider IN ('mistral', 'google_docai')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── public.translations ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.translations (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id              UUID        NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  translated_markdown TEXT        NOT NULL,
  translated_pdf_key  TEXT        NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── public.payments ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.payments (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  stripe_charge_id TEXT        NOT NULL UNIQUE,
  amount_cents     INT         NOT NULL,
  document_id      UUID        REFERENCES public.documents(id) ON DELETE SET NULL,
  status           TEXT        NOT NULL CHECK (status IN ('pending', 'completed', 'failed')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Row Level Security ───────────────────────────────────────────────────────
ALTER TABLE public.users       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documents   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jobs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ocr_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.translations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments    ENABLE ROW LEVEL SECURITY;

-- users policies
CREATE POLICY "users_select_own"
  ON public.users FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "users_insert_own"
  ON public.users FOR INSERT
  WITH CHECK (auth.uid() = id);

CREATE POLICY "users_update_own"
  ON public.users FOR UPDATE
  USING (auth.uid() = id);

-- documents policies
CREATE POLICY "documents_select_own"
  ON public.documents FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "documents_insert_own"
  ON public.documents FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "documents_update_own"
  ON public.documents FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "documents_delete_own"
  ON public.documents FOR DELETE
  USING (auth.uid() = user_id);

-- jobs: SELECT only for the document owner; INSERT/UPDATE via service role only
CREATE POLICY "jobs_select_own"
  ON public.jobs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.documents d
      WHERE d.id = jobs.document_id AND d.user_id = auth.uid()
    )
  );

-- ocr_results: SELECT only for the document owner; writes via service role only
CREATE POLICY "ocr_results_select_own"
  ON public.ocr_results FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.jobs j
      JOIN public.documents d ON d.id = j.document_id
      WHERE j.id = ocr_results.job_id AND d.user_id = auth.uid()
    )
  );

-- translations: same pattern
CREATE POLICY "translations_select_own"
  ON public.translations FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.jobs j
      JOIN public.documents d ON d.id = j.document_id
      WHERE j.id = translations.job_id AND d.user_id = auth.uid()
    )
  );

-- payments: SELECT only for own records; writes via service role only
CREATE POLICY "payments_select_own"
  ON public.payments FOR SELECT
  USING (auth.uid() = user_id);

-- ─── updated_at trigger for documents ────────────────────────────────────────
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
