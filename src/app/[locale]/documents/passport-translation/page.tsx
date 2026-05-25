import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { LandingPage } from '@/components/landing/LandingPage';
import { passportTranslationConfig } from '@/lib/landing-pages/documents';

export const metadata: Metadata = {
  title: passportTranslationConfig.title,
  description: passportTranslationConfig.description,
};

export default async function PassportTranslationPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <LandingPage config={passportTranslationConfig} />;
}
