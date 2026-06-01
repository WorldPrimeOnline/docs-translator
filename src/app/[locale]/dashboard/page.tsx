'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations, useLocale } from 'next-intl';
import { toast } from 'sonner';
import { Upload, FileText, Download, AlertCircle, Loader2, Zap, Star } from 'lucide-react';
import { SubscriptionModal } from '@/components/subscription-modal';
import { createClient } from '@/lib/supabase/client';
import { Link } from '@/i18n/navigation';
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
  paidViaSubscription?: boolean;
  subscriptionPlan?: string;
  remainingDocs?: number;
}

interface SubscriptionInfo {
  id: string;
  plan: 'basic' | 'pro';
  status: string;
  documentsLimit: number;
  documentsUsed: number;
  expiresAt: string | null;
}

function StatusBadge({ status }: { status: string }) {
  const t = useTranslations('dashboard');
  switch (status) {
    case 'completed':
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-400">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          {t('completed')}
        </span>
      );
    case 'failed':
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-2.5 py-0.5 text-xs font-medium text-red-400">
          <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
          {t('failed')}
        </span>
      );
    case 'queued':
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-white/5 px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
          <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground" />
          {t('queued')}
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/10 px-2.5 py-0.5 text-xs font-medium text-blue-400">
          <span className="h-1.5 w-1.5 animate-badge-pulse rounded-full bg-blue-400" />
          {t('processing')}
        </span>
      );
  }
}

function SubscriptionBanner({ onViewPlans }: { onViewPlans: () => void }) {
  const t = useTranslations('dashboard');
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-primary/20 bg-primary/5 px-5 py-4">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10">
          <Zap className="h-4 w-4 text-primary" />
        </div>
        <div>
          <p className="text-sm font-medium text-foreground">{t('subBannerTitle')}</p>
          <p className="text-xs text-muted-foreground">{t('subBannerDesc')}</p>
        </div>
      </div>
      <button
        type="button"
        onClick={onViewPlans}
        className="shrink-0 inline-flex items-center rounded-md bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground transition-colors hover:bg-gold-dark"
      >
        {t('viewPlans')}
      </button>
    </div>
  );
}

function SubscriptionCard({
  sub,
  onUpgrade,
}: {
  sub: SubscriptionInfo;
  onUpgrade: () => void;
}) {
  const t = useTranslations('dashboard');
  const locale = useLocale();
  const pct = Math.round((sub.documentsUsed / sub.documentsLimit) * 100);
  const remaining = sub.documentsLimit - sub.documentsUsed;
  const expiresDate = sub.expiresAt
    ? new Date(sub.expiresAt).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })
    : '—';

  const isPro = sub.plan === 'pro';

  return (
    <div className={`overflow-hidden rounded-lg border p-5 ${isPro ? 'border-primary/40 bg-primary/5' : 'border-white/10 bg-card'}`}>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isPro ? (
            <Star className="h-4 w-4 text-primary" />
          ) : (
            <Zap className="h-4 w-4 text-primary" />
          )}
          <span className="text-sm font-semibold text-foreground">
            {isPro ? t('proPlan') : t('basicPlan')}
          </span>
          {isPro && (
            <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-bold text-primary-foreground">
              PRO
            </span>
          )}
        </div>
        <span className="text-xs text-muted-foreground">{t('expires')} {expiresDate}</span>
      </div>

      <div className="mb-2 flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{t('docsUsed')}</span>
        <span className="font-medium text-foreground">
          {sub.documentsUsed} / {sub.documentsLimit}
        </span>
      </div>
      <div className="mb-4 h-2 w-full overflow-hidden rounded-full bg-white/10">
        <div
          className={`h-full rounded-full transition-all duration-500 ${pct >= 90 ? 'bg-amber-500' : 'bg-primary'}`}
          style={{ width: `${pct}%` }}
        />
      </div>

      {remaining === 0 ? (
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-amber-400">
            {t('allDocsUsed', { n: sub.documentsLimit })}
          </p>
          <button
            type="button"
            onClick={onUpgrade}
            className="shrink-0 inline-flex items-center rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-gold-dark"
          >
            {t('upgradeToPro')}
          </button>
        </div>
      ) : !isPro ? (
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">{t('docsRemaining', { n: remaining })}</p>
          <button
            type="button"
            onClick={onUpgrade}
            className="shrink-0 inline-flex items-center rounded-md border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-white/10"
          >
            {t('upgradeToPro')}
          </button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{t('docsRemaining', { n: remaining })}</p>
      )}
    </div>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const t = useTranslations('dashboard');
  const tLegal = useTranslations('legal');

  const LANGUAGES = [
    { value: 'auto', label: t('langs.auto') },
    { value: 'ru',   label: t('langs.ru')   },
    { value: 'en',   label: t('langs.en')   },
    { value: 'th',   label: t('langs.th')   },
    { value: 'zh',   label: t('langs.zh')   },
    { value: 'ko',   label: t('langs.ko')   },
    { value: 'ja',   label: t('langs.ja')   },
    { value: 'de',   label: t('langs.de')   },
    { value: 'fr',   label: t('langs.fr')   },
    { value: 'es',   label: t('langs.es')   },
    { value: 'ar',   label: t('langs.ar')   },
  ];

  const DOCUMENT_TYPES = [
    { value: 'passport',        label: t('docTypes.passport')        },
    { value: 'diploma',         label: t('docTypes.diploma')         },
    { value: 'contract',        label: t('docTypes.contract')        },
    { value: 'bank_statement',  label: t('docTypes.bank_statement')  },
    { value: 'medical',         label: t('docTypes.medical')         },
    { value: 'employment',      label: t('docTypes.employment')      },
    { value: 'police_clearance',label: t('docTypes.police_clearance')},
    { value: 'driver_license',  label: t('docTypes.driver_license')  },
    { value: 'other',           label: t('docTypes.other')           },
  ];

  function statusLabel(status: JobStatus, progress: number): string {
    switch (status) {
      case 'queued':               return t('status.queued');
      case 'ocr_in_progress':      return t('status.ocr',      { pct: progress });
      case 'ocr_completed':        return t('status.ocrDone',  { pct: progress });
      case 'translation_in_progress': return t('status.translating', { pct: progress });
      case 'pdf_rendering':        return t('status.rendering', { pct: progress });
      case 'completed':            return t('status.completed');
      case 'failed':               return t('status.failed');
    }
  }

  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [sourceLang, setSourceLang] = useState('auto');
  const [targetLang, setTargetLang] = useState('en');
  const [documentType, setDocumentType] = useState('other');
  const [outputFormat, setOutputFormat] = useState<'html' | 'pdf' | 'docx'>('pdf');
  const [notarized, setNotarized] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [consentChecked, setConsentChecked] = useState(false);

  const [activeJob, setActiveJob] = useState<ActiveJob | null>(null);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [subscription, setSubscription] = useState<SubscriptionInfo | null | undefined>(undefined);
  const [showSubscriptionModal, setShowSubscriptionModal] = useState(false);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadSubscription = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch('/api/subscriptions/current');
      if (!res.ok) { setSubscription(null); return; }
      const data = (await res.json()) as { subscription: SubscriptionInfo | null };
      setSubscription(data.subscription);
    } catch {
      setSubscription(null);
    }
  }, []);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data }) => {
      setUserEmail(data.session?.user.email ?? null);
    });
    void loadDocuments();
    void loadSubscription();
  }, [loadSubscription]);

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
        void loadSubscription();
      }
      return;
    }

    pollRef.current = setInterval(() => {
      void pollJob(activeJobId);
    }, 3000);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [activeJobId, activeJobStatus, loadSubscription]);

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
    form.append('documentType', `${documentType}|${outputFormat}`);
    form.append('notarized', String(notarized));

    const res = await fetch('/api/documents/upload', { method: 'POST', body: form });
    const data = (await res.json()) as {
      jobId?: string;
      documentId?: string;
      error?: string;
      paidViaSubscription?: boolean;
      subscriptionPlan?: string;
      remainingDocs?: number;
    };

    if (!res.ok || !data.jobId || !data.documentId) {
      toast.error(data.error ?? 'Upload failed');
      setUploading(false);
      return;
    }

    setUploading(false);
    setFile(null);

    if (data.paidViaSubscription) {
      setActiveJob({
        jobId: data.jobId,
        documentId: data.documentId,
        status: 'queued',
        progress: 0,
        errorMessage: null,
        filename: file.name,
        paidViaSubscription: true,
        subscriptionPlan: data.subscriptionPlan,
        remainingDocs: data.remainingDocs,
      });
      toast.success(
        `Translation started — ${data.remainingDocs ?? 0} doc${data.remainingDocs === 1 ? '' : 's'} remaining on your ${data.subscriptionPlan === 'pro' ? 'Pro' : 'Basic'} plan.`,
      );
      void loadSubscription();
      void loadDocuments();
    }
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

  const useSubscription = subscription && subscription.documentsUsed < subscription.documentsLimit;

  return (
    <div className="flex flex-col gap-5">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {t('signedIn')}{' '}
          <span className="font-medium text-foreground">{userEmail ?? '…'}</span>
        </p>
        <button
          type="button"
          onClick={handleLogout}
          disabled={isLoggingOut}
          className="inline-flex items-center justify-center rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-white/20 hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
        >
          {isLoggingOut ? '…' : t('logout')}
        </button>
      </div>

      {/* Subscription block */}
      {subscription === undefined ? null : subscription ? (
        <SubscriptionCard
          sub={subscription}
          onUpgrade={() => setShowSubscriptionModal(true)}
        />
      ) : (
        <SubscriptionBanner onViewPlans={() => setShowSubscriptionModal(true)} />
      )}

      {/* Upload form */}
      <div className="rounded-lg border border-white/10 bg-card p-6">
        <h2 className="mb-5 text-base font-semibold text-foreground">{t('newTranslation')}</h2>

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
                <p className="text-sm font-medium text-foreground">{t('dropzone')}</p>
                <p className="mt-1 text-xs text-muted-foreground">{t('dropzoneHint')}</p>
              </>
            )}
          </div>

          {/* Selects */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                {t('sourceLanguage')}
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
                {t('targetLanguage')}
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
                {t('documentType')}
              </label>
              <select
                value={documentType}
                onChange={(e) => setDocumentType(e.target.value)}
                className={selectClass}
              >
                {DOCUMENT_TYPES.map((dt) => (
                  <option key={dt.value} value={dt.value}>{dt.label}</option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                {t('outputFormat')}
              </label>
              <select
                value={outputFormat}
                onChange={(e) => setOutputFormat(e.target.value as 'html' | 'pdf' | 'docx')}
                className={selectClass}
              >
                <option value="pdf">{t('formatPdf')}</option>
                <option value="html">{t('formatHtml')}</option>
                <option value="docx">{t('formatDocx')}</option>
              </select>
            </div>
          </div>

          {/* Notarized option */}
          <button
            type="button"
            onClick={() => setNotarized((v) => !v)}
            className={`flex w-full items-start gap-3 rounded-lg border px-4 py-3.5 text-left transition-all duration-150 ${
              notarized
                ? 'border-primary/40 bg-primary/5'
                : 'border-white/10 bg-transparent hover:border-white/20 hover:bg-white/[0.02]'
            }`}
          >
            <span
              className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
                notarized ? 'border-primary bg-primary' : 'border-white/30 bg-transparent'
              }`}
            >
              {notarized && (
                <svg className="h-2.5 w-2.5 text-primary-foreground" fill="none" viewBox="0 0 10 10">
                  <path d="M1.5 5l2.5 2.5 4.5-4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </span>
            <span className="flex flex-col gap-0.5">
              <span className="text-sm font-medium text-foreground">{t('notarizedLabel')}</span>
              <span className="text-xs leading-relaxed text-muted-foreground">{t('notarizedDesc')}</span>
            </span>
          </button>

          {/* Subscription hint */}
          {subscription && subscription.documentsUsed >= subscription.documentsLimit ? (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/20 bg-amber-500/5 p-3">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
              <p className="text-xs text-amber-400">
                {t('allDocsUsed', { n: subscription.documentsLimit })}{' '}
                <button
                  type="button"
                  onClick={() => setShowSubscriptionModal(true)}
                  className="underline underline-offset-2 hover:text-amber-300"
                >
                  {t('upgradeToPro')}
                </button>{' '}
                or continue with pay-per-document below.
              </p>
            </div>
          ) : subscription ? (
            <p className="text-xs text-muted-foreground">
              ✓ {t('usingPlan', {
                plan: subscription.plan === 'pro' ? 'Pro' : 'Basic',
                remaining: subscription.documentsLimit - subscription.documentsUsed,
              })}
            </p>
          ) : null}

          {/* Consent checkbox */}
          <label className="flex cursor-pointer items-start gap-2.5">
            <input
              type="checkbox"
              checked={consentChecked}
              onChange={(e) => setConsentChecked(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
            />
            <span className="text-xs leading-relaxed text-muted-foreground">
              {tLegal.rich('consentText', {
                offerLink: (chunks) => (
                  <Link
                    href={{ pathname: '/legal/offer' }}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline underline-offset-2 transition-colors hover:text-foreground"
                  >
                    {chunks}
                  </Link>
                ),
                privacyLink: (chunks) => (
                  <Link
                    href={{ pathname: '/legal/privacy' }}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline underline-offset-2 transition-colors hover:text-foreground"
                  >
                    {chunks}
                  </Link>
                ),
                consentLink: (chunks) => (
                  <Link
                    href={{ pathname: '/legal/personal-data-consent' }}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline underline-offset-2 transition-colors hover:text-foreground"
                  >
                    {chunks}
                  </Link>
                ),
              })}
            </span>
          </label>

          <button
            type="submit"
            disabled={uploading || !file || !consentChecked}
            className="inline-flex w-fit items-center justify-center gap-2 rounded-md bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-gold-dark disabled:pointer-events-none disabled:opacity-50"
          >
            {uploading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                …
              </>
            ) : useSubscription ? (
              <>
                <Upload className="h-4 w-4" />
                {t('uploadBtn')}
              </>
            ) : (
              <>
                <Upload className="h-4 w-4" />
                {t('uploadPay')}
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
                {activeJob.filename || t('jobTitle')}
              </h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {statusLabel(activeJob.status, activeJob.progress)}
              </p>
              {activeJob.paidViaSubscription && activeJob.status !== 'completed' && activeJob.status !== 'failed' && (
                <p className="mt-1 flex items-center gap-1 text-xs text-primary">
                  {activeJob.subscriptionPlan === 'pro' ? (
                    <Star className="h-3 w-3" />
                  ) : (
                    <Zap className="h-3 w-3" />
                  )}
                  {activeJob.subscriptionPlan === 'pro' ? t('proPlan') : t('basicPlan')}
                  {activeJob.remainingDocs !== undefined && ` · ${activeJob.remainingDocs} remaining`}
                </p>
              )}
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
              {t('downloadTranslation')}
            </a>
          )}
        </div>
      )}

      {/* Subscription modal */}
      {showSubscriptionModal && (
        <SubscriptionModal
          onSuccess={(plan) => {
            setShowSubscriptionModal(false);
            void loadSubscription();
            toast.success(`${plan === 'pro' ? 'Pro' : 'Basic'} plan activated!`);
          }}
          onClose={() => setShowSubscriptionModal(false)}
        />
      )}

      {/* Past documents */}
      <div className="rounded-lg border border-white/10 bg-card">
        <div className="border-b border-white/10 px-6 py-4">
          <h2 className="text-sm font-semibold text-foreground">{t('pastTranslations')}</h2>
        </div>
        {documents.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
            <FileText className="h-10 w-10 text-muted-foreground/30" />
            <p className="text-sm font-medium text-muted-foreground">{t('noTranslations')}</p>
            <p className="text-xs text-muted-foreground/60">{t('noTranslationsHint')}</p>
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
                    {doc.source_language} → {doc.target_language} · {(doc.document_type ?? '').split('|')[0]} ·{' '}
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
                      {t('download')}
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
