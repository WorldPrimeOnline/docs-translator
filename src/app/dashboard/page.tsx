'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
  awaitingPayment: boolean;
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

export default function DashboardPage() {
  const router = useRouter();
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const [file, setFile] = useState<File | null>(null);
  const [sourceLang, setSourceLang] = useState('auto');
  const [targetLang, setTargetLang] = useState('en');
  const [documentType, setDocumentType] = useState('other');
  const [uploading, setUploading] = useState(false);
  const [paying, setPaying] = useState(false);

  const [activeJob, setActiveJob] = useState<ActiveJob | null>(null);
  const [documents, setDocuments] = useState<Document[]>([]);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Read URL params on mount to restore state after Stripe redirect
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const payment = params.get('payment');
    const jobId = params.get('jobId');
    const documentId = params.get('documentId');

    if (payment === 'success' && jobId && documentId) {
      toast.success('Payment successful! Translation is starting…');
      setActiveJob({
        jobId,
        documentId,
        status: 'queued',
        progress: 0,
        errorMessage: null,
        filename: '',
        awaitingPayment: false,
      });
      // Clean up URL params
      router.replace('/dashboard');
    } else if (payment === 'cancelled') {
      toast.error('Payment cancelled.');
      router.replace('/dashboard');
    }
  }, [router]);

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
  const activeJobAwaiting = activeJob?.awaitingPayment ?? false;

  useEffect(() => {
    if (
      !activeJobId ||
      !activeJobStatus ||
      activeJobAwaiting ||
      activeJobStatus === 'completed' ||
      activeJobStatus === 'failed'
    ) {
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
  }, [activeJobId, activeJobStatus, activeJobAwaiting]);

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
      awaitingPayment: true,
    });
    toast.success('File uploaded — complete payment to start translation');
    void loadDocuments();
  };

  async function handlePay(documentId: string, jobId?: string): Promise<void> {
    setPaying(true);
    const res = await fetch('/api/payments/create-polar-checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ documentId, jobId }),
    });
    const data = (await res.json()) as { checkoutUrl?: string; error?: string };

    if (!res.ok || !data.checkoutUrl) {
      toast.error(data.error ?? 'Failed to create checkout session');
      setPaying(false);
      return;
    }

    window.location.href = data.checkoutUrl;
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Signed in as <span className="font-medium text-foreground">{userEmail ?? '…'}</span>
        </p>
        <button
          type="button"
          onClick={handleLogout}
          disabled={isLoggingOut}
          className="inline-flex items-center justify-center rounded-lg border border-border bg-background px-3 py-1 text-xs font-medium transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
        >
          {isLoggingOut ? 'Logging out…' : 'Log out'}
        </button>
      </div>

      {/* Upload form */}
      <Card>
        <CardHeader>
          <CardTitle>Translate a Document</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium">PDF File</label>
              <input
                type="file"
                accept=".pdf,application/pdf"
                className="text-sm"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              <p className="text-xs text-muted-foreground">PDF only · Max 25 MB · Max 50 pages</p>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium">Source Language</label>
                <select
                  value={sourceLang}
                  onChange={(e) => setSourceLang(e.target.value)}
                  className="rounded-md border bg-background px-3 py-2 text-sm"
                >
                  {LANGUAGES.map((l) => (
                    <option key={l.value} value={l.value}>{l.label}</option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium">Target Language</label>
                <select
                  value={targetLang}
                  onChange={(e) => setTargetLang(e.target.value)}
                  className="rounded-md border bg-background px-3 py-2 text-sm"
                >
                  {LANGUAGES.filter((l) => l.value !== 'auto').map((l) => (
                    <option key={l.value} value={l.value}>{l.label}</option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium">Document Type</label>
                <select
                  value={documentType}
                  onChange={(e) => setDocumentType(e.target.value)}
                  className="rounded-md border bg-background px-3 py-2 text-sm"
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
              className="inline-flex w-fit items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
            >
              {uploading ? 'Uploading…' : 'Upload Document'}
            </button>
          </form>
        </CardContent>
      </Card>

      {/* Active job card */}
      {activeJob && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {activeJob.filename || 'Translation in progress'}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {activeJob.awaitingPayment ? (
              <>
                <p className="text-sm text-muted-foreground">
                  Your file is uploaded. Pay $4.99 to start translation.
                </p>
                <button
                  type="button"
                  onClick={() => void handlePay(activeJob.documentId, activeJob.jobId)}
                  disabled={paying}
                  className="inline-flex w-fit items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
                >
                  {paying ? 'Redirecting to checkout…' : 'Pay to Translate — $4.99'}
                </button>
              </>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  {statusLabel(activeJob.status, activeJob.progress)}
                </p>

                {activeJob.status !== 'completed' && activeJob.status !== 'failed' && (
                  <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary transition-all duration-500"
                      style={{ width: `${activeJob.progress}%` }}
                    />
                  </div>
                )}

                {activeJob.status === 'failed' && activeJob.errorMessage && (
                  <p className="text-sm text-destructive">{activeJob.errorMessage}</p>
                )}

                {activeJob.status === 'completed' && (
                  <a
                    href={`/api/documents/${activeJob.documentId}/download`}
                    className="inline-flex w-fit items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                  >
                    Download Translation
                  </a>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Past documents */}
      {documents.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Past Documents</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="divide-y">
              {documents.map((doc) => (
                <div key={doc.id} className="flex items-center justify-between py-3">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm font-medium">{doc.filename}</span>
                    <span className="text-xs text-muted-foreground">
                      {doc.source_language} → {doc.target_language} · {doc.document_type} ·{' '}
                      {new Date(doc.created_at).toLocaleDateString()}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-xs font-medium ${
                        doc.status === 'completed'
                          ? 'text-green-600'
                          : doc.status === 'failed'
                            ? 'text-destructive'
                            : 'text-muted-foreground'
                      }`}
                    >
                      {doc.status}
                    </span>
                    {doc.status === 'uploading' && (
                      <button
                        type="button"
                        onClick={() => void handlePay(doc.id)}
                        disabled={paying}
                        className="inline-flex items-center justify-center rounded-lg border border-border bg-background px-3 py-1 text-xs font-medium transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
                      >
                        Pay $4.99
                      </button>
                    )}
                    {doc.status === 'completed' && (
                      <a
                        href={`/api/documents/${doc.id}/download`}
                        className="text-xs text-primary underline-offset-4 hover:underline"
                      >
                        Download
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
