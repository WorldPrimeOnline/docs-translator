import type { Metadata } from 'next';
import { LandingPage } from '@/components/landing/LandingPage';
import { bankStatementTranslationConfig } from '@/lib/landing-pages/documents';

export const metadata: Metadata = {
  title: bankStatementTranslationConfig.title,
  description: bankStatementTranslationConfig.description,
};

export default function BankStatementTranslationPage() {
  return <LandingPage config={bankStatementTranslationConfig} />;
}
