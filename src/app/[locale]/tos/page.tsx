import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';

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

  return (
    <div className="mx-auto max-w-3xl px-4 py-16">
      <h1 className="mb-2 text-3xl font-bold tracking-tight">Terms of Service</h1>
      <p className="mb-10 text-sm text-muted-foreground">Last updated: January 2026</p>

      <div className="prose prose-slate max-w-none space-y-8 text-sm leading-relaxed text-foreground">
        <section>
          <h2 className="mb-3 text-xl font-semibold">1. Informational Translation Only</h2>
          <p className="text-muted-foreground">WPO Translations provides <strong>informational translations only</strong>. Our translations are produced by artificial intelligence and are intended for informational and review purposes. They are <strong>not certified, notarized, sworn, or legally attested</strong> translations.</p>
          <p className="mt-3 text-muted-foreground">We make no representation that our translations will be accepted by any government body, consulate, court, university, bank, or other institution.</p>
        </section>

        <section>
          <h2 className="mb-3 text-xl font-semibold">2. Not Legal or Professional Advice</h2>
          <p className="text-muted-foreground">Nothing on this platform constitutes legal, immigration, financial, or professional advice. If you need a certified or notarized translation for legal, immigration, or official purposes, please engage a licensed human translator or translation agency.</p>
        </section>

        <section>
          <h2 className="mb-3 text-xl font-semibold">3. Payments and Refunds</h2>
          <p className="text-muted-foreground">Payments are made in TON cryptocurrency. The price per document translation is displayed at checkout and is subject to change without notice.</p>
          <p className="mt-3 text-muted-foreground"><strong>No refunds</strong> are issued once the translation job has been completed and the translated PDF has been delivered. If you experience a technical failure before delivery, please contact us.</p>
        </section>

        <section>
          <h2 className="mb-3 text-xl font-semibold">4. File Retention and Deletion</h2>
          <p className="text-muted-foreground">Uploaded documents and translated PDFs are stored securely for up to <strong>30 days</strong> after the translation is completed, after which they are automatically and permanently deleted.</p>
        </section>

        <section>
          <h2 className="mb-3 text-xl font-semibold">5. Acceptable Use</h2>
          <p className="text-muted-foreground">You agree not to:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
            <li>Upload documents you do not have the right to translate</li>
            <li>Use our service to produce fraudulent documents</li>
            <li>Attempt to circumvent any security or access controls</li>
            <li>Use automated tools to abuse the service</li>
          </ul>
        </section>

        <section>
          <h2 className="mb-3 text-xl font-semibold">6. Service Availability</h2>
          <p className="text-muted-foreground">We provide the service &quot;as-is&quot; and make no guarantees of uptime, accuracy, or fitness for any particular purpose.</p>
        </section>

        <section>
          <h2 className="mb-3 text-xl font-semibold">7. Limitation of Liability</h2>
          <p className="text-muted-foreground">To the maximum extent permitted by law, WPO Translations and its operators shall not be liable for any indirect, incidental, or consequential damages arising from your use of the service or reliance on any translation produced by it.</p>
        </section>

        <section>
          <h2 className="mb-3 text-xl font-semibold">8. Changes to Terms</h2>
          <p className="text-muted-foreground">We may update these Terms at any time. Continued use of the service after changes constitutes acceptance of the new Terms.</p>
        </section>

        <section>
          <h2 className="mb-3 text-xl font-semibold">9. Contact</h2>
          <p className="text-muted-foreground">For questions about these Terms, please contact us through the website.</p>
        </section>
      </div>
    </div>
  );
}
