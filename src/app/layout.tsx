import type { Metadata } from 'next';
import { Cormorant_Garamond, Geist_Mono, Inter } from 'next/font/google';
import { headers } from 'next/headers';
import { DEFAULT_LOCALE } from '@/i18n/locales';
import { buildFallbackMetadata } from '@/lib/seo/site-metadata';
import './globals.css';

const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin', 'latin-ext', 'cyrillic'],
});

const cormorant = Cormorant_Garamond({
  variable: '--font-cormorant',
  subsets: ['latin', 'latin-ext', 'cyrillic'],
  weight: ['400', '500', '600', '700'],
});

const geistMono = Geist_Mono({
  variable: '--font-mono',
  subsets: ['latin'],
});

/**
 * Locale-aware fallback for routes with no generateMetadata of their own.
 * next-intl middleware sets x-next-intl-locale, mirrored below in <html lang>.
 */
export async function generateMetadata(): Promise<Metadata> {
  const headersList = await headers();
  const locale = headersList.get('x-next-intl-locale') ?? DEFAULT_LOCALE;
  return buildFallbackMetadata(locale);
}

const IS_STAGING = process.env.NEXT_PUBLIC_APP_ENV === 'staging';

/**
 * Minimal root layout — only provides <html>/<body> wrappers.
 * Navbar, Footer, Toaster, and NextIntlClientProvider live in [locale]/layout.tsx.
 */
export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // next-intl middleware sets x-next-intl-locale so we can reflect it in <html lang>
  const headersList = await headers();
  const locale = headersList.get('x-next-intl-locale') ?? DEFAULT_LOCALE;

  return (
    <html lang={locale} suppressHydrationWarning>
      <body className={`${inter.variable} ${cormorant.variable} ${geistMono.variable} antialiased`}>
        {IS_STAGING && (
          <div
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              zIndex: 9999,
              background: '#b45309',
              color: '#fff',
              textAlign: 'center',
              fontSize: '12px',
              fontWeight: 600,
              letterSpacing: '0.08em',
              padding: '4px 0',
              pointerEvents: 'none',
            }}
          >
            STAGING MODE — test environment
          </div>
        )}
        {children}
      </body>
    </html>
  );
}
