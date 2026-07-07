import { Suspense } from 'react';
import { setRequestLocale } from 'next-intl/server';
import { CheckoutClient } from '@/components/order/CheckoutClient';

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
