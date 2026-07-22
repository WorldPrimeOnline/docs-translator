'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations, useLocale } from 'next-intl';
import { toast } from 'sonner';
import { FileText, Download, AlertCircle, Loader2, Clock, RefreshCw, Receipt } from 'lucide-react';
import { HalykPayButton } from '@/components/payment/HalykPayButton';
import { createClient } from '@/lib/supabase/client';
import { getCustomerOrderState } from '@/lib/translation-workflow/customer-order-state';
import { bucketOrders } from '@/lib/translation-workflow/order-buckets';
import { OrderForm } from '@/components/order/OrderForm';

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
  priceKzt: number | null;
  priceBeforeDiscountKzt: number | null;
  discountAppliedKzt: number | null;
  discountCode: string | null;
  latestQuoteId: string | null;
  quoteStatus: string | null;
  quoteAmountKzt: number | null;
  quoteCurrency: string | null;
  quoteExpiresAt: string | null;
  quoteRequiresOperatorReview: boolean;
  fiscalUrl: string | null;
  fiscalReceiptStatus: string | null;
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
  if (status === 'refunded' || status === 'canceled') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-slate-500/10 px-2.5 py-0.5 text-xs font-medium text-slate-400">
        <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
        {t(status === 'refunded' ? 'status.refunded' : 'status.canceled')}
      </span>
    );
  }
  if (status === 'payment_pending') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2.5 py-0.5 text-xs font-medium text-amber-400">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
        {t('status.paymentPending')}
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
      case 'payment_pending':      return t('status.paymentPending');
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
      case 'refunded':             return t('status.refunded');
      case 'canceled':             return t('status.canceled');
      default:                     return t('processing');
    }
  };
}

// ─── Active order card ────────────────────────────────────────────────────────

function ActiveOrderCard({ entry, locale, onRecalculate }: { entry: OrderEntry; locale: string; onRecalculate: (jobId: string) => void }) {
  const t = useTranslations('dashboard');
  const tElectronic = useTranslations('electronicOutput');
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

      {entry.customerStatus === 'payment_pending' && entry.jobId && (() => {
        const now = new Date();
        const isQuoteValid =
          entry.quoteStatus === 'quoted' &&
          entry.quoteAmountKzt != null &&
          entry.quoteAmountKzt > 0 &&
          entry.latestQuoteId != null &&
          entry.quoteExpiresAt != null &&
          new Date(entry.quoteExpiresAt) > now;

        const isExpired =
          entry.quoteStatus === 'expired' ||
          (entry.quoteExpiresAt != null && new Date(entry.quoteExpiresAt) <= now && entry.quoteStatus !== 'paid');

        // Payment is in-flight: user already initiated Halyk; quote moved to payment_pending
        if (entry.quoteStatus === 'payment_pending') {
          return (
            <div className="mt-3 rounded-md border border-amber-500/20 bg-amber-500/5 p-3">
              <div className="flex items-center gap-2 mb-1">
                <div className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
                <p className="text-sm font-medium text-amber-300">{t('paymentPendingTitle')}</p>
              </div>
              <p className="text-xs text-muted-foreground">{t('paymentPendingDesc')}</p>
            </div>
          );
        }

        if (entry.quoteRequiresOperatorReview) {
          return (
            <div className="mt-3 rounded-md border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-300">
              {t('quoteRequiresReview')}
            </div>
          );
        }

        if (isExpired) {
          return (
            <div className="mt-3 flex items-center gap-3">
              <span className="text-xs text-muted-foreground">{t('quoteExpired')}</span>
              <button type="button" onClick={() => onRecalculate(entry.jobId!)}
                className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-white/20 hover:bg-white/10">
                <RefreshCw className="h-3 w-3" />
                {t('quoteRecalculate')}
              </button>
            </div>
          );
        }

        if (isQuoteValid) {
          const expiryDate = new Date(entry.quoteExpiresAt!);
          const formattedExpiry = expiryDate.toLocaleString(locale, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
          return (
            <div className="mt-3 rounded-md border border-primary/20 bg-primary/5 p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-foreground">{t('quoteReady')}</span>
                <span className="text-xs text-muted-foreground">{t('quoteValidUntil', { date: formattedExpiry })}</span>
              </div>
              <div className="mb-3">
                {entry.discountAppliedKzt && entry.discountAppliedKzt > 0 ? (
                  <div className="flex flex-col gap-0.5">
                    <span className="text-xs text-muted-foreground">
                      {t('priceBeforeDiscount')}: {(entry.priceBeforeDiscountKzt ?? 0).toLocaleString()} {entry.quoteCurrency ?? 'KZT'}
                    </span>
                    <span className="text-xs text-emerald-400">
                      {t('discountByCode')}: −{entry.discountAppliedKzt.toLocaleString()} ₸{entry.discountCode ? ` (${entry.discountCode})` : ''}
                    </span>
                    <span className="text-xl font-bold text-foreground">
                      {t('finalPrice')}: {entry.quoteAmountKzt!.toLocaleString()} {entry.quoteCurrency ?? 'KZT'}
                    </span>
                  </div>
                ) : (
                  <span className="text-xl font-bold text-foreground">{entry.quoteAmountKzt!.toLocaleString()} {entry.quoteCurrency ?? 'KZT'}</span>
                )}
              </div>
              {entry.serviceLevel === 'electronic' && (
                <p className="mb-3 text-xs text-muted-foreground">
                  <span className="font-medium">{tElectronic('formats.title')}</span>
                  {': '}
                  {tElectronic('formats.body')}
                </p>
              )}
              <HalykPayButton
                jobId={entry.jobId}
                quoteId={entry.latestQuoteId!}
                priceKzt={entry.quoteAmountKzt!}
              />
            </div>
          );
        }

        // 2026-07-22: a payment_pending job and its price_quotes row are created together, in
        // the same synchronous request (createCardOrder()/convertDraftToOrder()) — there is no
        // legitimate transient window where one exists without the other. Reaching this branch
        // means an order got stuck in that (now-prevented, but possibly pre-existing) broken
        // state — never show an indefinite "calculating" spinner for it; there's nothing left to
        // wait for. WPO has no manual operator pricing step that would ever resolve this later.
        return (
          <div className="mt-3 flex items-start gap-2 rounded-md border border-red-500/20 bg-red-500/5 p-3">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
            <p className="text-xs text-red-400">{t('quoteUnavailable')}</p>
          </div>
        );
      })()}

      {entry.canDownload && (
        <>
          <a
            href={`/api/documents/${entry.documentId}/download`}
            className="mt-4 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-gold-dark"
          >
            <Download className="h-4 w-4" />
            {t('downloadTranslation')}
          </a>
          {entry.serviceLevel === 'electronic' && (
            <p className="mt-2 text-xs text-muted-foreground">
              <span className="font-medium">{tElectronic('formats.title')}</span>
              {': '}
              {tElectronic('formats.body')}
            </p>
          )}
        </>
      )}
      {entry.isTerminal && (
        <div className="mt-3">
          <FiscalReceiptLink fiscalUrl={entry.fiscalUrl} fiscalReceiptStatus={entry.fiscalReceiptStatus} />
        </div>
      )}
    </div>
  );
}

// ─── Fiscal receipt link ───────────────────────────────────────────────────────

const FISCAL_PENDING_STATUSES = new Set(['pending', 'pending_manual', 'retry_required']);

function FiscalReceiptLink({ fiscalUrl, fiscalReceiptStatus }: { fiscalUrl: string | null; fiscalReceiptStatus: string | null }) {
  const t = useTranslations('dashboard');

  if (fiscalUrl) {
    return (
      <a
        href={fiscalUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-white/20 hover:text-foreground"
      >
        <Receipt className="h-3 w-3" />
        {t('fiscalReceipt')}
      </a>
    );
  }

  if (fiscalReceiptStatus && FISCAL_PENDING_STATUSES.has(fiscalReceiptStatus)) {
    return (
      <span className="text-xs text-muted-foreground/60">{t('fiscalReceiptPending')}</span>
    );
  }

  return null;
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
      <div className="ml-4 flex shrink-0 flex-wrap items-center gap-2">
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
        <FiscalReceiptLink fiscalUrl={entry.fiscalUrl} fiscalReceiptStatus={entry.fiscalReceiptStatus} />
      </div>
    </div>
  );
}

// ─── Main dashboard component ─────────────────────────────────────────────────

export default function DashboardPage() {
  const router = useRouter();
  const t = useTranslations('dashboard');
  const locale = useLocale();

  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  // All orders loaded from Supabase — source of truth
  const [orders, setOrders] = useState<OrderEntry[]>([]);
  const [ordersLoaded, setOrdersLoaded] = useState(false);

  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const ordersRef = useRef<OrderEntry[]>([]);
  const seenTerminalIds = useRef<Set<string>>(new Set());

  // ready_for_delivery is "active" but also showable in history — put it in active for now.
  // Bucketing itself lives in a shared, unit-tested pure function — see
  // src/lib/translation-workflow/order-buckets.ts and its __tests__.
  const { activeOrders, readyOrders, historyOrders } = bucketOrders(orders);

  // ─── Load all orders from API (source of truth) ──────────────────────────────

  // A transient failure here (e.g. an auth-cookie race right after the
  // completion-triggered reload below) must never silently leave the order
  // list stale/empty with no way to recover — retry once before giving up,
  // and never clear existing orders on failure.
  const loadOrders = useCallback(async (): Promise<void> => {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch('/api/jobs', { cache: 'no-store' });
        if (!res.ok) {
          console.error(`[dashboard] loadOrders: /api/jobs returned ${res.status} (attempt ${attempt + 1})`);
          if (attempt === 0) { await new Promise((r) => setTimeout(r, 800)); continue; }
          break;
        }
        const data = (await res.json()) as { jobs: OrderEntry[] };
        setOrders(data.jobs);
        break;
      } catch (e) {
        console.error(`[dashboard] loadOrders failed (attempt ${attempt + 1}):`, e);
        if (attempt === 0) { await new Promise((r) => setTimeout(r, 800)); continue; }
      }
    }
    setOrdersLoaded(true);
  }, []);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data }) => {
      setUserEmail(data.session?.user.email ?? null);
    });
    void loadOrders();
  }, [loadOrders]);

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
            hasReadyResultFiles: boolean | null;
            priceBeforeDiscountKzt: number | null;
            discountAppliedKzt: number | null;
            discountCode: string | null;
            latestQuoteId: string | null;
            quoteStatus: string | null;
            quoteAmountKzt: number | null;
            quoteCurrency: string | null;
            quoteExpiresAt: string | null;
            quoteRequiresOperatorReview: boolean;
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
            hasReadyResultFiles: data.hasReadyResultFiles ?? undefined,
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
            latestQuoteId: data.latestQuoteId ?? next[idx]!.latestQuoteId,
            quoteStatus: data.quoteStatus ?? next[idx]!.quoteStatus,
            quoteAmountKzt: data.quoteAmountKzt ?? next[idx]!.quoteAmountKzt,
            quoteCurrency: data.quoteCurrency ?? next[idx]!.quoteCurrency,
            quoteExpiresAt: data.quoteExpiresAt ?? next[idx]!.quoteExpiresAt,
            quoteRequiresOperatorReview: data.quoteRequiresOperatorReview ?? next[idx]!.quoteRequiresOperatorReview,
            stages: state.stages,
            // fiscalUrl and fiscalReceiptStatus are not polled per-job; they come from loadOrders()
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
  }, [orders, ordersLoaded, loadOrders]);

  // ─── Auth ──────────────────────────────────────────────────────────────────────

  const handleLogout = async (): Promise<void> => {
    setIsLoggingOut(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signOut();
    if (error) { toast.error(t('errors.logoutFailed')); setIsLoggingOut(false); return; }
    router.push('/');
    router.refresh();
  };

  // ─── Upload ────────────────────────────────────────────────────────────────────

  const handleRecalculate = useCallback(async (jobId: string): Promise<void> => {
    await loadOrders();
    toast.info(t('quoteRecalculating'));
    void jobId; // jobId reserved for future recalculate endpoint
  }, [loadOrders, t]);

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

      <OrderForm mode="dashboard" onSubmitSuccess={loadOrders} />

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
              <ActiveOrderCard key={o.documentId} entry={o} locale={locale} onRecalculate={handleRecalculate} />
            ))}
          </>
        )}
      </div>


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
