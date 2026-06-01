ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS detected_source_language TEXT;
