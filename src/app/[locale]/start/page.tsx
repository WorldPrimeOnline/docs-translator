import { setRequestLocale } from 'next-intl/server';
import { OrderWizard } from '@/components/order/OrderWizard';

export default async function StartPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  return <OrderWizard />;
}
