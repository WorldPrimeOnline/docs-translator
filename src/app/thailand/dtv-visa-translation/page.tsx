import type { Metadata } from 'next';
import { LandingPage } from '@/components/landing/LandingPage';
import { thailandDtvConfig } from '@/lib/landing-pages/thailand';

export const metadata: Metadata = {
  title: thailandDtvConfig.title,
  description: thailandDtvConfig.description,
};

export default function ThailandDtvPage() {
  return <LandingPage config={thailandDtvConfig} />;
}
