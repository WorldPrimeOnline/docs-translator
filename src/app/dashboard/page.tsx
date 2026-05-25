'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Upload, FileText, Download, AlertCircle, Loader2 } from 'lucide-react';
import { TonPaymentModal } from '@/components/ton-payment-modal';
import { createClient } from '@/lib/supabase/client';
import type { Tables } from '@/types';

type Document = Tables<'documents'>;

type JobStatus =
  | 'queued'
  | 'ocr_in_progress'
  | 'ocr_completed'
  | 'translation_in_progress'
  | 'pdf_rendering'
  | 'completed'
  | 'failed';

interface ActiveJob {
  jobId: string;
  documentId: string;
  status: JobStatus;
  progress: number;
  errorMessage: string | null;
  filename: string;
}

const LANGUAGES = [
  { value: 'auto', label: 'Auto-detect' },
  { value: 'ru', label: 'Russian' },
  { value: 'en', label: 'English' },
  { value: 'th', label: 'Thai' },
  { value: 'zh', label: 'Chinese' },
  { value: 'ko', label: 'Korean' },
  { value: 'ja', label: 'Japanese' },
  { value: 'de', label: 'German' },
  { value: 'fr', label: 'French' },
  { value: 'es', label: 'Spanish' },
  { value: 'ar', label: 'Arabic' },
];

const DOCUMENT_TYPES = [
  { value: 'passport', label: 'Passport / ID Card' },
  { value: 'diploma', label: 'Diploma / Transcript' },
  { value: 'contract', label: 'Contract' },
  { value: 'bank_statement', label: 'Bank Statement' },
  { value: 'medical', label: 'Medical Record / Certificate' },
  { value: 'employment', label: 'Employment Contract / Labor Book' },
  { value: 'police_clearance', label: 'Police Clearance Certificate' },
  { value: 'driver_license', label: "Driver's License" },
  { value: 'other', label: 'Other' },
];

function statusLabel(status: JobStatus, progress: number): string {
  switch (status) {
    case 'queued': return 'Queued — waiting to start…';
    case 'ocr_in_progress': return `Extracting text… (${progress}%)`;
    case 'ocr_completed': return `OCR complete, starting translation… (${progress}%)`;
    case 'translation_in_progress': return `Translating… (${progress}%)`;
    case 'pdf_rendering': return `Rendering PDF… (${progress}%)`;
    case 'completed': return 'Completed';
    case 'failed': return 'Failed';
  }
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'completed':
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-400">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          Completed
        </span>
      );
    case 'failed':
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-2.5 py-0.5 text-xs font-medium text-red-400">
          <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
          Failed
        </span>
      );
    case 'queued':
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-white/5 px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
          <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground" />
          Queued
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/10 px-2.5 py-0.5 text-xs font-medium text-blue-400">
          <span className="h-1.5 w-1.5 animate-badge-pulse rounded-full bg-blue-400" />
          Processing
        </span>
      );
  }
}

export default function DashboardPage() {
  const router = useRouter();
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [sourceLang, setSourceLang] = useState('auto');
  const [targetLang, setTargetLang] = useState('en');
  const [documentType, setDocumentType] = useState('other');
  const [uploading, setUploading] = useState(false);

  const [activeJob, setActiveJob] = useState<ActiveJob | null>(null);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [pendingPayment, setPendingPayment] = useState<{ documentId: string; jobId: string } | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data }) => {
      setUserEmail(data.session?.user.email ?? null);
    });
    void loadDocuments();
  }, []);

  async function loadDocuments(): Promise<void> {
    const supabase = createClient();
    const { data } = await supabase
      .from('documents')
      .select('*')
      .order('created_at', { ascending: false });
    if (data) setDocuments(data);
  }

  const activeJobId = activeJob?.jobId ?? null;
  const activeJobStatus = activeJob?.status ?? null;

  useEffect(() => {
    if (!activeJobId || !activeJobStatus || activeJobStatus === 'completed' || activeJobStatus === 'failed') {
      if (pollRef.current) clearInterval(pollRef.current);
      if (activeJobStatus === 'completed' || activeJobStatus === 'failed') {
        void loadDocuments();
      }
      return;
    }

    pollRef.current = setInterval(() => {
      void pollJob(activeJobId);
    }, 3000);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [activeJobId, activeJobStatus]);

  async function pollJob(jobId: string): Promise<void> {
    const res = await fetch(`/api/jobs/${jobId}`);
    if (!res.ok) return;
    const data = (await res.json()) as {
      status: JobStatus;
      progress: number;
      errorMessage: string | null;
    };
    setActiveJob((prev) => (prev ? { ...prev, ...data } : prev));
  }

  const handleLogout = async (): Promise<void> => {
    setIsLoggingOut(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signOut();
    if (error) {
      toast.error('Failed to log out');
      setIsLoggingOut(false);
      return;
    }
    router.push('/');
    router.refresh();
  };

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!file) { toast.error('Please select a PDF file'); return; }

    setUploading(true);
    const form = new FormData();
    form.append('file', file);
    form.append('sourceLang', sourceLang);
    form.append('targetLang', targetLang);
    form.append('documentType', documentType);

    const res = await fetch('/api/documents/upload', { method: 'POST', body: form });
    const data = (await res.json()) as { jobId?: string; documentId?: string; error?: string };

    if (!res.ok || !data.jobId || !data.documentId) {
      toast.error(data.error ?? 'Upload failed');
      setUploading(false);
      return;
    }

    setUploading(false);
    setFile(null);
    setActiveJob({
      jobId: data.jobId,
      documentId: data.documentId,
      status: 'queued',
      progress: 0,
      errorMessage: null,
      filename: file.name,
    });
    setPendingPayment({ documentId: data.documentId, jobId: data.jobId });
    toast.success('File uploaded — complete payment to start translation.');
    void loadDocuments();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped?.type === 'application/pdf') {
      setFile(dropped);
    } else {
      toast.error('Please drop a PDF file');
    }
  };

  const selectClass = 'rounded-md border border-white/10 bg-input px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring transition-colors hover:border-white/20';

  return (
    <div className="flex flex-col gap-5">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Signed in as{' '}
          <span className="font-medium text-foreground">{userEmail ?? '…'}</span>
        </p>
        <button
          type="button"
          onClick={handleLogout}
          disabled={isLoggingOut}
          className="inline-flex items-center justify-center rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-white/20 hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
        >
          {isLoggingOut ? 'Logging out…' : 'Log out'}
        </button>
      </div>

      {/* Upload form */}
      <div className="rounded-lg border border-white/10 bg-card p-6">
        <h2 className="mb-5 text-base font-semibold text-foreground">New Translation</h2>

        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          {/* Drag-drop zone */}
          <div
            className={`relative flex flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-10 text-center transition-[border-color,background-color] duration-150 cursor-pointer ${
              isDragging
                ? 'border-primary/70 bg-[rgba(201,168,76,0.05)]'
                : file
                  ? 'border-primary/40 bg-primary/5'
                  : 'border-white/15 hover:border-white/25 hover:bg-white/[0.03]'
            }`}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,application/pdf"
              className="sr-only"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            {file ? (
              <>
                <FileText className="mb-2 h-8 w-8 text-primary" />
                <p className="text-sm font-medium text-foreground">{file.name}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {(file.size / 1024 / 1024).toFixed(2)} MB — click to change
                </p>
              </>
            ) : (
              <>
                <Upload className="mb-3 h-8 w-8 text-muted-foreground" />
                <p className="text-sm font-medium text-foreground">
                  Drop your PDF here, or click to browse
                </p>
                <p className="mt-1 text-xs text-muted-foreground">PDF only · Max 25 MB · Max 50 pages</p>
              </>
            )}
          </div>

          {/* Selects */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Source Language
              </label>
              <select
                value={sourceLang}
                onChange={(e) => setSourceLang(e.target.value)}
                className={selectClass}
              >
                {LANGUAGES.map((l) => (
                  <option key={l.value} value={l.value}>{l.label}</option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Target Language
              </label>
              <select
                value={targetLang}
                onChange={(e) => setTargetLang(e.target.value)}
                className={selectClass}
              >
                {LANGUAGES.filter((l) => l.value !== 'auto').map((l) => (
                  <option key={l.value} value={l.value}>{l.label}</option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Document Type
              </label>
              <select
                value={documentType}
                onChange={(e) => setDocumentType(e.target.value)}
                className={selectClass}
              >
                {DOCUMENT_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
          </div>

          <button
            type="submit"
            disabled={uploading || !file}
            className="inline-flex w-fit items-center justify-center gap-2 rounded-md bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-gold-dark disabled:pointer-events-none disabled:opacity-50"
          >
            {uploading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Uploading…
              </>
            ) : (
              <>
                <Upload className="h-4 w-4" />
                Upload & Pay
              </>
            )}
          </button>
        </form>
      </div>

      {/* Active job */}
      {activeJob && (
        <div className="rounded-lg border border-white/10 bg-card p-6">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <h3 className="text-sm font-semibold text-foreground">
                {activeJob.filename || 'Translation in progress'}
              </h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {statusLabel(activeJob.status, activeJob.progress)}
              </p>
            </div>
            <StatusBadge status={activeJob.status} />
          </div>

          {activeJob.status !== 'completed' && activeJob.status !== 'failed' && (
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-primary transition-all duration-500"
                style={{ width: `${activeJob.progress}%` }}
              />
            </div>
          )}

          {activeJob.status === 'failed' && activeJob.errorMessage && (
            <div className="mt-3 flex items-start gap-2 rounded-md border border-red-500/20 bg-red-500/5 p-3">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
              <p className="text-xs text-red-400">{activeJob.errorMessage}</p>
            </div>
          )}

          {activeJob.status === 'completed' && (
            <a
              href={`/api/documents/${activeJob.documentId}/download`}
              className="mt-4 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-gold-dark"
            >
              <Download className="h-4 w-4" />
              Download Translation
            </a>
          )}
        </div>
      )}

      {/* TON payment modal */}
      {pendingPayment && (
        <TonPaymentModal
          documentId={pendingPayment.documentId}
          jobId={pendingPayment.jobId}
          onSuccess={() => {
            setPendingPayment(null);
            toast.success('Payment confirmed — translation starting…');
          }}
          onClose={() => setPendingPayment(null)}
        />
      )}

      {/* Past documents */}
      <div className="rounded-lg border border-white/10 bg-card">
        <div className="border-b border-white/10 px-6 py-4">
          <h2 className="text-sm font-semibold text-foreground">Past Translations</h2>
        </div>
        {documents.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
            <FileText className="h-10 w-10 text-muted-foreground/30" />
            <p className="text-sm font-medium text-muted-foreground">No translations yet.</p>
            <p className="text-xs text-muted-foreground/60">Upload your first document above to get started.</p>
          </div>
        ) : (
          <div className="divide-y divide-white/5">
            {documents.map((doc) => (
              <div key={doc.id} className="flex items-center justify-between px-6 py-4 transition-colors hover:bg-white/[0.03]">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate text-sm font-medium text-foreground">
                    {doc.filename}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {doc.source_language} → {doc.target_language} · {doc.document_type} ·{' '}
                    {new Date(doc.created_at).toLocaleDateString()}
                  </span>
                </div>
                <div className="ml-4 flex shrink-0 items-center gap-3">
                  <StatusBadge status={doc.status} />
                  {doc.status === 'completed' && (
                    <a
                      href={`/api/documents/${doc.id}/download`}
                      className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-foreground transition-colors hover:border-white/20 hover:bg-white/10"
                    >
                      <Download className="h-3 w-3" />
                      Download
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
