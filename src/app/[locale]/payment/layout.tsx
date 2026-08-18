import type { Metadata } from 'next';
import { NOINDEX_METADATA } from '@/lib/seo/site-metadata';

// payment/result/page.tsx is 'use client', so it cannot export `metadata` itself —
// this thin layout exists only to carry it. Pure pass-through (no wrapper markup):
// the page already manages its own full-screen container per render state, and a
// wrapping div here would double-nest it.
export const metadata: Metadata = NOINDEX_METADATA;

export default function PaymentLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
