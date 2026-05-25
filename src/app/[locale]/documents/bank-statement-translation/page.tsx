import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { LandingPage } from '@/components/landing/LandingPage';
import { bankStatementTranslationConfig } from '@/lib/landing-pages/documents';

export const metadata: Metadata = {
  title: bankStatementTranslationConfig.title,
  description: bankStatementTranslationConfig.description,
};

export default async function BankStatementTranslationPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <LandingPage config={bankStatementTranslationConfig} />;
}
