import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { Metadata } from 'next';
import Image from 'next/image';
import { BUSINESS_PROFILE } from '@/lib/business-profile';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('contactsPage');
  return {
    title: t('metaTitle'),
    description: t('metaDescription'),
  };
}

export default async function ContactsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('contactsPage');

  return (
    <div className="mx-auto max-w-2xl px-4 py-16">
      <h1 className="mb-2 text-2xl font-bold text-foreground">{t('title')}</h1>
      <p className="mb-10 text-sm text-muted-foreground">{t('disputesNote')}</p>

      {/* Provider identification */}
      <div className="rounded-lg border border-white/10 bg-card p-6">
        <div className="mb-6 flex justify-center">
          <Image
            src="/logo/logo.png"
            alt="World Prime Online"
            width={220}
            height={110}
            style={{ objectFit: 'contain' }}
          />
        </div>
        <h2 className="mb-5 text-base font-semibold text-foreground font-[family-name:var(--font-inter)]">{t('providerHeading')}</h2>
        <dl className="grid gap-4">
          <div className="grid grid-cols-[1fr_2fr] gap-3 text-sm sm:grid-cols-[180px_1fr]">
            <dt className="text-muted-foreground">{t('legalNameLabel')}</dt>
            <dd className="font-medium text-foreground">{BUSINESS_PROFILE.legalName}</dd>
          </div>
          <div className="grid grid-cols-[1fr_2fr] gap-3 text-sm sm:grid-cols-[180px_1fr]">
            <dt className="text-muted-foreground">{t('iinBinLabel')}</dt>
            <dd className="font-medium text-foreground">{BUSINESS_PROFILE.iinBin}</dd>
          </div>
          <div className="grid grid-cols-[1fr_2fr] gap-3 text-sm sm:grid-cols-[180px_1fr]">
            <dt className="text-muted-foreground">{t('addressLabel')}</dt>
            <dd className="font-medium text-foreground">{BUSINESS_PROFILE.legalAddress}</dd>
          </div>
          <div className="grid grid-cols-[1fr_2fr] gap-3 text-sm sm:grid-cols-[180px_1fr]">
            <dt className="text-muted-foreground">{t('phoneLabel')}</dt>
            <dd className="font-medium text-foreground">{BUSINESS_PROFILE.phone}</dd>
          </div>
          <div className="grid grid-cols-[1fr_2fr] gap-3 text-sm sm:grid-cols-[180px_1fr]">
            <dt className="text-muted-foreground">{t('emailLabel')}</dt>
            <dd>
              <a
                href={`mailto:${BUSINESS_PROFILE.email}`}
                className="font-medium text-primary hover:underline"
              >
                {BUSINESS_PROFILE.email}
              </a>
            </dd>
          </div>
          <div className="grid grid-cols-[1fr_2fr] gap-3 text-sm sm:grid-cols-[180px_1fr]">
            <dt className="text-muted-foreground">{t('websiteLabel')}</dt>
            <dd>
              <a
                href={BUSINESS_PROFILE.website}
                className="font-medium text-primary hover:underline"
              >
                {BUSINESS_PROFILE.website}
              </a>
            </dd>
          </div>
        </dl>
      </div>

    </div>
  );
}
