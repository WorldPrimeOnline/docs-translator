import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Toaster } from '@/components/ui/sonner';
import { Navbar } from '@/components/navbar';
import { WpoLogo } from '@/components/wpo-logo';
import { Link } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';
import { PaymentComplianceBlock } from '@/components/payment/PaymentComplianceBlock';
import { BUSINESS_PROFILE } from '@/lib/business-profile';

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  if (!routing.locales.includes(locale as (typeof routing.locales)[number])) {
    notFound();
  }

  // Enable static rendering for all locales
  setRequestLocale(locale);

  const messages = await getMessages();
  const tFooter = await getTranslations('footer');
  const tLegal = await getTranslations('legal');
  const tContacts = await getTranslations('contactsPage');

  return (
    <NextIntlClientProvider messages={messages}>
      <Navbar />
      {children}
      <footer className="border-t border-white/8 bg-navy">
        <div className="mx-auto max-w-6xl px-4 py-10">
          {/* Top row: brand + legal links */}
          <div className="flex flex-col gap-8 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex flex-col gap-1.5">
              <WpoLogo size="sm" />
              <p className="text-xs text-muted-foreground">{tFooter('tagline')}</p>
              {/* Provider identification — required for Halyk Bank internet acquiring */}
              <div className="mt-2 flex flex-col gap-0.5 text-xs text-muted-foreground/70">
                <span className="font-medium text-muted-foreground/90">{BUSINESS_PROFILE.legalName}</span>
                <a href={`mailto:${BUSINESS_PROFILE.email}`} className="hover:text-foreground transition-colors">
                  {BUSINESS_PROFILE.email}
                </a>
                <Link href="/contacts" className="text-primary/70 hover:text-primary transition-colors">
                  {tContacts('title')} →
                </Link>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground/60">
                {tLegal('footerHeading')}
              </p>
              <nav className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm text-muted-foreground sm:grid-cols-1">
                <Link href="/legal/offer" className="transition-colors hover:text-foreground">
                  {tLegal('offer')}
                </Link>
                <Link href="/legal/privacy" className="transition-colors hover:text-foreground">
                  {tLegal('privacy')}
                </Link>
                <Link href="/legal/personal-data-consent" className="transition-colors hover:text-foreground">
                  {tLegal('personalData')}
                </Link>
                <Link href="/legal/refund-policy" className="transition-colors hover:text-foreground">
                  {tLegal('refund')}
                </Link>
                <Link href="/legal/disclaimer" className="transition-colors hover:text-foreground">
                  {tLegal('disclaimer')}
                </Link>
                <Link href="/legal/terms" className="transition-colors hover:text-foreground">
                  {tLegal('terms')}
                </Link>
                <Link href="/legal/partners" className="transition-colors hover:text-foreground">
                  {tLegal('partners')}
                </Link>
                <Link href="/contacts" className="transition-colors hover:text-foreground">
                  {tFooter('contacts')}
                </Link>
              </nav>
            </div>
          </div>

          {/* Payment compliance — Halyk ePay, Visa, Mastercard, 3D Secure */}
          <div className="mt-8">
            <PaymentComplianceBlock />
          </div>

          <div className="mt-6 border-t border-white/10 pt-6 text-center text-xs text-muted-foreground">
            <span>© 2026 WorldPrime Online. All rights reserved.</span>
          </div>
        </div>
      </footer>
      <Toaster position="bottom-right" richColors />
    </NextIntlClientProvider>
  );
}
