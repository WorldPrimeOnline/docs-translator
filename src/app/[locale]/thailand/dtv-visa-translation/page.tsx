import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { LandingPage } from '@/components/landing/LandingPage';
import { thailandDtvConfig } from '@/lib/landing-pages/thailand';

export const metadata: Metadata = {
  title: thailandDtvConfig.title,
  description: thailandDtvConfig.description,
};

export default async function ThailandDtvPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <LandingPage config={thailandDtvConfig} />;
}
