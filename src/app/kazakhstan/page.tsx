import type { Metadata } from 'next';
import { LandingPage } from '@/components/landing/LandingPage';
import { kazakhstanConfig } from '@/lib/landing-pages/kazakhstan';

export const metadata: Metadata = {
  title: kazakhstanConfig.title,
  description: kazakhstanConfig.description,
};

export default function KazakhstanPage() {
  return <LandingPage config={kazakhstanConfig} />;
}
