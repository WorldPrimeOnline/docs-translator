import type { Metadata } from 'next';
import { setRequestLocale, getTranslations } from 'next-intl/server';

export const metadata: Metadata = {
  title: 'Privacy Policy — WPO Translations',
};

export default async function PrivacyPolicy({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('privacyPage');

  return (
    <div className="mx-auto max-w-3xl px-4 py-16">
      <h1 className="mb-2 text-3xl font-bold tracking-tight">{t('title')}</h1>
      <p className="mb-10 text-sm text-muted-foreground">{t('lastUpdated')}</p>

      <div className="space-y-8 text-sm leading-relaxed">
        <section>
          <h2 className="mb-3 text-xl font-semibold">{t('s1')}</h2>
          <p className="text-muted-foreground">{t('s1Intro')}</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
            <li>{t('s1Item1')}</li>
            <li>{t('s1Item2')}</li>
            <li>{t('s1Item3')}</li>
            <li>{t('s1Item4')}</li>
            <li>{t('s1Item5')}</li>
          </ul>
        </section>

        <section>
          <h2 className="mb-3 text-xl font-semibold">{t('s2')}</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
            <li>{t('s2Item1')}</li>
            <li>{t('s2Item2')}</li>
            <li>{t('s2Item3')}</li>
          </ul>
        </section>

        <section>
          <h2 className="mb-3 text-xl font-semibold">{t('s3')}</h2>
          <p className="text-muted-foreground">{t('s3Intro')}</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
            <li>{t('s3Item1')}</li>
            <li>{t('s3Item2')}</li>
            <li>{t('s3Item3')}</li>
            <li>{t('s3Item4')}</li>
          </ul>
        </section>

        <section>
          <h2 className="mb-3 text-xl font-semibold">{t('s4')}</h2>
          <p className="text-muted-foreground">{t('s4Body')}</p>
          <p className="mt-3 text-muted-foreground">{t('s4Body2')}</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
            <li>{t('s4Item1')}</li>
            <li>{t('s4Item2')}</li>
            <li>{t('s4Item3')}</li>
            <li>{t('s4Item4')}</li>
          </ul>
        </section>

        <section>
          <h2 className="mb-3 text-xl font-semibold">{t('s5')}</h2>
          <p className="text-muted-foreground">{t('s5Body')}</p>
        </section>

        <section>
          <h2 className="mb-3 text-xl font-semibold">{t('s6')}</h2>
          <p className="text-muted-foreground">{t('s6Intro')}</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
            <li>{t('s6Item1')}</li>
            <li>{t('s6Item2')}</li>
            <li>{t('s6Item3')}</li>
          </ul>
          <p className="mt-3 text-muted-foreground">{t('s6Body2')}</p>
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
