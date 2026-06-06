import { createClient } from '@supabase/supabase-js';
import { env } from './env';

// Minimal inline types for the tables the worker touches.
// Keep in sync with src/types/supabase.ts in the Next.js app.
//
// IMPORTANT: Before deploying official translation workflow features,
// run supabase/migrations/add_official_workflow_fields.sql in Supabase SQL editor.
export interface JobRow {
  id: string;
  document_id: string;
  status: string;
  progress_percent: number;
  error_message: string | null;
  priority: number;
  payment_source: 'card_payment' | 'subscription' | null;
  notarized: boolean;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  /** Workflow status for official translation pipeline. Default: 'completed'. */
  workflow_status?: string | null;
}

export interface DocumentRow {
  id: string;
  user_id: string;
  filename: string;
  file_key: string;
  source_language: string;
  target_language: string;
  document_type: string;
  status: string;
  detected_source_language: string | null;
}

export interface TranslationRow {
  id: string;
  job_id: string;
  translated_markdown: string;
  translated_pdf_key: string;
  /** Key for translator review DOCX draft (official workflow). */
  translated_docx_key?: string | null;
  /** Key for preview PDF generated before human review (official workflow). */
  translated_preview_pdf_key?: string | null;
  /** QA report stored as JSON (official workflow). */
  qa_report?: Record<string, unknown> | null;
  created_at: string;
}

export interface PaymentTransactionRow {
  id: string;
  job_id: string;
  status: string;
}

export type SupabaseClient = ReturnType<typeof createClient>;

export const supabase = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);
