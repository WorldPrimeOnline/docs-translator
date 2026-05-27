import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import type { Metadata } from 'next';
import { routing } from '@/i18n/routing';
import type { Locale } from '@/i18n/routing';
import { getLegalDocument, LEGAL_SLUGS } from '@/lib/legal';
import type { LegalSlug } from '@/lib/legal';
import { LegalPageLayout } from '@/components/legal/LegalPageLayout';

interface Props {
  params: Promise<{ locale: string; slug: string }>;
}

export function generateStaticParams() {
  const params: { locale: string; slug: string }[] = [];
  for (const locale of routing.locales) {
    for (const slug of LEGAL_SLUGS) {
      params.push({ locale, slug });
    }
  }
  return params;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;

  if (!routing.locales.includes(locale as Locale)) return {};

  const doc = await getLegalDocument(locale as Locale, slug as LegalSlug);
  if (!doc) return {};

  return {
    title: doc.metaTitle,
    description: doc.metaDescription,
  };
}

export default async function LegalPage({ params }: Props) {
  const { locale, slug } = await params;

  if (!routing.locales.includes(locale as Locale)) notFound();

  setRequestLocale(locale);

  if (!LEGAL_SLUGS.includes(slug as LegalSlug)) notFound();

  const doc = await getLegalDocument(locale as Locale, slug as LegalSlug);
  if (!doc) notFound();

  return <LegalPageLayout doc={doc} />;
}
