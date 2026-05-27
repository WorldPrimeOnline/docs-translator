'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';

export default function LocaleNotFound() {
  const t = useTranslations('errors');

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-2xl font-bold">{t('notFound')}</h1>
      <p className="max-w-sm text-sm text-muted-foreground">{t('notFoundDesc')}</p>
      <Link
        href="/"
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-gold-dark"
      >
        {t('goHome')}
      </Link>
    </div>
  );
}
