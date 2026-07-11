'use client';

/**
 * Extracted verbatim from src/app/[locale]/dashboard/page.tsx's "New Translation" form —
 * this is the single source of truth for both the authenticated dashboard order form and
 * the public pre-checkout wizard (`/[locale]/start`). Do not fork the JSX/classes/copy
 * between the two call sites; add a `mode` branch here instead.
 *
 * Intentional differences between modes are isolated to:
 * - the dropzone size hint (50 MB dashboard vs 20 MB anonymous)
 * - the submit handler's network calls (upload-card vs order-drafts create/upload/calculate)
 * - whether `/api/users/accept-terms` is called before submit (skipped without a session)
 * Everything else — fields, order, labels, classes, service level cards, notary block,
 * consent block, promo/partner code field, price hint, and the "Загрузить документ"
 * button copy — is identical in both modes.
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { toast } from 'sonner';
import { Upload, FileText, FileImage, FileCode2, X, Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Link } from '@/i18n/navigation';
import { NOTARY_CITIES } from '@/lib/notary/cities';
import { isNotaryDeliveryValid, isDeliverySelected } from '@/lib/translation-workflow/notary-delivery-validation';
import { loadReferralParams } from '@/lib/referral/capture';
import type { ServiceLevel } from '@/lib/translation-prompts/types';

interface PromoDiscountInfo {
  discountType: string;
  discountValue: number;
  discountMinOrderKzt?: number;
  discountMaxKzt?: number;
  partnerName: string;
}

type FulfillmentMethod = 'pickup' | 'delivery';

export interface DraftPriceResult {
  priceKzt: number;
  currency: string;
  requiresOperatorReview: boolean;
  reviewReasons?: string[];
  priceBeforeDiscountKzt?: number;
  discountAppliedKzt?: number;
  discountCode?: string | null;
}

export type OrderFormMode = 'dashboard' | 'publicStart';

export interface OrderFormProps {
  mode: OrderFormMode;
  /** dashboard mode only — called after a successful upload-card submit (reloads the order list). */
  onSubmitSuccess?: () => void;
  /** publicStart mode only — existing draft id, owned by the parent so it survives the
   *  form/price step toggle in OrderWizard. */
  draftId?: string | null;
  /** publicStart mode only — called once when a new draft is created. */
  onDraftIdChange?: (draftId: string) => void;
  /** publicStart mode only — called after a successful draft price calculation. */
  onDraftPriced?: (price: DraftPriceResult, draftId: string) => void;
}

function ServiceLevelCard({ value, current, label, description, onChange }: {
  value: ServiceLevel; current: ServiceLevel; label: string; description: string; onChange: (v: ServiceLevel) => void;
}) {
  const selected = current === value;
  return (
    <button
      type="button"
      onClick={() => onChange(value)}
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

export function OrderForm({ mode, onSubmitSuccess, draftId, onDraftIdChange, onDraftPriced }: OrderFormProps) {
  const t = useTranslations('dashboard');
  const tElectronic = useTranslations('electronicOutput');
  const tLegal = useTranslations('legal');
  const tStart = useTranslations('startWizard');
  const locale = useLocale();

  const LANGUAGES = [
    { value: 'ru',   label: t('langs.ru')   },
    { value: 'en',   label: t('langs.en')   },
    { value: 'kk',   label: t('langs.kk')   },
    { value: 'th',   label: t('langs.th')   },
    { value: 'zh',   label: t('langs.zh')   },
    { value: 'ko',   label: t('langs.ko')   },
    { value: 'ja',   label: t('langs.ja')   },
    { value: 'de',   label: t('langs.de')   },
    { value: 'fr',   label: t('langs.fr')   },
    { value: 'es',   label: t('langs.es')   },
    { value: 'ar',   label: t('langs.ar')   },
    { value: 'uz',   label: t('langs.uz')   },
    { value: 'it',   label: t('langs.it')   },
    { value: 'tr',   label: t('langs.tr')   },
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

  const [files, setFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [sourceLang, setSourceLang] = useState('');
  const [targetLang, setTargetLang] = useState('ru');
  const [documentType, setDocumentType] = useState('other');
  // Electronic translation client output policy: DOCX + HTML only, never PDF
  // — see docs/ai-context/40_TRANSLATION_PIPELINE.md "Electronic output policy".
  const [outputFormat, setOutputFormat] = useState<'html' | 'docx'>('docx');
  const [serviceLevel, setServiceLevel] = useState<ServiceLevel>('electronic');
  // No default — an explicit individual/legal_entity choice is required for
  // notarized orders (it directly determines the notary MRP tariff, a ~2x
  // difference); silently defaulting to 'individual' would let an unanswered
  // field under-price a legal-entity order. Irrelevant for electronic/official.
  const [applicantType, setApplicantType] = useState('');
  const [notaryUrgencyLevel, setNotaryUrgencyLevel] = useState<'standard' | 'same_day'>('standard');
  const [notaryCity, setNotaryCity] = useState('');
  const [customerComment, setCustomerComment] = useState('');
  const [fulfillmentMethod, setFulfillmentMethod] = useState<FulfillmentMethod | ''>('');
  const [deliveryPhone, setDeliveryPhone] = useState('');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [uploading, setUploading] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState<boolean | null>(null);
  const [hasSession, setHasSession] = useState(false);
  const [consentChecked, setConsentChecked] = useState(false);

  // Promo / partner code
  const [promoCode, setPromoCode] = useState('');
  const [promoState, setPromoState] = useState<'idle' | 'checking' | 'valid' | 'invalid'>('idle');
  const [promoDiscount, setPromoDiscount] = useState<PromoDiscountInfo | null>(null);

  // Auto-reset targetLang if it matches a newly selected sourceLang
  useEffect(() => {
    if (sourceLang && targetLang && sourceLang === targetLang) {
      const fallback = LANGUAGES.find(l => l.value !== sourceLang && l.value !== '')?.value ?? 'ru';
      setTargetLang(fallback);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceLang]);

  // Pre-fill promo code from stored referral params (URL capture or prior visit)
  useEffect(() => {
    const stored = loadReferralParams();
    if (stored?.refCode) setPromoCode(stored.refCode);
  }, []);

  // Terms-accepted lookup — mode-agnostic: an anonymous publicStart visitor simply has
  // no session, so this naturally resolves termsAccepted=false without any branching.
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(async ({ data }) => {
      const userId = data.session?.user.id;
      setHasSession(!!userId);
      if (userId) {
        const { data: userRow } = await supabase.from('users').select('terms_accepted_at').eq('id', userId).maybeSingle();
        setTermsAccepted(!!userRow?.terms_accepted_at);
      } else {
        setTermsAccepted(false);
      }
    });
  }, []);

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
    if (rejected.length > 0) toast.error(t('errors.unsupportedFileType', { files: rejected.map((f) => f.name).join(', ') }));
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
      setApplicantType(''); setNotaryUrgencyLevel('standard');
    }
  };

  const isNotarization = serviceLevel === 'notarization_through_partners';
  const isDelivery = isDeliverySelected({ isNotarization, fulfillmentMethod });
  const totalSize = files.reduce((s, f) => s + f.size, 0);

  const isFormValid =
    files.length > 0 &&
    sourceLang.length > 0 &&
    targetLang.length > 0 &&
    sourceLang !== targetLang &&
    termsAccepted !== null &&
    (termsAccepted === true || consentChecked) &&
    isNotaryDeliveryValid({ isNotarization, notaryCity, fulfillmentMethod, deliveryPhone, deliveryAddress, applicantType });

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!isFormValid) return;
    if (files.length === 0) { toast.error(t('errors.pleaseSelectFile')); return; }
    setUploading(true);

    // Only attempt to record terms acceptance when a real session exists — an
    // anonymous publicStart visitor cannot call this endpoint (401); their
    // eventual acceptance is recorded later at checkout, after login.
    if (hasSession && !termsAccepted) {
      const acceptRes = await fetch('/api/users/accept-terms', { method: 'POST' });
      if (!acceptRes.ok) { toast.error(t('errors.failedTermsAcceptance')); setUploading(false); return; }
      setTermsAccepted(true);
    }

    if (mode === 'dashboard') {
      const form = new FormData();
      for (const f of files) form.append('file', f);
      form.append('sourceLang', sourceLang);
      form.append('targetLang', targetLang);
      form.append('documentType', `${documentType}|${outputFormat}`);
      form.append('serviceLevel', serviceLevel);
      if (isNotarization) {
        form.append('applicantType', applicantType);
        form.append('notaryUrgencyLevel', notaryUrgencyLevel);
        form.append('notaryCity', notaryCity);
        if (fulfillmentMethod) form.append('fulfillmentMethod', fulfillmentMethod);
        if (isDelivery) { form.append('deliveryPhone', deliveryPhone.trim()); form.append('deliveryAddress', deliveryAddress.trim()); }
      }
      if (customerComment.trim()) form.append('customerComment', customerComment.trim());

      // Attach referral params — promo field takes precedence over stored URL capture.
      // Server re-validates the code; client cannot influence discount or commission amounts.
      const activeCode = promoCode.trim();
      if (activeCode) form.append('refCode', activeCode);
      const referralParams = loadReferralParams();
      if (referralParams?.utmSource)   form.append('utmSource',   referralParams.utmSource);
      if (referralParams?.utmMedium)   form.append('utmMedium',   referralParams.utmMedium);
      if (referralParams?.utmCampaign) form.append('utmCampaign', referralParams.utmCampaign);
      if (referralParams?.utmContent)  form.append('utmContent',  referralParams.utmContent);
      if (referralParams?.utmTerm)     form.append('utmTerm',     referralParams.utmTerm);

      if (process.env.NODE_ENV !== 'production') {
        console.info('[upload-card payload]', { sourceLanguage: sourceLang, targetLanguage: targetLang, documentType: `${documentType}|${outputFormat}`, serviceLevel });
      }

      const res = await fetch('/api/documents/upload-card', { method: 'POST', body: form });
      let data: { jobId?: string; documentId?: string; error?: string; priceKzt?: number; quoteId?: string; requiresOperatorReview?: boolean; currency?: string; discountAppliedKzt?: number } = {};
      try {
        data = await res.json() as typeof data;
      } catch {
        toast.error(t('errors.serverError'));
        setUploading(false);
        return;
      }

      if (!res.ok || !data.jobId || !data.documentId) {
        toast.error(data.error ?? t('errors.uploadFailed'));
        setUploading(false);
        return;
      }

      setUploading(false);
      setFiles([]);
      if (data.requiresOperatorReview) {
        toast.success(t('uploadedRequiresReview'));
      } else if (data.discountAppliedKzt && data.discountAppliedKzt > 0) {
        toast.success(t('uploadedQuoteReadyWithDiscount', {
          price: (data.priceKzt ?? 0).toLocaleString(),
          saved: data.discountAppliedKzt.toLocaleString(),
        }));
      } else {
        toast.success(t('uploadedQuoteReady', { price: (data.priceKzt ?? 0).toLocaleString() }));
      }

      onSubmitSuccess?.();
      return;
    }

    // ─── publicStart mode: create/patch draft → upload → calculate ────────────
    try {
      const referral = loadReferralParams();
      const payload = {
        sourceLanguage: sourceLang,
        targetLanguage: targetLang,
        documentType,
        outputFormat,
        serviceLevel,
        ...(isNotarization
          ? {
              applicantType,
              notaryUrgencyLevel,
              notaryCity,
              fulfillmentMethod: fulfillmentMethod || undefined,
              ...(isDelivery ? { deliveryPhone: deliveryPhone.trim(), deliveryAddress: deliveryAddress.trim() } : {}),
            }
          : {}),
        customerComment: customerComment.trim() || undefined,
        refCode: promoCode.trim() || undefined,
        utmSource: referral?.utmSource ?? undefined,
        utmMedium: referral?.utmMedium ?? undefined,
        utmCampaign: referral?.utmCampaign ?? undefined,
        utmContent: referral?.utmContent ?? undefined,
        utmTerm: referral?.utmTerm ?? undefined,
      };

      let currentDraftId = draftId ?? null;

      if (!currentDraftId) {
        const res = await fetch('/api/order-drafts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await res.json() as { draftId?: string; error?: string };
        if (!res.ok || !data.draftId) { toast.error(tStart('errors.genericError')); setUploading(false); return; }
        currentDraftId = data.draftId;
        onDraftIdChange?.(currentDraftId);
      } else {
        const res = await fetch(`/api/order-drafts/${currentDraftId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) { toast.error(tStart('errors.genericError')); setUploading(false); return; }
      }

      const uploadForm = new FormData();
      for (const f of files) uploadForm.append('file', f);
      const uploadRes = await fetch(`/api/order-drafts/${currentDraftId}/upload`, { method: 'POST', body: uploadForm });
      if (!uploadRes.ok) {
        const err = await uploadRes.json().catch(() => ({})) as { error?: string; file?: string };
        if (err.error === 'TOTAL_SIZE_EXCEEDED') toast.error(tStart('errors.totalSizeExceeded'));
        else if (err.error === 'INVALID_FILE_SIGNATURE') toast.error(tStart('errors.invalidFileSignature', { file: err.file ?? '' }));
        else toast.error(tStart('errors.uploadFailed'));
        setUploading(false);
        return;
      }

      const calcRes = await fetch(`/api/order-drafts/${currentDraftId}/calculate`, { method: 'POST' });
      const calcData = await calcRes.json() as DraftPriceResult & { error?: string; reason?: string };
      if (!calcRes.ok) {
        if (calcData.error === 'RATE_LIMITED') {
          toast.error(calcData.reason === 'daily_limit' ? tStart('errors.rateLimitedDaily') : tStart('errors.rateLimitedHourly'));
        } else if (calcData.error === 'LANGUAGE_PAIR_MUST_DIFFER') {
          toast.error(tStart('errors.languagePairMustDiffer'));
        } else {
          toast.error(tStart('errors.calculationFailed'));
        }
        setUploading(false);
        return;
      }

      setUploading(false);
      onDraftPriced?.(calcData, currentDraftId);
    } catch {
      toast.error(tStart('errors.genericError'));
      setUploading(false);
    }
  };

  const selectClass = 'rounded-md border border-white/10 bg-input px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring transition-colors hover:border-white/20';
  const inputClass = 'rounded-md border border-white/10 bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring transition-colors hover:border-white/20 w-full';

  return (
    <div className="rounded-lg border border-white/10 bg-card p-6">
      <h2 className="mb-5 text-base font-semibold text-foreground">{t('newTranslation')}</h2>
      <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-5">
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
          {/* Anonymous cap (20 MB) differs from the authenticated 50 MB cap — the one
              necessary content difference here. */}
          <p className="mt-1 text-xs text-muted-foreground">{mode === 'dashboard' ? t('dropzoneHint') : tStart('dropzoneHint')}</p>
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
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t('sourceLanguage')} <span className="text-red-400">*</span></label>
            <select value={sourceLang} onChange={(e) => setSourceLang(e.target.value)} className={selectClass} required>
              <option value="" disabled>{t('selectSourceLanguage')}</option>
              {LANGUAGES.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t('targetLanguage')}</label>
            <select value={targetLang} onChange={(e) => setTargetLang(e.target.value)} className={selectClass}>
              {LANGUAGES.filter((l) => l.value !== sourceLang).map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t('documentType')}</label>
            <select value={documentType} onChange={(e) => setDocumentType(e.target.value)} className={selectClass}>
              {DOCUMENT_TYPES.map((dt) => <option key={dt.value} value={dt.value}>{dt.label}</option>)}
            </select>
          </div>
          {/* Output format area — always shown (never disappears across service levels).
              Electronic: interactive DOCX/HTML selector, no PDF option.
              Official/notarized: read-only notice — their pipeline produces its own
              artifacts (AI draft DOCX -> human review -> final PDF/notary package) and
              this selector has no effect on them, so it must not offer DOCX/HTML/PDF
              as choices. See the 2026-07-03 UX correction. */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t('outputFormat')}</label>
            {serviceLevel === 'electronic' ? (
              <select value={outputFormat} onChange={(e) => setOutputFormat(e.target.value as 'html' | 'docx')} className={selectClass}>
                <option value="docx">{t('formatDocx')}</option>
                <option value="html">{t('formatHtml')}</option>
              </select>
            ) : (
              <div
                className={`${selectClass} flex cursor-not-allowed items-center opacity-70`}
                aria-disabled="true"
                data-testid="output-format-readonly"
              >
                {serviceLevel === 'notarization_through_partners'
                  ? tElectronic('finalFormat.notarized')
                  : tElectronic('finalFormat.official')}
              </div>
            )}
          </div>
        </div>

        {/* Electronic output format disclaimer — DOCX/HTML only, no PDF for electronic delivery. */}
        {serviceLevel === 'electronic' && (
          <p className="text-xs text-muted-foreground">
            <span className="font-medium">{tElectronic('formats.title')}</span>
            {': '}
            {tElectronic('formats.body')}
          </p>
        )}

        {/* Service level */}
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t('serviceLevel.label')}</p>
          <div className="flex flex-col gap-2">
            <ServiceLevelCard value="electronic" current={serviceLevel} label={t('serviceLevel.electronic.label')} description={t('serviceLevel.electronic.desc')} onChange={handleServiceLevelChange} />
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
                  <input
                    type="tel"
                    name="notary-delivery-phone"
                    value={deliveryPhone}
                    onChange={(e) => setDeliveryPhone(e.target.value)}
                    placeholder={t('notary.phonePlaceholder')}
                    className={inputClass}
                    required={isDelivery}
                    autoComplete="off"
                  />
                  {deliveryPhone.trim().length === 0 && (
                    <p className="text-xs text-red-400">{t('notary.phoneRequired')}</p>
                  )}
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t('notary.address')} <span className="text-red-400">*</span></label>
                  {/* Free-form text only — no address autocomplete/placeId selection required.
                      name deliberately avoids the word "address" (a known browser autofill
                      heuristic trigger, independent of autoComplete="off" in some versions) so
                      the browser's native address-manager popup does not appear over this field. */}
                  <textarea
                    name="notary-delivery-location-note"
                    value={deliveryAddress}
                    onChange={(e) => setDeliveryAddress(e.target.value)}
                    placeholder={t('notary.addressPlaceholder')}
                    className={`${inputClass} min-h-[80px] resize-none`}
                    required={isDelivery}
                    rows={3}
                    autoComplete="off"
                  />
                  {deliveryAddress.trim().length === 0 && (
                    <p className="text-xs text-red-400">{t('notary.addressRequired')}</p>
                  )}
                </div>
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t('notary.applicantType')} <span className="text-red-400">*</span></label>
              <select value={applicantType} onChange={(e) => setApplicantType(e.target.value)} className={selectClass} required>
                <option value="" disabled>{t('notary.applicantTypePlaceholder')}</option>
                <option value="individual">{t('notary.individual')}</option>
                <option value="legal_entity">{t('notary.legalEntity')}</option>
              </select>
              {applicantType === '' && (
                <p className="text-xs text-red-400">{t('notary.applicantTypeRequired')}</p>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t('notary.urgencyLevel')}</label>
              <div className="flex flex-col gap-2">
                {(['standard', 'same_day'] as const).map((level) => (
                  <label key={level} className={`flex items-start gap-3 rounded-lg border px-3 py-2.5 cursor-pointer transition-all ${notaryUrgencyLevel === level ? 'border-primary/40 bg-primary/5' : 'border-white/10 hover:border-white/20'}`}>
                    <input
                      type="radio"
                      name="notaryUrgencyLevel"
                      value={level}
                      checked={notaryUrgencyLevel === level}
                      onChange={() => setNotaryUrgencyLevel(level)}
                      className="mt-0.5 accent-primary"
                    />
                    <div>
                      <p className="text-sm font-medium text-foreground">{t(`notary.urgency.${level}`)}</p>
                      {level === 'standard' && (
                        <p className="text-xs text-muted-foreground mt-0.5">{t('notary.urgency.standardHint')}</p>
                      )}
                      {level === 'same_day' && (
                        <p className="text-xs text-muted-foreground mt-0.5">{t('notary.urgency.sameDayHint')}</p>
                      )}
                    </div>
                  </label>
                ))}
              </div>
            </div>
          </div>
        )}

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

        {/* Customer comment */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            {t('customerComment.label')}
          </label>
          <textarea
            value={customerComment}
            onChange={(e) => setCustomerComment(e.target.value.slice(0, 2000))}
            placeholder={t('customerComment.placeholder')}
            rows={3}
            maxLength={2000}
            className={`${inputClass} resize-none`}
          />
          {customerComment.length > 1800 && (
            <p className="text-xs text-muted-foreground text-right">
              {customerComment.length}/2000
            </p>
          )}
        </div>

        {/* Promo / partner code */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            {t('promoCode.label')}
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={promoCode}
              onChange={(e) => {
                const val = e.target.value.toUpperCase();
                setPromoCode(val);
                setPromoState('idle');
                setPromoDiscount(null);
              }}
              placeholder={t('promoCode.placeholder')}
              className={`${inputClass} flex-1`}
              maxLength={100}
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
            />
            {promoCode.trim() && promoState !== 'valid' && (
              <button
                type="button"
                disabled={promoState === 'checking'}
                onClick={async () => {
                  setPromoState('checking');
                  setPromoDiscount(null);
                  try {
                    const res = await fetch('/api/partners/validate-code', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ code: promoCode.trim() }),
                    });
                    const json = await res.json() as {
                      valid: boolean;
                      partnerName?: string;
                      discountEnabled?: boolean;
                      discountType?: string;
                      discountValue?: number;
                      discountMinOrderKzt?: number;
                      discountMaxKzt?: number;
                    };
                    if (json.valid) {
                      setPromoState('valid');
                      if (json.discountEnabled && json.discountType && json.discountValue != null) {
                        setPromoDiscount({
                          discountType: json.discountType,
                          discountValue: json.discountValue,
                          discountMinOrderKzt: json.discountMinOrderKzt,
                          discountMaxKzt: json.discountMaxKzt,
                          partnerName: json.partnerName ?? '',
                        });
                      }
                    } else {
                      setPromoState('invalid');
                    }
                  } catch {
                    setPromoState('invalid');
                  }
                }}
                className="shrink-0 inline-flex items-center justify-center rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:border-white/20 hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
              >
                {promoState === 'checking' ? t('promoCode.checking') : t('promoCode.apply')}
              </button>
            )}
            {promoState === 'valid' && (
              <button
                type="button"
                onClick={() => { setPromoCode(''); setPromoState('idle'); setPromoDiscount(null); }}
                className="shrink-0 inline-flex items-center justify-center rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:border-white/20 hover:text-foreground"
              >
                {t('promoCode.remove')}
              </button>
            )}
          </div>
          {promoState === 'valid' && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-emerald-400">
                ✓ {promoDiscount ? t('promoCode.valid') : t('promoCode.validAttribution')}
              </span>
              {promoDiscount && (
                <span className="text-xs text-emerald-400/80">
                  {promoDiscount.discountType === 'fixed'
                    ? t('promoCode.discountFixed', { amount: promoDiscount.discountValue.toLocaleString() })
                    : promoDiscount.discountMaxKzt != null
                      ? t('promoCode.discountPercentCapped', { pct: promoDiscount.discountValue, max: promoDiscount.discountMaxKzt.toLocaleString() })
                      : t('promoCode.discountPercent', { pct: promoDiscount.discountValue })}
                </span>
              )}
            </div>
          )}
          {promoState === 'valid' && !promoDiscount && (
            <p className="text-xs text-muted-foreground/70">{t('promoCode.attributionHint')}</p>
          )}
          {promoState === 'valid' && promoDiscount?.discountMinOrderKzt != null && promoDiscount.discountMinOrderKzt > 0 && (
            <p className="text-xs text-muted-foreground/60">{t('promoCode.discountMinOrderHint', { min: promoDiscount.discountMinOrderKzt.toLocaleString() })}</p>
          )}
          {promoState === 'invalid' && (
            <p className="text-xs text-red-400">{t('promoCode.invalid')}</p>
          )}
          {promoState === 'idle' && (
            <p className="text-xs text-muted-foreground/60">{t('promoCode.helperText')}</p>
          )}
        </div>

        <div className="rounded-md border border-white/10 bg-white/[0.02] px-4 py-3 text-xs text-muted-foreground">
          {serviceLevel === 'electronic' && t('priceHintElectronic')}
          {serviceLevel === 'official_with_translator_signature_and_provider_stamp' && t('priceHintOfficial')}
          {serviceLevel === 'notarization_through_partners' && t('priceHintNotarized')}
        </div>

        <button type="submit" disabled={uploading || !isFormValid}
          className="inline-flex w-fit items-center justify-center gap-2 rounded-md bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-gold-dark disabled:pointer-events-none disabled:opacity-50">
          {uploading ? (
            <><Loader2 className="h-4 w-4 animate-spin" />…</>
          ) : (
            <><Upload className="h-4 w-4" />{t('uploadDocument')}</>
          )}
        </button>
      </form>
    </div>
  );
}
