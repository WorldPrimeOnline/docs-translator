'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { PARTNER_TYPES, type PartnerType } from '@/lib/partners/schema';
import { loadReferralParams } from '@/lib/referral/capture';

const TYPE_KEYS: Record<PartnerType, string> = {
  translator:            'typeTranslator',
  notary:                'typeNotary',
  agency:                'typeAgency',
  visa_center:           'typeVisaCenter',
  migration_consultant:  'typeMigrationConsultant',
  education_agency:      'typeEducationAgency',
  legal_firm:            'typeLegalFirm',
  corporate:             'typeCorporate',
  other:                 'typeOther',
};

interface FormState {
  partnerType: PartnerType | '';
  name: string;
  email: string;
  phone: string;
  organization: string;
  message: string;
}

const INITIAL: FormState = {
  partnerType: '',
  name: '',
  email: '',
  phone: '',
  organization: '',
  message: '',
};

export function PartnerApplicationForm() {
  const t = useTranslations('partnersPage.form');
  const [form, setForm] = useState<FormState>(INITIAL);
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  function set(field: keyof FormState) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm((prev) => ({ ...prev, [field]: e.target.value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.partnerType) return;
    setStatus('submitting');
    setErrorMsg('');

    const referral = loadReferralParams();

    const payload = {
      partnerType: form.partnerType,
      name: form.name.trim(),
      email: form.email.trim(),
      phone: form.phone.trim() || undefined,
      organization: form.organization.trim() || undefined,
      message: form.message.trim() || undefined,
      refCode: referral?.refCode ?? undefined,
      utmSource: referral?.utmSource ?? undefined,
      utmMedium: referral?.utmMedium ?? undefined,
      utmCampaign: referral?.utmCampaign ?? undefined,
    };

    try {
      const res = await fetch('/api/partners/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        setStatus('success');
        setForm(INITIAL);
      } else {
        const body = await res.json().catch(() => ({})) as { error?: string };
        setErrorMsg(body.error ?? t('errorGeneric'));
        setStatus('error');
      }
    } catch {
      setErrorMsg(t('errorGeneric'));
      setStatus('error');
    }
  }

  if (status === 'success') {
    return (
      <div className="rounded-xl border border-green-500/20 bg-green-500/5 p-8 text-center">
        <p className="text-lg font-semibold text-foreground">{t('successTitle')}</p>
        <p className="mt-2 text-sm text-muted-foreground">{t('successMessage')}</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Partner type */}
      <div>
        <label className="mb-1.5 block text-sm font-medium text-foreground">
          {t('typeLabel')} <span className="text-destructive">*</span>
        </label>
        <select
          value={form.partnerType}
          onChange={set('partnerType')}
          required
          className="w-full rounded-lg border border-white/10 bg-background px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
        >
          <option value="" disabled>{t('typePlaceholder')}</option>
          {PARTNER_TYPES.map((type) => (
            <option key={type} value={type}>{t(TYPE_KEYS[type])}</option>
          ))}
        </select>
      </div>

      {/* Name */}
      <div>
        <label className="mb-1.5 block text-sm font-medium text-foreground">
          {t('nameLabel')} <span className="text-destructive">*</span>
        </label>
        <input
          type="text"
          value={form.name}
          onChange={set('name')}
          required
          minLength={2}
          maxLength={200}
          placeholder={t('namePlaceholder')}
          className="w-full rounded-lg border border-white/10 bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
        />
      </div>

      {/* Email */}
      <div>
        <label className="mb-1.5 block text-sm font-medium text-foreground">
          {t('emailLabel')} <span className="text-destructive">*</span>
        </label>
        <input
          type="email"
          value={form.email}
          onChange={set('email')}
          required
          maxLength={255}
          placeholder={t('emailPlaceholder')}
          className="w-full rounded-lg border border-white/10 bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
        />
      </div>

      {/* Phone (optional) */}
      <div>
        <label className="mb-1.5 block text-sm font-medium text-foreground">
          {t('phoneLabel')}
        </label>
        <input
          type="tel"
          value={form.phone}
          onChange={set('phone')}
          maxLength={50}
          placeholder={t('phonePlaceholder')}
          className="w-full rounded-lg border border-white/10 bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
        />
      </div>

      {/* Organization (optional) */}
      <div>
        <label className="mb-1.5 block text-sm font-medium text-foreground">
          {t('orgLabel')}
        </label>
        <input
          type="text"
          value={form.organization}
          onChange={set('organization')}
          maxLength={500}
          placeholder={t('orgPlaceholder')}
          className="w-full rounded-lg border border-white/10 bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
        />
      </div>

      {/* Message (optional) */}
      <div>
        <label className="mb-1.5 block text-sm font-medium text-foreground">
          {t('messageLabel')}
        </label>
        <textarea
          value={form.message}
          onChange={set('message')}
          maxLength={2000}
          rows={4}
          placeholder={t('messagePlaceholder')}
          className="w-full resize-none rounded-lg border border-white/10 bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
        />
      </div>

      {status === 'error' && (
        <p className="text-sm text-destructive">{errorMsg || t('errorGeneric')}</p>
      )}

      <button
        type="submit"
        disabled={status === 'submitting'}
        className="w-full rounded-lg bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {status === 'submitting' ? t('submitting') : t('submit')}
      </button>
    </form>
  );
}
