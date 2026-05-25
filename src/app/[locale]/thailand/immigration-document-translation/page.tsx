import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { LandingPage } from '@/components/landing/LandingPage';
import { thailandImmigrationConfig } from '@/lib/landing-pages/thailand';

export const metadata: Metadata = {
  title: thailandImmigrationConfig.title,
  description: thailandImmigrationConfig.description,
};

export default async function ThailandImmigrationPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <LandingPage config={thailandImmigrationConfig} />;
}
