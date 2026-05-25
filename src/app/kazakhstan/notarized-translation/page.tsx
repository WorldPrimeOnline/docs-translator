import type { Metadata } from 'next';
import { LandingPage } from '@/components/landing/LandingPage';
import { kazakhstanNotarizedConfig } from '@/lib/landing-pages/kazakhstan';

export const metadata: Metadata = {
  title: kazakhstanNotarizedConfig.title,
  description: kazakhstanNotarizedConfig.description,
};

export default function KazakhstanNotarizedPage() {
  return <LandingPage config={kazakhstanNotarizedConfig} />;
}
