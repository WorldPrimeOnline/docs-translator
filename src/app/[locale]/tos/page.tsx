import type { Metadata } from 'next';
import { setRequestLocale, getTranslations } from 'next-intl/server';

export const metadata: Metadata = {
  title: 'Terms of Service — WPO Translations',
};

export default async function TermsOfService({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('tos');

  return (
    <div className="mx-auto max-w-3xl px-4 py-16">
      <h1 className="mb-2 text-3xl font-bold tracking-tight">{t('title')}</h1>
      <p className="mb-10 text-sm text-muted-foreground">{t('lastUpdated')}</p>

      <div className="prose prose-slate max-w-none space-y-8 text-sm leading-relaxed text-foreground">
        <section>
          <h2 className="mb-3 text-xl font-semibold">{t('s1')}</h2>
          <p className="text-muted-foreground">
            {t.rich('s1Body', { b: (chunks) => <strong>{chunks}</strong> })}
          </p>
          <p className="mt-3 text-muted-foreground">{t('s1Body2')}</p>
        </section>

        <section>
          <h2 className="mb-3 text-xl font-semibold">{t('s2')}</h2>
          <p className="text-muted-foreground">{t('s2Body')}</p>
        </section>

        <section>
          <h2 className="mb-3 text-xl font-semibold">{t('s3')}</h2>
          <p className="text-muted-foreground">{t('s3Body')}</p>
          <p className="mt-3 text-muted-foreground">
            {t.rich('s3Body2', { b: (chunks) => <strong>{chunks}</strong> })}
          </p>
        </section>

        <section>
          <h2 className="mb-3 text-xl font-semibold">{t('s4')}</h2>
          <p className="text-muted-foreground">
            {t.rich('s4Body', { b: (chunks) => <strong>{chunks}</strong> })}
          </p>
        </section>

        <section>
          <h2 className="mb-3 text-xl font-semibold">{t('s5')}</h2>
          <p className="text-muted-foreground">{t('s5Intro')}</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
            <li>{t('s5Item1')}</li>
            <li>{t('s5Item2')}</li>
            <li>{t('s5Item3')}</li>
            <li>{t('s5Item4')}</li>
          </ul>
        </section>

        <section>
          <h2 className="mb-3 text-xl font-semibold">{t('s6')}</h2>
          <p className="text-muted-foreground">{t('s6Body')}</p>
        </section>

        <section>
          <h2 className="mb-3 text-xl font-semibold">{t('s7')}</h2>
          <p className="text-muted-foreground">{t('s7Body')}</p>
        </section>

        <section>
          <h2 className="mb-3 text-xl font-semibold">{t('s8')}</h2>
          <p className="text-muted-foreground">{t('s8Body')}</p>
        </section>

        <section>
          <h2 className="mb-3 text-xl font-semibold">{t('s9')}</h2>
          <p className="text-muted-foreground">{t('s9Body')}</p>
        </section>
      </div>
    </div>
  );
}
