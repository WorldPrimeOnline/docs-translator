import {
  Zap,
  Lock,
  BadgeDollarSign,
  CreditCard,
} from 'lucide-react';
import type { HowItWorksStep, TrustItem, PricingTier } from './types';

export const defaultHowItWorksSteps: HowItWorksStep[] = [
  {
    n: '01',
    title: 'Upload your PDF',
    desc: 'Scanned or digital PDF, up to 25 MB and 50 pages. Any official document accepted.',
  },
  {
    n: '02',
    title: 'Choose language and document type',
    desc: 'Select source and target languages, then choose the document type for the best output.',
  },
  {
    n: '03',
    title: 'Pay and receive your translation',
    desc: 'Pay securely online. Receive a clean translated PDF in 2–5 minutes.',
  },
];

export const defaultTrustItems: TrustItem[] = [
  {
    icon: Zap,
    title: '2–5 minute delivery',
    desc: 'Most documents are ready in under 5 minutes. No waiting for an agency to reply.',
  },
  {
    icon: BadgeDollarSign,
    title: 'From $4.39 per document',
    desc: 'Up to 3× cheaper than traditional translation bureaus. No subscription required.',
  },
  {
    icon: CreditCard,
    title: 'Secure online payment',
    desc: 'Pay via available payment methods. Instant processing, no hidden fees.',
  },
  {
    icon: Lock,
    title: 'Files deleted after 30 days',
    desc: 'Your documents are stored securely and permanently deleted after 30 days.',
  },
];

// Tier IDs correspond to keys in the pricing.tiers namespace.
// PricingSection resolves all display text (title, price, unit, features, cta)
// from getTranslations('pricing') using these IDs.
export const defaultPricingTiers: PricingTier[] = [
  { id: 'electronic' },
  { id: 'agentStamp', highlighted: true },
  { id: 'notarized' },
];

export const defaultPricingFootnote = 'allPricesNote';
