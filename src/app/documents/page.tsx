import type { Metadata } from 'next';
import Link from 'next/link';
import { HeroSection } from '@/components/landing/HeroSection';
import { HowItWorksSection } from '@/components/landing/HowItWorksSection';
import { TrustSection } from '@/components/landing/TrustSection';
import { PricingSection } from '@/components/landing/PricingSection';
import { FAQSection } from '@/components/landing/FAQSection';
import { FinalCTASection } from '@/components/landing/FinalCTASection';
import { documentsHubConfig } from '@/lib/landing-pages/documents';
import {
  IdCard,
  Landmark,
  GraduationCap,
  FileHeart,
  Briefcase,
  HeartPulse,
  Shield,
  Car,
  FileText,
} from 'lucide-react';

export const metadata: Metadata = {
  title: documentsHubConfig.title,
  description: documentsHubConfig.description,
};

const DOCUMENT_LINKS = [
  { icon: IdCard, name: 'Passport & ID Card', href: '/documents/passport-translation', price: '$4.39' },
  { icon: Landmark, name: 'Bank Statement', href: '/documents/bank-statement-translation', price: '$4.99' },
  { icon: GraduationCap, name: 'Diploma & Transcript', href: '/documents/diploma-translation', price: '$4.99' },
  { icon: FileHeart, name: 'Birth & Marriage Certificate', href: '/auth/signup', price: '$4.99' },
  { icon: Briefcase, name: 'Employment Contract', href: '/auth/signup', price: '$4.99' },
  { icon: HeartPulse, name: 'Medical Certificate', href: '/auth/signup', price: '$4.99' },
  { icon: Shield, name: 'Police Clearance', href: '/auth/signup', price: '$4.99' },
  { icon: Car, name: "Driver's License", href: '/auth/signup', price: '$4.39' },
  { icon: FileText, name: 'Other Official Document', href: '/auth/signup', price: '$4.99' },
];

export default function DocumentsHubPage() {
  const c = documentsHubConfig;
  return (
    <div className="bg-background">
      <HeroSection {...c.hero} />

      <HowItWorksSection steps={c.howItWorks!.steps} />

      {/* Document type grid with links */}
      <section id="documents" className="px-4 py-20">
        <div className="mx-auto max-w-6xl">
          <div className="mb-12 text-center">
            <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-primary">
              Document Types
            </p>
            <h2 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              Choose your document type
            </h2>
            <p className="mt-3 text-sm text-muted-foreground">
              Some document types have dedicated pages with specific guidance
            </p>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {DOCUMENT_LINKS.map(({ icon: Icon, name, href, price }) => (
              <Link
                key={name}
                href={href}
                className="flex items-center justify-between rounded-lg border border-white/8 bg-card p-4 transition-colors hover:border-white/20 hover:bg-card/80"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10">
                    <Icon className="h-4 w-4 text-primary" />
                  </div>
                  <span className="text-sm font-medium text-foreground">{name}</span>
                </div>
                <span className="ml-2 shrink-0 text-xs font-semibold text-primary">{price}</span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {c.trust && <TrustSection {...c.trust} />}
      {c.pricing && <PricingSection {...c.pricing} />}
      {c.faq && <FAQSection {...c.faq} />}
      {c.finalCta && <FinalCTASection {...c.finalCta} ctaHref={c.hero.ctaHref} />}
    </div>
  );
}
