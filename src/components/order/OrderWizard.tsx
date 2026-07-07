'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Upload, FileText, FileImage, FileCode2, X, Loader2, ArrowRight } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Link } from '@/i18n/navigation';
import { NOTARY_CITIES } from '@/lib/notary/cities';
import { isDeliverySelected, isNotaryDeliveryValid } from '@/lib/translation-workflow/notary-delivery-validation';
import { loadReferralParams } from '@/lib/referral/capture';
import type { ServiceLevel } from '@/lib/translation-prompts/types';

type Step = 'form' | 'price';
type FulfillmentMethod = 'pickup' | 'delivery';

interface PriceState {
  priceKzt: number;
  currency: string;
  requiresOperatorReview: boolean;
  reviewReasons?: string[];
}

// Same field styling as the dashboard order form (src/app/[locale]/dashboard/page.tsx) —
// this component mirrors that form's layout/copy as closely as possible; the only
// intended differences are: public route, pre-login fill-in, a smaller anonymous
// upload cap, an explicit price-reveal step, and login-gated payment.
const selectClass = 'rounded-md border border-white/10 bg-input px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring transition-colors hover:border-white/20';
const inputClass = 'rounded-md border border-white/10 bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring transition-colors hover:border-white/20 w-full';

function ServiceLevelCard({ value, current, label, description, onChange }: {
  value: ServiceLevel; current: ServiceLevel; label: string; description: string; onChange: (v: ServiceLevel) => void;
}) {
  const active = current === value;
  return (
    <button
      type="button"
      onClick={() => onChange(value)}
      className={`flex flex-col gap-1 rounded-lg border px-4 py-3 text-left transition-all duration-150 ${active ? 'border-primary/40 bg-primary/5' : 'border-white/10 bg-transparent hover:border-white/20'}`}
    >
      <span className={`text-sm font-medium ${active ? 'text-foreground' : 'text-foreground/80'}`}>{label}</span>
      <span className="text-xs text-muted-foreground">{description}</span>
    </button>
  );
}

export function OrderWizard() {
  const locale = useLocale();
  const router = useRouter();
  const t = useTranslations('startWizard');
  const td = useTranslations('dashboard');
  const tElectronic = useTranslations('electronicOutput');
  const tLegal = useTranslations('legal');

  const LANGUAGES = [
    { value: 'ru', label: td('langs.ru') }, { value: 'en', label: td('langs.en') },
    { value: 'kk', label: td('langs.kk') }, { value: 'th', label: td('langs.th') },
    { value: 'zh', label: td('langs.zh') }, { value: 'ko', label: td('langs.ko') },
    { value: 'ja', label: td('langs.ja') }, { value: 'de', label: td('langs.de') },
    { value: 'fr', label: td('langs.fr') }, { value: 'es', label: td('langs.es') },
    { value: 'ar', label: td('langs.ar') }, { value: 'uz', label: td('langs.uz') },
    { value: 'it', label: td('langs.it') }, { value: 'tr', label: td('langs.tr') },
  ];

  const DOCUMENT_TYPES = [
    { value: 'passport_id', label: td('docTypes.passport_id') },
    { value: 'diploma_transcript', label: td('docTypes.diploma_transcript') },
    { value: 'contract', label: td('docTypes.contract') },
    { value: 'bank_statement', label: td('docTypes.bank_statement') },
    { value: 'medical_document', label: td('docTypes.medical_document') },
    { value: 'employment_document', label: td('docTypes.employment_document') },
    { value: 'police_clearance', label: td('docTypes.police_clearance') },
    { value: 'visa_documents', label: td('docTypes.visa_documents') },
    { value: 'driver_license', label: td('docTypes.driver_license') },
    { value: 'presentation', label: td('docTypes.presentation') },
    { value: 'other', label: td('docTypes.other') },
  ];

  const [step, setStep] = useState<Step>('form');
  const [files, setFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [sourceLang, setSourceLang] = useState('');
  const [targetLang, setTargetLang] = useState('ru');
  const [documentType, setDocumentType] = useState('other');
  const [outputFormat, setOutputFormat] = useState<'html' | 'docx'>('docx');
  const [serviceLevel, setServiceLevel] = useState<ServiceLevel>('electronic');
  const [applicantType, setApplicantType] = useState('individual');
  const [notaryUrgencyLevel, setNotaryUrgencyLevel] = useState<'standard' | 'same_day'>('standard');
  const [notaryCity, setNotaryCity] = useState('');
  const [fulfillmentMethod, setFulfillmentMethod] = useState<FulfillmentMethod | ''>('');
  const [deliveryPhone, setDeliveryPhone] = useState('');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [customerComment, setCustomerComment] = useState('');
  const [consentChecked, setConsentChecked] = useState(false);

  const [draftId, setDraftId] = useState<string | null>(null);
  const [price, setPrice] = useState<PriceState | null>(null);
  const [busy, setBusy] = useState(false);

  // Auto-reset targetLang if it matches a newly selected sourceLang — matches
  // the dashboard form exactly (without this, the target <select> silently drops
  // the now-invalid option while state keeps the stale value, and the submit
  // button stays disabled with no visible reason).
  useEffect(() => {
    if (sourceLang && targetLang && sourceLang === targetLang) {
      const fallback = LANGUAGES.find((l) => l.value !== sourceLang && l.value !== '')?.value ?? 'ru';
      setTargetLang(fallback);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceLang]);

  const isNotarization = serviceLevel === 'notarization_through_partners';
  const isDelivery = isDeliverySelected({ isNotarization, fulfillmentMethod });

  function handleServiceLevelChange(newLevel: ServiceLevel) {
    setServiceLevel(newLevel);
    if (newLevel !== 'notarization_through_partners') {
      setNotaryCity(''); setFulfillmentMethod(''); setDeliveryPhone(''); setDeliveryAddress('');
      setApplicantType('individual'); setNotaryUrgencyLevel('standard');
    }
  }

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
    if (rejected.length > 0) {
      toast.error(t('errors.unsupportedFileType', { files: rejected.map((f) => f.name).join(', ') }));
    }
    if (accepted.length > 0) setFiles(accepted); // single merged draft file — replace, don't append
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

  const totalSize = files.reduce((s, f) => s + f.size, 0);

  const isFormValid =
    files.length > 0 &&
    sourceLang.length > 0 &&
    targetLang.length > 0 &&
    sourceLang !== targetLang &&
    consentChecked &&
    isNotaryDeliveryValid({ isNotarization, notaryCity, fulfillmentMethod, deliveryPhone, deliveryAddress });

  const draftFieldsPayload = useCallback(() => {
    const referral = loadReferralParams();
    return {
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
      refCode: referral?.refCode ?? undefined,
      utmSource: referral?.utmSource ?? undefined,
      utmMedium: referral?.utmMedium ?? undefined,
      utmCampaign: referral?.utmCampaign ?? undefined,
      utmContent: referral?.utmContent ?? undefined,
      utmTerm: referral?.utmTerm ?? undefined,
    };
  }, [sourceLang, targetLang, documentType, outputFormat, serviceLevel, isNotarization, applicantType, notaryUrgencyLevel, notaryCity, fulfillmentMethod, isDelivery, deliveryPhone, deliveryAddress, customerComment]);

  // Visible CTA is "Загрузить документ" (dashboard's real upload button copy) — it
  // internally creates/updates the draft, uploads the file, and computes the price,
  // but the button never says "Рассчитать стоимость".
  const handleUploadDocument = async (): Promise<void> => {
    if (!isFormValid) return;
    if (sourceLang === targetLang) { toast.error(t('errors.languagePairMustDiffer')); return; }
    setBusy(true);

    try {
      let currentDraftId = draftId;
      const payload = draftFieldsPayload();

      if (!currentDraftId) {
        const res = await fetch('/api/order-drafts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await res.json() as { draftId?: string; error?: string };
        if (!res.ok || !data.draftId) { toast.error(t('errors.genericError')); setBusy(false); return; }
        currentDraftId = data.draftId;
        setDraftId(currentDraftId);
      } else {
        const res = await fetch(`/api/order-drafts/${currentDraftId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) { toast.error(t('errors.genericError')); setBusy(false); return; }
      }

      const form = new FormData();
      for (const f of files) form.append('file', f);
      const uploadRes = await fetch(`/api/order-drafts/${currentDraftId}/upload`, { method: 'POST', body: form });
      if (!uploadRes.ok) {
        const err = await uploadRes.json().catch(() => ({})) as { error?: string; file?: string };
        if (err.error === 'TOTAL_SIZE_EXCEEDED') toast.error(t('errors.totalSizeExceeded'));
        else if (err.error === 'INVALID_FILE_SIGNATURE') toast.error(t('errors.invalidFileSignature', { file: err.file ?? '' }));
        else toast.error(t('errors.uploadFailed'));
        setBusy(false);
        return;
      }

      const calcRes = await fetch(`/api/order-drafts/${currentDraftId}/calculate`, { method: 'POST' });
      const calcData = await calcRes.json() as PriceState & { error?: string; reason?: string };
      if (!calcRes.ok) {
        if (calcData.error === 'RATE_LIMITED') {
          toast.error(calcData.reason === 'daily_limit' ? t('errors.rateLimitedDaily') : t('errors.rateLimitedHourly'));
        } else if (calcData.error === 'LANGUAGE_PAIR_MUST_DIFFER') {
          toast.error(t('errors.languagePairMustDiffer'));
        } else {
          toast.error(t('errors.calculationFailed'));
        }
        setBusy(false);
        return;
      }

      setPrice(calcData);
      setStep('price');
    } catch {
      toast.error(t('errors.genericError'));
    } finally {
      setBusy(false);
    }
  };

  const handlePay = async (): Promise<void> => {
    if (!draftId) return;
    const supabase = createClient();
    const { data } = await supabase.auth.getSession();
    const checkoutPath = `/${locale}/checkout?draftId=${draftId}`;

    if (!data.session) {
      router.push(`/${locale}/auth/login?next=${encodeURIComponent(checkoutPath)}`);
      return;
    }
    router.push(checkoutPath);
  };

  // ─── Price step — the one screen with no dashboard equivalent: dashboard shows
  // the price via a toast + order-history row, but an anonymous visitor has no
  // order history yet, so this explicit "price ready → pay" panel is required. ───
  if (step === 'price' && price) {
    return (
      <div className="mx-auto max-w-lg rounded-lg border border-white/10 bg-card p-6">
        <h2 className="mb-1 text-lg font-semibold text-foreground">{t('priceReadyTitle')}</h2>
        <p className="mb-5 text-sm text-muted-foreground">{t('signInHint')}</p>

        <div className="mb-5 rounded-lg border border-primary/30 bg-primary/5 p-5 text-center">
          <div className="text-3xl font-extrabold text-foreground">
            {price.priceKzt.toLocaleString()} {price.currency}
          </div>
        </div>

        {price.requiresOperatorReview && (
          <p className="mb-4 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-400">
            {t('requiresOperatorReviewNotice')}
          </p>
        )}

        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={() => setStep('form')}
            className="inline-flex flex-1 items-center justify-center rounded-md border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-medium text-foreground/80 transition-colors hover:border-white/20 hover:text-foreground"
          >
            {t('editDetails')}
          </button>
          <button
            type="button"
            onClick={() => void handlePay()}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-gold-dark"
          >
            {t('continueToPayment')}
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }

  // ─── Form step — same field set, order, classes, and copy as the dashboard's
  // "New Translation" form (src/app/[locale]/dashboard/page.tsx). ───
  return (
    <div className="mx-auto max-w-2xl rounded-lg border border-white/10 bg-card p-6">
      <h2 className="mb-5 text-base font-semibold text-foreground">{td('newTranslation')}</h2>
      <div className="flex flex-col gap-5">
        {/* Drop zone */}
        <div
          className={`relative flex flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-8 text-center transition-[border-color,background-color] duration-150 cursor-pointer ${isDragging ? 'border-primary/70 bg-[rgba(201,168,76,0.05)]' : files.length > 0 ? 'border-primary/30 bg-primary/[0.03]' : 'border-white/15 hover:border-white/25 hover:bg-white/[0.03]'}`}
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => { e.preventDefault(); setIsDragging(false); addFiles(Array.from(e.dataTransfer.files)); }}
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,.docx,application/pdf,image/jpeg,image/png,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            multiple
            className="sr-only"
            onChange={(e) => { if (e.target.files) addFiles(Array.from(e.target.files)); e.target.value = ''; }}
          />
          <Upload className="mb-2 h-7 w-7 text-muted-foreground" />
          <p className="text-sm font-medium text-foreground">{td('dropzone')}</p>
          {/* Anonymous cap (20 MB) differs from the dashboard's 50 MB authenticated cap — the
              one necessary content difference here, so this uses the startWizard copy. */}
          <p className="mt-1 text-xs text-muted-foreground">{t('dropzoneHint')}</p>
        </div>

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
              <span className="text-xs text-muted-foreground">{files.length} {files.length === 1 ? td('fileCount1') : td('fileCountN')} · {formatBytes(totalSize)}</span>
              <button type="button" onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }} className="text-xs text-primary hover:opacity-80 transition-opacity">+ {td('addMoreFiles')}</button>
            </div>
          </div>
        )}

        {/* Selects */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{td('sourceLanguage')} <span className="text-red-400">*</span></label>
            <select value={sourceLang} onChange={(e) => setSourceLang(e.target.value)} className={selectClass} required>
              <option value="" disabled>{td('selectSourceLanguage')}</option>
              {LANGUAGES.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{td('targetLanguage')}</label>
            <select value={targetLang} onChange={(e) => setTargetLang(e.target.value)} className={selectClass}>
              {LANGUAGES.filter((l) => l.value !== sourceLang).map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{td('documentType')}</label>
            <select value={documentType} onChange={(e) => setDocumentType(e.target.value)} className={selectClass}>
              {DOCUMENT_TYPES.map((dt) => <option key={dt.value} value={dt.value}>{dt.label}</option>)}
            </select>
          </div>
          {/* Output format area — always shown (never disappears across service levels).
              Electronic: interactive DOCX/HTML selector, no PDF option.
              Official/notarized: read-only notice — matches dashboard exactly. */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{td('outputFormat')}</label>
            {serviceLevel === 'electronic' ? (
              <select value={outputFormat} onChange={(e) => setOutputFormat(e.target.value as 'html' | 'docx')} className={selectClass}>
                <option value="docx">{td('formatDocx')}</option>
                <option value="html">{td('formatHtml')}</option>
              </select>
            ) : (
              <div className={`${selectClass} flex cursor-not-allowed items-center opacity-70`} aria-disabled="true">
                {serviceLevel === 'notarization_through_partners'
                  ? tElectronic('finalFormat.notarized')
                  : tElectronic('finalFormat.official')}
              </div>
            )}
          </div>
        </div>

        {/* Electronic output format disclaimer — matches dashboard exactly. */}
        {serviceLevel === 'electronic' && (
          <p className="text-xs text-muted-foreground">
            <span className="font-medium">{tElectronic('formats.title')}</span>
            {': '}
            {tElectronic('formats.body')}
          </p>
        )}

        {/* Service level */}
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{td('serviceLevel.label')}</p>
          <div className="flex flex-col gap-2">
            <ServiceLevelCard value="electronic" current={serviceLevel} label={td('serviceLevel.electronic.label')} description={td('serviceLevel.electronic.desc')} onChange={handleServiceLevelChange} />
            <ServiceLevelCard value="official_with_translator_signature_and_provider_stamp" current={serviceLevel} label={td('serviceLevel.certified.label')} description={td('serviceLevel.certified.desc')} onChange={handleServiceLevelChange} />
            <ServiceLevelCard value="notarization_through_partners" current={serviceLevel} label={td('serviceLevel.notarization.label')} description={td('serviceLevel.notarization.desc')} onChange={handleServiceLevelChange} />
          </div>
        </div>

        {/* Notary delivery fields — identical to dashboard, including urgency radios. */}
        {isNotarization && (
          <div className="flex flex-col gap-4 rounded-lg border border-white/10 bg-white/[0.02] p-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{td('notary.city')} <span className="text-red-400">*</span></label>
              {NOTARY_CITIES.length > 0 ? (
                <select value={notaryCity} onChange={(e) => setNotaryCity(e.target.value)} className={selectClass} required>
                  <option value="">{td('notary.cityPlaceholder')}</option>
                  {NOTARY_CITIES.map((c) => <option key={c.value} value={c.value}>{c.label[locale] ?? c.label['en'] ?? c.value}</option>)}
                </select>
              ) : <p className="text-xs text-amber-400">{td('notary.citiesNotConfigured')}</p>}
            </div>
            <div className="flex flex-col gap-1.5">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{td('notary.fulfillment')} <span className="text-red-400">*</span></p>
              <div className="flex gap-2">
                {(['pickup', 'delivery'] as FulfillmentMethod[]).map((method) => (
                  <button key={method} type="button" onClick={() => { setFulfillmentMethod(method); if (method === 'pickup') { setDeliveryPhone(''); setDeliveryAddress(''); } }}
                    className={`flex flex-1 items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-sm transition-all duration-150 ${fulfillmentMethod === method ? 'border-primary/40 bg-primary/5 text-foreground font-medium' : 'border-white/10 bg-transparent text-muted-foreground hover:border-white/20 hover:text-foreground'}`}>
                    <span className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border transition-colors ${fulfillmentMethod === method ? 'border-primary bg-primary' : 'border-white/30'}`}>
                      {fulfillmentMethod === method && <span className="h-1.5 w-1.5 rounded-full bg-primary-foreground" />}
                    </span>
                    {method === 'pickup' ? td('notary.pickup') : td('notary.delivery')}
                  </button>
                ))}
              </div>
            </div>
            {isDelivery && (
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{td('notary.phone')} <span className="text-red-400">*</span></label>
                  <input type="tel" value={deliveryPhone} onChange={(e) => setDeliveryPhone(e.target.value)} placeholder={td('notary.phonePlaceholder')} className={inputClass} required={isDelivery} autoComplete="off" />
                  {deliveryPhone.trim().length === 0 && (
                    <p className="text-xs text-red-400">{td('notary.phoneRequired')}</p>
                  )}
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{td('notary.address')} <span className="text-red-400">*</span></label>
                  <textarea value={deliveryAddress} onChange={(e) => setDeliveryAddress(e.target.value)} placeholder={td('notary.addressPlaceholder')} className={`${inputClass} min-h-[80px] resize-none`} required={isDelivery} rows={3} autoComplete="off" />
                  {deliveryAddress.trim().length === 0 && (
                    <p className="text-xs text-red-400">{td('notary.addressRequired')}</p>
                  )}
                </div>
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{td('notary.applicantType')}</label>
              <select value={applicantType} onChange={(e) => setApplicantType(e.target.value)} className={selectClass}>
                <option value="individual">{td('notary.individual')}</option>
                <option value="legal_entity">{td('notary.legalEntity')}</option>
                <option value="unknown">{td('notary.unknownApplicant')}</option>
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{td('notary.urgencyLevel')}</label>
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
                      <p className="text-sm font-medium text-foreground">{td(`notary.urgency.${level}`)}</p>
                      {level === 'standard' && (
                        <p className="text-xs text-muted-foreground mt-0.5">{td('notary.urgency.standardHint')}</p>
                      )}
                      {level === 'same_day' && (
                        <p className="text-xs text-muted-foreground mt-0.5">{td('notary.urgency.sameDayHint')}</p>
                      )}
                    </div>
                  </label>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Consent — anonymous visitors never have a prior terms_accepted_at, so this
            always shows the checkbox (dashboard's termsAccepted === false branch),
            reusing the exact same legal consent copy/links. */}
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

        {/* Customer comment — customerComment is a {label, placeholder} object in
            messages/{locale}/order.json, so both sub-keys must be addressed explicitly. */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            {td('customerComment.label')}
          </label>
          <textarea
            value={customerComment}
            onChange={(e) => setCustomerComment(e.target.value.slice(0, 2000))}
            placeholder={td('customerComment.placeholder')}
            rows={3}
            maxLength={2000}
            className={`${inputClass} resize-none`}
          />
          {customerComment.length > 1800 && (
            <p className="text-xs text-muted-foreground text-right">{customerComment.length}/2000</p>
          )}
        </div>

        {/* Price hint — same static informational box as dashboard. */}
        <div className="rounded-md border border-white/10 bg-white/[0.02] px-4 py-3 text-xs text-muted-foreground">
          {serviceLevel === 'electronic' && td('priceHintElectronic')}
          {serviceLevel === 'official_with_translator_signature_and_provider_stamp' && td('priceHintOfficial')}
          {serviceLevel === 'notarization_through_partners' && td('priceHintNotarized')}
        </div>

        {/* Main CTA — must read "Загрузить документ" (dashboard's real upload button
            copy), never "Рассчитать стоимость". Internally this still creates the
            draft, uploads the file, and computes the price. */}
        <button type="button" onClick={() => void handleUploadDocument()} disabled={busy || !isFormValid}
          className="inline-flex w-fit items-center justify-center gap-2 rounded-md bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-gold-dark disabled:pointer-events-none disabled:opacity-50">
          {busy ? (
            <><Loader2 className="h-4 w-4 animate-spin" />…</>
          ) : (
            <><Upload className="h-4 w-4" />{td('uploadDocument')}</>
          )}
        </button>
      </div>
    </div>
  );
}
