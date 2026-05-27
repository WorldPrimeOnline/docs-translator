'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import * as Sentry from '@sentry/nextjs';

export default function LocaleError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations('errors');

  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-2xl font-bold">{t('somethingWrong')}</h1>
      <p className="max-w-sm text-sm text-muted-foreground">{t('errorDesc')}</p>
      <div className="flex gap-3">
        <button
          onClick={reset}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-gold-dark"
        >
          {t('tryAgain')}
        </button>
        <Link
          href="/dashboard"
          className="rounded-md border border-white/15 bg-white/5 px-4 py-2 text-sm font-medium text-foreground hover:bg-white/10"
        >
          {t('goToDashboard')}
        </Link>
      </div>
    </div>
  );
}
