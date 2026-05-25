import type { Metadata } from 'next';
import { LandingPage } from '@/components/landing/LandingPage';
import { thailandImmigrationConfig } from '@/lib/landing-pages/thailand';

export const metadata: Metadata = {
  title: thailandImmigrationConfig.title,
  description: thailandImmigrationConfig.description,
};

export default function ThailandImmigrationPage() {
  return <LandingPage config={thailandImmigrationConfig} />;
}
