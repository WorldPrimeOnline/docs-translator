import { setRequestLocale } from 'next-intl/server';
import { OrderWizard } from '@/components/order/OrderWizard';

export default async function StartPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <div className="bg-background px-4 py-12 lg:py-16">
      <OrderWizard />
    </div>
  );
}
