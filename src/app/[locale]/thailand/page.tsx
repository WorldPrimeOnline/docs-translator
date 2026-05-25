import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { LandingPage } from '@/components/landing/LandingPage';
import { thailandConfig } from '@/lib/landing-pages/thailand';

export const metadata: Metadata = {
  title: thailandConfig.title,
  description: thailandConfig.description,
};

export default async function ThailandPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <LandingPage config={thailandConfig} />;
}
