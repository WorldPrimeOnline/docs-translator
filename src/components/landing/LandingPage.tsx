import type { LandingPageConfig } from '@/lib/landing-pages/types';
import { HeroSection } from './HeroSection';
import { HowItWorksSection } from './HowItWorksSection';
import { SupportedDocumentsSection } from './SupportedDocumentsSection';
import { PainSection } from './PainSection';
import { TrustSection } from './TrustSection';
import { PricingSection } from './PricingSection';
import { FAQSection } from './FAQSection';
import { FinalCTASection } from './FinalCTASection';
import { StructuredData } from './StructuredData';

interface Props {
  config: LandingPageConfig;
}

export function LandingPage({ config }: Props) {
  const { hero, howItWorks, docs, pain, trust, pricing, faq, finalCta, seoContent, structuredData, breadcrumb } = config;

  return (
    <div className="bg-background">
      <HeroSection {...hero} breadcrumb={breadcrumb} />

      {howItWorks && <HowItWorksSection />}

      {docs && (
        <SupportedDocumentsSection
          headline={docs.headline}
          subheadline={docs.subheadline}
          items={docs.items}
        />
      )}

      {pain && <PainSection headline={pain.headline} points={pain.points} />}

      {trust && <TrustSection headline={trust.headline} />}

      {pricing && (
        <PricingSection
          headline={pricing.headline}
          subheadline={pricing.subheadline}
          tiers={pricing.tiers}
          footnote={pricing.footnote}
        />
      )}

      {faq && <FAQSection headline={faq.headline} items={faq.items} />}

      {seoContent && (
        <section className="border-t border-white/10 bg-card px-4 py-16">
          <div className="mx-auto max-w-2xl">
            {seoContent.headline && (
              <h2 className="mb-6 text-xl font-semibold text-foreground">
                {seoContent.headline}
              </h2>
            )}
            <div className="space-y-4">
              {seoContent.paragraphs.map((p, i) => (
                <p key={i} className="text-sm leading-relaxed text-muted-foreground">
                  {p}
                </p>
              ))}
            </div>
          </div>
        </section>
      )}

      {finalCta && (
        <FinalCTASection
          headline={finalCta.headline}
          sub={finalCta.sub}
          cta={finalCta.cta}
          ctaHref={hero.ctaHref}
        />
      )}

      {structuredData && <StructuredData schemas={structuredData} />}
    </div>
  );
}
