import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { LandingPage } from '@/components/landing/LandingPage';
import { diplomaTranslationConfig } from '@/lib/landing-pages/documents';

export const metadata: Metadata = {
  title: diplomaTranslationConfig.title,
  description: diplomaTranslationConfig.description,
};

export default async function DiplomaTranslationPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <LandingPage config={diplomaTranslationConfig} />;
}
