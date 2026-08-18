import { Suspense } from 'react';
import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { CheckoutClient } from '@/components/order/CheckoutClient';
import { NOINDEX_METADATA } from '@/lib/seo/site-metadata';

export const metadata: Metadata = NOINDEX_METADATA;

export default async function CheckoutPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <div className="bg-background px-4 py-12 lg:py-16">
      <Suspense fallback={null}>
        <CheckoutClient />
      </Suspense>
    </div>
  );
}
