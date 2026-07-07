'use client';

import { useCallback, useRef, useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Upload, FileText, FileImage, FileCode2, X, Loader2, ArrowRight } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
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

  const LANGUAGES = [
    { value: 'ru', label: td('langs.ru') }, { value: 'en', label: td('langs.en') },
    { value: 'kk', label: td('langs.kk') }, { value: 'th', label: td('langs.th') },
    { value: 'zh', label: td('langs.zh') }, { value: 'ko', label: td('langs.ko') },
    { value: 'de', label: td('langs.de') }, { value: 'es', label: td('langs.es') },
    { value: 'uz', label: td('langs.uz') }, { value: 'tr', label: td('langs.tr') },
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

  function fileIcon(f: File) {
    if (f.type === 'application/pdf') return <FileText className="h-4 w-4 shrink-0 text-red-400" />;
    if (f.type.startsWith('image/')) return <FileImage className="h-4 w-4 shrink-0 text-blue-400" />;
    return <FileCode2 className="h-4 w-4 shrink-0 text-green-400" />;
  }

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

  const handleCalculate = async (): Promise<void> => {
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

  return (
    <div className="mx-auto max-w-2xl rounded-lg border border-white/10 bg-card p-6">
      <h2 className="mb-1 text-lg font-semibold text-foreground">{t('pageTitle')}</h2>
      <p className="mb-5 text-sm text-muted-foreground">{t('pageSubtitle')}</p>

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
          <p className="text-sm font-medium text-foreground">{t('dropzoneCta')}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t('dropzoneHint')}</p>
        </div>

        {files.length > 0 && (
          <div className="rounded-md border border-white/10 bg-white/[0.02] overflow-hidden">
            {files.map((f, i) => (
              <div key={i} className="flex items-center gap-3 px-3 py-2 border-b border-white/5 last:border-b-0">
                {fileIcon(f)}
                <span className="flex-1 truncate text-xs text-foreground">{f.name}</span>
                <button type="button" onClick={(e) => { e.stopPropagation(); setFiles((p) => p.filter((_, j) => j !== i)); }}
                  className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground hover:bg-white/10 transition-colors">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

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
          {serviceLevel === 'electronic' && (
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{td('outputFormat')}</label>
              <select value={outputFormat} onChange={(e) => setOutputFormat(e.target.value as 'html' | 'docx')} className={selectClass}>
                <option value="docx">{td('formatDocx')}</option>
                <option value="html">{td('formatHtml')}</option>
              </select>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{td('serviceLevel.label')}</p>
          <div className="flex flex-col gap-2">
            <ServiceLevelCard value="electronic" current={serviceLevel} label={td('serviceLevel.electronic.label')} description={td('serviceLevel.electronic.desc')} onChange={handleServiceLevelChange} />
            <ServiceLevelCard value="official_with_translator_signature_and_provider_stamp" current={serviceLevel} label={td('serviceLevel.certified.label')} description={td('serviceLevel.certified.desc')} onChange={handleServiceLevelChange} />
            <ServiceLevelCard value="notarization_through_partners" current={serviceLevel} label={td('serviceLevel.notarization.label')} description={td('serviceLevel.notarization.desc')} onChange={handleServiceLevelChange} />
          </div>
        </div>

        {isNotarization && (
          <div className="flex flex-col gap-4 rounded-lg border border-white/10 bg-white/[0.02] p-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{td('notary.city')} <span className="text-red-400">*</span></label>
              <select value={notaryCity} onChange={(e) => setNotaryCity(e.target.value)} className={selectClass} required>
                <option value="">{td('notary.cityPlaceholder')}</option>
                {NOTARY_CITIES.map((c) => <option key={c.value} value={c.value}>{c.label[locale] ?? c.label['en'] ?? c.value}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{td('notary.fulfillment')} <span className="text-red-400">*</span></p>
              <div className="flex gap-2">
                {(['pickup', 'delivery'] as FulfillmentMethod[]).map((method) => (
                  <button key={method} type="button" onClick={() => { setFulfillmentMethod(method); if (method === 'pickup') { setDeliveryPhone(''); setDeliveryAddress(''); } }}
                    className={`flex flex-1 items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-sm transition-all duration-150 ${fulfillmentMethod === method ? 'border-primary/40 bg-primary/5 text-foreground font-medium' : 'border-white/10 bg-transparent text-muted-foreground hover:border-white/20 hover:text-foreground'}`}>
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
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{td('notary.address')} <span className="text-red-400">*</span></label>
                  <textarea value={deliveryAddress} onChange={(e) => setDeliveryAddress(e.target.value)} placeholder={td('notary.addressPlaceholder')} className={`${inputClass} min-h-[80px] resize-none`} required={isDelivery} rows={3} autoComplete="off" />
                </div>
              </div>
            )}
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{td('customerComment')}</label>
          <textarea value={customerComment} onChange={(e) => setCustomerComment(e.target.value)} className={`${inputClass} min-h-[60px] resize-none`} rows={2} />
        </div>

        <label className="flex items-start gap-2.5 text-xs text-muted-foreground">
          <input type="checkbox" checked={consentChecked} onChange={(e) => setConsentChecked(e.target.checked)} className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-white/20" />
          {t('consentText')}
        </label>

        <button
          type="button"
          onClick={() => void handleCalculate()}
          disabled={!isFormValid || busy}
          className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-gold-dark disabled:pointer-events-none disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {busy ? t('calculating') : t('calculateButton')}
        </button>
      </div>
    </div>
  );
}
