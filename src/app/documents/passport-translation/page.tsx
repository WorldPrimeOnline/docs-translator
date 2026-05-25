import type { Metadata } from 'next';
import { LandingPage } from '@/components/landing/LandingPage';
import { passportTranslationConfig } from '@/lib/landing-pages/documents';

export const metadata: Metadata = {
  title: passportTranslationConfig.title,
  description: passportTranslationConfig.description,
};

export default function PassportTranslationPage() {
  return <LandingPage config={passportTranslationConfig} />;
}
