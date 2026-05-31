import {
  IdCard,
  Landmark,
  GraduationCap,
  FileHeart,
  HeartPulse,
  Shield,
  Car,
  Briefcase,
  FileText,
} from 'lucide-react';
import type { LandingPageConfig } from './types';
import {
  defaultHowItWorksSteps,
  defaultTrustItems,
  defaultPricingTiers,
  defaultPricingFootnote,
} from './shared';

export const passportTranslationConfig: LandingPageConfig = {
  title: 'Passport Translation — Any Language, Online — WPO Translations',
  description:
    'Translate a passport or ID card online. Clean English or multilingual output with all biographic data, dates, and document numbers preserved. For visa applications, immigration, and official workflows.',

  breadcrumb: [
    { label: 'WPO Translations', href: '/' },
    { label: 'Documents', href: '/documents' },
    { label: 'Passport Translation', href: '/documents/passport-translation' },
  ],

  hero: {
    badge: 'Document Type · Passport & ID',
    headline: 'Passport Translation',
    accentLine: 'Any Language — Online in Minutes',
    subheadline:
      'Upload a passport or ID card scan and receive a clean, structured translation. All biographic data, document numbers, dates, and personal details preserved exactly as shown.',
    ctaLabel: 'Translate My Passport',
    ctaHref: '/auth/signup',
    trustLine: '$4.39 per passport · 2–5 minutes · 10+ language pairs',
  },

  howItWorks: {
    steps: defaultHowItWorksSteps,
  },

  docs: {
    headline: 'Passport and ID document types supported',
    items: [
      { icon: IdCard, name: 'Biometric Passport' },
      { icon: IdCard, name: 'Non-Biometric Passport' },
      { icon: IdCard, name: 'National ID Card' },
      { icon: Car, name: "Driver's License (as ID)" },
      { icon: FileText, name: 'Residence Permit' },
      { icon: FileText, name: 'Travel Document' },
    ],
  },

  pain: {
    headline: 'Why passport translation is needed — and why it is hard to get right',
    points: [
      {
        title: 'Visa applications often require a translated version of a foreign-language passport',
        desc: 'Consulates and embassies reviewing applications from non-native-language holders frequently ask for an English translation of the passport data page.',
      },
      {
        title: 'Names must be transliterated, not translated',
        desc: 'Personal names in a passport must be preserved phonetically in the target language script. Translating the meaning of a name instead of its sound is a common and serious error.',
      },
      {
        title: 'MRZ codes and document numbers must be preserved exactly',
        desc: 'The machine-readable zone (MRZ) at the bottom of passport data pages contains critical information. Any change to numbers, codes, or dates makes the translation useless.',
      },
      {
        title: 'Standard translation tools produce unformatted text dumps',
        desc: 'Generic OCR or translation services extract passport data as unstructured text. A usable passport translation must preserve the field structure: surname, given name, nationality, date of birth, etc.',
      },
    ],
  },

  trust: {
    items: defaultTrustItems,
  },

  pricing: {
    headline: 'Passport translation pricing',
    subheadline: '$4.39 per document — the lowest of our pricing tiers',
    tiers: [
      {
        ...defaultPricingTiers[0]!,
        name: 'Passport & ID',
        features: [
          'Passport, ID card, travel document',
          'All biographic data preserved',
          'Names transliterated (not translated)',
          'Document numbers and dates exact',
          'Disclaimer footer on every page',
        ],
      },
    ],
    footnote: defaultPricingFootnote,
  },

  faq: {
    items: [
      {
        q: 'What passport data is included in the translation?',
        a: 'We translate all visible fields on the passport data page: surname, given name(s), nationality, date of birth, place of birth, gender, date of issue, date of expiry, passport number, issuing authority, and MRZ zone contents. Personal names are transliterated into the target script.',
      },
      {
        q: 'What languages can a passport be translated into?',
        a: 'We support 10+ target languages including English, Russian, Chinese, Korean, Japanese, German, French, Spanish, and Arabic. Source language is auto-detected or can be manually specified.',
      },
      {
        q: 'Is the translation accepted for visa applications?',
        a: 'Our translations are unofficial and for informational use. Some consulates accept informal translated copies alongside the original passport. Others require certified translations. Always confirm with the specific embassy or consulate what level of translation they require.',
      },
      {
        q: 'How are names handled in the translation?',
        a: 'Personal names are transliterated following ICAO 9303 standards for passport-style documents where applicable, and standard transliteration conventions for other scripts. Names are never translated semantically.',
      },
      {
        q: 'Is my passport data safe?',
        a: 'Your document is processed and stored on encrypted Cloudflare R2 storage. It is automatically deleted after 30 days. We do not store, share, or use the personal data in your passport for any purpose other than generating the translation.',
      },
    ],
  },

  finalCta: {
    headline: 'Translate your passport online',
    sub: 'Upload your passport scan and receive a clean, structured English translation in minutes.',
    cta: 'Translate My Passport',
  },

  structuredData: [
    {
      '@context': 'https://schema.org',
      '@type': 'Service',
      name: 'Passport Translation — WPO Online Translations',
      description: 'Translate a passport or ID card online. Clean structured output with all biographic data preserved for visa applications and immigration workflows.',
      provider: { '@type': 'Organization', name: 'WPO Online Translations', url: 'https://wpo.online' },
      serviceType: 'Document Translation',
    },
  ],
};

export const bankStatementTranslationConfig: LandingPageConfig = {
  title: 'Bank Statement Translation for Visa & Immigration — WPO Translations',
  description:
    'Translate bank statements online for visa applications, mortgage approvals, immigration, and income verification. Clean PDF output with all balances, dates, and transactions preserved exactly.',

  breadcrumb: [
    { label: 'WPO Translations', href: '/' },
    { label: 'Documents', href: '/documents' },
    { label: 'Bank Statement Translation', href: '/documents/bank-statement-translation' },
  ],

  hero: {
    badge: 'Document Type · Bank Statement',
    headline: 'Bank Statement Translation',
    accentLine: 'for Visa, Immigration & Income Proof',
    subheadline:
      'Translate bank statements from any language into English or other target languages. All balances, transaction dates, account numbers, and currency amounts preserved exactly as shown.',
    ctaLabel: 'Translate My Bank Statement',
    ctaHref: '/auth/signup',
    trustLine: '$4.99 per document · 2–5 minutes · Any bank, any country',
  },

  howItWorks: {
    steps: defaultHowItWorksSteps,
  },

  docs: {
    headline: 'Bank and financial document types supported',
    items: [
      { icon: Landmark, name: 'Bank Statement (1–6 months)' },
      { icon: Landmark, name: 'Account Balance Certificate' },
      { icon: Briefcase, name: 'Income Certificate from Employer' },
      { icon: FileText, name: 'Tax Return Summary' },
      { icon: Briefcase, name: 'Payslip / Salary Statement' },
      { icon: FileText, name: 'Property or Asset Statement' },
    ],
  },

  pain: {
    headline: 'Why getting your bank statement translated is harder than it should be',
    points: [
      {
        title: 'Visa consulates require English bank statements — most banks don\'t offer them',
        desc: 'Banks in Russia, Kazakhstan, and many other countries issue statements only in their local language. Embassies and consulates reviewing visa applications typically require English translations.',
      },
      {
        title: 'Numbers and amounts must be perfectly preserved — no rounding, no conversion',
        desc: 'Bank statements used for visa or mortgage applications must show exact original amounts in original currency. Any conversion or rounding creates a discrepancy that can cause rejection.',
      },
      {
        title: 'Transaction-level detail must be readable and structured',
        desc: 'A bank statement with 50 transactions must remain a table — not a paragraph. Generic translation tools collapse structure into unformatted text.',
      },
      {
        title: 'Tight visa deadlines make waiting 3–5 days for a bureau unacceptable',
        desc: 'DTV, Schengen, and other visa applications have narrow windows. Getting your bank statement translated in minutes, not days, can determine whether your application is ready on time.',
      },
    ],
  },

  trust: {
    items: defaultTrustItems,
  },

  pricing: {
    headline: 'Bank statement translation pricing',
    tiers: defaultPricingTiers,
    footnote: defaultPricingFootnote,
  },

  faq: {
    items: [
      {
        q: 'Which visa types require a translated bank statement?',
        a: 'Schengen visas, UK visitor visas, US B1/B2 visas, and most immigration applications require proof of funds from a bank, typically in English. Other documents like income certificates and payslips are also commonly required.',
      },
      {
        q: 'Are currencies and amounts preserved without conversion?',
        a: 'Yes. All amounts, currencies, and balances are preserved exactly as they appear in the original document. We do not convert currencies, round amounts, or interpret financial data in any way.',
      },
      {
        q: 'What if my bank statement is 6 pages long?',
        a: 'We support bank statements up to 50 pages. The price per document applies regardless of page count within that limit. All pages are translated as one document.',
      },
      {
        q: 'Will the translated statement be accepted by my consulate?',
        a: 'Our translations are unofficial. Many consulates accept informal translations accompanying the original statement. Others require a certified translation. Verify the requirements with your specific consulate or visa agent.',
      },
      {
        q: 'Can you translate online banking screenshots or PDF exports?',
        a: 'Yes. Both scanned paper statements and digital PDF exports from online banking are supported. Scanned documents are processed through OCR before translation.',
      },
    ],
  },

  finalCta: {
    headline: 'Translate your bank statement for visa or immigration',
    sub: 'Upload your bank statement and receive a clean English translation in 2–5 minutes.',
    cta: 'Translate My Bank Statement',
  },

  structuredData: [
    {
      '@context': 'https://schema.org',
      '@type': 'Service',
      name: 'Bank Statement Translation — WPO Online Translations',
      description: 'Translate bank statements online for visa applications, immigration, and income verification. All amounts and balances preserved exactly.',
      provider: { '@type': 'Organization', name: 'WPO Online Translations', url: 'https://wpo.online' },
      serviceType: 'Document Translation',
    },
  ],
};

export const diplomaTranslationConfig: LandingPageConfig = {
  title: 'Diploma & Academic Credential Translation — WPO Translations',
  description:
    'Translate diplomas, degree certificates, and academic transcripts online. Clean structured English output for university applications, professional licensing, and international employment.',

  breadcrumb: [
    { label: 'WPO Translations', href: '/' },
    { label: 'Documents', href: '/documents' },
    { label: 'Diploma Translation', href: '/documents/diploma-translation' },
  ],

  hero: {
    badge: 'Document Type · Diploma & Transcript',
    headline: 'Diploma & Academic Credential',
    accentLine: 'Translation Online',
    subheadline:
      'Translate diplomas, degree certificates, and academic transcripts for university applications, professional licensing, credential evaluation, and international employment.',
    ctaLabel: 'Translate My Diploma',
    ctaHref: '/auth/signup',
    trustLine: '$4.99 per document · Academic terminology preserved · 10+ languages',
  },

  howItWorks: {
    steps: defaultHowItWorksSteps,
  },

  docs: {
    headline: 'Academic document types supported',
    items: [
      { icon: GraduationCap, name: "Bachelor's Diploma" },
      { icon: GraduationCap, name: "Master's Diploma" },
      { icon: GraduationCap, name: 'PhD / Doctoral Certificate' },
      { icon: FileText, name: 'Academic Transcript' },
      { icon: FileText, name: 'School Leaving Certificate' },
      { icon: FileText, name: 'Diploma Supplement' },
      { icon: FileHeart, name: 'Academic Reference Letter' },
      { icon: HeartPulse, name: 'Professional Certification' },
    ],
  },

  pain: {
    headline: 'Diploma translation challenges — what goes wrong',
    points: [
      {
        title: 'Academic institution names must be translated with care',
        desc: 'University and faculty names have official international forms. Incorrectly translating "Московский государственный университет" as anything other than "Moscow State University" raises immediate flags with reviewers.',
      },
      {
        title: 'Qualification titles are not universal — context matters',
        desc: 'A Russian "специалист" degree is not simply a "bachelor\'s degree". Credential evaluators expect accurate description of the qualification type, duration, and field.',
      },
      {
        title: 'Transcripts are tables — not paragraphs',
        desc: 'Academic transcripts contain structured course listings with credits, grades, and subject codes. Translation tools that flatten tables into prose produce unusable output.',
      },
      {
        title: 'Tight deadlines for credential evaluation services',
        desc: 'WES, ICAS, and other credential evaluation bodies often have document submission deadlines. Having a fast translation tool available means you can submit on time.',
      },
    ],
  },

  trust: {
    items: defaultTrustItems,
  },

  pricing: {
    headline: 'Diploma translation pricing',
    tiers: defaultPricingTiers,
    footnote: defaultPricingFootnote,
  },

  faq: {
    items: [
      {
        q: 'Is your translation accepted for WES or other credential evaluations?',
        a: 'WES (World Education Services) and most credential evaluation bodies require certified or notarized translations. WPO provides unofficial translations that can be used during preparation, by education consultants, or as input to a certified translation workflow. Verify official requirements before submitting.',
      },
      {
        q: 'Do you translate diploma supplements and grade explanations?',
        a: 'Yes. Diploma supplements, grade scale explanations, and attached transcripts are translated as part of the document. Subject names are translated using standard academic English terminology.',
      },
      {
        q: 'What languages do you support for diploma translation?',
        a: 'We support 10+ languages. The most common pairs for diploma translation are Russian → English, Kazakh → English, and Chinese → English. Source language can be auto-detected.',
      },
      {
        q: 'How do you handle degree titles and academic grades?',
        a: 'Degree titles are translated with explanatory context where needed (e.g., "Specialist degree (5-year integrated program)"). Grades are preserved in the original scale without conversion.',
      },
      {
        q: 'Can I use this for a professional licensing application?',
        a: 'Many licensing boards require certified or notarized translations of foreign credentials. WPO provides unofficial translations for preparation and reference. Confirm certification requirements with your licensing board.',
      },
    ],
  },

  finalCta: {
    headline: 'Translate your diploma or academic transcript',
    sub: 'Upload your academic credential and receive a clean, structured English translation in minutes.',
    cta: 'Translate My Diploma',
  },

  structuredData: [
    {
      '@context': 'https://schema.org',
      '@type': 'Service',
      name: 'Diploma Translation — WPO Online Translations',
      description: 'Translate diplomas, degree certificates, and academic transcripts online for university applications, professional licensing, and credential evaluation.',
      provider: { '@type': 'Organization', name: 'WPO Online Translations', url: 'https://wpo.online' },
      serviceType: 'Document Translation',
    },
  ],
};

// Documents hub config
export const documentsHubConfig: LandingPageConfig = {
  title: 'Document Translation by Type — WPO Translations',
  description:
    'Translate any official document online. Passports, bank statements, diplomas, birth certificates, medical records, contracts, and more. Clean PDF output in 2–5 minutes.',

  hero: {
    badge: 'All Document Types',
    headline: 'Translate Any Official Document',
    accentLine: 'Online, in Minutes',
    subheadline:
      'Upload a scanned or digital PDF and receive a clean translated version. Every major official document type supported — passports, bank statements, diplomas, certificates, and more.',
    ctaLabel: 'Start Translating',
    ctaHref: '/auth/signup',
    trustLine: 'From $4.39 · 10+ languages · 2–5 minutes',
  },

  docs: {
    headline: 'All supported document types',
    subheadline: 'Click a type to see a dedicated translation page with specific guidance',
    items: [
      { icon: IdCard, name: 'Passport & ID Card' },
      { icon: Landmark, name: 'Bank Statement' },
      { icon: GraduationCap, name: 'Diploma & Transcript' },
      { icon: FileHeart, name: 'Birth & Marriage Certificate' },
      { icon: Briefcase, name: 'Employment Contract & Letter' },
      { icon: HeartPulse, name: 'Medical Certificate & Record' },
      { icon: Shield, name: 'Police Clearance Certificate' },
      { icon: Car, name: "Driver's License" },
      { icon: FileText, name: 'Any Other Official Document' },
    ],
  },

  howItWorks: {
    steps: defaultHowItWorksSteps,
  },

  trust: {
    items: defaultTrustItems,
  },

  pricing: {
    headline: 'Simple pricing',
    tiers: defaultPricingTiers,
    footnote: defaultPricingFootnote,
  },

  faq: {
    items: [
      {
        q: 'Which document types do you support?',
        a: 'We support all major official document types: passports, ID cards, bank statements, diplomas, transcripts, birth and marriage certificates, employment contracts, medical records, police clearance certificates, driver\'s licenses, and generic official documents.',
      },
      {
        q: 'What languages are supported?',
        a: 'We support 10+ languages including English, Russian, Chinese, Korean, Japanese, German, French, Spanish, and Arabic. Source language can be auto-detected.',
      },
      {
        q: 'Are your translations certified or notarized?',
        a: 'No. All translations are unofficial and for informational use only. A visible disclaimer appears on every translated page. Certified or notarized translations must be obtained from a licensed translator or notary.',
      },
    ],
  },

  finalCta: {
    headline: 'Start translating your document',
    sub: 'Upload any official PDF and receive a clean translation in 2–5 minutes.',
    cta: 'Upload Document',
  },
};
