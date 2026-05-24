import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { Toaster } from '@/components/ui/sonner';
import { Navbar } from '@/components/navbar';
import { WpoLogo } from '@/components/wpo-logo';
import Link from 'next/link';
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <Navbar />
        {children}
        <footer className="border-t border-white/10 bg-navy">
          <div className="mx-auto max-w-6xl px-4 py-10">
            <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
              <WpoLogo size="sm" />
              <nav className="flex gap-6 text-sm text-muted-foreground">
                <Link href="/tos" className="transition-colors hover:text-foreground">
                  Terms of Service
                </Link>
                <Link href="/privacy" className="transition-colors hover:text-foreground">
                  Privacy Policy
                </Link>
              </nav>
            </div>
            <div className="mt-8 flex flex-col gap-1 border-t border-white/10 pt-6 text-center text-xs text-muted-foreground sm:flex-row sm:justify-between">
              <span>© 2026 WorldPrime Online. All rights reserved.</span>
              <span>Translations are for informational purposes only. Not certified or notarized.</span>
            </div>
          </div>
        </footer>
        <Toaster position="bottom-right" richColors />
      </body>
    </html>
  );
}
