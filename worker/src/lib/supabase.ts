import { createClient } from '@supabase/supabase-js';
import { env } from './env';

// Minimal inline types for the tables the worker touches.
// Keep in sync with src/types/supabase.ts in the Next.js app.
export interface JobRow {
  id: string;
  document_id: string;
  status: string;
  progress_percent: number;
  error_message: string | null;
  priority: number;
  payment_source: 'card_payment' | 'subscription' | null;
  /** Legacy boolean — prefer service_level. */
  notarized: boolean;
  service_level: 'electronic' | 'official_with_translator_signature_and_provider_stamp' | 'notarization_through_partners' | null;
  notary_city: string | null;
  fulfillment_method: 'pickup' | 'delivery' | null;
  delivery_phone: string | null;
  delivery_address: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  workflow_status: string | null;
  // Integration fields
  jira_issue_id: string | null;
  jira_issue_key: string | null;
  jira_issue_url: string | null;
  google_drive_folder_id: string | null;
  google_drive_folder_url: string | null;
  jira_sync_status: string | null;
  drive_sync_status: string | null;
  last_integration_error: string | null;
  last_synced_at: string | null;
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

export interface FiscalReceiptRow {
  id: string;
  job_id: string;
  document_id: string;
  payment_transaction_id: string;
  provider: string;
  provider_environment: 'test' | 'production';
  amount_kzt: number;
  currency: string;
  operation_type: 'sale' | 'refund' | 'correction';
  status: 'pending_manual' | 'pending' | 'issued' | 'failed' | 'retry_required' | 'canceled';
  retry_count: number;
  created_at: string;
  updated_at: string;
}

export interface RefundTransactionRow {
  id: string;
  job_id: string;
  payment_transaction_id: string;
  provider: string;
  provider_environment: 'test' | 'production';
  refund_amount_kzt: number;
  status: 'requested' | 'pending' | 'succeeded' | 'failed' | 'requires_review' | 'pending_manual' | 'canceled';
  reason: string;
  created_at: string;
  updated_at: string;
}

export type SupabaseClient = ReturnType<typeof createClient>;

export const supabase = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);
