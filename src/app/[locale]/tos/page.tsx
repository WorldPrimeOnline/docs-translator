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
          <p className="text-muted-foreground">WPO Translations provides <strong>informational translations only</strong>. Our translations are produced by artificial intelligence and are intended for informational and review purposes. They are <strong>not certified, notarized, sworn, or legally attested</strong> translations.</p>
          <p className="mt-3 text-muted-foreground">We make no representation that our translations will be accepted by any government body, consulate, court, university, bank, or other institution.</p>
        </section>

        <section>
          <h2 className="mb-3 text-xl font-semibold">{t('s2')}</h2>
          <p className="text-muted-foreground">Nothing on this platform constitutes legal, immigration, financial, or professional advice. If you need a certified or notarized translation for legal, immigration, or official purposes, please engage a licensed human translator or translation agency.</p>
        </section>

        <section>
          <h2 className="mb-3 text-xl font-semibold">{t('s3')}</h2>
          <p className="text-muted-foreground">Payments are made in TON cryptocurrency. The price per document translation is displayed at checkout and is subject to change without notice.</p>
          <p className="mt-3 text-muted-foreground"><strong>No refunds</strong> are issued once the translation job has been completed and the translated PDF has been delivered. If you experience a technical failure before delivery, please contact us.</p>
        </section>

        <section>
          <h2 className="mb-3 text-xl font-semibold">{t('s4')}</h2>
          <p className="text-muted-foreground">Uploaded documents and translated PDFs are stored securely for up to <strong>30 days</strong> after the translation is completed, after which they are automatically and permanently deleted.</p>
        </section>

        <section>
          <h2 className="mb-3 text-xl font-semibold">{t('s5')}</h2>
          <p className="text-muted-foreground">You agree not to:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
            <li>Upload documents you do not have the right to translate</li>
            <li>Use our service to produce fraudulent documents</li>
            <li>Attempt to circumvent any security or access controls</li>
            <li>Use automated tools to abuse the service</li>
          </ul>
        </section>

        <section>
          <h2 className="mb-3 text-xl font-semibold">{t('s6')}</h2>
          <p className="text-muted-foreground">We provide the service &quot;as-is&quot; and make no guarantees of uptime, accuracy, or fitness for any particular purpose.</p>
        </section>

        <section>
          <h2 className="mb-3 text-xl font-semibold">{t('s7')}</h2>
          <p className="text-muted-foreground">To the maximum extent permitted by law, WPO Translations and its operators shall not be liable for any indirect, incidental, or consequential damages arising from your use of the service or reliance on any translation produced by it.</p>
        </section>

        <section>
          <h2 className="mb-3 text-xl font-semibold">{t('s8')}</h2>
          <p className="text-muted-foreground">We may update these Terms at any time. Continued use of the service after changes constitutes acceptance of the new Terms.</p>
        </section>

        <section>
          <h2 className="mb-3 text-xl font-semibold">{t('s9')}</h2>
          <p className="text-muted-foreground">For questions about these Terms, please contact us through the website.</p>
        </section>
      </div>
    </div>
  );
}
