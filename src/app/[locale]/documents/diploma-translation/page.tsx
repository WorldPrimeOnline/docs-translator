import type { Metadata } from 'next';
import { LandingPage } from '@/components/landing/LandingPage';
import { diplomaTranslationConfig } from '@/lib/landing-pages/documents';

export const metadata: Metadata = {
  title: diplomaTranslationConfig.title,
  description: diplomaTranslationConfig.description,
};

export default function DiplomaTranslationPage() {
  return <LandingPage config={diplomaTranslationConfig} />;
}
