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
  const {
    hero,
    howItWorks,
    docs,
    pain,
    trust,
    pricing,
    faq,
    finalCta,
    seoContent,
    structuredData,
    breadcrumb,
  } = config;

  return (
    <div className="bg-background">

      {/* 1. Hero */}
      <HeroSection {...hero} breadcrumb={breadcrumb} />

      {/* 2. Pain section */}
      {pain && <PainSection headline={pain.headline} points={pain.points} sectionLabel={pain.sectionLabel} bridgeLabel={pain.bridgeLabel} />}

      {/* 3. How it works */}
      {howItWorks && <HowItWorksSection />}

      {/* 4. Supported documents */}
      {docs && (
        <SupportedDocumentsSection
          headline={docs.headline}
          subheadline={docs.subheadline}
          sectionLabel={docs.sectionLabel}
          items={docs.items}
        />
      )}

      {/* 5. Features / trust */}
      {trust && <TrustSection headline={trust.headline} mode="features" />}

      {/* 6. Security */}
      <TrustSection mode="security" />

      {/* 7. Pricing */}
      {pricing && (
        <PricingSection
          headline={pricing.headline}
          subheadline={pricing.subheadline}
          tiers={pricing.tiers}
          footnote={pricing.footnote}
        />
      )}

      {/* 8. FAQ */}
      {faq && <FAQSection headline={faq.headline} items={faq.items} />}

      {/* 9. SEO prose */}
      {seoContent && (
        <section className="border-t border-white/[0.07] bg-card px-4 py-16">
          <div className="mx-auto max-w-2xl">
            {seoContent.headline && (
              <h2 className="mb-6 text-xl font-semibold tracking-[-0.02em] text-foreground">
                {seoContent.headline}
              </h2>
            )}
            <div className="space-y-4">
              {seoContent.paragraphs.map((p, i) => (
                <p key={i} className="text-[13px] leading-relaxed text-muted-foreground/80">
                  {p}
                </p>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* 10. Final CTA */}
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
