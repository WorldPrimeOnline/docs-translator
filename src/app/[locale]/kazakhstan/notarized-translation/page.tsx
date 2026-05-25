import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { LandingPage } from '@/components/landing/LandingPage';
import { kazakhstanNotarizedConfig } from '@/lib/landing-pages/kazakhstan';

export const metadata: Metadata = {
  title: kazakhstanNotarizedConfig.title,
  description: kazakhstanNotarizedConfig.description,
};

export default async function KazakhstanNotarizedPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <LandingPage config={kazakhstanNotarizedConfig} />;
}
