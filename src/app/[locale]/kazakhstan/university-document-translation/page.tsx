import type { Metadata } from 'next';
import { LandingPage } from '@/components/landing/LandingPage';
import { kazakhstanUniversityConfig } from '@/lib/landing-pages/kazakhstan';

export const metadata: Metadata = {
  title: kazakhstanUniversityConfig.title,
  description: kazakhstanUniversityConfig.description,
};

export default function KazakhstanUniversityPage() {
  return <LandingPage config={kazakhstanUniversityConfig} />;
}
