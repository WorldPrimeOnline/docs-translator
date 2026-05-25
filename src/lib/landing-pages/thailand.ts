import {
  IdCard,
  Landmark,
  Briefcase,
  GraduationCap,
  Shield,
  HeartPulse,
  Car,
  FileText,
  FileHeart,
} from 'lucide-react';
import type { LandingPageConfig } from './types';
import {
  defaultHowItWorksSteps,
  defaultTrustItems,
  defaultDisclaimer,
  defaultPricingTiers,
  defaultPricingFootnote,
} from './shared';

export const thailandConfig: LandingPageConfig = {
  title: 'Document Translation for Thailand Visas & Expat Life — WPO Translations',
  description:
    'Translate passports, bank statements, employment letters, and official documents online. Clean PDF output for DTV visa, Thai immigration, and expat paperwork. Ready in 2–5 minutes.',

  breadcrumb: [
    { label: 'WPO Translations', href: '/' },
    { label: 'Thailand', href: '/thailand' },
  ],

  hero: {
    badge: 'Thailand · Expat & Visa Documents',
    headline: 'Document Translation for Thailand',
    accentLine: 'Visas, Expat Life & Immigration',
    subheadline:
      'Translate passports, bank statements, employment letters, and official documents online. Clean PDF output for DTV visa applications, Thai immigration offices, banks, and agencies.',
    ctaLabel: 'Translate a Document',
    ctaHref: '/auth/signup',
    ctaSecondaryLabel: 'View Supported Documents',
    ctaSecondaryHref: '#documents',
    trustLine: 'From $4.39 · 2–5 minutes · RU/EN/TH language pairs',
  },

  howItWorks: {
    headline: 'How It Works',
    steps: defaultHowItWorksSteps,
  },

  docs: {
    headline: 'Supported Document Types',
    subheadline: 'All common document types used in Thai visa and expat workflows',
    items: [
      { icon: IdCard, name: 'Passport & ID Card' },
      { icon: Landmark, name: 'Bank Statement' },
      { icon: Briefcase, name: 'Employment Letter & Proof of Income' },
      { icon: GraduationCap, name: 'Diploma & Transcript' },
      { icon: Shield, name: 'Police Clearance Certificate' },
      { icon: HeartPulse, name: 'Medical Certificate' },
      { icon: Car, name: "Driver's License" },
      { icon: FileHeart, name: 'Marriage & Birth Certificate' },
      { icon: FileText, name: 'Lease Agreement & Accommodation Proof' },
    ],
  },

  pain: {
    headline: 'Why traditional translation agencies fall short in Thailand',
    points: [
      {
        title: 'You are abroad — they require in-person visits',
        desc: 'Most certified translation bureaus require you to appear in person or physically mail your documents. When you are already in Thailand, that is not an option.',
      },
      {
        title: 'Agencies take 2–5 business days for a single letter',
        desc: 'Employment letters, income proofs, and bank summaries are often simple one-page documents — yet agencies charge premium rates and return them days later.',
      },
      {
        title: 'WhatsApp-based services lose documents and delay replies',
        desc: 'Informal translation services common in expat communities often go dark, send incomplete PDFs, and have no structured delivery process.',
      },
      {
        title: 'Thai consulates expect specific formatting',
        desc: 'Immigration offices want clean, readable documents. Generic OCR dumps or poorly formatted Word files create unnecessary complications during review.',
      },
    ],
  },

  trust: {
    headline: 'Secure, transparent, and legally clear',
    items: defaultTrustItems,
    disclaimer: defaultDisclaimer,
  },

  pricing: {
    headline: 'Simple pricing',
    subheadline: 'No subscription. Pay only when you translate.',
    tiers: defaultPricingTiers,
    footnote: defaultPricingFootnote,
  },

  faq: {
    headline: 'Frequently asked questions — Thailand',
    items: [
      {
        q: 'Can I use this translation for a DTV visa application?',
        a: 'Our translations are unofficial and for informational purposes only. They are not certified or notarized translations. For DTV visa, Thai immigration typically requires translations to accompany originals. We recommend confirming with your specific consulate or immigration agent what level of translation is required.',
      },
      {
        q: 'Which language pairs do you support for Thailand?',
        a: 'We support Russian → English, English → Russian, Russian → Thai, Thai → English, and English → Thai. These cover the most common workflows for Russian-speaking expats and digital nomads in Thailand.',
      },
      {
        q: 'How quickly will I get my translated document?',
        a: 'Most documents are ready in 2–5 minutes after payment. Longer documents (10+ pages) may take up to 15 minutes. You will receive a download link by email and can also download from your dashboard.',
      },
      {
        q: 'Is this an official or certified translation?',
        a: 'No. WPO Translations provides unofficial translations for informational purposes only. The translated PDF includes a visible disclaimer on every page. For official certified translations accepted by Thai government bodies, you will need a certified translator or a notarized translation service.',
      },
      {
        q: 'What exactly is included in the translated PDF?',
        a: 'The translated PDF includes a clean translation of all visible text, with personal names transliterated (not translated), numbers, dates, and document numbers preserved exactly as shown. A disclaimer footer appears on every page.',
      },
      {
        q: 'How is my document stored and protected?',
        a: 'Your files are encrypted and stored on Cloudflare R2 storage. They are automatically deleted after 30 days. We do not share your documents with third parties.',
      },
    ],
  },

  finalCta: {
    headline: 'Ready to translate your document?',
    sub: 'Upload a PDF and get a clean translated version in minutes. From $4.39.',
    cta: 'Start Translating',
  },

  seoContent: {
    headline: 'Document translation for Thailand — how it works',
    paragraphs: [
      'Living or working in Thailand as a foreign national frequently means dealing with a stack of official documents that need to be translated between Russian, English, and Thai. Whether you are applying for a DTV visa, opening a bank account, proving your income to a Thai landlord, or preparing documents for a local agency, accurate and clearly formatted translations make the process smoother.',
      'WPO Online Translations provides fast online document translation using AI, delivered as clean, structured PDFs. The service is designed for expats, digital nomads, and people dealing with Thai immigration paperwork from abroad. Documents are processed in 2–5 minutes and include a visible disclaimer stating the unofficial nature of the translation.',
      'Common use cases in Thailand include: translating Russian or English bank statements for Thai banks or landlords, preparing employment letters and income certificates in Thai or English for DTV and other visa applications, translating birth and marriage certificates for Thai government offices, and creating readable English versions of Thai official documents for foreign employers or universities.',
    ],
  },

  structuredData: [
    {
      '@context': 'https://schema.org',
      '@type': 'Service',
      name: 'Document Translation for Thailand — WPO Online Translations',
      description:
        'Online document translation service for Thailand visa and expat workflows. Passports, bank statements, employment letters, diplomas, and more. Russian, English, and Thai language pairs.',
      provider: {
        '@type': 'Organization',
        name: 'WPO Online Translations',
        url: 'https://wpo.online',
      },
      areaServed: 'Thailand',
      serviceType: 'Document Translation',
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'WPO Translations', item: 'https://wpo.online' },
        { '@type': 'ListItem', position: 2, name: 'Thailand', item: 'https://wpo.online/thailand' },
      ],
    },
  ],
};

export const thailandDtvConfig: LandingPageConfig = {
  title: 'Translate Documents for Thailand DTV Visa — WPO Translations',
  description:
    'Translate bank statements, employment letters, income proof, and other required documents for Thailand Digital Nomad Visa (DTV) application. Online, in 2–5 minutes.',

  breadcrumb: [
    { label: 'WPO Translations', href: '/' },
    { label: 'Thailand', href: '/thailand' },
    { label: 'DTV Visa Translation', href: '/thailand/dtv-visa-translation' },
  ],

  hero: {
    badge: 'Thailand DTV Visa',
    headline: 'Translate Documents for Thailand',
    accentLine: 'DTV Visa Application',
    subheadline:
      'Get clean English or Thai translations of bank statements, employment letters, income certificates, and other documents required for the Thailand Digital Nomad Visa. Delivered in minutes.',
    ctaLabel: 'Translate My DTV Documents',
    ctaHref: '/auth/signup',
    trustLine: 'From $4.39 · RU/EN/TH · 2–5 minutes',
  },

  howItWorks: {
    steps: defaultHowItWorksSteps,
  },

  docs: {
    headline: 'Documents commonly required for DTV',
    subheadline: 'We translate all standard documents in a DTV application package',
    items: [
      { icon: Landmark, name: 'Bank Statement (6 months)' },
      { icon: Briefcase, name: 'Employment Letter or Contract' },
      { icon: FileText, name: 'Freelance Income Proof' },
      { icon: FileText, name: 'Tax Return or Tax Notice' },
      { icon: FileText, name: 'Company Registration Document' },
      { icon: FileText, name: 'Lease or Accommodation Proof' },
      { icon: IdCard, name: 'Passport Copy' },
      { icon: HeartPulse, name: 'Health Insurance Documents' },
    ],
  },

  pain: {
    headline: 'The DTV application process is straightforward — the document preparation is not',
    points: [
      {
        title: 'Bank statements in Russian are not readable by Thai immigration',
        desc: 'If your bank account is in Russia, Kazakhstan, or another country, your statement is in Cyrillic. Thai offices require an English version. Getting one quickly from abroad is the main bottleneck.',
      },
      {
        title: 'Employment letters from remote employers need professional formatting',
        desc: 'A typed PDF on company letterhead is acceptable. A forwarded email or an informal WhatsApp message is not. You need a clean, properly formatted English translation.',
      },
      {
        title: 'Agencies quote 3–7 business days and charge per page',
        desc: 'For what is essentially a formatting and translation task, traditional bureaus charge $30–60 and require a week. DTV applicants preparing from abroad cannot afford that timeline.',
      },
      {
        title: 'Requirements are not standardised across consulates',
        desc: 'Some consulates want Thai translations, others want English. Having a fast, flexible tool to produce either version on demand reduces back-and-forth with your visa agent.',
      },
    ],
  },

  trust: {
    items: defaultTrustItems,
    disclaimer: defaultDisclaimer,
  },

  pricing: {
    headline: 'Pricing for DTV document translation',
    tiers: defaultPricingTiers,
    footnote: defaultPricingFootnote,
  },

  faq: {
    items: [
      {
        q: 'What documents do I need for a DTV application?',
        a: 'The Thailand Digital Nomad Visa (DTV) typically requires: 6 months of bank statements showing sufficient funds, proof of income or employment, health insurance documentation, a passport valid for at least 18 months, and accommodation proof. Requirements may vary by consulate — always confirm directly.',
      },
      {
        q: 'Should my documents be translated into Thai or English?',
        a: 'Most Thai consulates abroad accept English translations. Some may require Thai translations if you are applying at a Thai immigration office inside Thailand. We support both Thai and English as target languages.',
      },
      {
        q: 'What is the minimum income requirement for DTV?',
        a: 'As of 2024–2025, the DTV requires proof of income of at least 500,000 THB (approximately $14,000) held in a foreign bank account, or equivalent income proof. Please verify the current requirements on the official Thai immigration website before applying.',
      },
      {
        q: 'Is your translation accepted by Thai immigration?',
        a: 'WPO provides unofficial, informational translations. They are not certified or notarized. Many applicants use them as part of a package reviewed by a visa agent or immigration consultant who confirms document readiness. Always consult your visa agent or consulate regarding official requirements.',
      },
      {
        q: 'Can I translate multiple documents at once?',
        a: 'Currently each document is uploaded and translated separately. Multi-document upload is on our roadmap. You can translate several documents in sequence through your dashboard.',
      },
    ],
  },

  finalCta: {
    headline: 'Prepare your DTV application documents today',
    sub: 'Translate your bank statements, employment letters, and income proof in minutes.',
    cta: 'Start Translating',
  },

  structuredData: [
    {
      '@context': 'https://schema.org',
      '@type': 'Service',
      name: 'Thailand DTV Visa Document Translation — WPO Online Translations',
      description:
        'Translate bank statements, employment letters, and income proof for Thailand Digital Nomad Visa (DTV) applications. Online, fast, and affordable.',
      provider: { '@type': 'Organization', name: 'WPO Online Translations', url: 'https://wpo.online' },
      areaServed: 'Thailand',
      serviceType: 'Document Translation',
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'WPO Translations', item: 'https://wpo.online' },
        { '@type': 'ListItem', position: 2, name: 'Thailand', item: 'https://wpo.online/thailand' },
        { '@type': 'ListItem', position: 3, name: 'DTV Visa Translation', item: 'https://wpo.online/thailand/dtv-visa-translation' },
      ],
    },
  ],
};

export const thailandImmigrationConfig: LandingPageConfig = {
  title: 'Immigration Document Translation for Thailand — WPO Translations',
  description:
    'Translate passports, marriage certificates, police clearance, medical records, and other documents for Thai immigration, visa extensions, and residency applications.',

  breadcrumb: [
    { label: 'WPO Translations', href: '/' },
    { label: 'Thailand', href: '/thailand' },
    { label: 'Immigration Document Translation', href: '/thailand/immigration-document-translation' },
  ],

  hero: {
    badge: 'Thai Immigration Workflow',
    headline: 'Translate Documents for',
    accentLine: 'Thai Immigration & Residency',
    subheadline:
      'Translate passports, marriage certificates, police clearance, bank statements, and medical records for Thai immigration offices, TM30, visa extensions, and residency applications.',
    ctaLabel: 'Translate Immigration Documents',
    ctaHref: '/auth/signup',
    trustLine: 'From $4.39 · RU / EN / TH · Ready in minutes',
  },

  howItWorks: {
    steps: defaultHowItWorksSteps,
  },

  docs: {
    headline: 'Supported immigration document types',
    items: [
      { icon: IdCard, name: 'Passport & ID Card' },
      { icon: FileHeart, name: 'Marriage & Birth Certificate' },
      { icon: Shield, name: 'Police Clearance Certificate' },
      { icon: HeartPulse, name: 'Medical Certificate' },
      { icon: Landmark, name: 'Bank Statement' },
      { icon: Briefcase, name: 'Employment Letter / Work Certificate' },
      { icon: FileText, name: 'TM30 Supporting Documents' },
      { icon: FileText, name: 'Lease Agreement' },
      { icon: Car, name: "Driver's License" },
    ],
  },

  pain: {
    headline: 'Thai immigration paperwork involves more documents than expected',
    points: [
      {
        title: 'Visa extensions require clean, readable versions of foreign documents',
        desc: 'Thai immigration officers reviewing documents in Russian or Cyrillic need English or Thai versions. Poorly formatted PDFs cause delays and return trips.',
      },
      {
        title: 'TM30 and residency filings require full names and dates to match exactly',
        desc: 'Inconsistencies between translated and original documents create complications. Our AI preserves all names, numbers, and dates exactly as they appear.',
      },
      {
        title: 'Marriage and birth certificates require specific formatting for Thai use',
        desc: 'Vital documents for Thai family-based visas must be clearly structured. Generic translation tools produce unstructured text outputs that Thai offices reject.',
      },
      {
        title: 'Finding a bilingual Thai/Russian or Thai/English translator is expensive',
        desc: 'Certified translators for less common language pairs like Russian → Thai charge significant premiums and have long turnaround times.',
      },
    ],
  },

  trust: {
    items: defaultTrustItems,
    disclaimer: defaultDisclaimer,
  },

  pricing: {
    headline: 'Straightforward pricing',
    tiers: defaultPricingTiers,
    footnote: defaultPricingFootnote,
  },

  faq: {
    items: [
      {
        q: 'Do I need a certified translation for Thai immigration offices?',
        a: 'Requirements vary by visa type and immigration office. Many immigration tasks — including supporting document submission — can be handled with informal translated copies alongside originals. For court proceedings or officially mandated certification, a certified translator is required. Always verify with the specific office you are dealing with.',
      },
      {
        q: 'Which language pairs do you support for Thai immigration documents?',
        a: 'We support Russian ↔ English, English ↔ Thai, and Russian → Thai. This covers the main language combinations needed by Russian-speaking expats and digital nomads dealing with Thai immigration.',
      },
      {
        q: 'Can you translate a marriage certificate for a Thai spouse visa?',
        a: 'Yes, we can translate marriage certificates from Russian or English into Thai or English. These translations are unofficial and for informational use. For formal visa applications involving marriage certificates, confirm whether a notarized translation is required.',
      },
      {
        q: 'How fast is the delivery?',
        a: '2–5 minutes for most documents. Police clearance certificates and multi-page bank statements may take up to 10 minutes. You receive a download link by email immediately upon completion.',
      },
    ],
  },

  finalCta: {
    headline: 'Get your immigration documents ready',
    sub: 'Upload your PDF and receive a clean translated version in minutes.',
    cta: 'Start Translating',
  },

  structuredData: [
    {
      '@context': 'https://schema.org',
      '@type': 'Service',
      name: 'Thailand Immigration Document Translation — WPO Online Translations',
      description: 'Translate passports, marriage certificates, police clearance, and other documents for Thai immigration, visa extensions, and residency applications.',
      provider: { '@type': 'Organization', name: 'WPO Online Translations', url: 'https://wpo.online' },
      areaServed: 'Thailand',
      serviceType: 'Document Translation',
    },
  ],
};
