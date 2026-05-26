import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Toaster } from '@/components/ui/sonner';
import { Navbar } from '@/components/navbar';
import { WpoLogo } from '@/components/wpo-logo';
import Link from 'next/link';
import { routing } from '@/i18n/routing';

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

  return (
    <NextIntlClientProvider messages={messages}>
      <Navbar />
      {children}
      <footer className="border-t border-white/8 bg-navy">
        <div className="mx-auto max-w-6xl px-4 py-10">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex flex-col gap-1.5">
              <WpoLogo size="sm" />
              <p className="text-xs text-muted-foreground">{tFooter('tagline')}</p>
            </div>
            <nav className="flex gap-6 text-sm text-muted-foreground">
              <Link href="/tos" className="transition-colors hover:text-foreground">
                {tFooter('tos')}
              </Link>
              <Link href="/privacy" className="transition-colors hover:text-foreground">
                {tFooter('privacy')}
              </Link>
            </nav>
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
