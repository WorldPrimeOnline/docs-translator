import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { Toaster } from '@/components/ui/sonner';
import { Navbar } from '@/components/navbar';
import { TonProvider } from '@/components/ton-provider';
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
  title: 'Docs Translator — AI Document Translation',
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
        <TonProvider>
        <Navbar />
        {children}
        <footer className="border-t bg-white">
          <div className="mx-auto max-w-6xl px-4 py-8">
            <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-between">
              <p className="text-sm text-muted-foreground">
                © 2026 Docs Translator. All rights reserved.
              </p>
              <nav className="flex gap-4 text-sm text-muted-foreground">
                <Link href="/tos" className="hover:text-foreground">
                  Terms of Service
                </Link>
                <Link href="/privacy" className="hover:text-foreground">
                  Privacy Policy
                </Link>
              </nav>
            </div>
            <p className="mt-4 text-center text-xs text-muted-foreground">
              Translations are for informational purposes only and are not certified or notarized.
            </p>
          </div>
        </footer>
        <Toaster position="bottom-right" richColors />
        </TonProvider>
      </body>
    </html>
  );
}
