import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { headers } from 'next/headers';
import './globals.css';

const geistSans = Geist({
  variable: '--font-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'WPO Translations — AI Document Translation',
  description:
    'AI-powered document translation. Upload a scanned PDF and receive a translated version in minutes — passports, diplomas, contracts, bank statements and more.',
};

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
  const locale = headersList.get('x-next-intl-locale') ?? 'en';

  return (
    <html lang={locale} suppressHydrationWarning>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
