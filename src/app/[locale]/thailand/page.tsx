import type { Metadata } from 'next';
import { LandingPage } from '@/components/landing/LandingPage';
import { thailandConfig } from '@/lib/landing-pages/thailand';

export const metadata: Metadata = {
  title: thailandConfig.title,
  description: thailandConfig.description,
};

export default function ThailandPage() {
  return <LandingPage config={thailandConfig} />;
}
