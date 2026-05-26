import {
  Zap,
  Lock,
  BadgeDollarSign,
  Coins,
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
    desc: 'Pay securely with TON cryptocurrency. Receive a clean translated PDF in 2–5 minutes.',
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
    icon: Coins,
    title: 'TON blockchain payment',
    desc: 'Pay with TON cryptocurrency — no bank card required. Instant, borderless, trustless.',
  },
  {
    icon: Lock,
    title: 'Files deleted after 30 days',
    desc: 'Your documents are stored securely and permanently deleted after 30 days.',
  },
];

export const defaultPricingTiers: PricingTier[] = [
  {
    name: 'Passport & ID',
    price: '$4.39',
    features: [
      'Passport, ID card, driver\'s license',
      'Translation by Claude Sonnet AI',
      'Clean PDF output',
      'Delivery in 2–5 minutes',
      '10+ language pairs',
    ],
    cta: 'Translate Now',
    highlighted: true,
  },
  {
    name: 'All Other Documents',
    price: '$4.99',
    features: [
      'Diplomas, transcripts, contracts',
      'Bank statements, medical records',
      'Translation by Claude Sonnet AI',
      'Clean PDF output',
      'Delivery in 2–5 minutes',
    ],
    cta: 'Translate Now',
  },
];

export const defaultPricingFootnote =
  'All prices in USD · Paid via TON cryptocurrency · No subscription · No hidden fees';
