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
          <p className="text-muted-foreground">When you use WPO Translations, we collect:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
            <li><strong>Account information</strong>: email address when you sign up</li>
            <li><strong>Uploaded documents</strong>: PDF files you upload for translation</li>
            <li><strong>Translation output</strong>: the translated PDFs we produce</li>
            <li><strong>Payment information</strong>: TON transaction hashes and amounts. We never store private keys or wallet credentials.</li>
            <li><strong>Usage data</strong>: basic logs (timestamps, document types, language pairs) to operate and improve the service</li>
          </ul>
        </section>

        <section>
          <h2 className="mb-3 text-xl font-semibold">{t('s2')}</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
            <li><strong>Uploaded and translated files</strong>: automatically and permanently deleted <strong>30 days</strong> after the translation is completed</li>
            <li><strong>Account information</strong>: retained until you delete your account</li>
            <li><strong>Payment records</strong>: retained as required by applicable tax and financial regulations</li>
          </ul>
        </section>

        <section>
          <h2 className="mb-3 text-xl font-semibold">{t('s3')}</h2>
          <p className="text-muted-foreground">We use your data exclusively to:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
            <li>Provide the translation service you requested</li>
            <li>Process and verify payments</li>
            <li>Send you the translated document and service notifications</li>
            <li>Improve the accuracy and reliability of the service</li>
          </ul>
        </section>

        <section>
          <h2 className="mb-3 text-xl font-semibold">{t('s4')}</h2>
          <p className="text-muted-foreground">We <strong>never sell, rent, or share</strong> your documents or personal data with third parties for marketing or advertising purposes.</p>
          <p className="mt-3 text-muted-foreground">We use the following sub-processors to operate the service:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
            <li><strong>Supabase</strong> — database and authentication</li>
            <li><strong>Cloudflare R2</strong> — encrypted file storage</li>
            <li><strong>Mistral AI</strong> — OCR (text extraction from PDFs)</li>
            <li><strong>Anthropic</strong> — AI translation</li>
          </ul>
        </section>

        <section>
          <h2 className="mb-3 text-xl font-semibold">{t('s5')}</h2>
          <p className="text-muted-foreground">All files are stored with encryption at rest. Data in transit is protected by TLS. Access to your documents is restricted to your authenticated account only.</p>
        </section>

        <section>
          <h2 className="mb-3 text-xl font-semibold">{t('s6')}</h2>
          <p className="text-muted-foreground">You have the right to:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
            <li><strong>Access</strong> the personal data we hold about you</li>
            <li><strong>Delete your account</strong> and all associated data</li>
            <li><strong>Request early deletion</strong> of your uploaded documents before the 30-day period</li>
          </ul>
          <p className="mt-3 text-muted-foreground">To exercise these rights, contact us through the website. We will respond within 30 days.</p>
        </section>

        <section>
          <h2 className="mb-3 text-xl font-semibold">{t('s7')}</h2>
          <p className="text-muted-foreground">We use only essential cookies required for authentication (managed by Supabase). We do not use tracking, analytics, or advertising cookies.</p>
        </section>

        <section>
          <h2 className="mb-3 text-xl font-semibold">{t('s8')}</h2>
          <p className="text-muted-foreground">We may update this Privacy Policy from time to time. We will notify you of significant changes by email or by a notice on the service.</p>
        </section>

        <section>
          <h2 className="mb-3 text-xl font-semibold">{t('s9')}</h2>
          <p className="text-muted-foreground">For privacy-related questions or data requests, please contact us through the website.</p>
        </section>
      </div>
    </div>
  );
}
