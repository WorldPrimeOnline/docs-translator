import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { LandingPage } from '@/components/landing/LandingPage';
import { kazakhstanConfig } from '@/lib/landing-pages/kazakhstan';

export const metadata: Metadata = {
  title: kazakhstanConfig.title,
  description: kazakhstanConfig.description,
};

export default async function KazakhstanPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <LandingPage config={kazakhstanConfig} />;
}
