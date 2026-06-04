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
          {/*
           * 3-column footer grid:
           *   Col 1 — brand + full provider identification (Halyk Bank requires visible company info)
           *   Col 2 — legal document links
           *   Col 3 — payment compliance (Halyk ePay, Visa, Mastercard, 3D Secure, VAT)
           */}
          <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 md:grid-cols-[2fr_1fr_1.5fr]">

            {/* ── Col 1: Brand + provider identification ─────────────────── */}
            <div className="flex flex-col gap-1.5">
              <WpoLogo size="sm" />
              <p className="text-xs text-muted-foreground">{tFooter('tagline')}</p>

              {/* Provider ID block — required for Halyk Bank internet acquiring */}
              <div className="mt-3 flex flex-col gap-1 text-xs text-muted-foreground/70">
                <span className="font-semibold text-muted-foreground/90">{BUSINESS_PROFILE.legalName}</span>
                <span className="text-muted-foreground/60">{BUSINESS_PROFILE.latinName}</span>
                <span>{tContacts('iinBinLabel')}: {BUSINESS_PROFILE.iinBin}</span>
                <a
                  href={`mailto:${BUSINESS_PROFILE.email}`}
                  className="transition-colors hover:text-foreground"
                >
                  {BUSINESS_PROFILE.email}
                </a>
                <span>{BUSINESS_PROFILE.phone}</span>
                {BUSINESS_PROFILE.legalAddress !== 'TODO: Юридический / почтовый адрес' && (
                  <span>{BUSINESS_PROFILE.legalAddress}</span>
                )}
                <Link href="/contacts" className="mt-1 text-primary/70 transition-colors hover:text-primary">
                  {tContacts('title')} →
                </Link>
              </div>
            </div>

            {/* ── Col 2: Legal document links ─────────────────────────────── */}
            <div className="flex flex-col gap-2">
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground/60">
                {tLegal('footerHeading')}
              </p>
              <nav className="flex flex-col gap-2 text-sm text-muted-foreground">
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
              </nav>
            </div>

            {/* ── Col 3: Payment compliance (inline, no detached second footer) */}
            <PaymentComplianceBlock variant="footer-column" />

          </div>

          <div className="mt-8 border-t border-white/10 pt-6 text-center text-xs text-muted-foreground">
            <span>© 2026 WorldPrime Online. All rights reserved.</span>
          </div>
        </div>
      </footer>
      <Toaster position="bottom-right" richColors />
    </NextIntlClientProvider>
  );
}
