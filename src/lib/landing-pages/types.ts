import type { LucideIcon } from 'lucide-react';

export interface FAQ {
  q: string;
  a: string;
}

export interface PainPoint {
  title: string;
  desc: string;
}

export interface SupportedDoc {
  icon: LucideIcon;
  name: string;
}

export interface HowItWorksStep {
  n: string;
  title: string;
  desc: string;
}

export interface TrustItem {
  icon: LucideIcon;
  title: string;
  desc: string;
}

export interface PricingTier {
  name: string;
  price: string;
  features: string[];
  cta: string;
  highlighted?: boolean;
}

export interface BreadcrumbItem {
  label: string;
  href: string;
}

export interface LandingPageConfig {
  // SEO
  title: string;
  description: string;

  // Breadcrumb navigation
  breadcrumb?: BreadcrumbItem[];

  // Hero
  hero: {
    badge?: string;
    headline: string;
    accentLine?: string;
    subheadline: string;
    ctaLabel: string;
    ctaHref: string;
    ctaSecondaryLabel?: string;
    ctaSecondaryHref?: string;
    trustLine?: string;
  };

  // How it works (optional — default used if omitted)
  howItWorks?: {
    headline?: string;
    steps: HowItWorksStep[];
  };

  // Supported documents
  docs?: {
    headline: string;
    subheadline?: string;
    items: SupportedDoc[];
  };

  // Pain points
  pain?: {
    headline: string;
    points: PainPoint[];
  };

  // Trust + disclaimer
  trust?: {
    headline?: string;
    items: TrustItem[];
    disclaimer: string;
  };

  // Pricing
  pricing?: {
    headline: string;
    subheadline?: string;
    tiers: PricingTier[];
    footnote?: string;
  };

  // FAQ
  faq?: {
    headline?: string;
    items: FAQ[];
  };

  // Final CTA
  finalCta?: {
    headline: string;
    sub?: string;
    cta: string;
  };

  // SEO prose block
  seoContent?: {
    headline?: string;
    paragraphs: string[];
  };

  // JSON-LD structured data objects
  structuredData?: Record<string, unknown>[];
}
