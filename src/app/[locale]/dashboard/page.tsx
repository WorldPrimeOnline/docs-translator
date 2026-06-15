'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations, useLocale } from 'next-intl';
import { toast } from 'sonner';
import { Upload, FileText, FileImage, FileCode2, Download, AlertCircle, Loader2, Zap, Star, X, Clock } from 'lucide-react';
import { SubscriptionModal } from '@/components/subscription-modal';
import { createClient } from '@/lib/supabase/client';
import { Link } from '@/i18n/navigation';
import { NOTARY_CITIES } from '@/lib/notary/cities';
import { getCustomerOrderState } from '@/lib/translation-workflow/customer-order-state';

type ServiceLevel =
  | 'electronic'
  | 'official_with_translator_signature_and_provider_stamp'
  | 'notarization_through_partners';

type FulfillmentMethod = 'pickup' | 'delivery';

interface OrderEntry {
  documentId: string;
  jobId: string | null;
  filename: string;
  sourceLanguage: string;
  targetLanguage: string;
  documentType: string;
  documentStatus: string;
  serviceLevel: string;
  fulfillmentMethod: 'pickup' | 'delivery' | null;
  jobStatus: string | null;
  workflowStatus: string | null;
  progressPercent: number;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  customerStatus: string | null;
  canDownload: boolean;
  isActive: boolean;
  isTerminal: boolean;
  stages: { key: string; labelKey: string; done: boolean; current: boolean }[];
}

interface SubscriptionInfo {
  id: string;
  plan: 'basic' | 'pro';
  status: string;
  documentsLimit: number;
  documentsUsed: number;
  expiresAt: string | null;
}

// ─── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ customerStatus }: { customerStatus: string | null }) {
  const t = useTranslations('dashboard');
  const status = customerStatus ?? 'queued';

  if (status === 'completed' || status === 'delivered' || status === 'picked_up' || status === 'ready_for_delivery') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-400">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
        {t('completed')}
      </span>
    );
  }
  if (status === 'failed' || status === 'translator_declined' || status === 'notary_declined') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-2.5 py-0.5 text-xs font-medium text-red-400">
        <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
        {t('failed')}
      </span>
    );
  }
  if (status === 'queued') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-white/5 px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
        <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground" />
        {t('queued')}
      </span>
    );
  }
  // Human review / physical delivery stages
  if (
    status === 'awaiting_translator_review' ||
    status === 'awaiting_signature_stamp' ||
    status === 'awaiting_notary_review' ||
    status === 'awaiting_final_qa' ||
    status === 'translator_approved' ||
    status === 'assigned_to_notary' ||
    status === 'notarization_in_progress' ||
    status === 'notarized' ||
    status === 'ready_for_pickup' ||
    status === 'out_for_delivery' ||
    status === 'operator_processing'
  ) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2.5 py-0.5 text-xs font-medium text-amber-400">
        <span className="h-1.5 w-1.5 animate-badge-pulse rounded-full bg-amber-400" />
        {t('inReview')}
      </span>
    );
  }
  // AI processing stages
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/10 px-2.5 py-0.5 text-xs font-medium text-blue-400">
      <span className="h-1.5 w-1.5 animate-badge-pulse rounded-full bg-blue-400" />
      {t('processing')}
    </span>
  );
}

// ─── Stage progress bar ────────────────────────────────────────────────────────

function StageProgressBar({
  stages,
  progressPercent,
}: {
  stages: OrderEntry['stages'];
  progressPercent: number;
}) {
  const t = useTranslations('dashboard');

  if (!stages.length) {
    return (
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
        <div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${progressPercent}%` }} />
      </div>
    );
  }

  const currentIdx = stages.findIndex((s) => s.current);
  const currentStage = currentIdx >= 0 ? stages[currentIdx] : null;

  return (
    <div className="flex flex-col gap-2">
      {/* Dot track */}
      <div className="flex items-center gap-0">
        {stages.map((stage, i) => (
          <div key={stage.key} className="flex flex-1 items-center">
            <div
              className={`h-2 w-2 shrink-0 rounded-full transition-colors ${
                stage.done
                  ? 'bg-primary'
                  : stage.current
                  ? 'bg-primary ring-2 ring-primary/30'
                  : 'bg-white/20'
              }`}
            />
            {i < stages.length - 1 && (
              <div className="flex-1 h-px mx-0.5 transition-colors" style={{ background: stage.done ? 'rgb(201 168 76)' : 'rgb(255 255 255 / 0.15)' }} />
            )}
          </div>
        ))}
      </div>
      {/* Current stage label */}
      {currentStage && (
        <p className="text-xs text-muted-foreground">
          {(() => {
            try {
              return t(currentStage.labelKey as Parameters<typeof t>[0]);
            } catch {
              return currentStage.labelKey.split('.').pop() ?? '';
            }
          })()}
        </p>
      )}
    </div>
  );
}

// ─── Customer status label ─────────────────────────────────────────────────────

function useStatusLabel() {
  const t = useTranslations('dashboard');

  return (entry: OrderEntry): string => {
    const status = entry.customerStatus;
    const pct = entry.progressPercent;

    switch (status) {
      case 'queued':               return t('status.queued');
      case 'ocr_in_progress':      return t('status.ocr', { pct });
      case 'translation_in_progress': return t('status.translating', { pct });
      case 'pdf_rendering':        return t('status.rendering', { pct });
      case 'awaiting_translator_review': return t('status.awaitingTranslatorReview');
      case 'awaiting_signature_stamp':   return t('status.awaitingSignatureStamp');
      case 'awaiting_notary_review':     return t('status.awaitingNotaryReview');
      case 'awaiting_final_qa':          return t('status.awaitingFinalQa');
      case 'translator_approved':        return t('status.translatorApproved');
      case 'assigned_to_notary':         return t('status.assignedToNotary');
      case 'notarization_in_progress':   return t('status.notarizationInProgress');
      case 'notarized':                  return t('status.notarized');
      case 'ready_for_delivery':         return t('status.readyForDelivery');
      case 'ready_for_pickup':           return t('status.readyForPickup');
      case 'out_for_delivery':           return t('status.outForDelivery');
      case 'delivered':                  return t('status.delivered');
      case 'picked_up':                  return t('status.pickedUp');
      case 'operator_processing':        return t('status.operatorProcessing');
      case 'translator_declined':        return t('status.translatorDeclined');
      case 'notary_declined':            return t('status.notaryDeclined');
      case 'completed':            return t('status.completed');
      case 'failed':               return t('status.failed');
      default:                     return t('processing');
    }
  };
}

// ─── Active order card ────────────────────────────────────────────────────────

function ActiveOrderCard({ entry, locale }: { entry: OrderEntry; locale: string }) {
  const t = useTranslations('dashboard');
  const statusLabel = useStatusLabel();

  const AI_STAGES = new Set(['queued', 'ocr_in_progress', 'translation_in_progress', 'pdf_rendering', 'completed', 'failed']);
  const isHumanStage = !AI_STAGES.has(entry.customerStatus ?? '');

  const serviceLevelLabel =
    entry.serviceLevel === 'notarization_through_partners'
      ? t('order.serviceNotarized')
      : entry.serviceLevel === 'official_with_translator_signature_and_provider_stamp'
      ? t('order.serviceCertified')
      : t('order.serviceElectronic');

  const createdDate = new Date(entry.createdAt).toLocaleDateString(locale, {
    day: 'numeric', month: 'short', year: 'numeric',
  });

  return (
    <div className="rounded-lg border border-white/10 bg-card p-5">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-foreground">
            {entry.filename || t('jobTitle')}
          </h3>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
            <span>{entry.sourceLanguage} → {entry.targetLanguage}</span>
            <span>·</span>
            <span>{serviceLevelLabel}</span>
            <span>·</span>
            <span>{t('order.created')} {createdDate}</span>
          </div>
          <p className="mt-1.5 text-xs text-foreground/70">
            {statusLabel(entry)}
          </p>
        </div>
        <StatusBadge customerStatus={entry.customerStatus} />
      </div>

      <StageProgressBar stages={entry.stages} progressPercent={entry.progressPercent} />

      {isHumanStage && (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground/70">
          <Clock className="h-3 w-3 shrink-0" />
          {t('closeTabOk')}
        </p>
      )}

      {entry.customerStatus === 'failed' && entry.errorMessage && (
        <div className="mt-3 flex items-start gap-2 rounded-md border border-red-500/20 bg-red-500/5 p-3">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
          <p className="text-xs text-red-400">{entry.errorMessage}</p>
        </div>
      )}

      {entry.canDownload && (
        <a
          href={`/api/documents/${entry.documentId}/download`}
          className="mt-4 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-gold-dark"
        >
          <Download className="h-4 w-4" />
          {t('downloadTranslation')}
        </a>
      )}
    </div>
  );
}

// ─── History row ───────────────────────────────────────────────────────────────

function HistoryRow({ entry }: { entry: OrderEntry }) {
  const t = useTranslations('dashboard');

  return (
    <div className="flex items-center justify-between px-6 py-4 transition-colors hover:bg-white/[0.03]">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-sm font-medium text-foreground">
          {entry.filename}
        </span>
        <span className="text-xs text-muted-foreground">
          {entry.sourceLanguage} → {entry.targetLanguage} · {(entry.documentType ?? '').split('|')[0]} ·{' '}
          {new Date(entry.createdAt).toLocaleDateString()}
        </span>
      </div>
      <div className="ml-4 flex shrink-0 items-center gap-3">
        <StatusBadge customerStatus={entry.customerStatus} />
        {entry.canDownload && (
          <a
            href={`/api/documents/${entry.documentId}/download`}
            className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-foreground transition-colors hover:border-white/20 hover:bg-white/10"
          >
            <Download className="h-3 w-3" />
            {t('download')}
          </a>
        )}
      </div>
    </div>
  );
}

// ─── Subscription components (unchanged) ──────────────────────────────────────

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

function SubscriptionCard({ sub, onUpgrade }: { sub: SubscriptionInfo; onUpgrade: () => void }) {
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
          {isPro ? <Star className="h-4 w-4 text-primary" /> : <Zap className="h-4 w-4 text-primary" />}
          <span className="text-sm font-semibold text-foreground">{isPro ? t('proPlan') : t('basicPlan')}</span>
          {isPro && <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-bold text-primary-foreground">PRO</span>}
        </div>
        <span className="text-xs text-muted-foreground">{t('expires')} {expiresDate}</span>
      </div>
      <div className="mb-2 flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{t('docsUsed')}</span>
        <span className="font-medium text-foreground">{sub.documentsUsed} / {sub.documentsLimit}</span>
      </div>
      <div className="mb-4 h-2 w-full overflow-hidden rounded-full bg-white/10">
        <div className={`h-full rounded-full transition-all duration-500 ${pct >= 90 ? 'bg-amber-500' : 'bg-primary'}`} style={{ width: `${pct}%` }} />
      </div>
      {remaining === 0 ? (
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-amber-400">{t('allDocsUsed', { n: sub.documentsLimit })}</p>
          <button type="button" onClick={onUpgrade} className="shrink-0 inline-flex items-center rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-gold-dark">{t('upgradeToPro')}</button>
        </div>
      ) : !isPro ? (
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">{t('docsRemaining', { n: remaining })}</p>
          <button type="button" onClick={onUpgrade} className="shrink-0 inline-flex items-center rounded-md border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-white/10">{t('upgradeToPro')}</button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{t('docsRemaining', { n: remaining })}</p>
      )}
    </div>
  );
}

function ServiceLevelCard({ value, current, label, description, onChange }: {
  value: ServiceLevel; current: ServiceLevel; label: string; description: string; onChange: (v: ServiceLevel) => void;
}) {
  const selected = current === value;
  return (
    <button
      type="button"
      onClick={() => onChange(selected ? 'electronic' : value)}
      className={`flex w-full items-start gap-3 rounded-lg border px-4 py-3.5 text-left transition-all duration-150 ${selected ? 'border-primary/40 bg-primary/5' : 'border-white/10 bg-transparent hover:border-white/20 hover:bg-white/[0.02]'}`}
    >
      <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors ${selected ? 'border-primary bg-primary' : 'border-white/30 bg-transparent'}`}>
        {selected && <span className="h-2 w-2 rounded-full bg-primary-foreground" />}
      </span>
      <span className="flex flex-col gap-0.5">
        <span className="text-sm font-medium text-foreground">{label}</span>
        <span className="text-xs leading-relaxed text-muted-foreground">{description}</span>
      </span>
    </button>
  );
}

// ─── Main dashboard component ─────────────────────────────────────────────────

export default function DashboardPage() {
  const router = useRouter();
  const t = useTranslations('dashboard');
  const tLegal = useTranslations('legal');
  const locale = useLocale();

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
    { value: 'passport_id',         label: t('docTypes.passport_id')         },
    { value: 'diploma_transcript',  label: t('docTypes.diploma_transcript')  },
    { value: 'contract',            label: t('docTypes.contract')            },
    { value: 'bank_statement',      label: t('docTypes.bank_statement')      },
    { value: 'medical_document',    label: t('docTypes.medical_document')    },
    { value: 'employment_document', label: t('docTypes.employment_document') },
    { value: 'police_clearance',    label: t('docTypes.police_clearance')    },
    { value: 'visa_documents',      label: t('docTypes.visa_documents')      },
    { value: 'driver_license',      label: t('docTypes.driver_license')      },
    { value: 'presentation',        label: t('docTypes.presentation')        },
    { value: 'other',               label: t('docTypes.other')               },
  ];

  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [sourceLang, setSourceLang] = useState('auto');
  const [targetLang, setTargetLang] = useState('en');
  const [documentType, setDocumentType] = useState('other');
  const [outputFormat, setOutputFormat] = useState<'html' | 'pdf' | 'docx'>('pdf');
  const [serviceLevel, setServiceLevel] = useState<ServiceLevel>('electronic');
  const [notaryCity, setNotaryCity] = useState('');
  const [fulfillmentMethod, setFulfillmentMethod] = useState<FulfillmentMethod | ''>('');
  const [deliveryPhone, setDeliveryPhone] = useState('');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [uploading, setUploading] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState<boolean | null>(null);
  const [consentChecked, setConsentChecked] = useState(false);
  const [subscription, setSubscription] = useState<SubscriptionInfo | null | undefined>(undefined);
  const [showSubscriptionModal, setShowSubscriptionModal] = useState(false);

  // All orders loaded from Supabase — source of truth
  const [orders, setOrders] = useState<OrderEntry[]>([]);
  const [ordersLoaded, setOrdersLoaded] = useState(false);

  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const ordersRef = useRef<OrderEntry[]>([]);
  const seenTerminalIds = useRef<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);

  const activeOrders = orders.filter((o) => o.isActive && !o.isTerminal);
  // ready_for_delivery is "active" but also showable in history — put it in active for now
  const readyOrders = orders.filter((o) => o.isActive && o.isTerminal);
  const historyOrders = orders.filter((o) => o.isTerminal && !o.isActive);

  // ─── Load all orders from API (source of truth) ──────────────────────────────

  const loadOrders = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch('/api/jobs');
      if (!res.ok) return;
      const data = (await res.json()) as { jobs: OrderEntry[] };
      setOrders(data.jobs);
    } catch (e) {
      console.error('[dashboard] loadOrders failed:', e);
    } finally {
      setOrdersLoaded(true);
    }
  }, []);

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
    supabase.auth.getSession().then(async ({ data }) => {
      setUserEmail(data.session?.user.email ?? null);
      const userId = data.session?.user.id;
      if (userId) {
        const { data: userRow } = await supabase.from('users').select('terms_accepted_at').eq('id', userId).maybeSingle();
        setTermsAccepted(!!userRow?.terms_accepted_at);
      } else {
        setTermsAccepted(false);
      }
    });
    void loadOrders();
    void loadSubscription();
  }, [loadOrders, loadSubscription]);

  // Keep ordersRef in sync so pollActiveJobs can read current orders without closing over state
  useEffect(() => { ordersRef.current = orders; }, [orders]);

  // ─── Polling: poll all active (non-terminal) jobs ─────────────────────────────

  const pollActiveJobs = useCallback(async (): Promise<void> => {
    // Read via ref — no dependency on orders state; callback is stable across renders
    const current = ordersRef.current;
    const polling = current.filter((o) => !o.isTerminal);
    if (!polling.length) return;

    let needFullReload = false;

    try {
      const results = await Promise.allSettled(
        polling.map(async (o) => {
          if (!o.jobId) return null;
          const res = await fetch(`/api/jobs/${o.jobId}`);
          if (res.status === 404) return { gone: true } as const;
          if (!res.ok) return null;
          return (await res.json()) as {
            status: string;
            progress: number;
            errorMessage: string | null;
            workflowStatus: string | null;
            serviceLevel: string;
            fulfillmentMethod: 'pickup' | 'delivery' | null;
          };
        }),
      );

      polling.forEach((_, i) => {
        const r = results[i];
        if (r?.status === 'fulfilled' && r.value && 'gone' in r.value && r.value.gone) {
          needFullReload = true;
        }
      });

      setOrders((prev) => {
        const next = [...prev];
        polling.forEach((o, i) => {
          const r = results[i];
          if (r?.status !== 'fulfilled' || !r.value || 'gone' in r.value) return;
          const data = r.value;
          const idx = next.findIndex((x) => x.documentId === o.documentId);
          if (idx < 0) return;
          const state = getCustomerOrderState({
            jobStatus: data.status,
            progressPercent: data.progress,
            workflowStatus: data.workflowStatus,
            serviceLevel: data.serviceLevel,
            fulfillmentMethod: data.fulfillmentMethod ?? null,
          });
          next[idx] = {
            ...next[idx]!,
            jobStatus: data.status,
            workflowStatus: data.workflowStatus,
            fulfillmentMethod: data.fulfillmentMethod ?? null,
            progressPercent: state.progressPercent,
            errorMessage: data.errorMessage,
            customerStatus: state.customerStatus,
            canDownload: state.canDownload,
            isActive: state.isActive,
            isTerminal: state.isTerminal,
            stages: state.stages,
          };
        });
        return next;
      });
    } catch (e) {
      console.error('[dashboard] poll error:', e);
    }

    // A 404 means the job ID is stale; reload the full list to get authoritative server state
    if (needFullReload) void loadOrders();
  }, [loadOrders]);

  // Derive stable boolean signals for the interval effect so it only restarts when the
  // boolean VALUE changes (true↔false), not on every setOrders call.
  const hasActive = orders.some((o) => !o.isTerminal);
  // Poll at 20s for any non-terminal order waiting on a human (translator/notary/courier).
  // Poll at 3s for active AI processing stages to show progress quickly.
  const AI_POLLING_STATUSES = new Set(['queued', 'ocr_in_progress', 'translation_in_progress', 'pdf_rendering']);
  const hasHumanStage = orders.some(
    (o) => !o.isTerminal && !AI_POLLING_STATUSES.has(o.customerStatus ?? ''),
  );

  // Start/stop polling — restarts ONLY when active status or stage type changes, not every poll
  useEffect(() => {
    if (!hasActive) {
      if (pollIntervalRef.current) { clearInterval(pollIntervalRef.current); pollIntervalRef.current = null; }
      return;
    }

    const ms = hasHumanStage ? 20_000 : 3_000;
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    pollIntervalRef.current = setInterval(() => { void pollActiveJobs(); }, ms);

    return () => {
      if (pollIntervalRef.current) { clearInterval(pollIntervalRef.current); pollIntervalRef.current = null; }
    };
  }, [hasActive, hasHumanStage, pollActiveJobs]);

  // When a new job flips to terminal/completed, reload once — tracked per-job so it never fires twice
  useEffect(() => {
    if (!ordersLoaded) return;
    const newlyDone = orders.filter(
      (o) => o.isTerminal && o.jobStatus === 'completed' && o.jobId && !seenTerminalIds.current.has(o.jobId),
    );
    if (!newlyDone.length) return;
    newlyDone.forEach((o) => { if (o.jobId) seenTerminalIds.current.add(o.jobId); });
    void loadOrders();
    void loadSubscription();
  }, [orders, ordersLoaded, loadOrders, loadSubscription]);

  // ─── Auth ──────────────────────────────────────────────────────────────────────

  const handleLogout = async (): Promise<void> => {
    setIsLoggingOut(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signOut();
    if (error) { toast.error('Failed to log out'); setIsLoggingOut(false); return; }
    router.push('/');
    router.refresh();
  };

  // ─── File handling ─────────────────────────────────────────────────────────────

  const ACCEPTED_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
  const ACCEPTED_EXT = ['.pdf', '.jpg', '.jpeg', '.png', '.docx'];

  function isAccepted(f: File): boolean {
    if (ACCEPTED_TYPES.includes(f.type)) return true;
    const ext = '.' + (f.name.split('.').pop() ?? '').toLowerCase();
    return ACCEPTED_EXT.includes(ext);
  }

  function addFiles(incoming: File[]) {
    const accepted = incoming.filter(isAccepted);
    const rejected = incoming.filter((f) => !isAccepted(f));
    if (rejected.length > 0) toast.error(`Unsupported file type: ${rejected.map((f) => f.name).join(', ')}`);
    if (accepted.length > 0) setFiles((prev) => [...prev, ...accepted]);
  }

  function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  }

  function fileIcon(f: File) {
    if (f.type === 'application/pdf') return <FileText className="h-4 w-4 shrink-0 text-red-400" />;
    if (f.type.startsWith('image/')) return <FileImage className="h-4 w-4 shrink-0 text-blue-400" />;
    return <FileCode2 className="h-4 w-4 shrink-0 text-green-400" />;
  }

  const handleServiceLevelChange = (newLevel: ServiceLevel) => {
    setServiceLevel(newLevel);
    if (newLevel !== 'notarization_through_partners') {
      setNotaryCity(''); setFulfillmentMethod(''); setDeliveryPhone(''); setDeliveryAddress('');
    }
  };

  const isNotarization = serviceLevel === 'notarization_through_partners';
  const isDelivery = isNotarization && fulfillmentMethod === 'delivery';
  const totalSize = files.reduce((s, f) => s + f.size, 0);

  const isFormValid =
    files.length > 0 &&
    termsAccepted !== null &&
    (termsAccepted === true || consentChecked) &&
    (!isNotarization ||
      (notaryCity.length > 0 &&
        fulfillmentMethod !== '' &&
        (!isDelivery || (deliveryPhone.length > 0 && deliveryAddress.length > 0))));

  const useSubscription = subscription && subscription.documentsUsed < subscription.documentsLimit;

  // ─── Upload ────────────────────────────────────────────────────────────────────

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!isFormValid) return;
    if (files.length === 0) { toast.error('Please select at least one file'); return; }
    setUploading(true);

    if (!termsAccepted) {
      const acceptRes = await fetch('/api/users/accept-terms', { method: 'POST' });
      if (!acceptRes.ok) { toast.error('Failed to save terms acceptance.'); setUploading(false); return; }
      setTermsAccepted(true);
    }

    const form = new FormData();
    for (const f of files) form.append('file', f);
    form.append('sourceLang', sourceLang);
    form.append('targetLang', targetLang);
    form.append('documentType', `${documentType}|${outputFormat}`);
    form.append('serviceLevel', serviceLevel);
    if (isNotarization) {
      form.append('notaryCity', notaryCity);
      if (fulfillmentMethod) form.append('fulfillmentMethod', fulfillmentMethod);
      if (isDelivery) { form.append('deliveryPhone', deliveryPhone); form.append('deliveryAddress', deliveryAddress); }
    }

    const res = await fetch('/api/documents/upload', { method: 'POST', body: form });
    const data = (await res.json()) as { jobId?: string; documentId?: string; error?: string; subscriptionPlan?: string; remainingDocs?: number; };

    if (!res.ok || !data.jobId || !data.documentId) {
      toast.error(data.error ?? 'Upload failed');
      setUploading(false);
      return;
    }

    setUploading(false);
    setFiles([]);

    toast.success(`Translation started — ${data.remainingDocs ?? 0} doc${data.remainingDocs === 1 ? '' : 's'} remaining on your ${data.subscriptionPlan === 'pro' ? 'Pro' : 'Basic'} plan.`);

    // Reload from Supabase so the new job appears in the active orders section
    await loadOrders();
    await loadSubscription();
  };

  const selectClass = 'rounded-md border border-white/10 bg-input px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring transition-colors hover:border-white/20';
  const inputClass = 'rounded-md border border-white/10 bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring transition-colors hover:border-white/20 w-full';

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {t('signedIn')}{' '}<span className="font-medium text-foreground">{userEmail ?? '…'}</span>
        </p>
        <button type="button" onClick={handleLogout} disabled={isLoggingOut}
          className="inline-flex items-center justify-center rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-white/20 hover:text-foreground disabled:pointer-events-none disabled:opacity-50">
          {isLoggingOut ? '…' : t('logout')}
        </button>
      </div>

      {/* Subscription */}
      {subscription === undefined ? null : subscription ? (
        <SubscriptionCard sub={subscription} onUpgrade={() => setShowSubscriptionModal(true)} />
      ) : (
        <SubscriptionBanner onViewPlans={() => setShowSubscriptionModal(true)} />
      )}

      {/* Upload form */}
      <div className="rounded-lg border border-white/10 bg-card p-6">
        <h2 className="mb-5 text-base font-semibold text-foreground">{t('newTranslation')}</h2>
        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          {/* Drop zone */}
          <div
            className={`relative flex flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-8 text-center transition-[border-color,background-color] duration-150 cursor-pointer ${isDragging ? 'border-primary/70 bg-[rgba(201,168,76,0.05)]' : files.length > 0 ? 'border-primary/30 bg-primary/[0.03]' : 'border-white/15 hover:border-white/25 hover:bg-white/[0.03]'}`}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => { e.preventDefault(); setIsDragging(false); addFiles(Array.from(e.dataTransfer.files)); }}
            onClick={() => fileInputRef.current?.click()}
          >
            <input ref={fileInputRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.docx,application/pdf,image/jpeg,image/png,application/vnd.openxmlformats-officedocument.wordprocessingml.document" multiple className="sr-only"
              onChange={(e) => { if (e.target.files) addFiles(Array.from(e.target.files)); e.target.value = ''; }} />
            <Upload className="mb-2 h-7 w-7 text-muted-foreground" />
            <p className="text-sm font-medium text-foreground">{t('dropzone')}</p>
            <p className="mt-1 text-xs text-muted-foreground">{t('dropzoneHint')}</p>
          </div>

          {/* File list */}
          {files.length > 0 && (
            <div className="rounded-md border border-white/10 bg-white/[0.02] overflow-hidden">
              {files.map((f, i) => (
                <div key={i} className="flex items-center gap-3 px-3 py-2 border-b border-white/5 last:border-b-0">
                  {fileIcon(f)}
                  <span className="flex-1 truncate text-xs text-foreground">{f.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{formatBytes(f.size)}</span>
                  <button type="button" onClick={(e) => { e.stopPropagation(); setFiles((p) => p.filter((_, j) => j !== i)); }}
                    className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground hover:bg-white/10 transition-colors">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              <div className="flex items-center justify-between px-3 py-2 bg-white/[0.02] border-t border-white/5">
                <span className="text-xs text-muted-foreground">{files.length} {files.length === 1 ? t('fileCount1') : t('fileCountN')} · {formatBytes(totalSize)}</span>
                <button type="button" onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }} className="text-xs text-primary hover:opacity-80 transition-opacity">+ {t('addMoreFiles')}</button>
              </div>
            </div>
          )}

          {/* Selects */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t('sourceLanguage')}</label>
              <select value={sourceLang} onChange={(e) => setSourceLang(e.target.value)} className={selectClass}>
                {LANGUAGES.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t('targetLanguage')}</label>
              <select value={targetLang} onChange={(e) => setTargetLang(e.target.value)} className={selectClass}>
                {LANGUAGES.filter((l) => l.value !== 'auto').map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t('documentType')}</label>
              <select value={documentType} onChange={(e) => setDocumentType(e.target.value)} className={selectClass}>
                {DOCUMENT_TYPES.map((dt) => <option key={dt.value} value={dt.value}>{dt.label}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t('outputFormat')}</label>
              <select value={outputFormat} onChange={(e) => setOutputFormat(e.target.value as 'html' | 'pdf' | 'docx')} className={selectClass}>
                <option value="pdf">{t('formatPdf')}</option>
                <option value="html">{t('formatHtml')}</option>
                <option value="docx">{t('formatDocx')}</option>
              </select>
            </div>
          </div>

          {/* Service level */}
          <div className="flex flex-col gap-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t('serviceLevel.label')}</p>
            <div className="flex flex-col gap-2">
              <ServiceLevelCard value="official_with_translator_signature_and_provider_stamp" current={serviceLevel} label={t('serviceLevel.certified.label')} description={t('serviceLevel.certified.desc')} onChange={handleServiceLevelChange} />
              <ServiceLevelCard value="notarization_through_partners" current={serviceLevel} label={t('serviceLevel.notarization.label')} description={t('serviceLevel.notarization.desc')} onChange={handleServiceLevelChange} />
            </div>
          </div>

          {/* Notary delivery fields */}
          {isNotarization && (
            <div className="flex flex-col gap-4 rounded-lg border border-white/10 bg-white/[0.02] p-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t('notary.city')} <span className="text-red-400">*</span></label>
                {NOTARY_CITIES.length > 0 ? (
                  <select value={notaryCity} onChange={(e) => setNotaryCity(e.target.value)} className={selectClass} required>
                    <option value="">{t('notary.cityPlaceholder')}</option>
                    {NOTARY_CITIES.map((c) => <option key={c.value} value={c.value}>{c.label[locale] ?? c.label['en'] ?? c.value}</option>)}
                  </select>
                ) : <p className="text-xs text-amber-400">{t('notary.citiesNotConfigured')}</p>}
              </div>
              <div className="flex flex-col gap-1.5">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t('notary.fulfillment')} <span className="text-red-400">*</span></p>
                <div className="flex gap-2">
                  {(['pickup', 'delivery'] as FulfillmentMethod[]).map((method) => (
                    <button key={method} type="button" onClick={() => { setFulfillmentMethod(method); if (method === 'pickup') { setDeliveryPhone(''); setDeliveryAddress(''); } }}
                      className={`flex flex-1 items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-sm transition-all duration-150 ${fulfillmentMethod === method ? 'border-primary/40 bg-primary/5 text-foreground font-medium' : 'border-white/10 bg-transparent text-muted-foreground hover:border-white/20 hover:text-foreground'}`}>
                      <span className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border transition-colors ${fulfillmentMethod === method ? 'border-primary bg-primary' : 'border-white/30'}`}>
                        {fulfillmentMethod === method && <span className="h-1.5 w-1.5 rounded-full bg-primary-foreground" />}
                      </span>
                      {method === 'pickup' ? t('notary.pickup') : t('notary.delivery')}
                    </button>
                  ))}
                </div>
              </div>
              {isDelivery && (
                <div className="flex flex-col gap-3">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t('notary.phone')} <span className="text-red-400">*</span></label>
                    <input type="tel" value={deliveryPhone} onChange={(e) => setDeliveryPhone(e.target.value)} placeholder={t('notary.phonePlaceholder')} className={inputClass} required={isDelivery} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t('notary.address')} <span className="text-red-400">*</span></label>
                    <textarea value={deliveryAddress} onChange={(e) => setDeliveryAddress(e.target.value)} placeholder={t('notary.addressPlaceholder')} className={`${inputClass} min-h-[80px] resize-none`} required={isDelivery} rows={3} />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Subscription hint */}
          {subscription && subscription.documentsUsed >= subscription.documentsLimit ? (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/20 bg-amber-500/5 p-3">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
              <p className="text-xs text-amber-400">{t('allDocsUsed', { n: subscription.documentsLimit })}{' '}
                <button type="button" onClick={() => setShowSubscriptionModal(true)} className="underline underline-offset-2 hover:text-amber-300">{t('upgradeToPro')}</button>
              </p>
            </div>
          ) : subscription ? (
            <p className="text-xs text-muted-foreground">✓ {t('usingPlan', { plan: subscription.plan === 'pro' ? 'Pro' : 'Basic', remaining: subscription.documentsLimit - subscription.documentsUsed })}</p>
          ) : null}

          {/* Consent */}
          {termsAccepted === false ? (
            <label className="flex cursor-pointer items-start gap-2.5">
              <input type="checkbox" checked={consentChecked} onChange={(e) => setConsentChecked(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-primary" />
              <span className="text-xs leading-relaxed text-muted-foreground">
                {tLegal.rich('consentText', {
                  offerLink: (chunks) => <Link href={{ pathname: '/legal/offer' }} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 transition-colors hover:text-foreground">{chunks}</Link>,
                  privacyLink: (chunks) => <Link href={{ pathname: '/legal/privacy' }} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 transition-colors hover:text-foreground">{chunks}</Link>,
                  consentLink: (chunks) => <Link href={{ pathname: '/legal/personal-data-consent' }} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 transition-colors hover:text-foreground">{chunks}</Link>,
                })}
              </span>
            </label>
          ) : termsAccepted === true ? (
            <p className="text-xs text-muted-foreground/60">✓ {tLegal('termsAccepted')}</p>
          ) : null}

          <button type="submit" disabled={uploading || !isFormValid}
            className="inline-flex w-fit items-center justify-center gap-2 rounded-md bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-gold-dark disabled:pointer-events-none disabled:opacity-50">
            {uploading ? (<><Loader2 className="h-4 w-4 animate-spin" />…</>) : useSubscription ? (<><Upload className="h-4 w-4" />{t('uploadBtn')}</>) : (<><Upload className="h-4 w-4" />{t('uploadPay')}</>)}
          </button>
        </form>
      </div>

      {/* Active orders */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">{t('activeOrders')}</h2>
        </div>
        {!ordersLoaded ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading…
          </div>
        ) : activeOrders.length === 0 && readyOrders.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t('noActiveOrders')}</p>
        ) : (
          <>
            {[...activeOrders, ...readyOrders].map((o) => (
              <ActiveOrderCard key={o.documentId} entry={o} locale={locale} />
            ))}
          </>
        )}
      </div>

      {/* Subscription modal */}
      {showSubscriptionModal && (
        <SubscriptionModal
          onSuccess={(plan) => { setShowSubscriptionModal(false); void loadSubscription(); toast.success(`${plan === 'pro' ? 'Pro' : 'Basic'} plan activated!`); }}
          onClose={() => setShowSubscriptionModal(false)}
        />
      )}

      {/* History */}
      <div className="rounded-lg border border-white/10 bg-card">
        <div className="border-b border-white/10 px-6 py-4">
          <h2 className="text-sm font-semibold text-foreground">{t('historyOrders')}</h2>
        </div>
        {historyOrders.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
            <FileText className="h-10 w-10 text-muted-foreground/30" />
            <p className="text-sm font-medium text-muted-foreground">{t('noTranslations')}</p>
            <p className="text-xs text-muted-foreground/60">{t('noTranslationsHint')}</p>
          </div>
        ) : (
          <div className="divide-y divide-white/5">
            {historyOrders.map((o) => <HistoryRow key={o.documentId} entry={o} />)}
          </div>
        )}
      </div>
    </div>
  );
}
