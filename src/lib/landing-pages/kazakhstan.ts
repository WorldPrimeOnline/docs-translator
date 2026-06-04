import {
  IdCard,
  GraduationCap,
  FileHeart,
  Landmark,
  Briefcase,
  Shield,
  HeartPulse,
  FileText,
  Users,
  BookOpen,
} from 'lucide-react';
import type { LandingPageConfig } from './types';
import {
  defaultHowItWorksSteps,
  defaultTrustItems,
  defaultPricingTiers,
  defaultPricingFootnote,
} from './shared';

export const kazakhstanConfig: LandingPageConfig = {
  title: 'Перевод документов для Казахстана — WPO Translations',
  description:
    'Онлайн-перевод документов для Казахстана: дипломы, свидетельства, контракты и официальные документы для учёбы, миграции, нотариуса и международных процессов.',

  breadcrumb: [
    { label: 'WPO Translations', href: '/' },
    { label: 'Kazakhstan', href: '/kazakhstan' },
  ],

  hero: {
    badge: 'Kazakhstan · Document Workflows',
    headline: 'Document Translation for Kazakhstan',
    accentLine: 'Study, Migration & Official Workflows',
    subheadline:
      'Translate diplomas, birth certificates, contracts, bank statements, and official documents online. Used by students, migration consultants, notaries, and visa agents for international workflows.',
    ctaLabel: 'Translate a Document',
    ctaHref: '/auth/signup',
    ctaSecondaryLabel: 'View Supported Documents',
    ctaSecondaryHref: '#documents',
    trustLine: 'От 2 290 ₸ · RU / EN / KZ · 2–5 minutes',
  },

  howItWorks: {
    steps: defaultHowItWorksSteps,
  },

  docs: {
    headline: 'Supported document types',
    subheadline: 'All major document types used in study, migration, and official workflows',
    items: [
      { icon: GraduationCap, name: 'Diploma & Transcript' },
      { icon: FileHeart, name: 'Birth & Marriage Certificate' },
      { icon: IdCard, name: 'Passport & National ID' },
      { icon: Landmark, name: 'Bank Statement' },
      { icon: Briefcase, name: 'Employment Contract & Letter' },
      { icon: Shield, name: 'Police Clearance Certificate' },
      { icon: HeartPulse, name: 'Medical Certificate' },
      { icon: FileText, name: 'Migration & Residency Documents' },
      { icon: FileText, name: 'Apostille-Related Documents' },
    ],
  },

  pain: {
    headline: 'Document translation in Kazakhstan — common bottlenecks',
    sectionLabel: 'ПРЕИМУЩЕСТВА',
    bridgeLabel: 'WPO помогает',
    points: [
      {
        title: 'Translation bureaus charge per page and require physical presence',
        desc: 'Most certified translation offices in Kazakhstan require you to come in person with originals, wait several days, and pay significant per-page fees for what can be a 2-page diploma.',
      },
      {
        title: 'Notary appointments need a complete translation draft in advance',
        desc: 'Many notaries and certified translators in Kazakhstan work faster and more accurately when they have a clean first-pass translation to review, rather than starting from scratch.',
      },
      {
        title: 'International university applications require precise English formatting',
        desc: 'Foreign universities evaluating Kazakhstani diplomas want clean, readable English transcriptions — not literal word-for-word renderings that lose structural context.',
      },
      {
        title: 'Migration and apostille workflows involve many documents at once',
        desc: 'Preparing for relocation, work abroad, or foreign university admission often means translating 5–10 documents simultaneously. The timeline becomes the main constraint.',
      },
    ],
  },

  trust: {
    headline: 'Прозрачно, конфиденциально и юридически аккуратно',
    items: defaultTrustItems,
  },

  pricing: {
    headline: 'Простая цена за документ',
    subheadline: 'Без подписки. Оплата только за выбранный перевод.',
    tiers: defaultPricingTiers,
    footnote: defaultPricingFootnote,
  },

  faq: {
    items: [
      {
        q: 'Can I use this translation before visiting a notary?',
        a: 'Yes. Many notaries and certified translators review an informal translation draft before completing the certified version. A clean, structured WPO translation can speed up that conversation and reduce errors in the final certified document.',
      },
      {
        q: 'Which languages do you support for Kazakhstan documents?',
        a: 'We support Russian ↔ English and English → Russian as the primary pairs. Kazakh ↔ Russian and Kazakh → English are also supported. These cover the main workflows for Kazakhstani documents used internationally.',
      },
      {
        q: 'Is this translation accepted by foreign universities?',
        a: 'Foreign universities typically require certified or notarized translations. WPO provides unofficial translations that can be used during the application preparation stage, for review by an education consultant, or as a reference draft for a certified translator. Always confirm official requirements with the target university.',
      },
      {
        q: 'Can notaries and visa agents use this service on behalf of clients?',
        a: 'Yes. Any user can upload a client\'s document, process it, and receive the translated PDF. A partner dashboard for agencies is planned for a future release.',
      },
      {
        q: 'What is an apostille and does translation affect it?',
        a: 'An apostille is an official authentication stamp applied to a document by a government authority. The apostille applies to the original document. The translation is a separate step, often required after the apostille has been obtained. WPO provides the translation step; the apostille must be obtained from the relevant government authority.',
      },
    ],
  },

  finalCta: {
    headline: 'Translate your documents online — no bureau visit required',
    sub: 'Upload your PDF and receive a clean translated version in 2–5 minutes.',
    cta: 'Start Translating',
  },

  seoContent: {
    headline: 'Перевод документов для Казахстана — когда и как использовать',
    paragraphs: [
      'В Казахстане переводы документов часто нужны для поступления в зарубежные университеты, рабочих виз, релокации, миграционных процедур, открытия банковских счетов за границей и апостиля. Обычный путь через бюро переводов может требовать личного визита, ожидания и ручной передачи документов.',
      'WorldPrimeOnline помогает подготовить перевод онлайн: загрузите документ, выберите языковую пару и уровень услуги, получите результат в электронном формате. Электронный перевод подходит для подготовки и ознакомления. Официальный перевод с проверкой переводчиком, подписью переводчика и печатью Исполнителя доступен как отдельный уровень услуги. Нотариальное удостоверение оформляется отдельно через партнёров, если такая услуга доступна.',
      'Принятие перевода третьими лицами не гарантируется. Перед подачей документа в банк, университет, консульство, миграционный орган или нотариусу необходимо проверить требования принимающей стороны.',
    ],
  },

  structuredData: [
    {
      '@context': 'https://schema.org',
      '@type': 'Service',
      name: 'Document Translation for Kazakhstan — WPO Online Translations',
      description: 'Online document translation for Kazakhstan workflows: university admissions, immigration, notary preparation, and apostille documents.',
      provider: { '@type': 'Organization', name: 'WPO Online Translations', url: 'https://wpo.online' },
      areaServed: 'Kazakhstan',
      serviceType: 'Document Translation',
    },
  ],
};

export const kazakhstanNotarizedConfig: LandingPageConfig = {
  title: 'Перевод для нотариального удостоверения — Казахстан — WPO Translations',
  description:
    'Подготовьте перевод онлайн и оформите официальный перевод или нотариальное удостоверение через партнёрский процесс WPO. Для Казахстана.',

  breadcrumb: [
    { label: 'WPO Translations', href: '/' },
    { label: 'Kazakhstan', href: '/kazakhstan' },
    { label: 'Translation for Notary Review', href: '/kazakhstan/notarized-translation' },
  ],

  hero: {
    badge: 'Kazakhstan · Notary Preparation',
    headline: 'Translation Draft for',
    accentLine: 'Notary Review & Certification',
    subheadline:
      'Upload your document and receive a clean, structured Russian or English translation ready to present to a notary or certified translator. Reduce review time, reduce errors, lower overall cost.',
    ctaLabel: 'Prepare Translation Draft',
    ctaHref: '/auth/signup',
    trustLine: 'От 2 290 ₸ · 2–5 minutes · Notary-ready output',
  },

  howItWorks: {
    steps: [
      {
        n: '01',
        title: 'Upload your document',
        desc: 'Upload the original scanned PDF — diploma, certificate, passport, or any official document.',
      },
      {
        n: '02',
        title: 'Receive a clean translation draft',
        desc: 'Get a structured, readable translation in 2–5 minutes. All names, dates, and numbers preserved.',
      },
      {
        n: '03',
        title: 'Bring the draft to your notary',
        desc: 'Present the draft alongside the original. The notary reviews, corrects if needed, and certifies the final version.',
      },
    ],
  },

  docs: {
    headline: 'Document types commonly prepared for notary review',
    items: [
      { icon: GraduationCap, name: 'Diploma & Academic Transcript' },
      { icon: FileHeart, name: 'Birth Certificate' },
      { icon: FileHeart, name: 'Marriage & Divorce Certificate' },
      { icon: IdCard, name: 'Passport & National ID' },
      { icon: Shield, name: 'Police Clearance Certificate' },
      { icon: Briefcase, name: 'Employment Contract' },
      { icon: Landmark, name: 'Bank Statement' },
      { icon: FileText, name: 'Power of Attorney' },
      { icon: HeartPulse, name: 'Medical Document' },
    ],
  },

  pain: {
    headline: 'Notary translation appointments take longer than necessary',
    sectionLabel: 'КАК ЭТО РАБОТАЕТ',
    bridgeLabel: 'WPO помогает организовать процесс',
    points: [
      {
        title: 'Notaries start from scratch on every document',
        desc: 'Without a pre-prepared draft, a notary or certified translator reads the original, dictates, and constructs the translation during the appointment — a slow, billable process.',
      },
      {
        title: 'Errors in the first draft cost time and money to correct',
        desc: 'Name transliterations, date formatting, and institution names are common error points. A pre-processed draft identifies these before the certified version is produced.',
      },
      {
        title: 'Multiple documents multiply the wait time',
        desc: 'University or migration packages often involve 5–10 documents. Preparing drafts for all of them before one notary session significantly reduces the overall timeline.',
      },
      {
        title: 'Clients arrive unprepared, extending appointment duration',
        desc: 'For notaries and visa agents, clients who arrive with a clear draft are faster to process. The translated draft also helps clients understand what they are signing.',
      },
    ],
  },

  trust: {
    items: [
      ...defaultTrustItems,
      {
        icon: Users,
        title: 'Used by notaries and migration consultants',
        desc: 'Professional consultants use WPO to prepare client document drafts before certified translation appointments, reducing time and cost for everyone involved.',
      },
    ],
  },

  pricing: {
    headline: 'Pricing',
    tiers: defaultPricingTiers,
    footnote: defaultPricingFootnote,
  },

  faq: {
    items: [
      {
        q: 'Is this a certified or notarized translation?',
        a: 'No. WPO provides unofficial translation drafts for informational and preparation purposes. A certified or notarized translation must be produced by a licensed translator or notary. WPO drafts can be used as input to that process, not as a replacement.',
      },
      {
        q: 'Will my notary accept a WPO translation draft as a starting point?',
        a: 'Most notaries and certified translators are willing to work from a pre-prepared draft. It speeds up their work and reduces the likelihood of errors. However, not all notaries accept external drafts — confirm with your specific notary before using this workflow.',
      },
      {
        q: 'What languages are supported?',
        a: 'Russian ↔ English, Kazakh → English, and Kazakh → Russian. These cover the main language pairs for documents prepared in Kazakhstan for international use.',
      },
      {
        q: 'Can I use this service as a notary or migration consultant?',
        a: 'Yes. You can upload client documents and receive translated drafts on their behalf. A dedicated partner workflow is in development.',
      },
    ],
  },

  finalCta: {
    headline: 'Prepare a clean translation draft before your notary appointment',
    sub: 'Upload your document and receive a structured translation in 2–5 minutes. От 2 290 ₸.',
    cta: 'Create Translation Draft',
  },

  structuredData: [
    {
      '@context': 'https://schema.org',
      '@type': 'Service',
      name: 'Notary Translation Draft — Kazakhstan — WPO Online Translations',
      description: 'Clean translation drafts for notary review in Kazakhstan. Upload your document and receive a structured translation to present to a notary or certified translator.',
      provider: { '@type': 'Organization', name: 'WPO Online Translations', url: 'https://wpo.online' },
      areaServed: 'Kazakhstan',
      serviceType: 'Document Translation',
    },
  ],
};

export const kazakhstanUniversityConfig: LandingPageConfig = {
  title: 'Academic Document Translation for University Applications — Kazakhstan — WPO Translations',
  description:
    'Translate diplomas, transcripts, school certificates, and academic documents for international university applications. Clean English output, preserved academic formatting.',

  breadcrumb: [
    { label: 'WPO Translations', href: '/' },
    { label: 'Kazakhstan', href: '/kazakhstan' },
    { label: 'University Document Translation', href: '/kazakhstan/university-document-translation' },
  ],

  hero: {
    badge: 'Kazakhstan · University Applications',
    headline: 'Translate Academic Documents',
    accentLine: 'for International University Applications',
    subheadline:
      'Get clean English translations of diplomas, transcripts, school certificates, and academic records for university applications in the UK, US, Europe, Canada, and beyond.',
    ctaLabel: 'Translate Academic Documents',
    ctaHref: '/auth/signup',
    trustLine: 'От 2 590 ₸ · Diploma & Transcript formats · RU / EN',
  },

  howItWorks: {
    steps: defaultHowItWorksSteps,
  },

  docs: {
    headline: 'Supported academic document types',
    items: [
      { icon: GraduationCap, name: 'Bachelor / Master Diploma' },
      { icon: BookOpen, name: 'Academic Transcript' },
      { icon: FileText, name: 'School Leaving Certificate (Attestat)' },
      { icon: FileText, name: 'Grade Transcripts & Supplements' },
      { icon: FileHeart, name: 'Birth Certificate (for enrollment)' },
      { icon: IdCard, name: 'Passport (for enrollment)' },
      { icon: Briefcase, name: 'Research / Employment Certificate' },
      { icon: HeartPulse, name: 'Medical Certificate (for admission)' },
    ],
  },

  pain: {
    headline: 'University application translation — where it gets complicated',
    points: [
      {
        title: 'International universities require precise academic terminology',
        desc: 'A diploma from a Kazakhstani university contains specific field-of-study names, department names, and qualification titles that must be translated using internationally recognised terminology.',
      },
      {
        title: 'Transcripts have structured tables — poorly formatted output gets rejected',
        desc: 'Academic transcripts contain subject names, credit hours, and grades in tabular format. Generic translation tools convert them to unstructured text. WPO preserves the structure.',
      },
      {
        title: 'Tight admission deadlines leave no time for agency delays',
        desc: 'University application windows are narrow. Getting a translation in 2–5 minutes versus waiting days from a bureau can determine whether you submit on time.',
      },
      {
        title: 'Education consultants need fast drafts for multiple clients at once',
        desc: 'Agencies handling multiple university applications simultaneously need a scalable, fast translation tool — not a per-client bureau negotiation.',
      },
    ],
  },

  trust: {
    items: defaultTrustItems,
  },

  pricing: {
    headline: 'Pricing for academic document translation',
    tiers: defaultPricingTiers,
    footnote: defaultPricingFootnote,
  },

  faq: {
    items: [
      {
        q: 'Will foreign universities accept a WPO translation?',
        a: 'Requirements vary by university and country. Many universities accept unofficial translations for initial application review, with certified translations required only after acceptance or at enrollment. Always check the specific requirements for your target university.',
      },
      {
        q: 'What is a "school leaving certificate" (Attestat)?',
        a: 'The Attestat is the Kazakhstani secondary school completion certificate. It lists final grades in all subjects. We translate the complete document including subject names, grades, and qualification details into clean English.',
      },
      {
        q: 'Do you preserve the grade scale and grading system?',
        a: 'Yes. We preserve the original grades as shown (e.g., 5-point or 100-point scale) and note the grading system in the translated document. We do not convert grades or apply any interpretation.',
      },
      {
        q: 'Can you translate documents for IELTS, TOEFL, or credential evaluation purposes?',
        a: 'WPO translations are unofficial. They are not accepted by IELTS/TOEFL administrative bodies for formal score reporting. However, they can be used for your own preparation, for informal application review, or as input to a certified translation workflow.',
      },
    ],
  },

  finalCta: {
    headline: 'Prepare your university application documents',
    sub: 'Upload your diploma, transcript, or academic certificate and get a clean English translation in minutes.',
    cta: 'Translate My Academic Documents',
  },

  structuredData: [
    {
      '@context': 'https://schema.org',
      '@type': 'Service',
      name: 'Academic Document Translation — Kazakhstan — WPO Online Translations',
      description: 'Translate diplomas, transcripts, and academic certificates from Kazakhstan for international university applications.',
      provider: { '@type': 'Organization', name: 'WPO Online Translations', url: 'https://wpo.online' },
      areaServed: 'Kazakhstan',
      serviceType: 'Document Translation',
    },
  ],
};

export const kazakhstanCertifiedConfig: LandingPageConfig = {
  title: 'Сертифицированный перевод документов в Казахстане — WPO Translations',
  description:
    'Официальный перевод с проверкой переводчиком, подписью переводчика и печатью Исполнителя. Для банков, университетов, миграции, визовых и официальных задач.',

  breadcrumb: [
    { label: 'WPO Translations', href: '/' },
    { label: 'Казахстан', href: '/kazakhstan' },
    { label: 'Сертифицированный перевод', href: '/kazakhstan/certified-translation' },
  ],

  hero: {
    badge: 'Казахстан · Официальный перевод',
    headline: 'Сертифицированный перевод',
    accentLine: 'документов онлайн',
    subheadline:
      'Закажите официальный перевод с проверкой переводчиком, подписью переводчика и печатью Исполнителя. Для банков, университетов, миграции, визовых и официальных задач.',
    ctaLabel: 'Заказать официальный перевод',
    ctaHref: '/auth/signup',
    trustLine: 'Принятие перевода третьими лицами не гарантируется и зависит от требований принимающей организации.',
  },

  docs: {
    headline: 'Поддерживаемые документы',
    sectionLabel: 'ДОКУМЕНТЫ',
    items: [
      { icon: GraduationCap, name: 'Диплом и транскрипт' },
      { icon: FileHeart, name: 'Свидетельство о рождении и браке' },
      { icon: IdCard, name: 'Паспорт и удостоверение личности' },
      { icon: Landmark, name: 'Банковская выписка' },
      { icon: Briefcase, name: 'Трудовой договор и справка' },
      { icon: Shield, name: 'Справка об отсутствии судимости' },
    ],
  },

  pain: {
    headline: 'Официальный перевод — отдельный уровень услуги',
    sectionLabel: 'ЧТО ВКЛЮЧЕНО',
    bridgeLabel: 'WPO помогает',
    points: [
      {
        title: 'Проверка переводчиком',
        desc: 'Перевод проверяется человеком-переводчиком. При необходимости исправляются ошибки OCR, терминология и формат.',
      },
      {
        title: 'Подпись переводчика',
        desc: 'Итоговый документ может содержать подпись переводчика и блок переводчика.',
      },
      {
        title: 'Печать Исполнителя',
        desc: 'Для официального уровня в документ может быть добавлена печать Исполнителя.',
      },
      {
        title: 'Без гарантии принятия',
        desc: 'Банки, университеты, консульства и другие организации могут иметь собственные требования. Их нужно проверить заранее.',
      },
    ],
  },

  pricing: {
    headline: 'Цены',
    subheadline: 'Электронный перевод оплачивается по базовой цене. Официальный перевод является отдельным уровнем услуги.',
    tiers: defaultPricingTiers,
    footnote: defaultPricingFootnote,
  },

  faq: {
    items: [
      {
        q: 'Это нотариальный перевод?',
        a: 'Нет. Сертифицированный / официальный перевод WPO сам по себе не является нотариальным удостоверением. Нотариальное удостоверение оформляется отдельно через партнёрский процесс, если такая услуга доступна.',
      },
      {
        q: 'Что входит в официальный перевод?',
        a: 'Проверка переводчиком, подпись переводчика, печать Исполнителя, дата и блок переводчика, если такой уровень услуги доступен и выбран при оформлении заказа.',
      },
      {
        q: 'Гарантируете ли вы принятие перевода?',
        a: 'Нет. Принятие перевода зависит от требований конкретного банка, университета, консульства, миграционного органа, нотариуса или другой организации.',
      },
      {
        q: 'Когда нужен официальный перевод?',
        a: 'Обычно он нужен, когда принимающая сторона требует перевод с подписью переводчика, печатью исполнителя или дополнительным подтверждением, а обычного электронного перевода недостаточно.',
      },
      {
        q: 'Можно ли потом добавить нотариальное удостоверение?',
        a: 'В некоторых случаях да, если доступен партнёрский процесс для выбранного документа, языка и юрисдикции. Возможность и стоимость подтверждаются отдельно.',
      },
    ],
  },

  finalCta: {
    headline: 'Нужен официальный перевод?',
    sub: 'Загрузите документ, выберите официальный уровень услуги и проверьте итоговую стоимость до оплаты.',
    cta: 'Начать перевод',
  },

  structuredData: [
    {
      '@context': 'https://schema.org',
      '@type': 'Service',
      name: 'Сертифицированный перевод — Казахстан — WPO Translations',
      description: 'Официальный перевод с проверкой переводчиком, подписью переводчика и печатью Исполнителя для Казахстана.',
      provider: { '@type': 'Organization', name: 'WPO Translations', url: 'https://wpotranslations.org' },
      areaServed: 'Kazakhstan',
      serviceType: 'Document Translation',
    },
  ],
};

